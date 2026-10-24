import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isolate } from './isolation.mjs';
import { runtimeDeclarations, runtimeModules, runtimeMetadata, piName } from './owned-pi-fixture.mjs';
import { resolveOwnedPi } from '../../agent/neura/owned-pi.mjs';

const scratch = isolate();
const actualRoot = path.resolve(import.meta.dirname, '../../agent/neura');
const actualRelease = JSON.parse(fs.readFileSync(path.join(actualRoot, 'release-manifest.json'), 'utf8'));
const actual = resolveOwnedPi(actualRoot, { release: actualRelease });
const moduleInventory = () => fs.readdirSync(path.join(actualRoot, 'node_modules'), {recursive:true}).sort();
const beforeSmoke = moduleInventory();
const smokeExtension = path.join(scratch, 'owned-cli-smoke.ts');
fs.writeFileSync(smokeExtension, `import { VERSION } from '@earendil-works/pi-coding-agent'; export default function(pi) { if (VERSION !== '${actualRelease.piVersion}') throw Error('wrong owned SDK'); pi.registerFlag('neura-runtime-smoke', {type:'boolean',description:'Synthetic owned CLI smoke'}); }`);
for (let attempt = 0; attempt < 2; attempt++) {
  const version = spawnSync(process.execPath, [actual.entry, '--offline', '--no-mcp', '--version'], {cwd:scratch, env:process.env, encoding:'utf8', timeout:30000});
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), actualRelease.piVersion, 'selected official unbundled CLI version differs');
  const help = spawnSync(process.execPath, [actual.entry, '--offline', '--no-mcp', '--no-session', '--no-skills', '--no-context-files', '--no-prompt-templates', '-e', smokeExtension, '--help'], {cwd:scratch, env:process.env, encoding:'utf8', timeout:30000});
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--neura-runtime-smoke/, 'owned CLI did not initialize the synthetic extension');
  assert.deepEqual(moduleInventory(), beforeSmoke, 'owned CLI initialization added files to the sealed modules');
}
const root = path.join(scratch, 'owned runtime');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(root, name), value);
runtimeDeclarations(root);
runtimeModules(root);
for (const name of ['headmaster.ts', 'process-security.ts', 'redaction.ts']) {
  fs.copyFileSync(new URL(`../../agent/neura/${name}`, import.meta.url), path.join(root, name));
}
const selected = `node_modules/${piName}/dist/cli.js`;
const captured = path.join(scratch, 'child-argv.json');
write(selected, `import './main.js'; import './cli/setup.js'; import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({decision:'approve_once',reason:'synthetic',saferPath:'regenerate'}));`);
const files = [...runtimeMetadata, `node_modules/${piName}/package.json`, selected,
  `node_modules/${piName}/dist/core/http-dispatcher.js`, `node_modules/${piName}/dist/main.js`, `node_modules/${piName}/dist/cli/setup.js`,
  'node_modules/undici/package.json', 'node_modules/undici/index.js'];
const release = { schemaVersion: 1, piVersion: '1.4.0', files: Object.fromEntries(runtimeMetadata.map(name => [`agent/neura/${name}`, hash(path.join(root, name))])) };
write('release-manifest.json', JSON.stringify(release));
const receipt = { schemaVersion: 1, manifestHash: hash(path.join(root, 'release-manifest.json')),
  files: Object.fromEntries([...files, 'release-manifest.json'].map(name => [`agent/neura/${name}`, hash(path.join(root, name))])) };
write('.install-state.json', JSON.stringify(receipt));
assert.equal(resolveOwnedPi(root).entry, path.join(root, selected));
const { headmasterEntry, reviewWithHeadmaster } = await import(pathToFileURL(path.join(root, 'headmaster.ts')).href);
assert.equal(headmasterEntry(), path.join(root, selected));
const action = { route:'review', category:'bounded-delete', capability:{approvalClass:'exception-boundary'},
  facts:{insideWorkspace:true,file:true,tracked:false,generated:true}, workspace:scratch, toolName:'synthetic', summary:'synthetic', reason:'bounded', saferPath:'regenerate' };
