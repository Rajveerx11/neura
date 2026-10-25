import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, link, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loginCodex, logoutCodex, codexAuthorization } from "../src/auth.ts";
import { createConfiguredModel } from "../src/providers.ts";
import { runTurn } from "../src/runtime.ts";

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const originalFetch = globalThis.fetch;
const originalHome = process.env.NEURA_HOME;
const sandbox = await mkdtemp(path.join(tmpdir(), "neura-auth-synthetic-"));
// Every operation uses only this synthetic root. Unexpected network calls fail, including API billing.
process.env.NEURA_HOME = sandbox;
after(async () => {
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = originalHome;
  await rm(sandbox, { recursive: true, force: true });
});

const jwt = (accountId = "synthetic-account", exp = Math.floor(Date.now() / 1000) + 3600) => `synthetic.${Buffer.from(JSON.stringify({ exp, "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.unsigned`;
const tokens = (extra: Record<string, unknown> = {}) => ({ access_token: jwt(), refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "Bearer", ...extra });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const filename = () => path.join(process.env.NEURA_HOME!, "codex-auth.json");
let homeIndex = 0;
async function fresh() {
  process.env.NEURA_HOME = path.join(sandbox, String(homeIndex++));
  globalThis.fetch = async () => { throw new Error("Unexpected network request in synthetic test"); };
}

async function callback(url: URL, options: { host?: string; pathname?: string; state?: string; code?: string; duplicate?: boolean; error?: boolean } = {}): Promise<number> {
  const redirect = new URL(url.searchParams.get("redirect_uri")!);
  const query = new URLSearchParams({ state: options.state ?? url.searchParams.get("state")!, code: options.code ?? "synthetic-code" });
  if (options.duplicate) query.append("state", query.get("state")!);
  if (options.error) query.set("error", "access_denied");
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: redirect.port, path: `${options.pathname ?? redirect.pathname}?${query}`, headers: { Host: options.host ?? redirect.host }, method: "GET" }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject); req.end();
  });
}

async function login(value = tokens()) {
  let authorization!: URL;
  let sent!: Promise<number>;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), TOKEN_URL);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.method, "POST");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "synthetic-code");
    assert.equal(body.get("client_id"), authorization.searchParams.get("client_id"));
    assert.equal(body.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
    assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), authorization.searchParams.get("code_challenge"));
    return json(value);
  };
  await loginCodex({ onAuthorize: (url) => { authorization = new URL(url); assert.equal(authorization.origin, "https://auth.openai.com"); assert.equal(authorization.pathname, "/oauth/authorize"); assert.equal(authorization.searchParams.get("code_challenge_method"), "S256"); assert.equal(authorization.searchParams.get("scope"), "openid profile email offline_access"); sent = callback(authorization); } });
  assert.equal(await sent, 200);
  return authorization;
}

