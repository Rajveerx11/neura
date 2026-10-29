import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, realpath, rm, writeFile, symlink, readdir, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { once } from "node:events";
import { Type } from "typebox";
import { createTurnTools, runTurn, MAX_TURN_STEPS, type ToolDefinition } from "../src/runtime.ts";
import { createConfiguredModel } from "../src/providers.ts";
import { appendSession, createSession, listSessions, resumeSession, saveSession, MAX_SESSION_MESSAGES, MAX_SESSION_BYTES } from "../src/session.ts";

import { fixture } from "./model-fixture.ts";
import { windowsShortPath } from "./windows-short-path.ts";
import { lockSession } from "../src/session-lock.ts";
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const user = { role: "user", content: "Synthetic test input" };
const text = (value: string) => ({ type: "text" as const, text: value });
const call = (name: string, input: unknown, id = name) => ({ type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) });
const done = [text("Done")];


function action(execute: ToolDefinition["execute"], name = "action"): ToolDefinition {
  return { name, description: "Synthetic action", parameters: Type.Object({ count: Type.Integer({ minimum: 1, maximum: 3 }) }), execute };
}

test("real Agent dispatch executes owned action and returns neutral history/text", async () => {
  const { model, requests } = fixture([[call("action", { count: 2 })], done]);
  let count = 0;
  const streamed: string[] = [];
  const result = await runTurn({ model, messages: [user], instructions: "Test", tools: [action(async (input) => { count += input.count; return { content: [text("Accepted")] }; })], onText: (chunk) => streamed.push(chunk) });
  assert.equal(count, 2);
  assert.equal(result.text, "Done");
  assert.equal(streamed.join(""), "Done");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].tools.map((tool: any) => tool.name), ["action"]);
  assert.equal(result.messages[0].role, "user");
  assert.ok(result.messages.some((message) => message.role === "tool"));
});

test("tool events are live before effects and reveal no arguments, results or exception details", async () => {
  const privateValue = "synthetic-private-value";
  const order: string[] = [];
  const events: unknown[] = [];
  const { model } = fixture([[call("action", { value: privateValue })], done]);
  await runTurn({ model, messages: [user], instructions: "Test", tools: [{ name: "action", description: "Synthetic", parameters: Type.Object({ value: Type.String() }), execute: async () => { order.push("effect"); return { content: [text(privateValue)] }; } }], onToolEvent: event => { events.push(event); order.push(event.phase); } });
  assert.ok(order.includes("requested"));
  assert.ok(order.indexOf("started") >= 0);
  assert.ok(order.indexOf("effect") >= 0);
  assert.ok(order.indexOf("started") < order.indexOf("effect"));
  assert.ok(order.indexOf("returned") > order.indexOf("effect"));
  assert.ok(!JSON.stringify(events).includes(privateValue));
  assert.ok(events.every(event => Object.keys(event as object).sort().join(',') === 'phase,toolName'));
});

test("invalid and denied tool calls remain visible without effects or raw error disclosure", async () => {
  for (const input of [{ count: 0 }, { count: 1 }]) {
    let entered = 0;
    const events: Array<{ toolName: string; phase: string }> = [];
    const { model } = fixture([[call("action", input)], done]);
    await runTurn({ model, messages: [user], instructions: "Test", tools: [action(async () => { entered++; throw new Error("synthetic-private-value"); })], onToolEvent: event => events.push(event) });
    assert.equal(entered, input.count === 0 ? 0 : 1);
    assert.ok(events.some(event => event.phase === "requested"));
    assert.ok(events.some(event => event.phase === "failed" || event.phase === "blocked"));
    assert.ok(!JSON.stringify(events).includes("synthetic-private-value"));
  }
  let effects = 0;
  const turn = createTurnTools([action(async () => { effects++; return { content: [] }; })], undefined, () => { throw new Error("Observer unavailable"); });
  const blocked = await turn.tools.action.execute!({ count: 1 }, {} as any);
  assert.ok(!JSON.stringify(blocked).includes('Observer unavailable'));
  assert.equal(effects, 0, "A hidden action must not run when its start cannot be reported");
  assert.equal(turn.isTerminated(), true);
});

