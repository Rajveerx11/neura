import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeDeclarations, runtimeModules, runtimeMetadata } from './owned-pi-fixture.mjs';

const candidateVersion = fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-install-test-'));
const home = path.join(tmp, 'home');
const source = path.join(tmp, 'source');
const helper = path.join(source, 'agent/neura/runtime-install.mjs');
const live = name => name.startsWith('launcher/') ? path.join(home, '.local/bin/neura.cmd') : path.join(home, '.pi/agent', name.slice(6));
const stage = path.join(home, '.pi/neura-install-pending/stage');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data); };
const run = (mode, ok = true, env = {}) => {
  const result = spawnSync(process.execPath, [helper, ...mode.split(' ')], { encoding: 'utf8', env: {...process.env, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'), ...env} });
  assert.equal(result.status === 0, ok, `${mode}: ${result.stderr}`);
  return result;
};
const build = (extension = 'one.ts') => {
  write(path.join(source, 'agent/extensions', extension), extension);
  write(path.join(source, 'agent/neura/runtime-install.mjs'), fs.readFileSync(new URL('../..//agent/neura/runtime-install.mjs', import.meta.url)));
  write(path.join(source, 'agent/mcp.json'), '{}');
  write(path.join(source, 'launcher/neura.cmd'), fs.readFileSync(new URL('../../launcher/neura.cmd', import.meta.url)));
  const skillFiles = ['skills-registry.mjs', 'skills-manifest.json', 'skills/neura-verification/1.0.4/SKILL.md'];
  for (const name of skillFiles) write(path.join(source, 'agent/neura', name), fs.readFileSync(new URL(`../../agent/neura/${name}`, import.meta.url)));
  runtimeDeclarations(path.join(source, 'agent/neura'));
  const names = [`agent/extensions/${extension}`, 'agent/neura/runtime-install.mjs', 'agent/mcp.json', 'launcher/neura.cmd', ...skillFiles.map(name => `agent/neura/${name}`), ...runtimeMetadata.map(name => `agent/neura/${name}`)];
  const files = Object.fromEntries(names.map(name => [name, sha(path.join(source, name))]));
  write(path.join(source, 'agent/neura/release-manifest.json'), JSON.stringify({schemaVersion:1, neuraVersion:candidateVersion, piVersion:'1.4.0',nodeMinimum:'24.15.0',automaticExecutables:{git:{}}, runtimePackages:[],capabilities:{work:'default'},files}));
};
const seal = () => { run('prepare'); write(path.join(stage, 'agent/neura/.learn-runtime-lock'), 'receipt'); write(path.join(stage, 'agent/neura/node_modules/example.js'), 'pinned'); runtimeModules(path.join(stage, 'agent/neura')); run('seal'); };
try {
  build();
  const candidateManifestPath = path.join(source, 'agent/neura/release-manifest.json');
  const candidateManifest = JSON.parse(fs.readFileSync(candidateManifestPath));
  // Exercise actual staging validation, including explicit RC acceptance even
  // when the repository's future VERSION returns to a stable release.
  for (const version of ['2.5.1', '2.6.0-rc.1', '2.6.0-0', '2.6.0-beta.01a']) {
    write(candidateManifestPath, JSON.stringify({...candidateManifest, neuraVersion:version}));
    run('prepare');
    assert.equal(JSON.parse(fs.readFileSync(path.join(stage, 'agent/neura/release-manifest.json'))).neuraVersion, version);
    run('recover');
  }
  for (const version of ['01.6.0', '2.06.0', '2.6.00', '2.6.0-01', '2.6.0-rc.01',
    '2.6.0-', '2.6.0-rc..1', '2.6.0-rc_1', 'v2.6.0-rc.1', '2.6', '2.6.0+build',
    '2.6.0-rc.1\n', ' 2.6.0', '', null, 26, ['2.6.0'], {}]) {
    write(candidateManifestPath, JSON.stringify({...candidateManifest, neuraVersion:version}));
    assert.match(run('prepare', false).stderr, /invalid release manifest/);
    assert.equal(fs.existsSync(path.dirname(stage)), false, 'invalid release identity reached staging');
  }
  for (const field of ['piVersion', 'nodeMinimum']) {
    write(candidateManifestPath, JSON.stringify({...candidateManifest, [field]:'1.2.0-rc.1'}));
    assert.match(run('prepare', false).stderr, /invalid release manifest/, `${field} accepted a prerelease prerequisite`);
    assert.equal(fs.existsSync(path.dirname(stage)), false, 'invalid prerequisite reached staging');
  }
  write(candidateManifestPath, JSON.stringify(candidateManifest));
  // Pre-catalog interrupted first-install transaction, using main's receipt and
  // journal contract. Recovery must roll back it, not activate an old release.
  const legacyNames = ['agent/extensions/one.ts', 'agent/neura/runtime-install.mjs', 'agent/mcp.json', 'launcher/neura.cmd'];
  for (const name of legacyNames) write(path.join(stage, name), `synthetic pre-catalog ${name}`);
  const legacyRelease = {schemaVersion:1, neuraVersion:'2.5.1', piVersion:'1.3.0', nodeMinimum:'24.15.0',
    automaticExecutables:{git:{}}, runtimePackages:[], capabilities:{work:'default'},
    files:Object.fromEntries(legacyNames.map(name => [name, sha(path.join(stage, name))]))};
  const legacyManifestPath = path.join(stage, 'agent/neura/release-manifest.json');
  write(legacyManifestPath, JSON.stringify(legacyRelease));
  write(path.join(stage, 'agent/neura/.learn-runtime-lock'), 'synthetic legacy receipt');
  write(path.join(stage, 'agent/neura/node_modules/example.js'), 'synthetic legacy dependency');
  const legacyReceipt = {schemaVersion:1, sourceCommit:'3eb6355bf4652a83f75704695918d0387ebab17f',
    manifestHash:sha(legacyManifestPath), version:'2.5.1', installedAt:'2026-10-08T00:00:00Z',
    files:{...legacyRelease.files, 'agent/neura/release-manifest.json':sha(legacyManifestPath),
      'agent/neura/.learn-runtime-lock':sha(path.join(stage, 'agent/neura/.learn-runtime-lock')),
      'agent/neura/node_modules/example.js':sha(path.join(stage, 'agent/neura/node_modules/example.js'))}};
  const legacyReceiptPath = path.join(stage, 'agent/neura/.install-state.json');
  write(legacyReceiptPath, JSON.stringify(legacyReceipt));
  const legacyEntries = [...Object.keys(legacyReceipt.files), 'agent/neura/.install-state.json', 'agent/extensions/autogit.ts'];
  const legacyPending = path.join(home, '.pi/neura-install-pending');
  write(path.join(legacyPending, 'journal.json'), JSON.stringify(legacyEntries));
  legacyEntries.forEach((_name, index) => write(path.join(legacyPending, 'backup', `absent-${index}`), ''));
  write(live('agent/extensions/one.ts'), fs.readFileSync(path.join(stage, 'agent/extensions/one.ts')));
  write(live('agent/neura/MEMORY.md'), 'synthetic private state');
  assert.match(run('seal', false).stderr, /skill validation|staged file drift/, 'legacy exception leaked into sealing');
  assert.match(run('activate', false).stderr, /skill validation/, 'legacy exception leaked into activation');
  const legacyRegistry = path.join(stage, 'agent/neura');
  for (const name of ['skills-manifest.json', 'skills-registry.mjs']) {
    write(path.join(legacyRegistry, name), '{}');
    assert.match(run('recover', false).stderr, /skill validation/, `partial ${name} was treated as legacy`);
    assert.equal(fs.existsSync(live('agent/extensions/one.ts')), true, 'failed recovery changed installed bytes');
    fs.rmSync(path.join(legacyRegistry, name));
  }
  fs.mkdirSync(path.join(legacyRegistry, 'skills'));
  assert.match(run('recover', false).stderr, /skill validation/, 'partial empty package tree was treated as legacy');
  fs.rmdirSync(path.join(legacyRegistry, 'skills'));
  fs.symlinkSync(path.join(tmp, 'absent-legacy-skills'), path.join(legacyRegistry, 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(run('recover', false).stderr, /skill validation/, 'dangling package link was treated as legacy');
  fs.rmSync(path.join(legacyRegistry, 'skills'));
  const legacyExtension = path.join(stage, 'agent/extensions/one.ts');
  const legacyBytes = fs.readFileSync(legacyExtension);
  write(legacyExtension, 'tampered legacy stage');
  assert.match(run('recover', false).stderr, /installed file drift/, 'legacy recovery bypassed byte verification');
  write(legacyExtension, legacyBytes);
  const receiptBytes = fs.readFileSync(legacyReceiptPath);
  write(legacyReceiptPath, JSON.stringify({...legacyReceipt, manifestHash:'0'.repeat(64)}));
  assert.match(run('recover', false).stderr, /manifest identity mismatch/, 'legacy recovery bypassed receipt identity');
  write(legacyReceiptPath, receiptBytes);
  // A byte-consistent receipt/journal/absent inventory cannot authorize an extra
  // user-owned target. Compare all target and pending bytes before/after failure.
  const inventory = root => fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? [[path.relative(home, file), 'directory'], ...inventory(file)] : [[path.relative(home, file), sha(file)]];
  });
  for (const extra of ['agent/neura/user-owned.txt', 'agent/extensions/custom.ts', 'agent/neura/.install-state.json', 'agent/neura/node_modules']) {
    // The receipt's own path is already present in the journal, but remains an
    // unauthorized next.files entry even with a matching staged byte digest.
    if (extra !== 'agent/neura/.install-state.json' && extra !== 'agent/neura/node_modules') {
      write(path.join(stage, extra), 'synthetic user-owned marker');
      write(live(extra), 'synthetic user-owned marker');
    }
    const extraFiles = { ...legacyReceipt.files, [extra]: 'a'.repeat(64) };
    if (extra !== 'agent/neura/.install-state.json' && extra !== 'agent/neura/node_modules') extraFiles[extra] = sha(path.join(stage, extra));
    write(legacyReceiptPath, JSON.stringify({ ...legacyReceipt, files: extraFiles }));
    const extraEntries = [...new Set([...Object.keys(extraFiles), 'agent/neura/.install-state.json', 'agent/extensions/autogit.ts'])];
    write(path.join(legacyPending, 'journal.json'), JSON.stringify(extraEntries));
    fs.rmSync(path.join(legacyPending, 'backup'), { recursive: true, force: true });
    extraEntries.forEach((_name, index) => write(path.join(legacyPending, 'backup', `absent-${index}`), ''));
    const before = inventory(home);
    assert.match(run('recover', false).stderr, /unowned or invalid install receipt entry/, extra);
    assert.deepEqual(inventory(home), before, 'rejected extra receipt changed targets or transaction inventory');
    if (extra !== 'agent/neura/.install-state.json' && extra !== 'agent/neura/node_modules') {
      fs.rmSync(path.join(stage, extra)); fs.rmSync(live(extra));
    }
  }
  write(legacyReceiptPath, receiptBytes);
  write(path.join(legacyPending, 'journal.json'), JSON.stringify(legacyEntries));
  fs.rmSync(path.join(legacyPending, 'backup'), { recursive: true, force: true });
  legacyEntries.forEach((_name, index) => write(path.join(legacyPending, 'backup', `absent-${index}`), ''));
  const partialRuntime = path.join(stage, 'agent/neura/node_modules/@earendil-works/pi-coding-agent');
  fs.mkdirSync(partialRuntime, {recursive:true});
  assert.match(run('recover', false).stderr, /owned Pi resolver is not release-owned/, 'mixed private-runtime recovery was treated as historical');
  fs.rmSync(path.join(stage, 'agent/neura/node_modules/@earendil-works'), {recursive:true});
  run('recover');
  assert.equal(fs.existsSync(legacyPending), false, 'legacy journal was not cleared');
  assert.equal(fs.existsSync(live('agent/extensions/one.ts')), false, 'legacy partial activation was not rolled back');
  assert.equal(fs.readFileSync(live('agent/neura/MEMORY.md'), 'utf8'), 'synthetic private state');
  fs.rmSync(live('agent/neura/MEMORY.md'));
  write(path.join(source, 'agent/extensions/one.ts'), 'changed source');
  run('prepare', false); // source bytes must match the release manifest
  write(path.join(source, 'agent/extensions/one.ts'), 'one.ts');
  const selection = path.join(home, '.pi/neura-skills.json');
  write(selection, JSON.stringify({schemaVersion: 1, enabled: ['neura-verification', 'neura-verification']}));
  assert.match(run('prepare', false).stderr, /invalid opt-in selection/);
  assert.equal(fs.existsSync(path.join(home, '.pi/neura-install-pending')), false, 'invalid selection reached staging');
  write(selection, JSON.stringify({schemaVersion: 1, enabled: ['neura-verification']}));
  const skillManifestFile = path.join(source, 'agent/neura/skills-manifest.json');
  const releaseFile = path.join(source, 'agent/neura/release-manifest.json');
  const skillManifestBytes = fs.readFileSync(skillManifestFile);
  const releaseBytes = fs.readFileSync(releaseFile);
  const badSkills = JSON.parse(skillManifestBytes);
  badSkills.skills[0].permissions.execute = true;
  write(skillManifestFile, JSON.stringify(badSkills));
  const badRelease = JSON.parse(releaseBytes);
  badRelease.files['agent/neura/skills-manifest.json'] = sha(skillManifestFile);
  write(releaseFile, JSON.stringify(badRelease));
  assert.match(run('prepare', false).stderr, /permissions are restrictions/);
  write(skillManifestFile, skillManifestBytes);
  delete badRelease.files['agent/neura/skills/neura-verification/1.0.4/SKILL.md'];
  badRelease.files['agent/neura/skills-manifest.json'] = sha(skillManifestFile);
  write(releaseFile, JSON.stringify(badRelease));
  assert.match(run('prepare', false).stderr, /not release-owned/);
  write(releaseFile, releaseBytes);
  assert.match(run('prepare', false, {NEURA_INSTALL_TEST_FAIL_PREPARE_AFTER:'1'}).stderr, /injected staging failure/);
  assert.equal(fs.existsSync(path.join(home, '.pi/neura-install-pending')), false, 'failed preparation left a shared transaction behind');
  const legacyModule = live('agent/neura/node_modules/user-package.js');
  write(legacyModule, 'unreceipted');
  assert.match(run('prepare', false).stderr, /unreceipted Learn runtime/);
  assert.equal(fs.readFileSync(legacyModule, 'utf8'), 'unreceipted');
  fs.rmSync(path.dirname(legacyModule), {recursive:true, force:true});
  write(live('agent/settings.json'), '{"credential":"synthetic-only"}');
  run('prepare');
  write(path.join(stage, 'agent/neura/.learn-runtime-lock'), 'receipt');
  assert.match(run('seal', false).stderr, /ENOENT|owned Pi/, 'fresh seal accepted a missing private runtime');
  run('recover');
  seal();
  const stagedEntry = path.join(stage, 'agent/neura/node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
  const stagedEntryBytes = fs.readFileSync(stagedEntry);
  write(stagedEntry, 'modified entry');
  assert.match(run('activate', false).stderr, /installed file drift/, 'activation accepted a modified private entry');
  write(stagedEntry, stagedEntryBytes);
  run('activate', false, {NEURA_INSTALL_TEST_CRASH_DURING_COPY:'1'});
  const partial = `${live('agent/extensions/one.ts')}.neura-install-0.tmp`;
  assert.equal(fs.readFileSync(partial, 'utf8'), 'partial');
  write(selection, JSON.stringify({schemaVersion: 1, enabled: ['unsupported']}));
  run('recover'); // external opt-in corruption must not obstruct package rollback
  write(selection, JSON.stringify({schemaVersion: 1, enabled: ['neura-verification']}));
  assert.equal(fs.existsSync(partial), false, 'interrupted copy left a partial executable file');
  assert.equal(fs.existsSync(live('agent/extensions/one.ts')), false, 'partial copy reached live target');
  seal();
  const freshReceipt = JSON.parse(fs.readFileSync(path.join(stage, 'agent/neura/.install-state.json'), 'utf8'));
  run('activate', false, {NEURA_INSTALL_TEST_CRASH_AFTER: String(Object.keys(freshReceipt.files).length + 1)});
  const receiptIndex = Object.keys(freshReceipt.files).length;
  const absentMarker = path.join(home, '.pi/neura-install-pending/backup', `absent-${receiptIndex}`);
  fs.rmSync(absentMarker);
  run('recover', false);
  assert.equal(fs.existsSync(live('agent/neura/.install-state.json')), true, 'missing inventory marker changed live state');
  write(absentMarker, '');
  run('recover');
  assert.equal(fs.existsSync(live('agent/neura/.install-state.json')), false, 'interrupted first install left a release receipt');
  assert.equal(fs.existsSync(path.join(home, '.pi/neura-install-pending')), false, 'interrupted first install left a journal');
  seal(); run('activate');
  assert.ok(run('check').stdout.includes(`Neura ${candidateVersion} manifest`), 'installed candidate identity was lost');
  const alternateAgent = path.join(tmp, 'alternate-agent');
  fs.cpSync(path.join(home, '.pi/agent'), alternateAgent, {recursive: true});
  run('check', true, {PI_CODING_AGENT_DIR: alternateAgent});
  if (process.platform === 'win32') {
    const bin = path.join(tmp, 'stock bin');
    const marker = path.join(tmp, 'stock-called');
    write(path.join(bin, 'pi.cmd'), `@echo off\r\necho stock>"${marker}"\r\nexit /b 23\r\n`);
    const customAgent = path.join(tmp, 'custom agent with spaces');
    fs.cpSync(alternateAgent, customAgent, {recursive:true});
    const invoke = args => {
      const caller = path.join(tmp, 'invoke.cmd');
      write(caller, `@echo off\r\ncall "${live('launcher/neura.cmd')}" ${args}\r\nexit /b %errorlevel%\r\n`);
      return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', caller], {encoding:'utf8', env:{...process.env, USERPROFILE:home, HOME:home, PI_CODING_AGENT_DIR:customAgent, PATH:`${bin};${process.env.PATH}`}});
    };
    const launched = invoke('"hello world" "\\"quoted\\"" "" "C:\\path with spaces\\file"');
    assert.equal(launched.status, 7, launched.stderr);
    const output = JSON.parse(launched.stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(output.argv, ['--no-mcp', '--tui-mode', 'regular', 'hello world', '"quoted"', '', 'C:\\path with spaces\\file']);
    assert.equal(output.neura, '1');
    assert.equal(output.agent, customAgent);
    assert.equal(fs.existsSync(marker), false, 'Neura invoked ambient Pi');
    const cli = path.join(customAgent, 'neura/node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
    fs.rmSync(cli);
    assert.equal(invoke('"must not run"').status, 1, 'launcher fell back from a missing owned entry');
    assert.equal(fs.existsSync(marker), false);
    const stockCaller = path.join(tmp, 'stock-caller.cmd');
    write(stockCaller, `@echo off\r\ncall "${path.join(bin, 'pi.cmd')}"\r\nexit /b %errorlevel%\r\n`);
    const stock = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', stockCaller], {encoding:'utf8'});
    assert.equal(stock.status, 23, 'stock Pi dispatch changed');
    assert.equal(fs.existsSync(marker), true);
  }
  write(path.join(alternateAgent, 'extensions/one.ts'), 'tampered');
  run('check', false, {PI_CODING_AGENT_DIR: alternateAgent});
  assert.equal(fs.readFileSync(live('agent/settings.json'), 'utf8'), '{"credential":"synthetic-only"}');
  const liveModule = live('agent/neura/node_modules/example.js');
  write(liveModule, 'user-edited');
  run('check', false);
  if (process.platform === 'win32') {
    const caller = path.join(tmp, 'refuse.cmd');
    write(caller, `@echo off\r\ncall "${live('launcher/neura.cmd')}"\r\nexit /b %errorlevel%\r\n`);
    const refused = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d','/c',caller], {encoding:'utf8', env:{...process.env, HOME:home, USERPROFILE:home, PI_CODING_AGENT_DIR:path.join(home,'.pi/agent')}});
    assert.equal(refused.status, 1, 'launcher skipped the full module preflight');
    assert.doesNotMatch(refused.stdout, /"argv"/, 'CLI ran after full preflight failure');
  }
  run('check --quick'); // Health checks only managed files; launch still verifies Learn bytes.
  seal(); run('activate', false);
  run('recover');
  write(liveModule, 'pinned');
  run('prepare');
  write(path.join(stage, 'agent/neura/.learn-runtime-lock'), 'receipt');
  write(path.join(stage, 'agent/neura/node_modules/new.js'), 'pinned');
  runtimeModules(path.join(stage, 'agent/neura'));
  run('seal');
  write(liveModule, 'edited stale module');
  run('activate', false);
  assert.equal(fs.readFileSync(liveModule, 'utf8'), 'edited stale module');
  run('recover');
  write(liveModule, 'pinned');
  const retiredExtension = live('agent/extensions/autogit.ts');
  write(retiredExtension, 'user-owned');
  run('check', false); run('prepare', false);
  assert.equal(fs.readFileSync(retiredExtension, 'utf8'), 'user-owned');
  fs.rmSync(retiredExtension);
  const unexpectedModule = live('agent/neura/node_modules/unknown.js');
  write(unexpectedModule, 'unexpected');
  assert.match(run('check', false).stderr, /unknown Learn runtime file: agent\/neura\/node_modules\/unknown\.js/);
  fs.rmSync(unexpectedModule);
  // Upgrade removes only a previously owned stale extension.
  fs.rmSync(path.join(source, 'agent/extensions/one.ts'));
  build('two.ts'); seal(); run('activate'); run('check');
  assert.equal(fs.existsSync(live('agent/extensions/one.ts')), false);
  // Unknown extensions cannot load silently; an explicit user-owned hash allowlist preserves them.
  write(live('agent/extensions/custom.ts'), 'user code');
  run('check', false); run('prepare', false);
  write(path.join(home, '.pi/neura-user-extensions.json'), JSON.stringify({schemaVersion:1, extensions:{'custom.ts':sha(live('agent/extensions/custom.ts'))}}));
  run('check');
  write(live('agent/extensions/custom.ts'), 'changed'); run('check', false);
  write(live('agent/extensions/custom.ts'), 'user code');
  write(live('agent/mcp.json'), '{"user":"owned"}');
  run('prepare', false); // refuse to overwrite edited live configuration
  write(live('agent/mcp.json'), '{}');
  // Tamper detection checks bytes, not normalized text or a lockfile-only receipt.
  write(live('agent/extensions/two.ts'), 'tampered'); run('check', false); run('check --quick', false);
  write(live('agent/extensions/two.ts'), 'two.ts');
  seal(); run('activate', false, {NEURA_INSTALL_TEST_FAIL_AFTER:'2'});
  assert.equal(fs.readFileSync(live('agent/extensions/two.ts'), 'utf8'), 'two.ts', 'failed activation did not roll back');
  assert.equal(fs.readFileSync(live('agent/settings.json'), 'utf8'), '{"credential":"synthetic-only"}');
  run('check');
  // A forged previous receipt cannot claim a private file as a stale managed file.
  const receiptPath = live('agent/neura/.install-state.json');
  const originalReceipt = fs.readFileSync(receiptPath, 'utf8');
  const forgedReceipt = JSON.parse(originalReceipt);
  forgedReceipt.files['agent/neura/MEMORY.md'] = sha(live('agent/extensions/two.ts'));
  write(receiptPath, JSON.stringify(forgedReceipt));
  run('prepare', false);
  write(receiptPath, originalReceipt);
  // Abrupt process death leaves an actual stage, backups and journal to recover.
  const pending = path.join(home, '.pi/neura-install-pending');
  seal(); run('activate', false, {NEURA_INSTALL_TEST_CRASH_AFTER:'2'});
  run('check', false); run('prepare', false);
  run('recover', false, {NEURA_INSTALL_TEST_CRASH_DURING_RECOVER:'1'});
  const recoveryTemp = `${live('agent/extensions/two.ts')}.neura-recover-0.tmp`;
  assert.equal(fs.readFileSync(recoveryTemp, 'utf8'), 'partial');
  run('recover');
  assert.equal(fs.existsSync(recoveryTemp), false, 'interrupted rollback left a partial executable file');
  assert.equal(fs.readFileSync(live('agent/extensions/two.ts'), 'utf8'), 'two.ts');
  run('check');
  // Recovery must refuse an allowed-namespace private path, not only traversal.
  write(live('agent/neura/MEMORY.md'), 'private');
  seal();
  write(path.join(pending, 'journal.json'), JSON.stringify(['agent/neura/MEMORY.md']));
  run('recover', false);
  assert.equal(fs.readFileSync(live('agent/neura/MEMORY.md'), 'utf8'), 'private');
  fs.rmSync(pending, {recursive:true, force:true});
  // Reviewed updates must use a new immutable package version, not just a new hash.
  const packageName = 'agent/neura/skills/neura-verification/1.0.4/SKILL.md';
  const updateManifest = JSON.parse(fs.readFileSync(skillManifestFile));
  const updateRelease = JSON.parse(fs.readFileSync(releaseFile));
  fs.appendFileSync(path.join(source, packageName), '\nKeep evidence explicit.\n');
  updateManifest.skills[0].sha256 = sha(path.join(source, packageName));
  write(skillManifestFile, JSON.stringify(updateManifest));
  updateRelease.files[packageName] = updateManifest.skills[0].sha256;
  updateRelease.files['agent/neura/skills-manifest.json'] = sha(skillManifestFile);
  write(releaseFile, JSON.stringify(updateRelease));
  assert.match(run('prepare', false).stderr, /immutable skill version cannot be reused/);
  const updatedName = packageName.replace('1.0.4', '1.0.5');
  write(path.join(source, updatedName), fs.readFileSync(path.join(source, packageName)));
  fs.rmSync(path.join(source, packageName));
  updateManifest.skills[0].version = '1.0.5';
  updateManifest.skills[0].path = updatedName.slice('agent/neura/'.length);
  updateManifest.skills[0].source.path = updatedName;
  updateManifest.skills[0].source.version = '1.0.5';
  write(skillManifestFile, JSON.stringify(updateManifest));
  delete updateRelease.files[packageName];
  updateRelease.files[updatedName] = updateManifest.skills[0].sha256;
  updateRelease.files['agent/neura/skills-manifest.json'] = sha(skillManifestFile);
  write(releaseFile, JSON.stringify(updateRelease));
  seal(); run('activate'); run('check');
  assert.equal(fs.existsSync(live(packageName)), false, 'owned retired version was not removed');
  assert.equal(fs.existsSync(live(updatedName)), true, 'new immutable version was not installed');
  assert.equal(fs.readFileSync(live('agent/neura/MEMORY.md'), 'utf8'), 'private');
  console.log('PASS synthetic managed release install, upgrade, ownership, drift, rollback, interruption, immutable skill updates');
} finally { fs.rmSync(tmp, {recursive:true, force:true}); }
