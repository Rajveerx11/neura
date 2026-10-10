// Configured stock tools versus Neura replacements through real Pi public APIs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { isolate } from './isolation.mjs';
import { pinnedPi } from './pinned-pi.mjs';
const scratch = isolate();
process.env.PI_OFFLINE = '1';
const repo = path.resolve(import.meta.dirname, '../..');
pinnedPi(repo);
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
const { setMode } = await import('../../agent/neura/mode-state.ts');
const cwd = path.join(scratch, 'workspace');
fs.mkdirSync(cwd);
fs.writeFileSync(path.join(cwd, 'source.txt'), 'ordinary configured source');
fs.writeFileSync(path.join(cwd, '.env'), 'synthetic private file');
// A valid, synthetic 3000x30 RGB PNG exceeds Pi's default resize width.
function chunk(type, bytes) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(3000); header.writeUInt32BE(30, 4); header[8] = 8; header[9] = 2;
const image = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.alloc((3000 * 3 + 1) * 30))), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(cwd, 'wide.png'), image);
let shellPath = '/bin/sh';
if (process.platform === 'win32') {
  const found = spawnSync('where.exe', ['git.exe'], { encoding: 'utf8', windowsHide: true });
  assert.equal(found.status, 0, 'Git installation unavailable for synthetic alternate-shell test');
  shellPath = path.resolve(path.dirname(found.stdout.trim().split(/\r?\n/)[0]), '../usr/bin/sh.exe');
}
assert.ok(fs.existsSync(shellPath), 'Alternate shell fixture unavailable');
// Exercise Pi SettingsManager's public tilde normalization, not a private helper.
fs.symlinkSync(path.dirname(shellPath), path.join(scratch, 'shell'), process.platform === 'win32' ? 'junction' : 'dir');
const configuredShell = `~/shell/${path.basename(shellPath)}`;
const marker = path.join(scratch, 'prefix-ran.txt');
const prefix = `printf 'CONFIGURED_PREFIX\\n'; printf x > '${marker.replaceAll('\\', '/')}'`;
const modelRuntime = await ModelRuntime.create({ authPath: path.join(scratch, 'synthetic-auth.json'), modelsPath: null, refreshOnCreate: false });
const sessions = [];
async function makeSession(neura, settings) {
  if (neura) process.env.NEURA = '1'; else delete process.env.NEURA;
  const settingsManager = SettingsManager.inMemory({ packages: [], extensions: [], ...settings }, { projectTrusted: true });
  const loader = new DefaultResourceLoader({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager,
    additionalExtensionPaths: [path.join(repo, 'agent/extensions/guardrail.ts'), path.join(repo, 'agent/extensions/modes.ts')],
    noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, modelRuntime, settingsManager,
    resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), model: modelRuntime.getModels()[0] });
  sessions.push(session);
  await session.bindExtensions({ mode: 'print', onError() {} });
  if (!neura) assert.ok(loader.getExtensions().extensions.every(extension => extension.tools.size === 0 && extension.handlers.size === 0), 'No-NEURA Pi registered wrappers');
  return { session, settingsManager };
}
let serial = 0;
async function call(session, name, input) {
  const tool = session.agent.state.tools.find(candidate => candidate.name === name);
  assert.ok(tool, `${name} missing from configured session`);
  return tool.execute(`configured-${++serial}`, input, new AbortController().signal);
}
async function planControls(session) {
  setMode('plan');
  fs.rmSync(marker, { force: true });
  assert.match(JSON.stringify(await call(session, 'read', { path: 'source.txt' })), /ordinary configured source/);
  await call(session, 'bash', { command: 'pwd' });
  for (const [name, input] of [['read', { path: '.env' }], ['read', { path: 'wide.png' }],
    ['bash', { command: 'git show HEAD:source.txt' }], ['bash', { command: "printf 'native shell must not run'" }]]) {
    const verdict = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: `blocked-${++serial}`, toolName: name, input });
    // Images may pass the lexical hook but must fail the concrete Plan read.
    if (name === 'bash' || input.path === '.env') assert.equal(verdict?.block, true);
    await assert.rejects(() => call(session, name, input));
  }
  assert.equal(fs.existsSync(marker), false, 'Plan ran configured native prefix');
}
try {
  // Independent discriminating probes: default factories must fail all three.
  const failures = [];
  for (const [label, settings, tool, input, positive] of [
    ['commandPrefix', { shellCommandPrefix: "printf 'CONFIGURED_PREFIX\\n'" }, 'bash', { command: "printf 'ORDINARY_COMMAND\\n'" }, result => JSON.stringify(result.content).includes('CONFIGURED_PREFIX') && JSON.stringify(result.content).includes('ORDINARY_COMMAND')],
    ['shellPath', { shellPath: configuredShell }, 'bash', { command: "printf '%s\\n' \"$0\"" }, result => JSON.stringify(result.content).includes('/shell/sh')],
    ['imageAutoResize', { images: { autoResize: false } }, 'read', { path: 'wide.png' }, result => result.content.find(block => block.type === 'image')?.data === image.toString('base64')],
  ]) {
    const stock = await makeSession(false, settings);
    const neura = await makeSession(true, settings);
    setMode('yolo');
    const expected = await call(stock.session, tool, input);
    assert.equal(positive(expected), true, `${label}: stock fixture did not discriminate`);
    if (tool === 'bash') assert.equal(expected.structuredContent.exit_code, 0, `${label}: stock shell fixture failed`);
    const actual = await call(neura.session, tool, input);
    if (JSON.stringify(actual.content) !== JSON.stringify(expected.content) || actual.structuredContent?.exit_code !== expected.structuredContent?.exit_code) failures.push(label);
    await planControls(neura.session);
  }
  assert.deepEqual(failures, [], 'Non-Plan configured SDK regressions');
  console.log('PASS configured native probes: commandPrefix, normalized alternate shellPath, imageAutoResize=false; closed Plan negatives');
  const settings = { shellCommandPrefix: prefix, shellPath: configuredShell, images: { autoResize: false } };
  const stock = await makeSession(false, settings);
  const neura = await makeSession(true, settings);
  for (const phase of ['initial', 'reload', 'settings-pending', 'settings-reload']) {
    if (phase === 'settings-pending') {
      for (const entry of [stock, neura]) {
        entry.settingsManager.setShellCommandPrefix("printf 'RELOADED_PREFIX\\n'");
        entry.settingsManager.setImageAutoResize(true);
        entry.settingsManager.setShellPath(path.join(scratch, 'missing-shell'));
      }
    }
    if (phase === 'reload' || phase === 'settings-reload') {
      process.env.NEURA = '1';
      setMode('plan');
      await neura.session.reload();
      delete process.env.NEURA;
      await stock.session.reload();
      process.env.NEURA = '1';
    }
    for (const mode of ['yolo', 'work', 'human-away', 'learn']) {
      await planControls(neura.session);
      setMode(mode);
      // Direct wrapper equivalence; mode-specific hook restrictions are not bypassed in production.
      const expected = await call(stock.session, 'read', { path: 'wide.png' });
      assert.equal(JSON.stringify((await call(neura.session, 'read', { path: 'wide.png' })).content) === JSON.stringify(expected.content), true, `${phase}/${mode}: configured image changed`);
      if (phase === 'settings-reload') {
        for (const entry of [stock, neura]) await assert.rejects(() => call(entry.session, 'bash', { command: 'pwd' }), /Custom shell path not found/);
      } else {
        const input = { command: "printf '%s\\n' \"$0\"" };
        const expectedShell = await call(stock.session, 'bash', input);
        assert.equal(fs.existsSync(marker), true, `${phase}/${mode}: stock configured prefix did not run`);
        fs.rmSync(marker);
        const actualShell = await call(neura.session, 'bash', input);
        assert.equal(fs.existsSync(marker), true, `${phase}/${mode}: Neura configured prefix did not run`);
        assert.deepEqual(actualShell.content, expectedShell.content, `${phase}/${mode}: shell/prefix changed`);
        assert.equal(actualShell.structuredContent.exit_code, expectedShell.structuredContent.exit_code);
      }
    }
    if (phase === 'settings-reload') {
      // A missing configured native shell must not prevent closed Plan inspection.
      await planControls(neura.session);
      setMode('yolo');
      for (const entry of [stock, neura]) {
        if (entry === neura) process.env.NEURA = '1'; else delete process.env.NEURA;
        entry.settingsManager.setShellPath(configuredShell);
        await entry.session.reload();
      }
      process.env.NEURA = '1';
      setMode('yolo');
      const result = await call(neura.session, 'bash', { command: 'pwd' });
      assert.match(JSON.stringify(result.content), /RELOADED_PREFIX/);
      assert.doesNotMatch(JSON.stringify(result.content), /CONFIGURED_PREFIX/);
    }
  }
  console.log('PASS configured native lifecycle: stock/no-NEURA controls, four non-Plan modes, Plan transitions, reload, changed settings and missing-shell fail-closed');
} finally {
  for (const session of sessions) {
    try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); } finally { session.dispose(); }
  }
}
