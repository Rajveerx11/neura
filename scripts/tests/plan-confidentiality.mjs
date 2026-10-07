// Real SDK loader/session: tool name collisions must select the protected wrappers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { isolate } from './isolation.mjs';
import { pinnedPi } from './pinned-pi.mjs';
import { repository, git } from './git-fixture.mjs';
const scratch = isolate();
process.env.NEURA = '1';
process.env.PI_OFFLINE = '1';
const repo = path.resolve(import.meta.dirname, '../..');
pinnedPi(repo);
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createReadToolDefinition } = await import('@earendil-works/pi-coding-agent');
const { setMode } = await import('../../agent/neura/mode-state.ts');
const { authorizePlanPath, readPlanFile, inspectPlanFiles } = await import('../../agent/neura/plan-files.ts');
const cwd = repository(scratch, 'plan-files');
const privateCanary = 'PRIVATE_FILE_CANARY_NOT_A_TOKEN';
const globalCanary = 'GLOBAL_IGNORE_CANARY_NOT_A_TOKEN';
const historyCanary = 'HISTORICAL_CANARY_NOT_A_TOKEN';
const outside = path.join(scratch, 'outside');
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'outside.txt'), privateCanary);
fs.mkdirSync(path.join(cwd, 'src'));
fs.writeFileSync(path.join(cwd, 'src', 'normal.ts'), 'export const useful = "ordinary source";\nAPI_TOKEN=small-secret\n');
fs.mkdirSync(path.join(cwd, 'ignored'));
fs.writeFileSync(path.join(cwd, 'ignored', 'tracked-secret.txt'), privateCanary);
// A tracked file is still confidential when subsequently covered by ignore rules.
git(cwd, 'add', '-f', 'ignored/tracked-secret.txt');
git(cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'synthetic ignored tracked');
fs.writeFileSync(path.join(cwd, 'retired.txt'), historyCanary);
git(cwd, 'add', 'retired.txt');
git(cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'synthetic history');
fs.unlinkSync(path.join(cwd, 'retired.txt'));
git(cwd, 'add', 'retired.txt');
git(cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'synthetic retirement');
fs.writeFileSync(path.join(cwd, '.env'), privateCanary);
fs.mkdirSync(path.join(cwd, 'private'));
fs.writeFileSync(path.join(cwd, 'private', 'notes.txt'), privateCanary);
fs.writeFileSync(path.join(cwd, 'credentials.json'), privateCanary);
fs.writeFileSync(path.join(cwd, 'global-private.txt'), globalCanary);
const globalRules = path.join(scratch, 'global-ignore');
fs.writeFileSync(globalRules, 'global-private.txt\n');
const executableMarker = path.join(scratch, 'should-not-execute');
const hostile = path.join(scratch, 'hostile.sh');
fs.writeFileSync(hostile, `#!/bin/sh\nprintf executed > '${executableMarker.replaceAll('\\', '/')}'\n`);
fs.chmodSync(hostile, 0o755);
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, `[core]\n excludesFile = "${globalRules.replaceAll('\\', '/')}"\n fsmonitor = "${hostile.replaceAll('\\', '/')}"\n hooksPath = "${scratch.replaceAll('\\', '/')}"\n pager = "${hostile.replaceAll('\\', '/')}"\n[diff]\n external = "${hostile.replaceAll('\\', '/')}"\n`);
// Explicit config-path and Git's default synthetic HOME are both covered.
assert.throws(() => authorizePlanPath(cwd, 'global-private.txt'), /confidential/);
fs.copyFileSync(process.env.GIT_CONFIG_GLOBAL, path.join(scratch, '.gitconfig'));
const globalConfig = process.env.GIT_CONFIG_GLOBAL;
delete process.env.GIT_CONFIG_GLOBAL;
assert.throws(() => authorizePlanPath(cwd, 'global-private.txt'), /confidential/);
process.env.GIT_CONFIG_GLOBAL = globalConfig;
// Native Git's XDG config/default excludes lookup must match Plan, without
// carrying executable or command-injection environment variables into Git.
const xdg = path.join(scratch, 'xdg');
fs.mkdirSync(path.join(xdg, 'git'), { recursive: true });
const xdgName = 'xdg-ignored.txt';
const xdgCanary = 'XDG_IGNORE_CANARY_NOT_A_TOKEN';
fs.writeFileSync(path.join(cwd, xdgName), xdgCanary);
fs.writeFileSync(path.join(xdg, 'git', 'ignore'), `${xdgName}\n`);
fs.writeFileSync(path.join(xdg, 'git', 'config'), `[core]\n excludesFile = "${path.join(xdg, 'git', 'ignore').replaceAll('\\', '/')}"\n fsmonitor = "${hostile.replaceAll('\\', '/')}"\n`);
fs.unlinkSync(path.join(scratch, '.gitconfig'));
delete process.env.GIT_CONFIG_GLOBAL;
process.env.XDG_CONFIG_HOME = xdg;
try {
  assert.equal(git(cwd, 'check-ignore', '--no-index', xdgName).trim(), xdgName);
  assert.throws(() => readPlanFile(cwd, xdgName), /confidential/);
  assert.doesNotMatch(await inspectPlanFiles(cwd, 'grep', { pattern: xdgCanary, literal: true }), /XDG_IGNORE_CANARY/);
  // With no core.excludesFile config, Git also defaults to XDG/git/ignore.
  fs.writeFileSync(path.join(xdg, 'git', 'config'), '[core]\n autocrlf = false\n');
  assert.equal(git(cwd, 'check-ignore', '--no-index', xdgName).trim(), xdgName);
  assert.throws(() => readPlanFile(cwd, xdgName), /confidential/);
  assert.doesNotMatch(await inspectPlanFiles(cwd, 'grep', { pattern: xdgCanary, literal: true }), /XDG_IGNORE_CANARY/);
  Object.assign(process.env, {
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.excludesFile', GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_CONFIG_PARAMETERS: "'core.excludesFile=/dev/null'",
    GIT_EXTERNAL_DIFF: hostile, GIT_ASKPASS: hostile, GIT_PAGER: hostile,
  });
  assert.throws(() => readPlanFile(cwd, xdgName), /confidential/);
  assert.doesNotMatch(await inspectPlanFiles(cwd, 'grep', { pattern: xdgCanary, literal: true }), /XDG_IGNORE_CANARY/);
} finally {
  for (const name of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_PARAMETERS', 'GIT_EXTERNAL_DIFF', 'GIT_ASKPASS', 'GIT_PAGER']) delete process.env[name];
  delete process.env.XDG_CONFIG_HOME;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  fs.unlinkSync(path.join(cwd, xdgName));
}
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
fs.symlinkSync(outside, path.join(cwd, 'outside-link'), linkType);
fs.symlinkSync(path.join(cwd, 'ignored'), path.join(cwd, 'ignored-link'), linkType);
fs.symlinkSync(path.join(cwd, 'src'), path.join(cwd, 'source-link'), linkType);
fs.symlinkSync(cwd, path.join(cwd, 'loop'), linkType);
fs.linkSync(path.join(outside, 'outside.txt'), path.join(cwd, 'hardlink.txt'));
fs.writeFileSync(path.join(cwd, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
const settingsManager = SettingsManager.inMemory({ packages: [], extensions: [] }, { projectTrusted: true });
const modelRuntime = await ModelRuntime.create({ authPath: path.join(scratch, 'synthetic-auth.json'), modelsPath: null, refreshOnCreate: false });
const sessions = [];
async function makeSession(neura) {
  if (neura) process.env.NEURA = '1'; else delete process.env.NEURA;
  const loader = new DefaultResourceLoader({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager,
    additionalExtensionPaths: [path.join(repo, 'agent/extensions/guardrail.ts'), path.join(repo, 'agent/extensions/modes.ts')],
    noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, modelRuntime, settingsManager,
    resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), model: modelRuntime.getModels()[0] });
  sessions.push(session);
  await session.bindExtensions({ mode: 'print', onError() {} });
  return { loader, session };
}
let serial = 0;
async function call(session, toolName, input) {
  const tool = session.agent.state.tools.find(candidate => candidate.name === toolName);
  assert.ok(tool, `${toolName} missing from real session`);
  return tool.execute(`inspection-${++serial}`, input, new AbortController().signal);
}
async function denied(session, toolName, input) {
  const verdict = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: `denied-${++serial}`, toolName, input });
  if (verdict?.block) return;
  await assert.rejects(() => call(session, toolName, input));
}
try {
  setMode('plan');
  const { session, loader } = await makeSession(true);
  setMode('plan');
  const wrapper = loader.getExtensions().extensions.find(extension => extension.tools.has('read'));
  assert.equal(wrapper.resolvedPath, path.join(repo, 'agent/extensions/guardrail.ts'));
  assert.equal(wrapper.tools.size, 5);
  const normal = await call(session, 'read', { path: 'src/normal.ts', limit: 1 });
  assert.match(JSON.stringify(normal), /ordinary source/);
  const redacted = await call(session, 'read', { path: 'src/normal.ts' });
  assert.doesNotMatch(JSON.stringify(redacted), /small-secret/);
  assert.match(JSON.stringify(redacted), /REDACTED/);
  assert.match(JSON.stringify(await call(session, 'read', { path: 'source-link/normal.ts' })), /ordinary source/);
  for (const name of ['.env', 'credentials.json', 'private/notes.txt', 'ignored/tracked-secret.txt', 'global-private.txt', '.git/config', 'outside-link/outside.txt', 'ignored-link/tracked-secret.txt', 'hardlink.txt', '../outside/outside.txt']) {
    await denied(session, 'read', { path: name });
    await assert.rejects(() => call(session, 'read', { path: name }), undefined, `direct wrapper read escaped: ${name}`);
    for (const toolName of ['grep', 'find', 'ls']) await denied(session, toolName, { path: name, pattern: toolName === 'find' ? '*' : 'CANARY' });
  }
  await assert.rejects(() => call(session, 'read', { path: 'binary.dat' }), /UTF-8/);
  for (const [tool, input] of [['grep', { pattern: 'ordinary|useful', path: '.' }], ['find', { pattern: '**/*.ts', path: '.' }], ['ls', { path: '.' }], ['bash', { command: 'rg -n ordinary .' }], ['bash', { command: 'rg --files .' }]]) {
    const result = JSON.stringify(await call(session, tool, input));
    assert.doesNotMatch(result, /PRIVATE_FILE_CANARY|GLOBAL_IGNORE_CANARY|HISTORICAL_CANARY|tracked-secret|global-private|outside-link|ignored-link|hardlink|credentials|\.env/);
    assert.match(result, /normal\.ts|src\//, `${tool} lost useful source inspection`);
  }
  assert.match(JSON.stringify(await call(session, 'bash', { command: 'Get-Content -LiteralPath src/normal.ts' })), /ordinary source/);
  assert.match(JSON.stringify(await call(session, 'bash', { command: 'Select-String -LiteralPath src/normal.ts -Pattern ordinary' })), /ordinary source/);
  assert.match(JSON.stringify(await call(session, 'bash', { command: 'Get-ChildItem src' })), /normal.ts/);
  assert.match(JSON.stringify(await call(session, 'bash', { command: 'git rev-parse --short HEAD' })), new RegExp(git(cwd, 'rev-parse', '--short', 'HEAD').trim()));
  for (const command of ['git show HEAD~1:retired.txt', 'git log -p --all', 'git diff HEAD~2 HEAD', 'git cat-file -p HEAD~1:retired.txt', 'git grep CANARY HEAD~1', 'git reflog', 'rg --hidden --no-ignore CANARY .', 'rg -L CANARY .', 'Get-ChildItem -Recurse | Get-Content', 'Get-Content .env', 'Get-Content ../outside/outside.txt', 'Get-Content src/normal.ts; whoami', 'powershell -Command Get-Content .env']) {
    await denied(session, 'bash', { command });
    await assert.rejects(() => call(session, 'bash', { command }), undefined, `direct wrapper bash escaped: ${command}`);
  }
  // Ignore-policy changes and a link replacement between SDK access and read
  // must be rechecked, not authorized by an earlier tool_call verdict.
  const race = path.join(cwd, 'race.txt');
  fs.writeFileSync(race, 'ordinary race source');
  assert.equal((await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'race', toolName: 'read', input: { path: race } }))?.block, undefined);
  fs.appendFileSync(path.join(cwd, '.gitignore'), '\nrace.txt\n');
  await assert.rejects(() => call(session, 'read', { path: race }), /confidential/);
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'ignored/\n');
  const raceLink = path.join(cwd, 'race-link');
  fs.symlinkSync(path.join(cwd, 'src'), raceLink, linkType);
  let raced = false;
  const originalOpen = fs.openSync;
  fs.openSync = function(file, ...args) {
    if (!raced && String(file) === path.join(cwd, 'src', 'normal.ts')) {
      raced = true;
      fs.unlinkSync(raceLink); fs.symlinkSync(outside, raceLink, linkType);
    }
    return originalOpen.call(this, file, ...args);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => readPlanFile(cwd, 'race-link/normal.ts')); }
  finally { fs.openSync = originalOpen; syncBuiltinESMExports(); }
  assert.equal(raced, true);
  // Swap the concrete file after authorization but before descriptor open.
  const originalFstat = fs.fstatSync;
  fs.writeFileSync(race, 'ordinary');
  let swapped = false;
  fs.fstatSync = function(fd, ...args) {
    if (!swapped) { swapped = true; fs.unlinkSync(race); fs.linkSync(path.join(outside, 'outside.txt'), race); }
    return originalFstat.call(this, fd, ...args);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => readPlanFile(cwd, 'race.txt'), /hard-linked|changed/); }
  finally { fs.fstatSync = originalFstat; syncBuiltinESMExports(); }
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => session.agent.state.tools.find(tool => tool.name === 'grep').execute('aborted', { pattern: 'ordinary' }, aborted.signal), /aborted/);
  const runningAbort = new AbortController();
  const pending = session.agent.state.tools.find(tool => tool.name === 'find').execute('abort-running', { pattern: '**/*' }, runningAbort.signal);
  setImmediate(() => runningAbort.abort());
  await assert.rejects(() => pending, /aborted/);
  assert.equal(fs.existsSync(executableMarker), false, 'configured external executable ran');
  const validConfig = fs.readFileSync(globalConfig, 'utf8');
  fs.writeFileSync(globalConfig, '[broken config');
  try { await assert.rejects(() => call(session, 'read', { path: 'src/normal.ts' }), /failed closed/); }
  finally { fs.writeFileSync(globalConfig, validConfig); }
  fs.writeFileSync(path.join(cwd, 'many-lines.txt'), 'ordinary line\n'.repeat(2100));
  const limitedRead = await call(session, 'read', { path: 'many-lines.txt', offset: 2, limit: 1 });
  assert.match(JSON.stringify(limitedRead), /more lines/);
  const cappedRead = await call(session, 'read', { path: 'many-lines.txt' });
  assert.equal(cappedRead.details.truncation.truncated, true, 'SDK line cap was lost');
  const limitedFind = await call(session, 'find', { pattern: '**/*', limit: 1 });
  assert.match(JSON.stringify(limitedFind), /limit reached/);
  const boundedGrep = await call(session, 'grep', { pattern: 'ordinary', path: 'src', context: 1, limit: 1 });
  assert.match(JSON.stringify(boundedGrep), /REDACTED/);
  await assert.rejects(() => call(session, 'grep', { pattern: '(a+)+$', path: 'src' }), /regex/);
  // Previously allowed failed matches were quadratic and blocked abort/deadline.
  const hostileLines = path.join(cwd, 'hostile-lines.txt');
  fs.writeFileSync(hostileLines, `${'a'.repeat(16_384)}\n`.repeat(144));
  await assert.rejects(() => call(session, 'grep', { pattern: 'a.*b', path: 'hostile-lines.txt' }), /regex/);
  assert.match(await inspectPlanFiles(cwd, 'grep', { pattern: 'a.*b', literal: true, path: hostileLines }), /No authorized matches/);
  assert.match(await inspectPlanFiles(cwd, 'grep', { pattern: 'a[^a]$', path: hostileLines }), /No authorized matches/);
  // Do not silently clip matching input into a false successful no-match.
  fs.writeFileSync(path.join(cwd, 'oversize-line.txt'), `${'a'.repeat(16_385)}needle\n`);
  await assert.rejects(() => call(session, 'grep', { pattern: 'needle', path: 'oversize-line.txt' }), /line.*limit/i);
  fs.unlinkSync(path.join(cwd, 'oversize-line.txt'));
  fs.writeFileSync(path.join(cwd, 'oversize-file.txt'), Buffer.alloc(8 * 1024 * 1024 + 1, 'a'));
  await assert.rejects(() => call(session, 'grep', { pattern: 'needle', path: '.' }), /file size limit/i);
  fs.unlinkSync(path.join(cwd, 'oversize-file.txt'));
  // Instrument the actual per-line matcher, not traversal: the abort and clock
  // advance happen only after 40 lines of this single file have been scanned.
  const originalTest = RegExp.prototype.test;
  const originalNow = Date.now;
  const midFileAbort = new AbortController();
  let scanned = 0;
  RegExp.prototype.test = function(value) {
    if (this.source === '^a$' && ++scanned === 40) setImmediate(() => midFileAbort.abort());
    return originalTest.call(this, value);
  };
  try {
    await assert.rejects(() => inspectPlanFiles(cwd, 'grep', { pattern: '^a$', path: hostileLines }, midFileAbort.signal), /aborted/);
    assert.ok(scanned >= 40 && scanned < 144, `abort did not interrupt mid-file: ${scanned}`);
  } finally { RegExp.prototype.test = originalTest; }
  scanned = 0;
  const clockStart = originalNow();
  RegExp.prototype.test = function(value) {
    if (this.source === '^a$') scanned++;
    return originalTest.call(this, value);
  };
  Date.now = () => clockStart + (scanned >= 40 ? 10_001 : 0);
  try {
    await assert.rejects(() => inspectPlanFiles(cwd, 'grep', { pattern: '^a$', path: hostileLines }), /deadline/i);
    assert.equal(scanned, 40, 'deadline did not interrupt mid-file');
  } finally { RegExp.prototype.test = originalTest; Date.now = originalNow; }
  fs.unlinkSync(hostileLines);
  await assert.rejects(() => call(session, 'find', { pattern: '*', limit: 100000 }), /limit/);
  // Real final-context emission includes restored system text and tool schemas.
  const toolDefinition = { name: 'synthetic', description: 'normal', parameters: { type: 'object', properties: { token: { type: 'string' } } } };
  const finalContext = await session.extensionRunner.emitContext([
    { role: 'system', content: 'API_TOKEN=system-secret', sections: { research: 'PASSWORD=section-secret' }, toolsAdded: [toolDefinition], timestamp: 1 },
    { role: 'user', content: 'Authorization: Bearer user-secret', timestamp: 1 },
    { role: 'toolResult', toolCallId: 'previous-mode-read', toolName: 'read', content: [{ type: 'text', text: privateCanary }], details: { password: 'metadata-secret' }, timestamp: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(finalContext), /system-secret|section-secret|user-secret|metadata-secret/);
  assert.deepEqual(finalContext[0].toolsAdded, [toolDefinition]);
  const opaque = { type: 'image', data: Buffer.from('OPAQUE_IMAGE_CANARY').toString('base64'), mimeType: 'image/png' };
  const imageContext = await session.extensionRunner.emitContext([{ role: 'user', content: [opaque], timestamp: 1 }]);
  assert.deepEqual(imageContext[0].content, [{ type: 'text', text: '[Opaque image withheld in Plan.]' }]);
  assert.doesNotMatch(JSON.stringify(imageContext), new RegExp(opaque.data));
  const filtered = await session.extensionRunner.emitContext([{ role: 'toolResult', toolCallId: 'previous-mode-read', toolName: 'read', content: [{ type: 'text', text: privateCanary }], timestamp: 1 }]);
  assert.doesNotMatch(JSON.stringify(filtered), /PRIVATE_FILE_CANARY/);
  const finalResult = await session.extensionRunner.emitToolResult({ type: 'tool_result', toolCallId: 'synthetic', toolName: 'web_search', input: {}, content: [{ type: 'text', text: 'API_TOKEN=tool-secret' }], details: { password: 'detail-secret' }, structuredContent: { token: 'structured-secret' }, isError: false });
  assert.doesNotMatch(JSON.stringify(finalResult), /tool-secret|detail-secret|structured-secret/);
  // Outside Plan delegates to stock SDK, including paths Plan rejects.
  for (const mode of ['work', 'yolo', 'human-away', 'learn']) {
    setMode(mode);
    const actual = await call(session, 'read', { path: '../outside/outside.txt' });
    const expected = await createReadToolDefinition(cwd).execute('native', { path: '../outside/outside.txt' }, undefined, undefined, {});
    assert.deepEqual(actual, expected, `${mode}: SDK delegation changed`);
  }
  delete process.env.NEURA;
  const plain = await makeSession(false);
  assert.equal(plain.loader.getExtensions().extensions.every(extension => extension.tools.size === 0 && extension.handlers.size === 0), true);
  assert.match(JSON.stringify(await call(plain.session, 'read', { path: '../outside/outside.txt' })), /PRIVATE_FILE_CANARY/);
  console.log('PASS Plan confidentiality: real loader/session wrappers, ignored tracked/global/XDG/private/history, links/hardlinks/races, text/image redaction, bounded matching, mid-file cancellation/deadline, explicit size limits, native delegation and plain Pi');
} finally {
  for (const session of sessions) {
    try { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); } finally { session.dispose(); }
  }
}
