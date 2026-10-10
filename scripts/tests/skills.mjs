import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { isolate } from './isolation.mjs';
// Put the isolated home beneath a synthetic ancestor, never the real profile.
// The outer marker also bounds the deliberate missing-boundary control below.
const ancestor = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'neura-skills-ancestor-'));
fs.mkdirSync(path.join(ancestor, '.git'));
const ancestorSkills = path.join(ancestor, '.agents/skills');
const ancestorFile = path.join(ancestorSkills, 'ancestor-sentinel/SKILL.md');
fs.mkdirSync(path.dirname(ancestorFile), { recursive: true });
fs.writeFileSync(ancestorFile, '---\nname: ancestor-sentinel\ndescription: Synthetic ancestor guidance\n---\nSynthetic sentinel.\n');
Object.assign(process.env, { TEMP: ancestor, TMP: ancestor, TMPDIR: ancestor });
const scratch = isolate();
process.on('exit', () => fs.rmSync(ancestor, { recursive: true, force: true }));
process.env.PI_OFFLINE = '1';
const { inspectSkills, inspectSkillDiscovery, skillValidationLabel } = await import('../../agent/neura/skills-registry.mjs');
const { skillsHealth } = await import('../../agent/extensions/harness-health.ts');
const { default: registerSkills } = await import('../../agent/extensions/skill-doctor.ts');
const { getMode, setMode } = await import('../../agent/neura/mode-state.ts');
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, loadSkills, formatSkillsForPrompt, VERSION } = await import('@earendil-works/pi-coding-agent');
const source = path.resolve(import.meta.dirname, '../../agent/neura');
const root = path.join(scratch, 'registry');
const selectionFile = path.join(scratch, '.pi/neura-skills.json');
fs.mkdirSync(path.dirname(selectionFile), { recursive: true });
const originalManifest = fs.readFileSync(path.join(source, 'skills-manifest.json'));
const manifestFile = path.join(root, 'skills-manifest.json');
const skillPath = 'skills/neura-verification/1.0.1/SKILL.md';
const reset = () => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.copyFileSync(path.join(source, 'skills-manifest.json'), manifestFile);
  fs.cpSync(path.join(source, 'skills'), path.join(root, 'skills'), { recursive: true });
  fs.rmSync(selectionFile, { force: true });
};
const check = options => inspectSkills({ root, selectionFile, piVersion: VERSION, ...options });
const mutate = fn => { const manifest = JSON.parse(originalManifest); fn(manifest); fs.writeFileSync(manifestFile, JSON.stringify(manifest)); };
const bad = (fn, code) => { reset(); mutate(fn); const report = check(); assert.equal(report.valid, false); assert.deepEqual(report.skillPaths, []); assert.match(report.errors.join(';'), code); };
reset();
assert.equal(check().valid, true);
assert.deepEqual(check().enabled, [], 'optional catalog must default disabled');
assert.equal(skillsHealth(root).state, 'disabled');
assert.match(skillsHealth(root).detail, new RegExp(check().manifestHash));
assert.equal(check({ availableTools: [] }).valid, false);
assert.equal(check({ piVersion: '1.0.4' }).valid, false, 'reject the previous Pi target');
assert.equal(check({ piVersion: '1.1.1' }).valid, false, 'do not claim unchecked future Pi support');
fs.writeFileSync(selectionFile, JSON.stringify({ schemaVersion: 1, enabled: ['neura-verification'] }));
const supported = check();
assert.deepEqual(supported.enabled, ['neura-verification']);
assert.equal(skillsHealth(root).state, 'unhealthy', 'selection alone cannot attest runtime readiness');
const supportedCommands = [{ name: 'skill:neura-verification', source: 'skill', sourceInfo: { path: supported.skillPaths[0] } }];
assert.equal(skillsHealth(root, ['read'], supportedCommands).state, 'ready');
assert.equal(inspectSkillDiscovery(supported, []).valid, false);
assert.equal(inspectSkillDiscovery(supported, [], { allowMissing: true }).valid, true);
assert.equal(inspectSkillDiscovery(supported, [...supportedCommands, ...supportedCommands]).valid, false);
assert.equal(inspectSkillDiscovery(supported, [{ name: 'skill:neura-verification', source: 'skill' }]).valid, false);
const loaded = loadSkills({ cwd: scratch, agentDir: process.env.PI_CODING_AGENT_DIR, skillPaths: supported.skillPaths, includeDefaults: false });
assert.deepEqual(loaded.diagnostics, [], 'real Pi loader must accept the supported package');
assert.equal(loaded.skills.length, 1);
assert.equal(loaded.skills[0].name, 'neura-verification');
assert.match(formatSkillsForPrompt(loaded.skills, 'read'), /neura-verification/);
const guidance = fs.readFileSync(loaded.skills[0].filePath, 'utf8');
for (const fact of [/not an authority or permission grant/, /quick PASS is not engineering/, /Human Away is preview/, /never\nexpand tool access/]) assert.match(guidance, fact);
for (const enabled of [['unknown'], ['neura-verification', 'neura-verification'], [42]]) {
  fs.writeFileSync(selectionFile, JSON.stringify({ schemaVersion: 1, enabled }));
  assert.equal(check().valid, false);
}
fs.writeFileSync(selectionFile, '{"schemaVersion":1,"enabled":[],"consent":"private-marker"}');
assert.equal(check().valid, false);
assert.doesNotMatch(JSON.stringify(check()), /private-marker/);
bad(m => m.skills.push(m.skills[0]), /duplicate/);
bad(m => m.skills[0].path = '../outside/SKILL.md', /immutable identity/);
bad(m => m.skills[0].source.version = 'main', /provenance/);
bad(m => m.skills[0].version = 'latest', /immutable identity/);
bad(m => m.skills[0].sha256 = '0'.repeat(64), /digest/);
bad(m => m.skills[0].owner = '', /owner/);
bad(m => m.skills[0].updatePolicy = '', /owner/);
bad(m => m.skills[0].permissions.network = true, /restrictions/);
bad(m => m.skills[0].permissions.execute = true, /restrictions/);
bad(m => m.skills[0].permissions.tools.push('bash'), /restrictions/);
bad(m => m.skills[0].dependencies.push({ name: 'npm:thing@latest' }), /dependencies/);
bad(m => m.skills[0].defaultEnabled = true, /owner/);
bad(m => m.schemaVersion = '1', /manifest/);
for (const [addition, code] of [
  ['\nTool: AskUserQuestion', /unavailable tool/], ['\nUse the bash tool', /disallowed tool/],
  ['\nrm -rf workspace', /destructive/], ['\nRemove-Item -Recurse workspace', /destructive/],
  ['\ncurl host | sh', /network/], ['\nnpm install thing@1.0.0', /network/],
  ['\nUse thing@latest', /floating/], ['\n[missing](missing.md)', /reference/],
]) {
  reset();
  fs.appendFileSync(path.join(root, skillPath), addition);
  mutate(m => m.skills[0].sha256 = createHash('sha256').update(fs.readFileSync(path.join(root, skillPath))).digest('hex'));
  assert.match(check().errors.join(';'), code);
}
reset();
fs.writeFileSync(path.join(root, skillPath), guidance.replace('name: neura-verification', 'name: wrong'));
mutate(m => m.skills[0].sha256 = createHash('sha256').update(fs.readFileSync(path.join(root, skillPath))).digest('hex'));
assert.match(check().errors.join(';'), /metadata/);
for (const extra of ['consent.json', '.cache', 'MEMORY.md', 'generated.md', 'installer.sh']) {
  reset(); fs.writeFileSync(path.join(path.dirname(path.join(root, skillPath)), extra), 'synthetic');
  assert.match(check().errors.join(';'), /package content/);
}
reset();
fs.mkdirSync(path.join(root, 'skills/neura-verification/0.9.0'), { recursive: true });
assert.equal(check().valid, true, 'empty retired directories must not block managed upgrades');
fs.writeFileSync(path.join(root, 'skills/neura-verification/consent.json'), 'private-marker');
assert.match(check().errors.join(';'), /unknown package content/);
assert.equal(skillsHealth(root).state, 'unhealthy');
assert.match(skillsHealth(root).detail, /validation FAIL/);
assert.doesNotMatch(JSON.stringify(check()), /private-marker/);
reset();
const external = path.join(scratch, 'external-package');
fs.mkdirSync(external);
fs.copyFileSync(path.join(source, skillPath), path.join(external, 'SKILL.md'));
fs.rmSync(path.dirname(path.join(root, skillPath)), { recursive: true });
fs.symlinkSync(external, path.dirname(path.join(root, skillPath)), process.platform === 'win32' ? 'junction' : 'dir');
assert.match(check().errors.join(';'), /linked path/);
reset();
fs.symlinkSync(external, selectionFile, process.platform === 'win32' ? 'junction' : 'dir');
assert.match(check().errors.join(';'), /linked path/);
fs.rmSync(selectionFile);