const prompt = [{ role: "system" as const, content: "Current Neura instructions" }, { role: "user" as const, content: [{ type: "text" as const, text: "Synthetic request" }] }];
const output = [{ type: "message", id: "msg_synthetic", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Synthetic answer", annotations: [] }] }];
const snapshot = (items: unknown[] = output) => ({ id: "resp_synthetic", created_at: 1, model: "gpt-5.5", status: "completed", output: items, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
function sse(items: unknown[] = output, fragmented = false) {
  const response = snapshot(items);
  const first = items[0] as { type: string; id: string; arguments?: string };
  const added = first.type === "function_call" ? { ...first, arguments: "" } : { ...output[0], content: [] };
  const delta = first.type === "function_call"
    ? { type: "response.function_call_arguments.delta", item_id: first.id, output_index: 0, delta: first.arguments }
    : { type: "response.output_text.delta", item_id: "msg_synthetic", output_index: 0, content_index: 0, delta: "Synthetic answer" };
  const events = [{ type: "response.created", response: { ...response, output: [] } }, { type: "response.output_item.added", output_index: 0, item: added }, delta, { type: "response.output_item.done", output_index: 0, item: items[0] }, { type: "response.completed", response }];
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    if (fragmented) for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

function model() { return createConfiguredModel({ provider: "openai-codex", model: "gpt-5.5" }); }

test("model creation is synchronous and inert, absent Neura login never falls back to API keys", async () => {
  await fresh();
  const configured = model();
  assert.equal(configured.modelId, "gpt-5.5");
  await assert.rejects(async () => configured.doGenerate({ prompt }), /Not logged in.*No API billing fallback/);
  assert.throws(() => createConfiguredModel({ provider: "openai-codex", model: "gpt-5.5", baseURL: "https://api.openai.com/v1" }), /fixed Codex/);
});

test("explicit PKCE browser flow validates callback host, path, state, duplicates, replay, and stores no code", async () => {
  await fresh();
  let requests = 0;
  const failures: number[] = [];
  let callbacks!: Promise<void>;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), TOKEN_URL); requests++;
    assert.equal(init?.redirect, "error");
    return json(tokens());
  };
  await loginCodex({ onAuthorize: (value) => {
    const url = new URL(value);
    callbacks = (async () => {
      for (const invalid of [{ host: "evil.invalid" }, { pathname: "/wrong" }, { state: "0".repeat(64) }, { duplicate: true }]) failures.push(await callback(url, invalid));
      assert.equal(await callback(url), 200);
      // Token exchange yields while the server is still alive: subsequent callbacks cannot exchange again.
      try { const status = await callback(url); assert.equal(status, 409); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED" && (error as NodeJS.ErrnoException).code !== "ECONNRESET") throw error; }
    })();
  } });
  await callbacks;
  assert.deepEqual(failures, [400, 400, 400, 400]);
  assert.equal(requests, 1);
  const stored = await readFile(filename(), "utf8");
  assert.ok(!stored.includes("synthetic-code"));
  assert.ok(!stored.includes("code_verifier"));
  assert.equal(JSON.parse(stored).accountId, "synthetic-account");
  if (process.platform !== "win32") assert.equal((await stat(filename())).mode & 0o077, 0);
  await logoutCodex();
  await assert.rejects(codexAuthorization(), /Not logged in/);
});

test("PKCE verifier matches authorization challenge and browser denial/abort clean up server and lock", async () => {
  await fresh(); await login(); await logoutCodex();
  const controller = new AbortController();
  await assert.rejects(loginCodex({ signal: controller.signal, onAuthorize: () => controller.abort() }), { name: "AbortError" });
  let pending!: Promise<number>;
  await assert.rejects(loginCodex({ onAuthorize: (url) => { pending = callback(new URL(url), { error: true }); } }), /authorization denied/);
  assert.equal(await pending, 400);
  // Rebinding and login after both failures proves server/lock cleanup.
  await login();
});

test("malformed/expired token responses and redirects never save credentials or expose response secrets", async () => {
  for (const value of [tokens({ access_token: "" }), tokens({ expires_in: -1 }), tokens({ expires_in: "3600" }), tokens({ access_token: jwt("synthetic-account", 1) }), tokens({ access_token: "no-account", id_token: undefined }), tokens({ token_type: "Basic" }), tokens({ refresh_token: "unsafe\nheader" })]) {
    await fresh();
    await assert.rejects(login(value), /Invalid Codex token response|expired|identity/);
    await assert.rejects(readFile(filename()), { code: "ENOENT" });
  }
  await fresh();
  let pending!: Promise<number>;
  globalThis.fetch = async (_url, init) => { assert.equal(init?.redirect, "error"); return new Response("synthetic-private-response", { status: 302, headers: { Location: "https://evil.invalid" } }); };
  await assert.rejects(loginCodex({ onAuthorize: (url) => { pending = callback(new URL(url)); } }), (error: Error) => /denied/.test(error.message) && !error.message.includes("synthetic-private-response"));
  await pending;
});

test("subscription requests carry only OAuth/account headers, current instructions, forced stream/store flags", async () => {
  await fresh(); await login();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), CODEX_URL);
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${jwt()}`);
    assert.equal(headers.get("ChatGPT-Account-ID"), "synthetic-account");
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(headers.get("originator"), "neura");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-5.5");
    assert.equal(body.stream, true); assert.equal(body.store, false);
    assert.equal(body.instructions, "Current Neura instructions");
    assert.ok(!body.input.some((item: { role: string }) => ["system", "developer"].includes(item.role)));
    return sse(output, true);
  };
  const generated = await model().doGenerate({ prompt });
  assert.equal(generated.content.find((part) => part.type === "text")?.text, "Synthetic answer");
  const streamed = await model().doStream({ prompt });
  const chunks = [];
  for await (const chunk of streamed.stream) chunks.push(chunk);
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "Synthetic answer"));
  assert.equal(calls, 2);
});

test("actual Agent subscription tool calls/results and native user/tool images survive the wire conversion", async () => {
  await fresh(); await login();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === `data:image/png;base64,${png}`) return new Response(Buffer.from(png, "base64"), { headers: { "Content-Type": "image/png" } });
    assert.equal(String(url), CODEX_URL);
    requests.push(JSON.parse(String(init?.body)));
    return requests.length === 1 ? sse([{ type: "function_call", id: "fc_synthetic", call_id: "image_call", name: "image", arguments: "{}", status: "completed" }]) : sse();
  };
  const result = await runTurn({ model: model(), instructions: "Current Neura instructions", messages: [{ role: "user", content: [{ type: "text", text: "Inspect synthetic images" }, { type: "image", image: `data:image/png;base64,${png}`, mediaType: "image/png" }] }], tools: [{ name: "image", description: "Synthetic image", parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async () => ({ content: [{ type: "text", text: "Synthetic tool result" }, { type: "image", mimeType: "image/png", data: png }] }) }] });
  assert.equal(result.text, "Synthetic answer");
  assert.equal(requests.length, 2, JSON.stringify(result));
  assert.ok(JSON.stringify(requests[0].tools).includes('"name":"image"'));
  const input = requests[1].input as Array<{ type: string; call_id?: string }>;
  assert.ok(input.some((item) => item.type === "function_call_output" && item.call_id === "image_call"));
  assert.equal(JSON.stringify(requests[1]).split('"type":"input_image"').length - 1, 2, JSON.stringify(requests[1]));
  assert.ok(JSON.stringify(requests[1]).includes("Synthetic tool result"));
});

test("store:false is enforced before SDK history conversion, including encrypted reasoning", async () => {
  await fresh(); await login();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), CODEX_URL);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.ok(!body.input.some((item: { type?: string }) => item.type === "item_reference"));
    assert.ok(body.input.some((item: { type?: string; encrypted_content?: string }) => item.type === "reasoning" && item.encrypted_content === "synthetic-encrypted"));
    return sse();
  };
  await model().doGenerate({ prompt: [...prompt, { role: "assistant", content: [{ type: "reasoning", text: "Synthetic reasoning", providerOptions: { openai: { itemId: "rs_synthetic", reasoningEncryptedContent: "synthetic-encrypted" } } }] }, prompt[1]], providerOptions: { openai: { store: true } } });
});

test("expired credentials refresh once under concurrency and atomically retain rotated refresh tokens", async () => {
  await fresh(); await login();
  const stored = JSON.parse(await readFile(filename(), "utf8")); stored.expires = 1;
  await writeFile(filename(), JSON.stringify(stored));
  let refreshes = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), TOKEN_URL); refreshes++;
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "synthetic-refresh");
    assert.equal(init?.redirect, "error");
    return json(tokens({ access_token: jwt(), refresh_token: "synthetic-rotated" }));
  };
  await Promise.all([codexAuthorization(), codexAuthorization(), codexAuthorization()]);
  assert.equal(refreshes, 1);
  assert.equal(JSON.parse(await readFile(filename(), "utf8")).refresh, "synthetic-rotated");
});

test("refresh failure or identity switch denies inference with no API fallback", async () => {
  for (const response of [() => json({ error: "synthetic-private-value" }, 401), () => json(tokens({ access_token: jwt("different-account") }))]) {
    await fresh(); await login();
    const stored = JSON.parse(await readFile(filename(), "utf8")); stored.expires = 1;
    await writeFile(filename(), JSON.stringify(stored));
    globalThis.fetch = async (url) => { assert.equal(String(url), TOKEN_URL); return response(); };
    await assert.rejects(async () => model().doGenerate({ prompt }), (error: Error) => /denied|identity/.test(error.message) && !error.message.includes("synthetic-private-value"));
  }
});

test("abort before request, during refresh, and during SSE prevents completion; logout cancels pending login", async () => {
  await fresh(); await login();
  const before = new AbortController(); before.abort();
  globalThis.fetch = async () => { throw new Error("Must not fetch"); };
  await assert.rejects(async () => model().doGenerate({ prompt, abortSignal: before.signal }), { name: "AbortError" });
  const stored = JSON.parse(await readFile(filename(), "utf8")); stored.expires = 1;
  await writeFile(filename(), JSON.stringify(stored));
  const refresh = new AbortController();
  globalThis.fetch = async (_url, init) => { refresh.abort(); init?.signal?.throwIfAborted(); throw new Error("unreachable"); };
  await assert.rejects(async () => model().doGenerate({ prompt, abortSignal: refresh.signal }), { name: "AbortError" });
  await login();
  const stream = new AbortController(); let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ pull() { stream.abort(); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/event-stream" } });
  await assert.rejects(async () => model().doGenerate({ prompt, abortSignal: stream.signal }), { name: "AbortError" });
  assert.equal(cancelled, true);
  let logout!: Promise<void>;
  await assert.rejects(loginCodex({ onAuthorize: () => { logout = logoutCodex(); } }), { name: "AbortError" });
  await logout;
  await assert.rejects(readFile(filename()), { code: "ENOENT" });
});

test("truncated/error/malformed SSE and unauthorized backend responses fail closed without body diagnostics", async () => {
  await fresh(); await login();
  for (const response of [() => new Response('data: {"type":"response.created"}\n\n', { headers: { "Content-Type": "text/event-stream" } }), () => new Response('data: {"type":"error","error":"synthetic-private-value"}\n\n', { headers: { "Content-Type": "text/event-stream" } }), () => new Response("data: invalid\n\n", { headers: { "Content-Type": "text/event-stream" } }), () => json({ secret: "synthetic-private-value" }, 401), () => json(snapshot())]) {
    globalThis.fetch = async () => response();
    await assert.rejects(async () => model().doGenerate({ prompt }), (error: Error) => /Codex/.test(error.message) && !error.message.includes("synthetic-private-value"));
  }
});

test("auth rejects .pi spellings, linked ancestors/files, hardlinks, and concurrent-process lock claims", async () => {
  await fresh();
  for (const component of [".pi", ".PI", ".pi.", ".pi "]) {
    process.env.NEURA_HOME = path.join(sandbox, component, "owned");
    await assert.rejects(codexAuthorization(), /outside .pi/);
  }
  const target = path.join(sandbox, "link-target"); await mkdir(target);
  const alias = path.join(sandbox, "link-alias"); await symlink(target, alias, "junction");
  process.env.NEURA_HOME = path.join(alias, "nested");
  await assert.rejects(codexAuthorization(), /Linked authentication ancestors/);
  await fresh(); await login();
  const external = path.join(process.env.NEURA_HOME!, "other.json"); await writeFile(external, "synthetic");
  await rm(filename()); await link(external, filename());
  await assert.rejects(codexAuthorization(), /Linked authentication paths/);
  await assert.rejects(logoutCodex(), /Linked authentication paths/);
  await rm(filename()); await symlink(external, filename());
  await assert.rejects(codexAuthorization(), /Linked authentication paths/);
  await fresh(); await mkdir(process.env.NEURA_HOME!, { mode: 0o700 });
  await mkdir(path.join(process.env.NEURA_HOME!, "codex-auth.lock"));
  await assert.rejects(codexAuthorization(), /Authentication is busy/);
});
