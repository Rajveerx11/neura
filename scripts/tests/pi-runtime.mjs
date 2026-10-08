// Real Pi loader/session regressions; synthetic profiles, no model calls or provider credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { isolate } from './isolation.mjs';
import { pinnedPi } from './pinned-pi.mjs';

const scratch = isolate();
process.env.NEURA = '1';
process.env.NEURA_HEADMASTER = 'off';
process.env.PI_OFFLINE = '1';
const repo = path.resolve(import.meta.dirname, '../..');
pinnedPi(repo);
const { createAgentSession, createCodemodeExtension, createToolSearchExtension, createMcpExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai/compat');
const { parseArgs } = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js');
const { Type } = await import('typebox');
const { default: guardrail } = await import('../../agent/extensions/guardrail.ts');
const { setMode } = await import('../../agent/neura/mode-state.ts');
const agentDir = process.env.PI_CODING_AGENT_DIR;
const cwd = path.join(scratch, 'workspace');
fs.mkdirSync(path.join(cwd, '.pi'), { recursive: true });

let requests = 0;
let resolveRequest;
const firstRequest = new Promise(resolve => { resolveRequest = resolve; });
const server = http.createServer(async (request, response) => {
  requests++;
  resolveRequest();
  let body = '';
  for await (const chunk of request) body += chunk;
  const message = JSON.parse(body);
  if (message.id === undefined) { response.writeHead(204).end(); return; }
  const result = message.method === 'initialize'
    ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'synthetic', version: '1.0.0' } }
    : { tools: [] };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const marker = path.join(scratch, 'native-stdio-started');
const stdio = path.join(scratch, 'native-stdio.mjs');
fs.writeFileSync(stdio, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'synthetic'); process.stdin.resume();`);
const mcp = { mcpServers: { fixture: { url: `http://127.0.0.1:${server.address().port}/mcp`, exposure: 'direct' } } };
const withStdio = { mcpServers: { ...mcp.mcpServers, fixture_stdio: { command: process.execPath, args: [stdio], exposure: 'direct' } } };
fs.writeFileSync(path.join(agentDir, 'mcp.json'), JSON.stringify(withStdio));
fs.writeFileSync(path.join(cwd, '.pi/mcp.json'), JSON.stringify(withStdio));
fs.writeFileSync(path.join(cwd, '.pi/settings.json'), JSON.stringify({ extensions: ['+builtin:mcp'] }));
const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'synthetic-auth.json'), modelsPath: null, refreshOnCreate: false });
const settingsManager = SettingsManager.inMemory({ extensions: ['+builtin:mcp'], packages: [] }, { projectTrusted: true });
const sessions = [];
async function makeSession(disabled, extraFactories = [], tools) {
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: ['builtin:mcp'],
    disabledBuiltinExtensions: disabled ? ['mcp'] : [],
    extensionFactories: [{ name: 'mcp', builtin: true, replaceable: true, factory: createMcpExtension() }, ...extraFactories],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
    model: modelRuntime.getModels()[0], tools,
  });
  sessions.push(session);
  await session.bindExtensions({ mode: 'print', onError() {} });
  return { loader, session };
}
try {
  // --no-mcp maps to an enforced loader disable even if project/settings/-e opt back in.
  const parsed = parseArgs(['--no-mcp', '-e', 'builtin:mcp', '--approve']);
  assert.equal(parsed.noMcp, true);
  for (const mode of ['plan', 'work', 'learn', 'human-away']) {
    setMode(mode);
    const { loader, session } = await makeSession(parsed.noMcp, [() => { throw Error('synthetic legacy MCP load failure'); }]);
    assert.equal(loader.getExtensions().extensions.some(extension => extension.path === 'builtin:mcp'), false, 'native MCP loaded despite enforced disable');
    assert.equal(loader.getExtensions().errors.length, 1, 'broken replacement fixture did not fail');
    assert.equal(requests, 0, `native MCP connected in ${mode} after legacy load failure`);
    assert.equal(fs.existsSync(marker), false, `native stdio executed in ${mode}`);
    await session.reload();
    assert.equal(loader.getExtensions().extensions.some(extension => extension.path === 'builtin:mcp'), false, 'reload re-enabled native MCP');
  }

  // A real registered deferred tool remains callable while inactive; nested calls must hit Neura's hook.
  let executions = 0;
  const { session } = await makeSession(true, [guardrail, pi => {
    pi.registerTool({ name: 'fixture_deferred', label: 'Synthetic deferred', description: 'Synthetic capability', exposure: 'deferred', parameters: Type.Object({}),
      execute: async () => { executions++; return { content: [{ type: 'text', text: 'synthetic success' }], details: {} }; },
    });
    pi.registerTool({ name: 'fixture_parent', label: 'Synthetic caller', description: 'Synthetic nested call', parameters: Type.Object({}),
      execute: async (_id, _args, signal, _update, ctx) => ctx.executeTool('fixture_deferred', {}, { signal }),
    });
  }]);
  session.setActiveToolsByName(['fixture_parent']);
  assert.equal(session.getActiveToolNames().includes('fixture_deferred'), false);
  assert.equal(session.getCallableToolNames().includes('fixture_deferred'), true);
  session.sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'fixture-parent', name: 'fixture_parent', arguments: {} }],
    api: 'openai-responses', provider: 'openai', model: 'synthetic', timestamp: Date.now(), stopReason: 'toolUse',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
  const parent = session.agent.state.tools.find(tool => tool.name === 'fixture_parent');
  assert.ok(parent);
  for (const mode of ['plan', 'work', 'learn', 'human-away']) {
    setMode(mode);
    const result = await parent.execute('fixture-parent', {}, new AbortController().signal);
    assert.equal(result.isError, true, `nested deferred call escaped ${mode} policy`);
    assert.equal(executions, 0);
    for (const name of ['codemode', 'tool_search']) {
      const verdict = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'synthetic', toolName: name, input: {}, parentToolCallId: 'fixture-parent' });
      assert.equal(verdict?.block, true, `${name} bypassed ${mode}`);
    }
  }
  setMode('yolo');
  for (const name of ['codemode', 'tool_search']) {
    const verdict = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'synthetic-yolo', toolName: name, input: {} });
    assert.notEqual(verdict?.block, true, `${name} YOLO positive control failed`);
  }
  const success = await parent.execute('fixture-parent', {}, new AbortController().signal);
  assert.notEqual(success.isError, true, 'YOLO nested positive control failed');
  assert.equal(executions, 1);
  assert.equal(requests, 0);

  // Real 1.1 CLI/SDK modifiers are selections, not authority. Exercise the
  // registered built-ins through the actual agent pipeline with a local stream.
  const modifiers = parseArgs(['--tools', '+codemode,+tool_search,-write']);
  assert.deepEqual(modifiers.tools, ['+codemode', '+tool_search', '-write']);
  assert.deepEqual(modifiers.diagnostics, []);
  const mixed = parseArgs(['--tools', 'read,+codemode']);
  assert.equal(mixed.tools, undefined);
  assert.ok(mixed.diagnostics.some(item => item.type === 'error'));
  await assert.rejects(makeSession(true, [], ['read', '+codemode']), /Invalid tools option/);
  await modelRuntime.setRuntimeApiKey(modelRuntime.getModels()[0].provider, 'synthetic-local-stream-only');
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  function response(stream, model, content, stopReason = 'stop') {
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content, usage, timestamp: Date.now(), stopReason };
    stream.push(stopReason === 'aborted' ? { type: 'error', reason: 'aborted', error: message }
      : { type: 'done', reason: stopReason, message });
  }
  let toolSerial = 0, modifierExecutions = 0;
  async function callTool(session, name, args) {
    const id = `modifier-${toolSerial++}`;
    let first = true;
    session.agent.streamFunction = model => {
      const stream = createAssistantMessageEventStream();
      response(stream, model, first ? [{ type: 'toolCall', id, name, arguments: args }] : [{ type: 'text', text: 'synthetic done' }], first ? 'toolUse' : 'stop');
      first = false;
      return stream;
    };
    await session.prompt('synthetic local tool call');
    const result = session.messages.find(message => message.role === 'toolResult' && message.toolCallId === id);
    assert.ok(result, 'actual agent pipeline did not return the tool result');
    return result;
  }
  const { session: modified } = await makeSession(true, [guardrail, createCodemodeExtension(), createToolSearchExtension(), pi => {
    pi.registerTool({ name: 'modifier_deferred', label: 'Modifier deferred', description: 'Synthetic modifier deferred capability', exposure: 'deferred', parameters: Type.Object({}),
      execute: async () => { modifierExecutions++; return { content: [{ type: 'text', text: 'modifier success' }], details: {} }; },
    });
  }], modifiers.tools);
  const runtimeEvents = [];
  modified.subscribe(event => runtimeEvents.push(event));
  for (const reloaded of [false, true]) {
    if (reloaded) await modified.reload();
    assert.equal(modified.getActiveToolNames().includes('codemode'), true);
    assert.equal(modified.getActiveToolNames().includes('tool_search'), true);
    assert.equal(modified.getActiveToolNames().includes('read'), true, 'additive modifiers replaced defaults');
    assert.equal(modified.getActiveToolNames().includes('write'), false, 'reload erased subtractive modifier');
    for (const mode of ['plan', 'work', 'learn', 'human-away']) {
      setMode(mode);
      for (const [name, args] of [['codemode', { code: 'return await tools.modifier_deferred({});' }], ['tool_search', { query: 'modifier deferred' }]]) {
        const result = await callTool(modified, name, args);
        assert.equal(result.isError, true, `${name} modifier/reload escaped ${mode}`);
        assert.equal(modifierExecutions, 0, 'restricted indirect tool performed work');
      }
    }
  }
  setMode('yolo');
  assert.equal((await callTool(modified, 'codemode', { code: 'return await tools.modifier_deferred({});' })).isError, false);
  assert.equal(modifierExecutions, 1, 'YOLO real codemode did not execute the inactive deferred tool');
  assert.equal((await callTool(modified, 'tool_search', { query: 'modifier deferred' })).isError, false);
  assert.equal(modified.getActiveToolNames().includes('modifier_deferred'), true, 'real tool_search did not activate its match');
  const nestedEnd = runtimeEvents.find(event => event.type === 'tool_execution_end' && event.toolName === 'modifier_deferred');
  assert.ok(nestedEnd?.parentToolCallId?.startsWith('modifier-'), 'nested duration lost parent linkage');
  assert.ok(Number.isFinite(nestedEnd.durationMs) && nestedEnd.durationMs >= 0);
  assert.ok(runtimeEvents.some(event => event.type === 'agent_settled' && event.aborted === false), 'normal settlement flag missing');
  assert.ok(modified.messages.some(message => message.role === 'assistant' && Number.isFinite(message.durationMs)), 'assistant duration missing');

  // Observe a genuine aborted settlement; no provider or timing guess is used.
  let started;
  const streamStarted = new Promise(resolve => { started = resolve; });
  modified.agent.streamFunction = (model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    options.signal.addEventListener('abort', () => response(stream, model, [], 'aborted'), { once: true });
    started();
    return stream;
  };
  const interrupted = modified.prompt('synthetic cancellation');
  await streamStarted;
  await modified.abort();
  await interrupted;
  assert.equal(runtimeEvents.filter(event => event.type === 'agent_settled').at(-1).aborted, true);
  assert.equal(modified.isIdle, true);
  const oldRunner = modified.extensionRunner;
  await modified.reload();
  assert.notEqual(modified.extensionRunner, oldRunner, 'reload retained the old extension runtime');
  assert.equal(modified.getActiveToolNames().includes('write'), false);
  assert.equal(requests, 0, 'modifier/reload enabled native MCP');
  assert.equal(fs.existsSync(marker), false);

  // Plain Pi modifiers also execute the real built-ins without Neura policy.
  delete process.env.NEURA;
  const { session: stockTools } = await makeSession(true, [guardrail, createCodemodeExtension()], ['+codemode', '-write']);
  assert.equal((await callTool(stockTools, 'codemode', { code: 'return "stock modifier success";' })).isError, false);
  await stockTools.reload();
  assert.equal(stockTools.getActiveToolNames().includes('codemode'), true);
  assert.equal(stockTools.getActiveToolNames().includes('write'), false);

  // Without Neura's per-run disable, stock Pi still loads and connects its native MCP.
  delete process.env.NEURA;
  fs.writeFileSync(path.join(agentDir, 'mcp.json'), JSON.stringify(mcp));
  fs.writeFileSync(path.join(cwd, '.pi/mcp.json'), JSON.stringify(mcp));
  const { loader } = await makeSession(false);
  assert.equal(loader.getExtensions().extensions.some(extension => extension.path === 'builtin:mcp'), true);
  let timer;
  try { await Promise.race([firstRequest, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('stock Pi MCP positive control timed out')), 5_000); })]); }
  finally { clearTimeout(timer); }
  assert.ok(requests > 0, 'stock Pi native MCP never connected');
  console.log('PASS Pi 1.1 real loader/session: native MCP disable, override/reload/load-failure denial, nested deferred policy, real modifier/reload execution, duration/aborted settlement, YOLO and stock Pi controls');
} finally {
  for (const session of sessions) {
    try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); } finally { session.dispose(); }
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
