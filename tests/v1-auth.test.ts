import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, link, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loginCodex, logoutCodex, codexAuthorization } from "../src/auth.ts";
import { createConfiguredModel, listCodexModels } from "../src/providers.ts";
import { runTurn } from "../src/runtime.ts";
import { codexSse } from "./model-fixture.ts";

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
  return codexSse(snapshot(items), fragmented);
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

test("subscription model discovery uses only the fixed authenticated catalog and ignores remote instructions", async () => {
  await fresh(); await login();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const target = new URL(String(url));
    assert.equal(target.origin + target.pathname, "https://chatgpt.com/backend-api/codex/models");
    assert.deepEqual([...target.searchParams.keys()], ["client_version"]);
    assert.ok(target.searchParams.get("client_version"));
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("ChatGPT-Account-ID"), "synthetic-account");
    assert.match(headers.get("Authorization")!, /^Bearer /);
    assert.equal(headers.get("x-api-key"), null);
    return json({ models: [
      { slug: "fixture-second", visibility: "list", priority: 20, base_instructions: "synthetic-private-value", guardian: { allow_everything: true } },
      { slug: "fixture-first", visibility: "list", priority: 10, supported_in_api: false },
      { slug: "fixture-first", visibility: "list", priority: 99 },
      { slug: "fixture-hidden", visibility: "hide", priority: -1 },
      { slug: "bad\nmodel", visibility: "list", priority: -2 },
      { slug: "sk-proj-" + "s".repeat(60), visibility: "list", priority: -3 },
    ] });
  };
  assert.deepEqual(await listCodexModels(), [{ id: "fixture-first" }, { id: "fixture-second" }]);
  assert.equal(calls, 1);
  await assert.rejects(listCodexModels({ baseURL: "https://api.openai.com/v1" }), /fixed Codex/);
  assert.equal(calls, 1);
});

test("catalog denial, malformed or oversized data never leaks, guesses a model or falls back", async () => {
  await fresh(); await login();
  for (const response of [
    () => json({ error: { code: "model_not_found", message: "synthetic-private-value" } }, 403),
    () => json({ models: [] }),
    () => json({ models: "synthetic-private-value" }),
    () => json({ models: Array.from({ length: 257 }, () => ({ slug: "fixture", visibility: "list" })) }),
    () => new Response("synthetic-private-value", { headers: { "Content-Type": "text/html" } }),
    () => json({ models: [], ignored: "synthetic-private-value".repeat(500000) }),
    () => new Response(null, { status: 302, headers: { Location: "https://evil.invalid" } }),
  ]) {
    let calls = 0;
    globalThis.fetch = async (url) => { calls++; assert.equal(new URL(String(url)).hostname, "chatgpt.com"); return response(); };
    await assert.rejects(listCodexModels(), (error: Error) => !error.message.includes("synthetic-private-value") && /catalog|discovery/.test(error.message));
    assert.equal(calls, 1);
  }
});

test("catalog cancellation stops stalled reads and never constructs a model request", async () => {
  await fresh(); await login();
  const controller = new AbortController(); let cancelled = false;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(String(url)).pathname, "/backend-api/codex/models");
    return new Response(new ReadableStream({ pull() { controller.abort(); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
  };
  await assert.rejects(listCodexModels({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(cancelled, true);
  globalThis.fetch = async () => { throw new Error("Must not fetch"); };
  await assert.rejects(listCodexModels({ signal: controller.signal }), { name: "AbortError" });
});

test("catalog deadline includes header latency and continuously fulfilled reads", async (context) => {
  await fresh(); await login();
  const now = performance.now.bind(performance);
  let advanced = 0; let reads = 0; let cancelled = false;
  context.mock.method(performance, "now", () => now() + advanced);
  globalThis.fetch = async () => {
    advanced = 4000;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++reads <= 10) { advanced += 400; controller.enqueue(new Uint8Array(0)); }
        else { controller.enqueue(new TextEncoder().encode(JSON.stringify({ models: [{ slug: "fixture", visibility: "list" }] }))); controller.close(); }
      },
      cancel() { cancelled = true; },
    }), { headers: { "Content-Type": "application/json" } });
  };
  await assert.rejects(listCodexModels(), /catalog was invalid, oversized or stalled/);
  assert.ok(reads < 6, "Header time must not create a second full body-read budget");
  assert.equal(cancelled, true);
});