test("unknown tool calls are visible but do not expose model-provided tool names", async () => {
  const events: Array<{ toolName: string; phase: string }> = [];
  const { model } = fixture([[call("synthetic-private-value", {})], done]);
  try { await runTurn({ model, messages: [user], instructions: "Test", tools: [], onToolEvent: event => events.push(event) }); } catch { /* Provider rejection may end the turn. */ }
  assert.ok(events.some(event => event.toolName === "unknown"));
  assert.ok(!JSON.stringify(events).includes("synthetic-private-value"));
});

test("cancelled and closed tool callbacks are visibly fenced", async () => {
  const controller = new AbortController();
  const events: Array<{ toolName: string; phase: string }> = [];
  const { model } = fixture([[call("action", { count: 1 })]]);
  await assert.rejects(runTurn({ model, messages: [user], instructions: "Test", signal: controller.signal, onToolEvent: event => events.push(event), tools: [action(async (_, context) => { controller.abort(); context.signal?.throwIfAborted(); return { content: [] }; })] }), { name: "AbortError" });
  assert.ok(events.some(event => event.phase === "started"));
  assert.ok(events.some(event => event.phase === "cancelled"));
  let effects = 0;
  const turn = createTurnTools([action(async () => { effects++; return { content: [] }; })], undefined, event => events.push(event));
  turn.close();
  await turn.tools.action.execute!({ count: 1 }, {} as any);
  assert.equal(effects, 0);
  assert.ok(events.some(event => event.phase === "blocked"));
});

test("post-effect observer failures preserve outcomes and cannot bypass termination or leak into model history", async () => {
  const marker = "synthetic-observer-private";
  const { model, requests } = fixture([[call("lesson", { count: 1 }), call("mutate", { count: 1 })], done]);
  let lessons = 0; let mutations = 0;
  await assert.rejects(runTurn({ model, messages: [user], instructions: "Test", tools: [
    action(async () => { lessons++; return { content: [text("Exercise")], terminate: true }; }, "lesson"),
    action(async () => { mutations++; return { content: [] }; }, "mutate"),
  ], onToolEvent: event => { if (event.phase === 'returned') throw new Error(marker); } }), (error: Error) => /Tool status output failed/.test(error.message) && !error.message.includes(marker));
  assert.equal(lessons, 1);
  assert.equal(mutations, 0);
  assert.equal(requests.length, 1);
  assert.ok(!JSON.stringify(requests).includes(marker));
  const expected = { content: [text('Recorded result')], terminate: true };
  const turn = createTurnTools([action(async () => expected)], undefined, event => { if (event.phase === 'returned') throw new Error(marker); });
  assert.deepEqual(await turn.tools.action.execute!({ count: 1 }, {} as any), expected);
  assert.deepEqual(turn.results, [expected]);
  assert.equal(turn.isTerminated(), true);
});

test("observer exceptions on request or failure remain private and stop queued callbacks", async () => {
  for (const phase of ['requested', 'failed']) {
    const marker = 'synthetic-observer-private';
    let mutations = 0;
    const { model, requests } = fixture([[call('action', { count: 1 }), call('mutate', { count: 1 })], done]);
    await assert.rejects(runTurn({ model, messages: [user], instructions: 'Test', tools: [action(async () => { throw new Error('Denied'); }), action(async () => { mutations++; return { content: [] }; }, 'mutate')], onToolEvent: event => { if (event.phase === phase) throw new Error(marker); } }), (error: Error) => /Tool status output failed/.test(error.message) && !error.message.includes(marker));
    assert.equal(mutations, 0);
    assert.equal(requests.length, 1);
    assert.ok(!JSON.stringify(requests).includes(marker));
  }
});

