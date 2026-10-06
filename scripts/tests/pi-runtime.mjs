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
const { createAgentSession, createMcpExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
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
async function makeSession(disabled, extraFactories = []) {
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: ['builtin:mcp'],
    disabledBuiltinExtensions: disabled ? ['mcp'] : [],
    extensionFactories: [{ name: 'mcp', builtin: true, replaceable: true, factory: createMcpExtension() }, ...extraFactories],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
    model: modelRuntime.getModels()[0],
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
  console.log('PASS Pi 1.x real loader/session: native MCP disable, override/reload/load-failure denial, nested deferred policy, YOLO and stock Pi controls');
} finally {
  for (const session of sessions) {
    try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); } finally { session.dispose(); }
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
