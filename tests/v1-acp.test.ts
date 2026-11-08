import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { registerT3 } from '../scripts/register-t3.mjs';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
async function fixture() {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-acp-'));
  const workspace = path.join(scratch, 'workspace');
  const home = path.join(scratch, 'home');
  await fs.mkdir(workspace); await fs.mkdir(home);
  const requests: any[] = [];
  let toolPath: string | string[] | undefined;
  let toolContent = '# synthetic\n';
  let hold = false;
  let arrived: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body); requests.push(parsed); arrived?.();
    if (hold) { req.on('close', () => res.destroy()); return; }
    const tools = Array.isArray(toolPath) ? toolPath : toolPath ? [toolPath] : []; toolPath = undefined;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'synthetic', object: 'chat.completion', created: 1, model: 'fixture',
      choices: [{ index: 0, finish_reason: tools.length ? 'tool_calls' : 'stop', message: tools.length ? { role: 'assistant', content: null,
        tool_calls: tools.map((tool, index) => ({ id: `write-${index}`, type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: tool, content: toolContent, expectedHash: null }) } })) }
        : { role: 'assistant', content: 'Synthetic ACP answer' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|neura_git_executable)$/i.test(key)));
  const child = spawn(process.execPath, ['src/acp.ts'], { cwd: root, env: { ...env, HOME: home, USERPROFILE: home, NEURA_HOME: home,
    NEURA_PROVIDER: 'local', NEURA_MODEL: 'fixture', NEURA_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}/v1`, TEMP: scratch, TMP: scratch, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const frames: any[] = [];
  const waiting = new Map<number, (frame: any) => void>();
  let sequence = 0;
  let permission: ((frame: any) => void) | undefined;
  createInterface({ input: child.stdout }).on('line', line => {
    const frame = JSON.parse(line); frames.push(frame);
    if (frame.method === 'session/request_permission') permission?.(frame);
    else if (typeof frame.id === 'number') waiting.get(frame.id)?.(frame);
  });
  const send = (frame: any) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
  const rpc = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Timed out: ${method}; ${stderr}`)); }, 20000);
    waiting.set(id, frame => { clearTimeout(timer); waiting.delete(id); resolve(frame); });
    send({ id, method, params });
  });
  let sessionId = '';
  return {
    workspace, home, scratch, frames, requests, rpc, send,
    disconnect() { child.stdin.end(); },
    disconnectOutput() { child.stdout.destroy(); },
    async waitForExit() { const [code] = await exited; assert.equal(code, 0, stderr); },
    async start() {
      const init = await rpc('initialize', { protocolVersion: 2, clientCapabilities: {} });
      assert.equal(init.result.protocolVersion, 1);
      assert.equal(init.result.agentInfo.name, 'neura');
      assert.equal(init.result.agentCapabilities.loadSession, false);
      const session = await rpc('session/new', { cwd: workspace, mcpServers: [] });
      assert.ok(session.result?.sessionId, JSON.stringify(session));
      sessionId = session.result.sessionId;
      return sessionId;
    },
    prompt(text: string) { return rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }); },
    setTool(value: string | string[], content = '# synthetic\n') { toolPath = value; toolContent = content; },
    setPermission(handler: (frame: any) => void) { permission = handler; },
    holdNext() { hold = true; return new Promise<void>(resolve => { arrived = resolve; }); },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 10000);
      try { const [code] = await exited; assert.equal(code, 0, stderr); }
      finally { clearTimeout(timer); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(scratch, { recursive: true, force: true }); }
    },
  };
}

test('ACP negotiates v1 without a session, model request, banner or credentials', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.rpc('session/new', {})).error.code, -32000);
    assert.equal((await f.rpc('initialize', { protocolVersion: 2 })).result.protocolVersion, 1);
    assert.equal((await f.rpc('session/new', { cwd: '.', mcpServers: [] })).error.code, -32602);
    assert.equal((await f.rpc('unknown')).error.code, -32601);
    assert.equal(f.requests.length, 0);
    assert.ok(f.frames.every(frame => frame.jsonrpc === '2.0'));
  } finally { await f.close(); }
});

