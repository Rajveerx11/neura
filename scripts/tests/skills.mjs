import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isolate } from './isolation.mjs';
const scratch = isolate();
const { inspectSkills, skillValidationLabel } = await import('../../agent/neura/skills-registry.mjs');
const { skillsHealth } = await import('../../agent/extensions/harness-health.ts');
const { default: registerSkills } = await import('../../agent/extensions/skill-doctor.ts');
const { getMode, setMode } = await import('../../agent/neura/mode-state.ts');
const { loadSkills, formatSkillsForPrompt, VERSION } = await import('@earendil-works/pi-coding-agent');
const source = path.resolve(import.meta.dirname, '../../agent/neura');
const root = path.join(scratch, 'registry');
const selectionFile = path.join(scratch, '.pi/neura-skills.json');
fs.mkdirSync(path.dirname(selectionFile), { recursive: true });
const originalManifest = fs.readFileSync(path.join(source, 'skills-manifest.json'));
const manifestFile = path.join(root, 'skills-manifest.json');
const skillPath = 'skills/neura-verification/1.0.0/SKILL.md';
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
assert.equal(check({ piVersion: '1.0.3' }).valid, false);
assert.equal(check({ piVersion: '1.0.5' }).valid, false, 'do not claim unchecked future Pi support');
fs.writeFileSync(selectionFile, JSON.stringify({ schemaVersion: 1, enabled: ['neura-verification'] }));
const supported = check();
assert.deepEqual(supported.enabled, ['neura-verification']);
assert.equal(skillsHealth(root).state, 'ready');
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
const pi = { on(name, handler) { assert.equal(name, 'resources_discover'); discovery = handler; }, registerCommand(name, options) { assert.equal(name, 'skill-doctor'); command = options.handler; }, getAllTools() { return [{ name: 'read' }]; } };
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
console.log('PASS skills: exact catalog, opt-in Pi smoke, read-only doctor, health identity, metadata/tools/content/state/junction denials');
