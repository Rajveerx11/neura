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
const { createAssistantMessageEventStream, getCurrentTools, getCurrentSystemPrompt } = await import('@earendil-works/pi-ai/compat');
const { parseArgs } = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js');
const { Type } = await import('typebox');
const { stream: anthropicStream } = await import('@earendil-works/pi-ai/api/anthropic-messages');
const { validateThemeJson } = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.js');
const theme = JSON.parse(fs.readFileSync(path.join(repo, 'agent/themes/neura-dark.json'), 'utf8'));
validateThemeJson('neura-dark', theme);
assert.throws(() => validateThemeJson('unsupported metadata', { ...theme, unsupportedMetadata: true }), /Invalid theme/);
const { default: guardrail } = await import('../../agent/extensions/guardrail.ts');
const { default: modes } = await import('../../agent/extensions/modes.ts');
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
async function makeSession(disabled, extraFactories = [], tools, sessionManager = SessionManager.inMemory(cwd), extensionPaths = []) {
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: ['builtin:mcp', ...extensionPaths],
    disabledBuiltinExtensions: disabled ? ['mcp'] : [],
    extensionFactories: [{ name: 'mcp', builtin: true, replaceable: true, factory: createMcpExtension() }, ...extraFactories],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader, sessionManager,
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
  async function callTool(session, name, args, inspectProvider) {
    const id = `modifier-${toolSerial++}`;
    let first = true;
    session.agent.streamFunction = async (model, context, options) => {
      if (inspectProvider) await inspectProvider(context, options, model);
      const stream = createAssistantMessageEventStream();
      response(stream, model, first ? [{ type: 'toolCall', id, name, arguments: args }] : [{ type: 'text', text: 'synthetic done' }], first ? 'toolUse' : 'stop');
      first = false;
      return stream;
    };
    await session.prompt('synthetic local tool call');
    const result = session.messages.find(message => message.role === 'toolResult' && message.toolCallId === id);
    assert.ok(result, `actual agent pipeline did not return the tool result: ${session.messages.filter(message => message.role === 'assistant').at(-1)?.errorMessage ?? 'no assistant error'}`);
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

  // Pi 1.3 restores transcript tools on resume; restoration is not authority.
  const resumeFactories = [guardrail, createCodemodeExtension(), createToolSearchExtension()];
  const { session: resumed } = await makeSession(true, resumeFactories, undefined, modified.sessionManager);
  assert.equal(resumed.getActiveToolNames().includes('codemode'), true, 'resume lost the transcript loadout');
  assert.equal(resumed.getActiveToolNames().includes('write'), false, 'resume re-enabled a disabled tool');
  for (const reloaded of [false, true]) {
    if (reloaded) await resumed.reload();
    for (const mode of ['plan', 'work', 'learn', 'human-away']) {
      setMode(mode);
      const denied = await callTool(resumed, 'codemode', { code: 'return "resume must not grant execution";' });
      assert.equal(denied.isError, true, `restored codemode escaped ${mode}`);
    }
  }
  setMode('yolo');
  assert.equal((await callTool(resumed, 'codemode', { code: 'return "resumed YOLO control";' })).isError, false);
  const { session: explicit } = await makeSession(true, resumeFactories, ['read'], modified.sessionManager);
  assert.deepEqual(explicit.getActiveToolNames(), ['read'], 'explicit selection lost to transcript tools');
  assert.equal(requests, 0, 'resume enabled native MCP');
  assert.equal(fs.existsSync(marker), false);

  // Pi 1.4 replays the whole branch, not just its compaction checkpoint.
  // A removed tool must stay off; an unmentioned extension tool defaults on.
  const restoredNames = ['fixture_restored', 'fixture_removed', 'fixture_new', 'fixture_inactive'];
  let restoredExecutions = 0;
  let transportControlChecked = false;
  const restorationTools = pi => {
    for (const name of restoredNames) pi.registerTool({ name, label: name, description: `Synthetic ${name}`, parameters: Type.Object({}),
      ...(name === 'fixture_inactive' ? { defaultActive: false } : {}),
      execute: async () => { restoredExecutions++; return { content: [{ type: 'text', text: 'restoration control' }], details: {} }; },
    });
  };
  function compactedHistory() {
    const manager = SessionManager.inMemory(cwd);
    const initial = manager.appendMessage({ role: 'system', content: '', timestamp: Date.now(),
      toolsAdded: ['fixture_restored', 'fixture_removed'].map(name => ({ name, description: name, parameters: Type.Object({}) })) });
    const removed = manager.appendMessage({ role: 'system', content: '', timestamp: Date.now(), toolsRemoved: [{ name: 'fixture_removed' }] });
    manager.appendMessage({ role: 'user', content: 'synthetic history', timestamp: Date.now() });
    const compacted = manager.appendCompaction('synthetic summary; no model used', null, 0);
    assert.equal(manager.buildSessionContext().messages.some(message => message.toolsRemoved?.some(tool => tool.name === 'fixture_removed')), false,
      'fixture must hide the explicit removal from compacted context');
    return { manager, initial, removed, compacted };
  }
  const history = compactedHistory();
  const { session: restoredStock } = await makeSession(true, [restorationTools], undefined, history.manager);
  function assertRestored(candidate) {
    assert.equal(candidate.getActiveToolNames().includes('fixture_restored'), true);
    assert.equal(candidate.getActiveToolNames().includes('fixture_new'), true, 'unmentioned tool did not activate');
    assert.equal(candidate.getActiveToolNames().includes('fixture_removed'), false, 'pre-compaction removal was forgotten');
    assert.equal(candidate.getActiveToolNames().includes('fixture_inactive'), false, 'defaultActive:false tool activated');
  }
  assertRestored(restoredStock);
  await restoredStock.reload();
  // Upstream reload currently reactivates direct extension tools. Characterize
  // stock behavior; Neura must still enforce its own boundary below.
  assert.equal(restoredStock.getActiveToolNames().includes('fixture_removed'), true);
  assert.equal(restoredStock.getActiveToolNames().includes('fixture_inactive'), false);
  await restoredStock.navigateTree(history.initial, { summarize: false });
  assert.equal(restoredStock.getActiveToolNames().includes('fixture_removed'), true, 'tree did not restore the earlier branch loadout');
  await restoredStock.navigateTree(history.removed, { summarize: false });
  assertRestored(restoredStock);
  await restoredStock.navigateTree(history.compacted, { summarize: false });
  assertRestored(restoredStock);
  assert.equal((await callTool(restoredStock, 'fixture_new', {})).isError, false, 'stock new-tool control failed');
  assert.equal((await callTool(restoredStock, 'fixture_restored', {})).isError, false, 'stock restored-tool control failed');
  assert.equal(restoredExecutions, 2);
  restoredExecutions = 0;
  for (const mode of ['plan', 'work', 'learn', 'human-away']) {
    const { manager, compacted } = compactedHistory();
    const { session: restricted } = await makeSession(true, [guardrail, modes, restorationTools, pi => {
      // Simulate an extension activating capabilities after Neura's startup hook.
      pi.on('before_agent_start', () => pi.setActiveTools([...pi.getActiveTools(), 'fixture_new', 'fixture_restored']));
    }], undefined, manager);
    for (const phase of ['resume', 'reload', 'tree']) {
      if (phase === 'reload') await restricted.reload();
      if (phase === 'tree') await restricted.navigateTree(compacted, { summarize: false });
      setMode(mode);
      for (const name of ['fixture_new', 'fixture_restored']) {
        let payloads = 0;
        const denied = await callTool(restricted, name, {}, async (context, options, model) => {
          assert.equal(typeof options.onPayload, 'function', 'SDK provider hook missing');
          let payload, transportCalls = 0;
          const client = { beta: { messages: { create() { transportCalls++; throw Error('Synthetic transport reached'); } } } };
          const providerModel = { ...model, api: 'anthropic-messages', provider: 'anthropic', id: 'synthetic',
            baseUrl: 'https://example.invalid', maxTokens: 2048 };
          const shaped = anthropicStream(providerModel, context, {
            apiKey: 'synthetic-no-network', client, maxRetries: 0,
            async onPayload(value) {
              payload = await options.onPayload(value, model);
              throw Error('Synthetic payload captured before transport');
            },
          });
          await shaped.result();
          assert.equal(transportCalls, 0, 'provider transport was reached');
          assert.ok(payload, 'actual provider did not serialize the request');
          payloads++;
          if (!transportControlChecked) {
            // Let one synthetic request reach the same stub to prove its API shape.
            const control = anthropicStream(providerModel, context, {
              apiKey: 'synthetic-no-network', client, maxRetries: 0, onPayload: value => value,
            });
            const result = await control.result();
            assert.equal(transportCalls, 1, 'transport control missed the SDK client method');
            assert.match(result.errorMessage ?? '', /Synthetic transport reached/);
            transportControlChecked = true;
          }
          // Prior blocked calls/results may name the tool; executable declarations must not.
          assert.equal(JSON.stringify(payload.tools ?? []).includes('fixture_'), false, `${mode} exposed a restricted schema`);
          function inspectDefinitions(value) {
            if (Array.isArray(value)) value.forEach(inspectDefinitions);
            else if (value && typeof value === 'object') {
              if (value.type === 'tool_definition') assert.equal(JSON.stringify(value).includes('fixture_'), false, 'inline tool definition escaped');
              Object.values(value).forEach(inspectDefinitions);
            }
          }
          inspectDefinitions(payload);
          assert.equal(restricted.getActiveToolNames().some(tool => restoredNames.includes(tool)), false);
        });
        assert.ok(payloads > 0, 'provider boundary control never ran');
        assert.equal(denied.isError, true, `${name} escaped ${mode} after ${phase}`);
        assert.equal(restoredExecutions, 0, 'restricted tool had a side effect');
      }
    }
    setMode('yolo');
    assert.equal((await callTool(restricted, 'fixture_new', {})).isError, false, 'YOLO new-tool control failed');
    assert.equal((await callTool(restricted, 'fixture_restored', {})).isError, false, 'YOLO restored-tool control failed');
    assert.equal(restoredExecutions, 2);
    restoredExecutions = 0;
  }
  assert.equal(transportControlChecked, true, 'provider transport positive control never ran');
  assert.equal(requests, 0, 'restoration connected native MCP');
  assert.equal(fs.existsSync(marker), false, 'restoration started native stdio MCP');

  // Exercise jiti aliases through a real file extension, not a direct import.
  const aliasFixture = path.join(scratch, 'models-alias.ts');
  fs.writeFileSync(aliasFixture, `
    import { clampThinkingLevel } from '@earendil-works/pi-ai/models';
    import { clampThinkingLevel as legacyClamp } from '@mariozechner/pi-ai/models';
    export default function () {
      const model = { reasoning: false };
      if (clampThinkingLevel(model, 'high') !== 'off' || legacyClamp(model, 'high') !== 'off') throw Error('model alias mismatch');
    }
  `);
  const { loader: aliasLoader } = await makeSession(true, [], undefined, SessionManager.inMemory(cwd), [aliasFixture]);
  assert.deepEqual(aliasLoader.getExtensions().errors, []);
  assert.ok(aliasLoader.getExtensions().extensions.some(extension => extension.path === aliasFixture));

  // Pi 1.2 custom-triggered runs must cross the real Neura mode boundary,
  // including while asynchronous startup is busy and cancellation is pending.
  for (const cancelDuringStartup of [false, true]) {
    let entered, release;
    const startupEntered = new Promise(resolve => { entered = resolve; });
    const startupReleased = new Promise(resolve => { release = resolve; });
    let startupEvents = 0, providerCalls = 0;
    const { session: custom } = await makeSession(true, [guardrail, modes, pi => {
      pi.on('before_agent_start', async event => {
        startupEvents++;
        assert.equal(event.messageType, 'custom');
        assert.equal(event.message.customType, 'startup-security');
        assert.equal('prompt' in event, false, 'custom start impersonated a user prompt');
        assert.match(event.systemPrompt, /NEURA MODE: PLAN/);
        entered();
        await startupReleased;
      });
    }], ['+codemode', '+tool_search']);
    setMode('plan');
    const customEvents = [];
    custom.subscribe(event => customEvents.push(event));
    custom.agent.streamFunction = (model, context, options) => {
      providerCalls++;
      if (cancelDuringStartup) assert.equal(options.signal.aborted, true, 'startup abort reached an uncancelled provider');
      assert.match(getCurrentSystemPrompt(context.messages), /NEURA MODE: PLAN/);
      assert.equal(getCurrentTools(context.messages).some(tool => ['codemode', 'tool_search', 'write'].includes(tool.name)), false,
        'custom-triggered provider received a restricted capability');
      const stream = createAssistantMessageEventStream();
      response(stream, model, [{ type: 'text', text: 'synthetic custom response' }], options.signal.aborted ? 'aborted' : 'stop');
      return stream;
    };
    const run = custom.sendCustomMessage({ customType: 'startup-security', content: 'synthetic custom start', display: false }, { triggerTurn: true });
    await startupEntered;
    assert.equal(custom.isIdle, false, 'async startup appeared idle');
    assert.equal(custom.isStreaming, true, 'async startup did not reserve its run');
    assert.equal(providerCalls, 0, 'provider ran before startup boundary completed');
    let abort;
    if (cancelDuringStartup) abort = custom.abort();
    else await custom.sendCustomMessage({ customType: 'queued-startup', content: 'synthetic queued message', display: false }, { triggerTurn: true });
    assert.equal(startupEvents, 1, 'message during startup opened a competing run');
    release();
    await run;
    if (abort) await abort;
    assert.equal(startupEvents, 1);
    assert.equal(custom.isIdle, true);
    assert.equal(customEvents.filter(event => event.type === 'agent_settled').at(-1)?.aborted, cancelDuringStartup);
    if (!cancelDuringStartup) {
      assert.ok(providerCalls > 0, 'custom-triggered positive control never reached provider');
      assert.ok(custom.messages.some(message => message.role === 'custom' && message.customType === 'queued-startup'), 'startup message was lost');
    }
    assert.equal(requests, 0, 'custom startup enabled native MCP');
    assert.equal(fs.existsSync(marker), false, 'custom startup spawned native stdio MCP');
  }

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
  console.log('PASS Pi 1.4 real loader/session: pre-compaction removals, unmentioned/default-inactive tools, tree/reload, restricted provider payloads, models aliases, native MCP disable, override/reload/load-failure denial, nested deferred policy, real modifier/resume/reload execution, custom startup/busy/cancellation, duration/aborted settlement, YOLO and stock Pi controls');
} finally {
  for (const session of sessions) {
    try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); } finally { session.dispose(); }
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