test('T3 discovery exercises an ephemeral CLI session without authorizing private-home tasks or leaving history', { skip: process.platform !== 'win32' }, async () => {
  for (const probe of [true, false]) {
    const f = await fixture();
    try {
      await f.rpc('initialize', { protocolVersion: 1, clientInfo: { name: probe ? 't3-code-provider-test' : 't3-code' } });
      const session = await f.rpc('session/new', { cwd: f.home, mcpServers: [] });
      if (probe) {
        assert.ok(session.result?.sessionId, JSON.stringify(session));
        assert.deepEqual(await fs.readdir(f.home), [], 'discovery must not create native history');
        assert.equal((await fs.readdir(f.scratch)).filter(name => name.startsWith('neura-acp-probe-')).length, 1);
        const task = await f.rpc('session/prompt', { sessionId: session.result.sessionId, prompt: [{ type: 'text', text: 'must not run' }] });
        assert.equal(task.error.code, -32601);
        f.disconnect(); await f.waitForExit();
        assert.equal((await fs.readdir(f.scratch)).filter(name => name.startsWith('neura-acp-probe-')).length, 0);
      } else {
        assert.equal(session.error.code, -32603, 'normal clients retain private-home containment');
      }
      assert.equal(f.requests.length, 0, 'discovery and denied tasks must not contact a model');
    } finally { await f.close(); }
  }
});

test('ACP shares real Work turns and history, rejects unsupported input, and retains Learn mode', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const sessionId = await f.start();
    assert.equal((await f.rpc('session/prompt', { sessionId: 'not-owned', prompt: [] })).error.code, -32602);
    assert.equal((await f.rpc('session/prompt', { sessionId, prompt: [{ type: 'image', data: 'x' }] })).error.code, -32602);
    assert.equal((await f.prompt('/logout')).error.code, -32602);
    assert.equal((await f.prompt('first synthetic task')).result.stopReason, 'end_turn');
    assert.equal((await f.prompt('second synthetic task')).result.stopReason, 'end_turn');
    assert.equal(f.requests.length, 2);
    assert.ok(JSON.stringify(f.requests[1].messages).includes('first synthetic task'));
    assert.ok(f.frames.some(frame => frame.params?.update?.content?.text?.includes('Synthetic ACP answer')));
    assert.equal((await f.rpc('session/set_mode', { sessionId, modeId: 'plan' })).error.code, -32602);
    assert.deepEqual((await f.rpc('session/set_mode', { sessionId, modeId: 'learn' })).result, {});
    await f.prompt('/status');
    assert.ok(f.frames.some(frame => /Learn/.test(frame.params?.update?.content?.text ?? '')));
  } finally { await f.close(); }
});

test('ACP exact-once approvals allow only the advertised option, deny malformed grants and settle cancellation', { skip: process.platform !== 'win32' }, async () => {
  for (const optionId of ['allow_once', 'reject_once', 'allow_always', 'cancel']) {
    const f = await fixture();
    try {
      const sessionId = await f.start();
      f.setTool('.github/workflows/synthetic.yml');
      f.setPermission(frame => {
        assert.equal(frame.params.sessionId, sessionId);
        assert.deepEqual(frame.params.options.map((option: any) => option.optionId), ['allow_once', 'reject_once']);
        if (optionId === 'cancel') f.send({ method: 'session/cancel', params: { sessionId } });
        else f.send({ id: frame.id, result: { outcome: { outcome: 'selected', optionId } } });
      });
      const result = await f.prompt('write the synthetic workflow');
      assert.equal(result.result.stopReason, optionId === 'cancel' ? 'cancelled' : 'end_turn');
      const target = path.join(f.workspace, '.github/workflows/synthetic.yml');
      if (optionId === 'allow_once') assert.equal(await fs.readFile(target, 'utf8'), '# synthetic\n');
      else await assert.rejects(fs.stat(target), { code: 'ENOENT' });
      assert.ok(f.frames.some(frame => frame.params?.update?.sessionUpdate === 'tool_call'));
    } finally { await f.close(); }
  }
});

test('ACP batched calls retain distinct lifecycle cards through completion', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    await f.start();
    f.setTool(['first.txt', 'second.txt']);
    await f.prompt('write two synthetic files');
    const created = f.frames.filter(frame => frame.params?.update?.sessionUpdate === 'tool_call');
    assert.equal(created.length, 2);
    const ids = created.map(frame => frame.params.update.toolCallId);
    assert.equal(new Set(ids).size, 2);
    for (const id of ids) assert.ok(f.frames.some(frame => frame.params?.update?.toolCallId === id && frame.params.update.status === 'completed'));
  } finally { await f.close(); }
});

test('ACP approval carries the entire authorized CI content beyond 8000 characters', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    await f.start();
    const content = '# synthetic padding\n'.repeat(500) + '# VISIBLE_APPROVAL_TAIL\n';
    f.setTool('.github/workflows/long.yml', content);
    f.setPermission(frame => {
      const details = frame.params.toolCall;
      assert.ok(details.rawInput.description.includes(content));
      assert.ok(details.content[0].content.text.includes('VISIBLE_APPROVAL_TAIL'));
      f.send({ id: frame.id, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } });
    });
    assert.equal((await f.prompt('write synthetic long workflow')).result.stopReason, 'end_turn');
    assert.equal(await fs.readFile(path.join(f.workspace, '.github/workflows/long.yml'), 'utf8'), content);
  } finally { await f.close(); }
});