test("subscription requests carry only OAuth/account headers, current instructions, forced stream/store flags", async (context) => {
  await fresh(); await login();
  const expectedAccess = JSON.parse(await readFile(filename(), 'utf8')).access;
  const now = Date.now();
  context.mock.method(Date, 'now', () => now + 2000);
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), CODEX_URL);
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${expectedAccess}`);
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

for (const scenario of ['caller', 'timeout', 'logout']) {
  test(`completed refresh persistence honors ${scenario} cancellation without inference`, async () => {
    const source = String.raw`
      import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
      import os from 'node:os'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
      const scenario = process.argv[1];
      const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-refresh-persist-')));
      process.env.NEURA_HOME = scratch; process.env.HOME = scratch; process.env.USERPROFILE = scratch;
      const filename = path.join(scratch, 'codex-auth.json');
      const jwt = 'synthetic.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600, 'https://api.openai.com/auth': { chatgpt_account_id:'synthetic-account' } })).toString('base64url') + '.unsigned';
      await fs.writeFile(filename, JSON.stringify({ version:1, access:jwt, refresh:'synthetic-old', expires:1, accountId:'synthetic-account' }), { mode:0o600 });
      const caller = new AbortController(); const timeout = new AbortController();
      const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = ms => ms === 15000 ? timeout.signal : nativeTimeout(ms);
      let persisting = false; let publications = 0; let requests = 0; let logout;
      let logoutCodex;
      const open = fs.open; const realpath = fs.realpath; const rename = fs.rename;
      fs.open = async (...args) => {
        const file = await open(...args);
        if (args[1] === 'wx' && path.basename(String(args[0])).startsWith('.codex-auth.')) {
          persisting = true; const sync = file.sync.bind(file);
          file.sync = async () => { await sync(); if (scenario === 'caller') caller.abort(); if (scenario === 'timeout') timeout.abort(new DOMException('Synthetic deadline', 'TimeoutError')); };
        }
        return file;
      };
      fs.realpath = async (...args) => {
        const result = await realpath(...args);
        if (persisting && scenario === 'logout' && !logout) logout = logoutCodex();
        return result;
      };
      fs.rename = async (...args) => { publications++; return rename(...args); };
      syncBuiltinESMExports();
      globalThis.fetch = async (url, init) => {
        requests++;
        assert.equal(String(url), 'https://auth.openai.com/oauth/token', 'no inference/API fallback after cancellation');
        assert.equal(new URLSearchParams(String(init.body)).get('refresh_token'), 'synthetic-old');
        return new Response(JSON.stringify({ access_token:jwt, refresh_token:'synthetic-rotated', expires_in:3600, token_type:'Bearer' }), { headers:{'content-type':'application/json'} });
      };
      try {
        ({ logoutCodex } = await import('./src/auth.ts'));
        const { createConfiguredModel } = await import('./src/providers.ts');
        const model = createConfiguredModel({ provider:'openai-codex', model:'synthetic' });
        await assert.rejects(model.doGenerate({ prompt:[{role:'user',content:[{type:'text',text:'Synthetic input'}]}], abortSignal:caller.signal }), { name: scenario === 'timeout' ? 'TimeoutError' : 'AbortError' });
        assert.equal(persisting, true, 'cancel only after successful refresh reaches persistence');
        assert.equal(requests, 1);
        if (scenario === 'logout') {
          await logout;
          await assert.rejects(fs.stat(filename), { code:'ENOENT' });
          assert.equal(publications, 0, 'logout before rename must prevent credential publication');
        } else {
          assert.equal(JSON.parse(await fs.readFile(filename, 'utf8')).refresh, 'synthetic-rotated');
          assert.equal(publications, 1);
        }
        assert.ok(!(await fs.readdir(scratch)).some(name => name.startsWith('.codex-auth.') || name.endsWith('.lock')));
        console.log('completed refresh cancellation passed: ' + scenario);
      } finally { await fs.rm(scratch, { recursive:true, force:true }); }
    `;
    const reply = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, scenario], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp)$/i.test(key))),
      timeout: 20000,
    });
    assert.match(reply.stdout, new RegExp(`completed refresh cancellation passed: ${scenario}`));
    assert.equal(reply.stderr, '');
  });
}

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

test("backend rejection hints recognize only safe model, field and quota categories", async () => {
  await fresh(); await login();
  const privateText = "synthetic-private-value";
  const cases: Array<[unknown, RegExp]> = [
    [{ error: { code: "model_not_found", message: privateText } }, /selected model is unavailable/],
    [{ detail: "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account." }, /selected model is unavailable/],
    [{ error: { code: "unsupported_parameter", param: "max_output_tokens", message: privateText } }, /rejected request field: max_output_tokens/],
    [{ detail: "Unsupported parameter: max_output_tokens" }, /rejected request field: max_output_tokens/],
    [{ error: { type: "invalid_request_error", param: "reasoning.effort", message: privateText } }, /rejected request field: reasoning\.effort/],
    [{ error: { code: "insufficient_quota", message: privateText } }, /subscription quota or usage limit/],
    [{ error: { code: privateText, param: privateText, message: privateText } }, /No recognized safe backend reason/],
    [{ detail: "Unsupported parameter: temperature2" }, /No recognized safe backend reason/],
    [{ detail: "Unsupported parameter: model-private" }, /No recognized safe backend reason/],
    [{ detail: "Unrecognized parameter: input[0].private" }, /No recognized safe backend reason/],
    [{ detail: "The model is available; the requested resource was not found" }, /No recognized safe backend reason/],
    [{ error: { code: ["model_not_found"] } }, /No recognized safe backend reason/],
    [{ error: { code: { toString: "model_not_found" } } }, /No recognized safe backend reason/],
  ];
  for (const [body, expected] of cases) {
    globalThis.fetch = async (url) => { assert.equal(String(url), CODEX_URL); return json(body, 400); };
    for (const invoke of [async () => model().doGenerate({ prompt }), async () => model().doStream({ prompt })]) {
      await assert.rejects(invoke, (error: Error) => expected.test(error.message) && /no API billing fallback/.test(error.message) && !error.message.includes(privateText));
    }
  }
});

test("backend error hints bound body size and time without disclosing raw errors", async () => {
  await fresh(); await login();
  for (const response of [
    () => json({ error: { code: "model_not_found", message: "synthetic-private-value".repeat(500) } }, 400),
    () => new Response("synthetic-private-value", { status: 400, headers: { "Content-Type": "text/html" } }),
    () => new Response("invalid synthetic-private-value", { status: 400, headers: { "Content-Type": "application/json" } }),
    () => new Response(null, { status: 400 }),
  ]) {
    globalThis.fetch = async () => response();
    await assert.rejects(async () => model().doGenerate({ prompt }), (error: Error) => /No recognized safe backend reason/.test(error.message) && !error.message.includes("synthetic-private-value"));
  }
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 400, headers: { "Content-Type": "application/json" } });
  const started = Date.now();
  await assert.rejects(async () => model().doGenerate({ prompt }), /No recognized safe backend reason/);
  assert.ok(Date.now() - started < 6000, "A stalled error body must not hang the CLI");
  assert.equal(cancelled, true);
});

test("continuously fulfilled empty error reads cannot bypass the monotonic deadline", async (context) => {
  await fresh(); await login();
  const now = performance.now.bind(performance);
  let expired = false;
  context.mock.method(performance, "now", () => now() + (expired ? 2000 : 0));
  for (const invoke of [async () => model().doGenerate({ prompt }), async () => model().doStream({ prompt })]) {
    expired = false;
    let reads = 0; let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++reads <= 10) {
          if (reads === 8) expired = true;
          controller.enqueue(new Uint8Array(0));
        } else {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code: "model_not_found" } })));
          controller.close();
        }
      },
      cancel() { cancelled = true; },
    }), { status: 400, headers: { "Content-Type": "application/json" } });
    await assert.rejects(invoke, /No recognized safe backend reason/);
    assert.ok(reads < 11, "The reader must stop before consuming the late recognized error");
    assert.equal(cancelled, true);
  }
});

test("aborting a backend error read preserves cancellation rather than classifying a failure", async () => {
  await fresh(); await login();
  const controller = new AbortController(); let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ pull() { controller.abort(); }, cancel() { cancelled = true; } }), { status: 400, headers: { "Content-Type": "application/json" } });
  await assert.rejects(async () => model().doGenerate({ prompt, abortSignal: controller.signal }), { name: "AbortError" });
  assert.equal(cancelled, true);
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
