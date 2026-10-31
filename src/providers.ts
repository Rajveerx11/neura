import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { codexAuthorization } from "./auth.ts";
import { readFile } from "node:fs/promises";
import { redactSensitiveText } from "../agent/neura/redaction.ts";

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
// Match the official Codex transport's default stream-idle budget, without its retries.
const STREAM_IDLE_TIMEOUT_MS = 300_000;
const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models";

function codexHeaders(access: string, accountId: string, accept: string): Headers {
  return new Headers({ "Content-Type": "application/json", Accept: accept, Authorization: `Bearer ${access}`, "ChatGPT-Account-ID": accountId, originator: "neura", "User-Agent": "neura" });
}

type CodexResponse = { status: "completed"; output: Record<string, unknown>[]; [key: string]: unknown };

function completedCodexResponse(value: unknown): CodexResponse {
  const response = value as CodexResponse | null;
  if (!response || response.status !== "completed" || (response.error !== undefined && response.error !== null) || !Array.isArray(response.output) || response.output.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`Codex response did not complete; ${codexDenialReason(value)}; no API billing fallback was used`);
  }
  return response;
}

/** Replay an already completed response through the SDK's existing SSE decoder. */
function codexCompletedStream(response: CodexResponse): Response {
  const events: Record<string, unknown>[] = [{ type: "response.created", response: { ...response, output: [] } }];
  for (const [output_index, item] of response.output.entries()) {
    if (typeof item.type !== "string" || !["message", "function_call", "reasoning"].includes(item.type)) throw new Error("Unsupported completed Codex output; raw details withheld");
    events.push({ type: "response.output_item.added", output_index, item: { ...item, content: [], arguments: "", summary: [] } });
    if (item.type === "message") {
      if (!Array.isArray(item.content)) throw new Error("Invalid completed Codex message; raw details withheld");
      for (const [content_index, part] of item.content.entries()) {
        if (part?.type !== "output_text" || typeof part.text !== "string") throw new Error("Unsupported completed Codex content; raw details withheld");
        events.push({ type: "response.output_text.delta", item_id: item.id, output_index, content_index, delta: part.text });
        if (Array.isArray(part.annotations)) for (const annotation of part.annotations) events.push({ type: "response.output_text.annotation.added", item_id: item.id, output_index, content_index, annotation });
      }
    } else if (item.type === "function_call") {
      if (typeof item.arguments !== "string") throw new Error("Invalid completed Codex tool call; raw details withheld");
      events.push({ type: "response.function_call_arguments.delta", item_id: item.id, output_index, delta: item.arguments });
    } else if (Array.isArray(item.summary)) {
      for (const [summary_index, part] of item.summary.entries()) {
        if (part?.type !== "summary_text" || typeof part.text !== "string") throw new Error("Invalid completed Codex reasoning; raw details withheld");
        events.push({ type: "response.reasoning_summary_part.added", item_id: item.id, output_index, summary_index, part: { type: "summary_text", text: "" } }, { type: "response.reasoning_summary_text.delta", item_id: item.id, output_index, summary_index, delta: part.text }, { type: "response.reasoning_summary_part.done", item_id: item.id, output_index, summary_index, part });
      }
    }
    events.push({ type: "response.output_item.done", output_index, item });
  }
  events.push({ type: "response.completed", response });
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
}