test("Promise-returning tool observers fail closed without waiting or leaking rejections", async () => {
  const marker = 'synthetic-observer-private';
  for (const observer of [async () => { throw new Error(marker); }, () => new Promise<void>(() => {})]) {
    let effects = 0;
    const turn = createTurnTools([action(async () => { effects++; return { content: [] }; })], undefined, observer);
    const reply = await turn.tools.action.execute!({ count: 1 }, {} as any);
    assert.equal(effects, 0);
    assert.equal(turn.reportingFailed(), true);
    assert.ok(!JSON.stringify(reply).includes(marker));
  }
  let effects = 0; let later = 0;
  const { model, requests } = fixture([[call('action', { count: 1 }), call('mutate', { count: 1 })], done]);
  await assert.rejects(runTurn({ model, messages: [user], instructions: 'Test', tools: [action(async () => { effects++; return { content: [text('Actual result')] }; }), action(async () => { later++; return { content: [] }; }, 'mutate')], onToolEvent: event => { if (event.phase === 'returned') return Promise.reject(new Error(marker)); } }), (error: Error) => /Tool status output failed/.test(error.message) && !error.message.includes(marker));
  assert.equal(effects, 1);
  assert.equal(later, 0);
  assert.equal(requests.length, 1);
  assert.ok(!JSON.stringify(requests).includes(marker));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("unsupported observer thenables are not assimilated", async () => {
  let assimilations = 0; let effects = 0;
  const recursive = { then(resolve: (value: unknown) => void) { assimilations++; resolve(assimilations < 4 ? recursive : undefined); } };
  const turn = createTurnTools([action(async () => { effects++; return { content: [] }; })], undefined, () => recursive);
  await turn.tools.action.execute!({ count: 1 }, {} as any);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(turn.reportingFailed(), true);
  assert.equal(effects, 0);
  assert.equal(assimilations, 0);
});

test("fulfilled observer Promises do not assimilate values that become thenable", async () => {
  let assimilations = 0; let effects = 0;
  const turn = createTurnTools([action(async () => { effects++; return { content: [] }; })], undefined, () => {
    const value: Record<string, unknown> = {};
    const observed = Promise.resolve(value);
    value.then = (resolve: (value: unknown) => void) => { assimilations++; resolve(assimilations < 4 ? value : undefined); };
    return observed;
  });
  await turn.tools.action.execute!({ count: 1 }, {} as Parameters<NonNullable<typeof turn.tools.action.execute>>[1]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(turn.reportingFailed(), true);
  assert.equal(effects, 0);
  assert.equal(assimilations, 0);
});

test("cancellation triggered by a started observer prevents the effect", async () => {
  const controller = new AbortController(); let effects = 0;
  const events: string[] = [];
  const turn = createTurnTools([action(async () => { effects++; return { content: [] }; })], controller.signal, event => { events.push(event.phase); if (event.phase === 'started') controller.abort(); });
  await assert.rejects(async () => turn.tools.action.execute!({ count: 1 }, {} as any), { name: 'AbortError' });
  assert.equal(effects, 0);
  assert.ok(events.includes('cancelled'));
});

test("real Agent rejects extra fields, wrong types, and bounds before effects", async () => {
  for (const input of [{ count: 1, extra: "deny" }, { count: 0 }, { count: 4 }, { count: "1" }, {}, { count: 1.5 }]) {
    let effects = 0;
    const { model } = fixture([[call("action", input)], done]);
    await runTurn({ model, messages: [user], instructions: "Test", tools: [action(async () => { effects++; return { content: [] }; })] });
    assert.equal(effects, 0);
  }
});

test("direct/resumed tool paths enforce validation, closure, and current callback authority", async () => {
  let effects = 0;
  let allowed = false;
  const turn = createTurnTools([action(async () => { if (!allowed) throw new Error("Denied"); effects++; return { content: [text("ok")] }; })]);
  const execute = turn.tools.action.execute!;
  const invalid = await execute({ count: 1, extra: true }, { resumeData: {} } as any);
  assert.deepEqual(invalid, { content: [text("Invalid tool input; action rejected.")] });
  await execute({ count: 1 }, { resumeData: {} } as any);
  assert.equal(effects, 0);
  allowed = true;
  await execute({ count: 1 }, { resumeData: {} } as any);
  assert.equal(effects, 1);
  turn.close();
  await execute({ count: 1 }, { resumeData: {} } as any);
  assert.equal(effects, 1);
});

test("real Agent denied callback prevents mutation", async () => {
  let effects = 0;
  const { model } = fixture([[call("action", { count: 1 })], done]);
  await runTurn({ model, messages: [user], instructions: "Test", tools: [action(async () => { throw new Error("Denied by current mode"); effects++; })] });
  assert.equal(effects, 0);
});

test("termination serializes tools, blocks later mutation and stops model continuation", async () => {
  const { model, requests } = fixture([[call("lesson", { count: 1 }), call("mutate", { count: 1 })], done]);
  let mutation = 0;
  const result = await runTurn({ model, messages: [user], instructions: "Test", tools: [
    action(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return { content: [text("Your exercise")], terminate: true }; }, "lesson"),
    action(async () => { mutation++; return { content: [text("Mutated")] }; }, "mutate"),
  ] });
  assert.equal(mutation, 0);
  assert.equal(requests.length, 1);
  assert.equal(result.text, "Your exercise");
});

test("abort before dispatch and during first tool prevents later effects", async () => {
  const before = new AbortController(); before.abort();
  const first = fixture([done]);
  await assert.rejects(runTurn({ model: first.model, messages: [user], instructions: "Test", tools: [], signal: before.signal }), { name: "AbortError" });
  assert.equal(first.requests.length, 0);
  const controller = new AbortController();
  let mutation = 0;
  const { model } = fixture([[call("cancel", { count: 1 }), call("mutate", { count: 1 })]]);
  await assert.rejects(runTurn({ model, messages: [user], instructions: "Test", signal: controller.signal, tools: [
    action(async (_, { signal }) => { controller.abort(); signal?.throwIfAborted(); return { content: [] }; }, "cancel"),
    action(async () => { mutation++; return { content: [] }; }, "mutate"),
  ] }), { name: "AbortError" });
  assert.equal(mutation, 0);
});

test("turn step limit bounds a model that continuously requests tools", async () => {
  const { model, requests } = fixture([[call("action", { count: 1 })]]);
  let effects = 0;
  await runTurn({ model, messages: [user], instructions: "Test", tools: [action(async () => { effects++; return { content: [text("ok")] }; })] });
  assert.equal(requests.length, MAX_TURN_STEPS);
  assert.equal(effects, MAX_TURN_STEPS);
});

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";

test("tool images become model media parts, including after history resume", async () => {
  const { model, requests } = fixture([[call("image", { count: 1 })], done]);
  const result = await runTurn({ model, messages: [user], instructions: "Test", tools: [action(async () => ({ content: [{ type: "image", mimeType: "image/png", data: png }] }), "image")] });
  const toolMessage = requests[1].prompt.find((message: any) => message.role === "tool");
  assert.deepEqual(toolMessage.content[0].output, { type: "content", value: [{ type: "media", mediaType: "image/png", data: png }] });
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "neura-session-image-")));
  try {
    const session = await createSession(directory);
    await saveSession(directory, { ...session, messages: result.messages });
    const resumed = await resumeSession(directory, session.id);
    const next = fixture([done]);
    await runTurn({ model: next.model, messages: [...resumed.messages, user], instructions: "Fresh", tools: [] });
    const restored = next.requests[0].prompt.find((message: any) => message.role === "tool");
    assert.deepEqual(restored.content[0].output, toolMessage.content[0].output);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local OpenAI-compatible transport receives actual image_url data, no API key fallback", async () => {
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.equal(request.headers.authorization, "Bearer local");
    requests.push(JSON.parse(body));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "synthetic", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message: requests.length === 1 ? { role: "assistant", content: null, tool_calls: [{ id: "image", type: "function", function: { name: "image", arguments: '{"count":1}' } }] } : { role: "assistant", content: "Seen" }, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address() as { port: number };
    const model = createConfiguredModel({ provider: "local", model: "fixture", baseURL: `http://127.0.0.1:${address.port}/v1` });
    const result = await runTurn({ model, messages: [{ role: "user", content: [text("Inspect"), { type: "image", image: `data:image/png;base64,${png}`, mediaType: "image/png" }] }], instructions: "Test", tools: [action(async () => ({ content: [{ type: "image", mimeType: "image/png", data: png }] }), "image")] });
    assert.equal(result.text, "Seen");
    for (const request of requests) assert.ok(JSON.stringify(request.messages).includes(`data:image/png;base64,${png}`), JSON.stringify(request.messages));
    const images = requests[1].messages.flatMap((message: any) => Array.isArray(message.content) ? message.content.filter((part: any) => part.type === "image_url") : []);
    assert.equal(images.length, 2, "user and tool images must reach the API as images");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("provider selection is explicit; Codex subscription never falls back to API billing", () => {
  assert.equal(createConfiguredModel({ provider: "openai-codex", model: "gpt-5.5" }).modelId, "gpt-5.5");
  assert.throws(() => createConfiguredModel({ provider: "openai-codex", model: "gpt-5.5", baseURL: "https://api.openai.com/v1" }), /fixed Codex endpoint/);
  assert.throws(() => createConfiguredModel({ provider: "local", model: "fixture" }), /explicit baseURL/);
  for (const baseURL of ["https://example.com/v1", "http://user:pass@localhost/v1", "http://localhost/v1?key=x", "file:///test"]) {
    assert.throws(() => createConfiguredModel({ provider: "local", model: "fixture", baseURL }));
  }
});

test("explicit OpenAI/Anthropic API transports carry tool images as native image parts", async () => {
  const source = `
    import assert from 'node:assert/strict';
    const { runTurn } = await import('./src/runtime.ts');
    const { createConfiguredModel } = await import('./src/providers.ts');
    const png = ${JSON.stringify(png)};
    for (const provider of ['openai', 'anthropic']) {
      const requests = [];
      globalThis.fetch = async (url, options) => {
        assert.equal(new URL(url).hostname, provider === 'openai' ? 'api.openai.com' : 'api.anthropic.com');
        requests.push(JSON.parse(options.body));
        const first = requests.length === 1;
        const data = provider === 'openai' ? {
          id:'resp_test', created_at:1, model:'fixture', status:'completed',
          output: first ? [{type:'function_call',id:'fc_test',call_id:'image',name:'image',arguments:'{}',status:'completed'}] : [{type:'message',id:'msg_test',role:'assistant',status:'completed',content:[{type:'output_text',text:'Seen',annotations:[]}]}],
          usage:{input_tokens:1,output_tokens:1,total_tokens:2}
        } : {
          id:'msg_test',type:'message',role:'assistant',model:'fixture',
          content:first ? [{type:'tool_use',id:'image',name:'image',input:{}}] : [{type:'text',text:'Seen'}],
          stop_reason:first ? 'tool_use' : 'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}
        };
        return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
      };
      const model = createConfiguredModel({provider,model:'fixture'});
      const result = await runTurn({model,messages:[{role:'user',content:'Inspect tool image'}],instructions:'Test',tools:[{
        name:'image',description:'Synthetic image',parameters:{type:'object',properties:{},additionalProperties:false},
        execute:async()=>({content:[{type:'image',mimeType:'image/png',data:png}]})
      }]});
      assert.equal(result.text,'Seen'); assert.equal(requests.length,2);
      const imageParts=[];
      const visit=(value)=> { if (!value || typeof value!=='object') return; if (value.type === (provider==='openai' ? 'input_image' : 'image')) imageParts.push(value); for(const child of Object.values(value)) { if(Array.isArray(child)) child.forEach(visit); else visit(child); } };
      visit(requests[1]);
      assert.equal(imageParts.length,1);
      if(provider==='openai') assert.equal(imageParts[0].image_url,'data:image/png;base64,'+png);
      else { assert.equal(imageParts[0].source.data,png); assert.equal(imageParts[0].source.media_type,'image/png'); }
    }
    console.log('API image requests OK');
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", source], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { SystemRoot: process.env.SystemRoot, PATH: path.dirname(process.execPath), OPENAI_API_KEY: "synthetic-api-key", ANTHROPIC_API_KEY: "synthetic-api-key" },
    timeout: 20000,
  });
  assert.match(stdout, /API image requests OK/);
  assert.equal(stderr, "");
});

test("schema failure without assistant text returns usable feedback", async () => {
  const { model } = fixture([[call("action", { count: -1 })]]);
  const result = await runTurn({ model, messages: [user], instructions: "Test", tools: [action(async () => { throw new Error("Must not execute"); })] });
  assert.match(result.text, /Invalid tool input; action rejected/);
});

test("session create/list/append/resume is bounded and rejects incomplete effects or traversal", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "neura-session-test-")));
  try {
    const session = await createSession(directory);
    assert.deepEqual((await listSessions(directory)).map((entry) => entry.id), [session.id]);
    const history = Array.from({ length: 120 }, () => [user, { role: "assistant", content: "Synthetic answer" }]).flat();
    await appendSession(directory, session.id, history);
    const resumed = await resumeSession(directory, session.id);
    assert.equal(resumed.messages.length, MAX_SESSION_MESSAGES);
    assert.equal(resumed.messages[0].role, "user");
    await assert.rejects(resumeSession(directory, "../outside"), /Invalid session id/);
    for (const name of [".pi", ".PI", ".pi.", ".pi "]) await assert.rejects(createSession(path.join(directory, name, "sessions")), /outside .pi/);
    await assert.rejects(appendSession(directory, session.id, [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "pending", toolName: "write", input: {} }] }]), /Incomplete tool exchange/);
    await assert.rejects(saveSession(directory, { ...session, messages: [{ role: "system", content: "stale authority" }] }), /role/);
    await assert.rejects(saveSession(directory, { ...session, messages: [{ role: "user", content: "x".repeat(MAX_SESSION_BYTES) }] }), /exceeds/);
    assert.equal((await resumeSession(directory, session.id)).messages.length, MAX_SESSION_MESSAGES);
    await saveSession(directory, { ...session, messages: [user, { role: "assistant", content: [{ type: "reasoning", text: "Synthetic reasoning" }, text("Answer")] }] });
    assert.equal((await resumeSession(directory, session.id)).messages[1].content[0].type, "reasoning");
    const outside = path.join(directory, ".pi");
    const alias = path.join(directory, "alias");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(outside));
    await symlink(outside, alias, "junction");
    await assert.rejects(createSession(path.join(alias, "sessions")), /outside .pi|Linked session/);
    await writeFile(path.join(directory, `${session.id}.json`), "x".repeat(MAX_SESSION_BYTES + 1));
    await assert.rejects(resumeSession(directory, session.id), /exceeds/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("session paths reject linked ancestors before creating directories or history", async () => {
  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), "neura-session-links-")));
  try {
    const owned = path.join(scratch, "owned", "sessions");
    const session = await createSession(owned);
    await saveSession(owned, { ...session, messages: [user] });
    assert.deepEqual((await resumeSession(owned, session.id)).messages, [user]);

    const alias = path.join(scratch, "alias");
    await symlink(path.dirname(owned), alias, process.platform === "win32" ? "junction" : "dir");
    const missing = path.join(alias, "new", "sessions");
    await assert.rejects(createSession(missing), /Linked session/);
    await assert.rejects(stat(path.join(path.dirname(owned), "new")), { code: "ENOENT" });
    const linked = path.join(alias, "sessions");
    const names = await readdir(owned);
    await assert.rejects(createSession(linked), /Linked session/);
    await assert.rejects(resumeSession(linked, session.id), /Linked session/);
    await assert.rejects(saveSession(linked, { ...session, messages: [] }), /Linked session/);
    assert.deepEqual(await readdir(owned), names);
    assert.deepEqual((await resumeSession(owned, session.id)).messages, [user]);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("genuine Windows short names support session storage and leases without permitting Pi aliases", { skip: process.platform !== 'win32' }, async () => {
  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'neura-session-short-')));
  try {
    const short = await windowsShortPath(scratch);
    assert.notEqual(path.relative(short, scratch), '', 'fixture must exercise a genuine 8.3 spelling');
    const directory = path.join(short, 'new', 'sessions');
    const session = await createSession(directory);
    await saveSession(directory, { ...session, messages: [user] });
    assert.deepEqual((await resumeSession(directory, session.id)).messages, [user]);
    const release = await lockSession(directory, session.id);
    await assert.rejects(lockSession(await realpath(directory), session.id), /in use|unreconciled/);
    await release();
    const canonicalRelease = await lockSession(await realpath(directory), session.id); await canonicalRelease();
    const alias = path.join(scratch, 'junction');
    await symlink(path.join(scratch, 'new'), alias, 'junction');
    await assert.rejects(lockSession(path.join(alias, 'sessions'), session.id), /Linked session/);
    assert.ok(!(await readdir(await realpath(directory))).some(name => name.endsWith('.lock')));
    const pi = path.join(scratch, '.pi'); await mkdir(pi);
    const shortPi = await windowsShortPath(pi);
    assert.ok(!shortPi.split(/[\\/]/).some(part => part.toLowerCase() === '.pi'), 'exercise canonical Pi refusal');
    await assert.rejects(createSession(path.join(shortPi, 'uncreated', 'sessions')), /outside .pi/);
    assert.deepEqual(await readdir(pi), []);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("dangling session ancestors are rejected before any mkdir", async () => {
  const source = `
    import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
    import os from 'node:os'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
    const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-dangling-session-')));
    try {
      const target = path.join(scratch, 'missing-target'); const alias = path.join(scratch, 'dangling');
      await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
      let attempts = 0; const mkdir = fs.mkdir;
      fs.mkdir = (...args) => { attempts++; return mkdir(...args); }; syncBuiltinESMExports();
      const { createSession } = await import('./src/session.ts');
      await assert.rejects(createSession(path.join(alias, 'new', 'sessions')), /Linked session/);
      assert.equal(attempts, 0, 'reject existing links before attempting directory publication');
      await assert.rejects(fs.stat(target), { code:'ENOENT' });
      assert.equal((await fs.lstat(alias)).isSymbolicLink(), true);
      console.log('dangling link rejected before mkdir');
    } finally { await fs.rm(scratch, { recursive:true, force:true }); }
  `;
  const reply = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { cwd: path.resolve(import.meta.dirname, '..'), env: { SystemRoot: process.env.SystemRoot, PATH: path.dirname(process.execPath) }, timeout: 10000 });
  assert.match(reply.stdout, /dangling link rejected before mkdir/);
  assert.equal(reply.stderr, '');
});

test("session directory traversal terminates when a filesystem root is missing", async () => {
  const source = `
    import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
    import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
    let calls = 0;
    const missing = async () => { if (++calls > 4) throw new Error('Non-progressing root traversal'); throw Object.assign(new Error('Synthetic missing root'), { code: 'ENOENT' }); };
    fs.realpath = missing; fs.lstat = missing;
    fs.mkdir = async () => { throw new Error('Must not create beneath missing root'); };
    syncBuiltinESMExports();
    const { createSession } = await import('./src/session.ts');
    await assert.rejects(createSession(path.parse(process.cwd()).root), { code: 'ENOENT' });
    console.log('root traversal bounded');
  `;
  const reply = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { cwd: path.resolve(import.meta.dirname, '..'), env: { SystemRoot: process.env.SystemRoot, PATH: path.dirname(process.execPath) }, timeout: 10000 });
  assert.match(reply.stdout, /root traversal bounded/);
  assert.equal(reply.stderr, '');
});

test("clean-environment import and Agent run perform no telemetry/license network or process calls", async () => {
  const source = `
    import { syncBuiltinESMExports } from 'node:module';
    import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
    import tls from 'node:tls'; import child from 'node:child_process';
    let attempts = 0;
    const deny = () => { attempts++; throw new Error('Forbidden network/process call'); };
    globalThis.fetch = deny;
    for (const object of [http, https]) { object.request = deny; object.get = deny; }
    net.connect = deny; net.createConnection = deny; tls.connect = deny;
    for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) child[key] = deny;
    syncBuiltinESMExports();
    const { runTurn } = await import('./src/runtime.ts');
    const model = { specificationVersion:'v2', provider:'test', modelId:'test', supportedUrls:{},
      doGenerate: async () => ({content:[{type:'text',text:'ok'}],finishReason:'stop',usage:{inputTokens:1,outputTokens:1,totalTokens:2},warnings:[]}),
      doStream: deny };
    const result = await runTurn({model, messages:[{role:'user',content:'test'}],instructions:'Test',tools:[]});
    if (result.text !== 'ok' || process.env.MASTRA_TELEMETRY_DISABLED !== '1' || attempts !== 0) throw new Error('Wrong result or attempted network/process call');
    console.log('isolated runtime OK');
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", source], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { SystemRoot: process.env.SystemRoot, PATH: path.dirname(process.execPath), MASTRA_LICENSE_KEY: "synthetic-license", MASTRA_TELEMETRY_DISABLED: "false" },
    timeout: 20000,
  });
  assert.match(stdout, /isolated runtime OK/);
  assert.equal(stderr, "");
});