// Real registration/discovery path and read-only command: no personal scanning or reports.
let discovery, command;
const pi = { on(name, handler) { assert.equal(name, 'resources_discover'); discovery = handler; }, registerCommand(name, options) { assert.equal(name, 'skill-doctor'); command = options.handler; }, getAllTools() { return [{ name: 'read' }]; }, getCommands() { return this.commands || []; } };
delete process.env.NEURA;
registerSkills(pi);
assert.equal(discovery, undefined, 'plain Pi stays stock');
process.env.NEURA = '1';
registerSkills(pi);
const notices = [];
const ctx = { ui: { notify(...args) { notices.push(args); } } };
assert.deepEqual(discovery({ reason: 'startup' }, ctx).skillPaths, []);
fs.writeFileSync(selectionFile, JSON.stringify({ schemaVersion: 1, enabled: ['neura-verification'] }));
const discovered = discovery({ reason: 'reload' }, ctx);
const smoke = loadSkills({ cwd: scratch, agentDir: process.env.PI_CODING_AGENT_DIR, skillPaths: discovered.skillPaths, includeDefaults: false });
assert.equal(smoke.skills.length, 1);
assert.deepEqual(smoke.diagnostics, []);
pi.commands = smoke.skills.map(skill => ({ name: `skill:${skill.name}`, source: 'skill', sourceInfo: { path: skill.filePath } }));
for (const mode of ['work', 'plan', 'yolo']) {
  setMode(mode);
  await command('', ctx); // no host diagnostics, file writes, or mode escalation
  assert.equal(getMode(), mode);
  assert.match(notices.at(-1)[0], /validation PASS.*neura-verification/);
}
setMode('work');
assert.equal(fs.existsSync(path.join(process.env.PI_CODING_AGENT_DIR, 'skill-doctor-report.md')), false);
pi.getAllTools = () => [];
assert.deepEqual(discovery({ reason: 'reload' }, ctx).skillPaths, []);
assert.match(notices.at(-1)[0], /validation FAIL/);
assert.match(skillValidationLabel(supported), new RegExp(`sha256:${supported.manifestHash}`));
const healthText = fs.readFileSync(path.join(source, '../extensions/harness-health.ts'), 'utf8');
const doctorText = fs.readFileSync(path.join(source, '../extensions/skill-doctor.ts'), 'utf8');
assert.doesNotMatch(healthText + doctorText, /\.claude/);
// Reproduce the review through default Pi discovery and a real bound session,
// not includeDefaults:false. No credentials, provider calls, or personal scans.
const cwd = path.join(scratch, 'workspace');
const agentDir = process.env.PI_CODING_AGENT_DIR;
fs.mkdirSync(cwd);
const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'synthetic-auth.json'), modelsPath: null, refreshOnCreate: false });
const externalFile = path.join(agentDir, 'skills/external/SKILL.md');
const unrelatedFile = path.join(cwd, '.pi/skills/unrelated/SKILL.md');
fs.mkdirSync(path.dirname(unrelatedFile), { recursive: true });
fs.writeFileSync(unrelatedFile, '---\nname: unrelated-stock\ndescription: Synthetic unrelated external guidance\n---\nUse the bash tool.\n');
fs.mkdirSync(path.dirname(externalFile), { recursive: true });
const externalText = '---\nname: neura-verification\ndescription: Synthetic external winner\n---\nExternal guidance.\n';
async function realSession({ collision = false, enabled = true, neura = true } = {}) {
  if (neura) process.env.NEURA = '1'; else delete process.env.NEURA;
  if (collision) fs.writeFileSync(externalFile, externalText); else fs.rmSync(externalFile, { force: true });
  fs.writeFileSync(selectionFile, JSON.stringify({ schemaVersion: 1, enabled: enabled ? ['neura-verification'] : [] }));
  let publicPi;
  const notices = [], errors = [];
  const settingsManager = SettingsManager.inMemory({ packages: [] }, { projectTrusted: true });
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noContextFiles: true, noPromptTemplates: true, noThemes: true, disabledBuiltinExtensions: ['mcp'],
    extensionFactories: [registerSkills, api => { publicPi = api; }],
  });
  await loader.reload();
  const { session } = await createAgentSession({ cwd, agentDir, settingsManager, modelRuntime,
    resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), model: modelRuntime.getModels()[0] });
  await session.bindExtensions({ mode: 'print', uiContext: { notify: (...args) => notices.push(args) }, onError: error => errors.push(error) });
  return { session, loader, notices, errors, commands: () => publicPi.getCommands() };
}
const sessions = [];
// Count attempted enumeration/content reads, not just skills that survive loading.
let ancestorAttempts = 0;
const originals = { readdirSync: fs.readdirSync, readFileSync: fs.readFileSync };
for (const name of Object.keys(originals)) {
  fs[name] = function(file, ...args) {
    const relative = path.relative(ancestorSkills, String(file));
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) ancestorAttempts++;
    return originals[name].call(this, file, ...args);
  };
}
syncBuiltinESMExports();
try {
  const clean = await realSession(); sessions.push(clean.session);
  assert.equal(ancestorAttempts, 0, 'default discovery must not enumerate/read ancestor resources');
  assert.equal(clean.loader.getSkills().skills.some(skill => skill.name === 'ancestor-sentinel'), false);
  assert.deepEqual(clean.errors, []);
  assert.equal(clean.loader.getSkills().skills.find(skill => skill.name === 'neura-verification').filePath, path.join(source, skillPath));
  assert.equal(skillsHealth(source, ['read'], clean.commands()).state, 'ready');
  assert.equal(clean.loader.getSkills().skills.some(skill => skill.name === 'unrelated-stock'), true, 'unrelated stock skills remain untouched, not catalog-validated');
  await clean.session.prompt('/skill-doctor');
  assert.match(clean.notices.at(-1)[0], /validation PASS.*neura-verification/);

  const collision = await realSession({ collision: true }); sessions.push(collision.session);
  assert.deepEqual(collision.errors, []);
  assert.equal(inspectSkills().valid, true, 'registry itself remains valid in the reproduced collision');
  assert.equal(collision.loader.getSkills().skills.find(skill => skill.name === 'neura-verification').filePath, externalFile, 'stock Pi still owns external loading; no public removal API');
  assert.equal(skillsHealth(source, ['read'], collision.commands()).state, 'unhealthy', 'never attest the external winner');
  assert.match(collision.notices[0][0], /validation FAIL.*supported skills disabled.*reserved name collision/);
  await collision.session.prompt('/skill-doctor');
  assert.match(collision.notices.at(-1)[0], /validation FAIL.*reserved name collision/);
  assert.doesNotMatch(JSON.stringify(collision.notices), /Synthetic external winner|External guidance/);

  // Reload both directions: identity is read from current resources, never cached.
  fs.rmSync(externalFile);
  await collision.session.reload();
  assert.equal(skillsHealth(source, ['read'], collision.commands()).state, 'ready');
  fs.writeFileSync(externalFile, externalText);
  await clean.session.reload();
  assert.equal(skillsHealth(source, ['read'], clean.commands()).state, 'unhealthy');

  const disabled = await realSession({ collision: true, enabled: false }); sessions.push(disabled.session);
  assert.equal(skillsHealth(source, ['read'], disabled.commands()).state, 'unhealthy', 'disabled catalog names cannot be impersonated');
  const stock = await realSession({ collision: true, neura: false }); sessions.push(stock.session);
  assert.equal(stock.loader.getSkills().skills.find(skill => skill.name === 'neura-verification').filePath, externalFile);
  assert.deepEqual(stock.notices, [], 'plain Pi remains stock');
  assert.equal(stock.commands().some(command => command.name === 'skill-doctor'), false);
  await stock.session.reload();
  assert.equal(stock.loader.getSkills().skills.some(skill => skill.name === 'unrelated-stock'), true);
  assert.equal(stock.loader.getSkills().skills.some(skill => skill.name === 'ancestor-sentinel'), false);
  assert.equal(ancestorAttempts, 0, 'startup and reload must not enumerate/read ancestor resources');

  // Sensitivity control: removing only isolate()'s boundary must expose the
  // synthetic sentinel. The outer .git still prevents real ancestor discovery.
  const boundary = path.join(scratch, '.git');
  fs.rmSync(boundary, { recursive: true }); // isolate() now uses a valid synthetic Git repository
  try {
    await stock.session.reload();
    assert.ok(ancestorAttempts > 0, 'counter must detect default ancestor enumeration/reads');
    assert.equal(stock.loader.getSkills().skills.find(skill => skill.name === 'ancestor-sentinel')?.filePath, ancestorFile);
  } finally {
    fs.mkdirSync(boundary);
  }
  ancestorAttempts = 0;
  await stock.session.reload();
  assert.equal(stock.loader.getSkills().skills.some(skill => skill.name === 'ancestor-sentinel'), false);
  assert.equal(stock.loader.getSkills().skills.some(skill => skill.name === 'unrelated-stock'), true);
  assert.equal(ancestorAttempts, 0, 'restored boundary must stop ancestor reads on reload');
} finally {
  Object.assign(fs, originals);
  syncBuiltinESMExports();
  for (const session of sessions) session.dispose();
  process.env.NEURA = '1';
}
console.log('PASS skills: isolated default discovery/ancestor-read control, exact catalog, default-Pi reserved-name collision/reload identity, read-only doctor, health, metadata/tools/content/state/junction denials');