/** The terminal completed snapshot is authoritative; truncated streams must not become successful turns. */
async function codexSnapshot(response: Response, signal?: AbortSignal): Promise<Response> {
  if (!response.body) throw new Error("Codex response has no stream");
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let size = 0;
  let expired = false;
  let idleDeadline = performance.now() + STREAM_IDLE_TIMEOUT_MS;
  const expire = () => { expired = true; abort(); };
  let idleTimer = setTimeout(expire, STREAM_IDLE_TIMEOUT_MS);
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (expired || performance.now() >= idleDeadline) throw new Error("Codex response exceeded its stream idle deadline");
      size += value?.length ?? 0;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Codex response exceeds size limit");
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
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
        idleDeadline = performance.now() + STREAM_IDLE_TIMEOUT_MS;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(expire, STREAM_IDLE_TIMEOUT_MS);
        if (["error", "response.error", "response.failed", "response.incomplete"].includes(payload.type ?? "")) throw new Error("Codex response did not complete");
        if (payload.type === "response.completed") {
          return new Response(JSON.stringify(completedCodexResponse(payload.response)), { headers: { "Content-Type": "application/json" } });
        }
      }
      if (done) throw new Error("Codex stream ended without a completed response");
    }
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Shared bounded reader: no provider-controlled error text escapes this helper. */
async function readJsonResponse(response: Response, maxBytes: number, timeoutMs: number, signal?: AbortSignal, absoluteDeadline?: number): Promise<unknown> {
  if (!response.body) { signal?.throwIfAborted(); throw new Error("Provider JSON body missing"); }
  const reader = response.body.getReader();
  let stopped = false;
  const stop = () => { stopped = true; void reader.cancel().catch(() => undefined); };
  const deadline = Math.min(performance.now() + timeoutMs, absoluteDeadline ?? Infinity);
  const timer = setTimeout(stop, Math.max(0, deadline - performance.now()));
  signal?.addEventListener("abort", stop, { once: true });
  try {
    signal?.throwIfAborted();
    if (!/^application\/(?:json|problem\+json)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("Provider JSON content type required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (stopped || performance.now() >= deadline) throw new Error("Provider JSON read deadline exceeded");
      if (done) break;
      if (!value.length) continue;
      size += value.length;
      if (size > maxBytes) throw new Error("Provider JSON body too large");
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
    catch { throw new Error("Provider JSON body invalid"); }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    stop();
    reader.releaseLock();
  }
}

/** Expose fixed hints and allowlisted public field names, never raw error data. */
function codexDenialReason(value: unknown): string {
  const unknown = "No recognized safe backend reason; raw details withheld";
  const payload = value as { error?: { code?: unknown; type?: unknown; param?: unknown; message?: unknown }; detail?: unknown } | null;
  const error = payload?.error;
  const rawCode = error?.code ?? error?.type;
  const code = typeof rawCode === "string" ? rawCode : undefined;
  const message = typeof error?.message === "string" ? error.message : typeof payload?.detail === "string" ? payload.detail : "";
  if (["model_not_found", "unsupported_model", "model_not_available"].includes(code ?? "") || /^(?:the )?(?:['"][a-z0-9._-]{1,128}['"] )?model (?:is )?not (?:supported|available|found)(?: when using Codex with a ChatGPT account)?\.?$/i.test(message.trim())) {
    return "The selected model is unavailable; verify the model name and subscription entitlement";
  }
  if (code === "insufficient_quota" || code === "rate_limit_exceeded") return "The backend reports a subscription quota or usage limit";
  const unsupported = /^(?:unsupported|unrecognized|unknown) parameter:\s*(\S+)$/i.exec(message.trim());
  const detailField = unsupported?.[1].replace(/^(['"])(.*)\1$/, "$2");
  const field = typeof error?.param === "string" ? error.param : detailField;
  const fields = ["model", "instructions", "stream", "store", "tools", "tool_choice", "input", "max_output_tokens", "reasoning", "reasoning.effort", "temperature", "top_p", "include"];
  if (field && fields.includes(field) && (unsupported || ["invalid_request_error", "unsupported_parameter", "invalid_value"].includes(code ?? ""))) {
    return `The backend rejected request field: ${field}`;
  }
  return unknown;
}

async function codexDenialHint(response: Response, signal?: AbortSignal, deadline?: number, requestSignal = signal): Promise<string> {
  try { return codexDenialReason(await readJsonResponse(response, 8192, 1000, requestSignal, deadline)); }
  catch { signal?.throwIfAborted(); return codexDenialReason(null); }
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
  const headers = codexHeaders(access, accountId, "text/event-stream");
  let response: Response;
  try { response = await fetch(CODEX_ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal }); }
  catch { signal?.throwIfAborted(); throw new Error("Codex subscription request failed"); }
  if (!response.ok) {
    const hint = await codexDenialHint(response, signal);
    throw new Error(`Codex subscription request denied (${response.status}); ${hint}; no API billing fallback was used`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType === "text/event-stream") return streaming ? response : codexSnapshot(response, signal);
  if (contentType === "application/json") {
    let value: unknown;
    try { value = await readJsonResponse(response, MAX_RESPONSE_BYTES, 30_000, signal); }
    catch { signal?.throwIfAborted(); throw new Error("Codex JSON response was invalid, oversized or stalled; raw details withheld"); }
    const completed = completedCodexResponse(value);
    return streaming ? codexCompletedStream(completed) : new Response(JSON.stringify(completed), { headers: { "Content-Type": "application/json" } });
  }
  // The official Codex HTTP transport parses successful response bytes as SSE without a MIME gate.
  // Buffer mismatched/missing MIME until completion so HTML and partial streams cannot become success.
  try {
    const snapshot = await codexSnapshot(response, signal);
    return streaming ? codexCompletedStream(completedCodexResponse(await snapshot.json())) : snapshot;
  } catch {
    signal?.throwIfAborted();
    const publicTypes = ["text/plain", "text/html", "application/octet-stream", "application/x-ndjson", "application/json-seq", "text/x-component"];
    const label = publicTypes.find(type => type === contentType) ?? (contentType ? "other" : "missing");
    throw new Error(`Codex subscription did not return completed Responses SSE (HTTP ${response.status}; content-type ${label}); raw details withheld; no API billing fallback was used`);
  }
}

export type SubscriptionModel = { id: string };

/** Explicit metadata discovery only; never import catalog instructions, policies or tools. */
export async function listCodexModels({ signal, baseURL }: { signal?: AbortSignal; baseURL?: string } = {}): Promise<SubscriptionModel[]> {
  if (baseURL) throw new Error("ChatGPT subscription uses only the fixed Codex endpoint");
  signal?.throwIfAborted();
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof version !== "string" || version.length > 80) throw new Error("Neura client version is invalid");
  const { access, accountId } = await codexAuthorization(signal);
  const deadline = performance.now() + 5000;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const url = new URL(CODEX_MODELS_ENDPOINT);
  url.searchParams.set("client_version", version);
  let response: Response;
  try { response = await fetch(url.href, { method: "GET", headers: codexHeaders(access, accountId, "application/json"), redirect: "error", signal: requestSignal }); }
  catch { signal?.throwIfAborted(); throw new Error("Subscription model discovery failed; no API billing fallback was used"); }
  if (!response.ok) {
    const hint = await codexDenialHint(response, signal, deadline, requestSignal);
    throw new Error(`Subscription model discovery denied (${response.status}); ${hint}; no API billing fallback was used`);
  }
  let payload: unknown;
  try { payload = await readJsonResponse(response, MAX_RESPONSE_BYTES, 5000, requestSignal, deadline); }
  catch { signal?.throwIfAborted(); throw new Error("Subscription model catalog was invalid, oversized or stalled; raw details withheld"); }
  const models = (payload as { models?: unknown } | null)?.models;
  if (!Array.isArray(models) || models.length > 256) throw new Error("Subscription model catalog has an invalid shape; raw details withheld");
  const choices = new Map<string, number>();
  for (const [index, model] of models.entries()) {
    if (!model || typeof model !== "object" || model.visibility !== "list" || typeof model.slug !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model.slug)) continue;
    if (redactSensitiveText(model.slug, 256) !== model.slug) continue;
    if (!choices.has(model.slug)) choices.set(model.slug, Number.isSafeInteger(model.priority) ? model.priority : index);
  }
  const result = [...choices].sort((a, b) => a[1] - b[1]).map(([id]) => ({ id }));
  if (!result.length) throw new Error("The subscription catalog advertised no picker-visible models; no default was guessed");
  return result;
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
    configured.doGenerate = async (options) => {
      try {
        const result = await generate(optionsForCodex(options));
        options.abortSignal?.throwIfAborted();
        return result;
      }
      catch (error) {
        options.abortSignal?.throwIfAborted();
        if (error instanceof Error && error.name.startsWith("AI_")) throw new Error("Codex subscription response could not be decoded; raw details withheld");
        throw error;
      }
    };
    configured.doStream = async (options) => {
      const result = await stream(optionsForCodex(options));
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk.type === "error" ? { ...chunk, error: new Error("Codex subscription stream could not be decoded; raw details withheld") } : chunk);
        },
      }), { signal: options.abortSignal }) };
    };
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