delete process.env.NEURA_HEADMASTER;
const verdict = await reviewWithHeadmaster(action, {provider:'synthetic',modelId:'fixture',timeoutMs:3_000});
assert.equal(verdict.decision, 'approve_once');
const argv = JSON.parse(fs.readFileSync(captured, 'utf8'));
assert.deepEqual(argv.slice(0, 14), ['--no-mcp','--print','--no-session','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-tools','--mode','text','--thinking','low','--system-prompt', 'Review one sanitized action. Return strict JSON with decision approve_once, defer, or deny; reason; and saferPath. Default to defer.']);
assert.deepEqual(argv.slice(14, 16), ['--model','synthetic/fixture']);
assert.equal(JSON.parse(argv[16]).tool, 'synthetic');
assert.equal(argv.length, 17);
const refused = async () => {
  fs.rmSync(captured, {force:true});
  assert.equal(headmasterEntry(), null, 'drifted complete graph was selected');
  assert.equal((await reviewWithHeadmaster(action)).decision, 'defer');
  assert.equal(fs.existsSync(captured), false, 'synthetic child executed after graph verification failure');
};
const imported = `node_modules/${piName}/dist/main.js`;
const importedBytes = fs.readFileSync(path.join(root, imported));
write(imported, '// modified non-selected import');
await refused();
write(imported, importedBytes);
fs.rmSync(path.join(root, imported));
await refused();
write(imported, importedBytes);
const extra = 'node_modules/unrecorded.js';
write(extra, '// unrecorded module');
await refused();
fs.rmSync(path.join(root, extra));
const setupDir = path.join(root, `node_modules/${piName}/dist/cli`);
const savedSetupDir = path.join(scratch, 'saved-setup');
const linkedSetupDir = path.join(scratch, 'outside-setup');
fs.renameSync(setupDir, savedSetupDir);
fs.mkdirSync(linkedSetupDir);
fs.copyFileSync(path.join(savedSetupDir, 'setup.js'), path.join(linkedSetupDir, 'setup.js'));
fs.symlinkSync(linkedSetupDir, setupDir, process.platform === 'win32' ? 'junction' : 'dir');
await refused();
fs.rmSync(setupDir);
fs.renameSync(savedSetupDir, setupDir);
for (const [name, expected] of [
  ['agent/neura/node_modules/../../outside.js', '0'.repeat(64)],
  ['agent/neura/node_modules/C:/outside.js', '0'.repeat(64)],
  ['agent/neura/node_modules/./alias.js', '0'.repeat(64)],
  [`agent/neura/${imported}`, 'invalid hash'],
  [`agent/neura/${imported}`, ['0'.repeat(64)]],
]) {
  write('.install-state.json', JSON.stringify({...receipt,files:{...receipt.files,[name]:expected}}));
  await refused();
}
write('.install-state.json', JSON.stringify(receipt));
assert.equal(headmasterEntry(), path.join(root, selected), 'restored graph was refused');
assert.equal((await reviewWithHeadmaster(action, {provider:'synthetic',modelId:'fixture',timeoutMs:3_000})).decision, 'approve_once');
assert.equal(fs.existsSync(captured), true, 'restored graph did not execute the synthetic child');
assert.throws(() => resolveOwnedPi(root, { release:{...release,piVersion:'1.3.0'} }), /identity mismatch/);
for (const name of ['package.json','runtime-contract.json','package-lock.json',`node_modules/${piName}/package.json`,'node_modules/undici/package.json']) {
  const saved = fs.readFileSync(path.join(root, name));
  write(name, saved.toString().replaceAll('1.4.0','1.3.0').replaceAll('8.12.2','8.12.1'));
  assert.throws(() => resolveOwnedPi(root, { release }), /identity mismatch/, name);
  write(name, saved);
}
const undiciManifest = fs.readFileSync(path.join(root, 'node_modules/undici/package.json'));
for (const changed of [{main:'../../outside.js'}, {exports:'./other.js'}]) {
  write('node_modules/undici/package.json', JSON.stringify({...JSON.parse(undiciManifest), ...changed}));
  assert.throws(() => resolveOwnedPi(root, { release }), /installed runtime identity mismatch/, 'alternate Undici entry accepted');
}
write('node_modules/undici/package.json', undiciManifest);
const original = fs.readFileSync(path.join(root, selected));
write(selected, '// modified');
assert.throws(() => resolveOwnedPi(root), /file drift/);
assert.equal(headmasterEntry(), null);
fs.rmSync(captured);
assert.equal((await reviewWithHeadmaster(action)).decision, 'defer');
assert.equal(fs.existsSync(captured), false, 'missing runtime dispatched a reviewer');
write(selected, original);
const shadow = path.join(root, `node_modules/${piName}/dist/node_modules/undici`);
fs.mkdirSync(shadow, {recursive:true});
assert.throws(() => resolveOwnedPi(root), /shadowed/);
fs.rmSync(path.dirname(shadow), {recursive:true});
const external = path.join(scratch, 'outside');
fs.mkdirSync(external);
fs.writeFileSync(path.join(external, 'package.json'), 'must not read outside');
const undici = path.join(root, 'node_modules/undici');
const savedUndici = path.join(root, 'saved-undici');
fs.renameSync(undici, savedUndici);
fs.symlinkSync(external, undici, process.platform === 'win32' ? 'junction' : 'dir');
assert.throws(() => resolveOwnedPi(root), /linked owned Pi/);
fs.rmSync(undici);
fs.renameSync(savedUndici, undici);
const linkedRoot = path.join(scratch, 'linked-root');
fs.symlinkSync(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
assert.throws(() => resolveOwnedPi(linkedRoot), /linked owned Pi/);
fs.rmSync(linkedRoot);
fs.rmSync(path.join(root, selected));
process.env.NODE_PATH = external;
process.argv[1] = path.join(external, 'pi-coding-agent/dist/cli.js');
assert.throws(() => resolveOwnedPi(root), /ENOENT/);
assert.equal(headmasterEntry(), null, 'Headmaster accepted argv/global fallback');
write(selected, original);
fs.rmSync(path.join(root, '.install-state.json'));
assert.equal(headmasterEntry(), null, 'Headmaster accepted an unsealed runtime');
console.log('PASS offline owned CLI version/help/extension twice with unchanged module inventory; complete sealed graph/import drift, malformed receipts, missing/linked/unknown modules, no global fallback, synthetic tool-free Headmaster argv and no-child refusal');
