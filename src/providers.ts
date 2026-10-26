import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { codexAuthorization } from "./auth.ts";

export type ProviderConfig = { provider: "local" | "openai" | "anthropic" | "openai-codex"; model: string; baseURL?: string };

type ChatModel = ReturnType<ReturnType<typeof createOpenAI>["chat"]>;
type ModelPrompt = Parameters<ChatModel["doGenerate"]>[0]["prompt"];

function chatImagePrompt(prompt: ModelPrompt): ModelPrompt {
  const result: ModelPrompt = [];
  let images: Extract<ModelPrompt[number], { role: "user" }>["content"] = [];
  for (const message of prompt) {
    if (message.role !== "tool") {
      if (images.length) { result.push({ role: "user", content: images }); images = []; }
      result.push(message);
      continue;
    }
    result.push({ ...message, content: message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "content") return part;
      return { ...part, output: { ...part.output, value: part.output.value.map((content) => {
        if (content.type !== "file" || !content.mediaType.startsWith("image/")) return content;
        images.push({ type: "text", text: `Image from tool ${part.toolName}, call ${part.toolCallId}:` }, content);
        return { type: "text" as const, text: "Tool image follows the tool results." };
      }) } };
    }) });
  }
  if (images.length) result.push({ role: "user", content: images });
  return result;
}

function endpoint(value: string, local: boolean): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Provider URL cannot contain credentials, query, or fragment");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (local ? !loopback || !["http:", "https:"].includes(url.protocol) : url.protocol !== "https:") {
    throw new Error(local ? "Local provider requires a loopback HTTP(S) endpoint" : "API providers require HTTPS");
  }
  return url.href.replace(/\/$/, "");
}

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** The terminal completed snapshot is authoritative; truncated streams must not become successful turns. */
async function codexSnapshot(response: Response, signal?: AbortSignal): Promise<Response> {
  if (!response.body) throw new Error("Codex response has no stream");
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      size += value?.length ?? 0;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Codex response exceeds size limit");
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let payload: { type?: string; response?: { status?: string; output?: unknown[] } };
        try { payload = JSON.parse(data); }
        catch { throw new Error("Invalid Codex stream event"); }
        if (!payload || typeof payload !== "object") throw new Error("Invalid Codex stream event");
        if (["error", "response.error", "response.failed", "response.incomplete"].includes(payload.type ?? "")) throw new Error("Codex response did not complete");
        if (payload.type === "response.completed") {
          if (payload.response?.status !== "completed" || !Array.isArray(payload.response.output)) throw new Error("Invalid completed Codex response");
          return new Response(JSON.stringify(payload.response), { headers: { "Content-Type": "application/json" } });
        }
      }
      if (done) throw new Error("Codex stream ended without a completed response");
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// Protocol reference: @mastra/code-sdk@1.15.0, Apache-2.0; see docs/CODEX_AUTH.md.
async function codexFetch(url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const target = new URL(url instanceof Request ? url.url : url);
  if (target.href !== CODEX_ENDPOINT || init?.method !== "POST" || typeof init.body !== "string") throw new Error("Invalid Codex transport request");
  const signal = init.signal ?? undefined;
  signal?.throwIfAborted();
  const { access, accountId } = await codexAuthorization(signal);
  const body = JSON.parse(init.body);
  const streaming = body.stream === true;
  const instructions: string[] = typeof body.instructions === "string" ? [body.instructions] : [];
  if (Array.isArray(body.input)) body.input = body.input.filter((item: { role?: string; content?: unknown }) => {
    if (item.role !== "system" && item.role !== "developer") return true;
    if (typeof item.content === "string") instructions.push(item.content);
    else if (Array.isArray(item.content)) for (const part of item.content) {
      if (part.type === "input_text" && typeof part.text === "string") instructions.push(part.text);
    }
    return false;
  });
  body.instructions = instructions.join("\n\n");
  body.store = false;
  body.stream = true;
  const headers = new Headers({ "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${access}`, "ChatGPT-Account-ID": accountId, originator: "neura", "User-Agent": "neura" });
  let response: Response;
  try { response = await fetch(CODEX_ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal }); }
  catch { signal?.throwIfAborted(); throw new Error("Codex subscription request failed"); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Codex subscription request denied (${response.status}); no API billing fallback was used`); }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) { await response.body?.cancel(); throw new Error("Codex subscription requires an event stream"); }
  return streaming ? response : codexSnapshot(response, signal);
}

/** API keys come only from the named environment variables; subscription login is separate. */
export function createConfiguredModel({ provider, model, baseURL }: ProviderConfig) {
  if (!model.trim()) throw new Error("Model name is required");
  if (provider === "openai-codex") {
    if (baseURL) throw new Error("ChatGPT subscription uses only the fixed Codex endpoint");
    // The placeholder is never sent: codexFetch replaces all headers with subscription credentials.
    const configured = createOpenAI({ apiKey: "unused-subscription-placeholder", baseURL: "https://chatgpt.com/backend-api/codex", fetch: codexFetch }).responses(model);
    const optionsForCodex = (options: Parameters<ChatModel["doGenerate"]>[0]) => ({ ...options, providerOptions: { ...options.providerOptions, openai: { ...options.providerOptions?.openai, store: false } } });
    // Disable storage before SDK prompt conversion too, so history is inline rather than item references.
    const generate = configured.doGenerate.bind(configured);
    const stream = configured.doStream.bind(configured);
    configured.doGenerate = (options) => generate(optionsForCodex(options));
    configured.doStream = (options) => stream(optionsForCodex(options));
    return configured;
  }
  if (provider === "local") {
    if (!baseURL) throw new Error("Local provider requires an explicit baseURL");
    const configured = createOpenAI({ name: "neura-local", baseURL: endpoint(baseURL, true), apiKey: "local" }).chat(model);
    // Chat Completions serializes tool media as JSON; deliver images in a following user content block.
    const generate = configured.doGenerate.bind(configured);
    const stream = configured.doStream.bind(configured);
    configured.doGenerate = (options) => generate({ ...options, prompt: chatImagePrompt(options.prompt) });
    configured.doStream = (options) => stream({ ...options, prompt: chatImagePrompt(options.prompt) });
    return configured;
  }
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API requires OPENAI_API_KEY; use openai-codex for ChatGPT subscription login");
    return createOpenAI({ apiKey, baseURL: endpoint(baseURL ?? "https://api.openai.com/v1", false) }).responses(model);
  }
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Anthropic API requires ANTHROPIC_API_KEY; subscription login is not implemented");
    return createAnthropic({ apiKey, baseURL: endpoint(baseURL ?? "https://api.anthropic.com/v1", false) })(model);
  }
  throw new Error("Unsupported provider");
}