test('ACP disconnect denies a pending approval before releasing its native session', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const sessionId = await f.start();
    f.setTool('.github/workflows/disconnected.yml');
    const requested = new Promise<void>(resolve => f.setPermission(() => { f.disconnect(); resolve(); }));
    f.send({ id: 9999, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'synthetic disconnected write' }] } });
    await requested;
    await f.waitForExit();
    await assert.rejects(fs.stat(path.join(f.workspace, '.github/workflows/disconnected.yml')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('ACP broken output pipe cancels a pending approval without executing its write', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const sessionId = await f.start();
    f.setTool('.github/workflows/broken-pipe.yml');
    const requested = new Promise<void>(resolve => f.setPermission(() => {
      f.disconnectOutput();
      f.send({ id: 9998, method: 'unknown', params: {} });
      resolve();
    }));
    f.send({ id: 9999, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'synthetic broken pipe write' }] } });
    await requested;
    await f.waitForExit();
    await assert.rejects(fs.stat(path.join(f.workspace, '.github/workflows/broken-pipe.yml')), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('T3 registration preserves other providers, is idempotent and refuses an existing different instance', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-t3-register-'));
  try {
    const userdata = path.join(scratch, 'userdata'); await fs.mkdir(userdata);
    const settings = path.join(userdata, 'settings.json');
    const original = { defaultModelSelection: { instanceId: 'fx', model: 'fixture' }, providerInstances: { fx: { driver: 'fx', enabled: true } } };
    await fs.writeFile(settings, JSON.stringify(original));
    let calls = 0;
    const mutate = async (_base: string, mutation: any) => {
      calls++;
      assert.equal(mutation.operation, 'create');
      assert.equal(mutation.instanceId, 'neura');
      // Simulate another client changing settings after the registration's initial read.
      const latest = JSON.parse(await fs.readFile(settings, 'utf8'));
      latest.concurrentClientPreference = 'preserved';
      latest.providerInstances.neura = mutation.instance;
      await fs.writeFile(settings, JSON.stringify(latest));
    };
    const options = { baseDir: scratch, mutate };
    assert.equal(await registerT3(options), false);
    assert.equal(calls, 0);
    assert.equal(await registerT3({ ...options, apply: true }), true);
    const registered = JSON.parse(await fs.readFile(settings, 'utf8'));
    assert.equal(registered.concurrentClientPreference, 'preserved');
    assert.deepEqual(registered.defaultModelSelection, original.defaultModelSelection);
    assert.deepEqual(registered.providerInstances.fx, original.providerInstances.fx);
    assert.equal(registered.providerInstances.neura.driver, 'acpRegistry');
    assert.equal(registered.providerInstances.neura.config.source, 'local');
    assert.deepEqual(registered.providerInstances.neura.config.commandArgs, [path.join(root, 'src/acp.ts')]);
    const native = registered.providerInstances.neura;
    registered.providerInstances.neura = { config: { ...native.config, customModels: [] }, environment: native.environment.map((value: any) => ({ sensitive: value.sensitive, value: value.value, name: value.name })), enabled: native.enabled, displayName: native.displayName, driver: native.driver };
    await fs.writeFile(settings, JSON.stringify(registered));
    const before = await fs.readFile(settings, 'utf8');
    await registerT3({ ...options, apply: true }); await registerT3(options);
    assert.equal(calls, 1);
    assert.equal(await fs.readFile(settings, 'utf8'), before);
    registered.providerInstances.neura.config.commandPath = 'other-agent.exe';
    await fs.writeFile(settings, JSON.stringify(registered));
    await assert.rejects(registerT3({ ...options, apply: true }), /existing Neura instance differs/);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await fs.readFile(settings, 'utf8')).providerInstances.neura.config.commandPath, 'other-agent.exe');
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('ACP Stop interrupts an active model request and rejects concurrent prompts', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const sessionId = await f.start();
    const arrived = f.holdNext();
    const turn = f.prompt('wait for cancellation');
    await arrived;
    assert.equal((await f.prompt('must not run concurrently')).error.code, -32000);
    f.send({ method: 'session/cancel', params: { sessionId } });
    assert.equal((await turn).result.stopReason, 'cancelled');
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
