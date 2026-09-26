// Managed Neura files only. Never stage or back up the Pi profile, credentials, or user settings.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (file) => hash(fs.readFileSync(file));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = (file) => fs.existsSync(file);
const manifestName = 'agent/neura/release-manifest.json';
const stateName = 'agent/neura/.install-state.json';
const retired = ['agent/extensions/autogit.ts'];
const home = os.homedir();
const agent = process.env.PI_CODING_AGENT_DIR ? path.resolve(process.env.PI_CODING_AGENT_DIR) : path.join(home, '.pi', 'agent');
const transaction = path.join(home, '.pi', 'neura-install-pending');
const allowlistPath = path.join(home, '.pi', 'neura-user-extensions.json');
const source = path.resolve(import.meta.dirname, '../..');
function managedName(name) {
  if (typeof name !== 'string' || name.includes('..') || !/^(agent\/(extensions|themes|neura)\/[\w.@\/-]+|agent\/mcp\.json|launcher\/neura\.cmd)$/.test(name)) throw Error(`invalid managed path: ${name}`);
  return name;
}
const asTarget = (name) => (managedName(name).startsWith('launcher/') ? path.join(home, '.local', 'bin', 'neura.cmd') : path.join(agent, name.slice(6)));
function safe(file) {
  // Reject junctions and symlinks in managed path components before any read/write.
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (exists(p) && fs.lstatSync(p).isSymbolicLink()) throw Error(`linked managed path refused: ${p}`);
    if (p === path.dirname(p)) break;
  }
}
function valid(manifest) {
  if (manifest.schemaVersion !== 1 || !manifest.files || Array.isArray(manifest.files) ||
      !/^\d+\.\d+\.\d+$/.test(manifest.neuraVersion) || !/^\d+\.\d+\.\d+$/.test(manifest.piVersion) ||
      !/^\d+\.\d+\.\d+$/.test(manifest.nodeMinimum) || !manifest.automaticExecutables || !manifest.runtimePackages || !manifest.capabilities) throw Error('invalid release manifest');
  for (const [name, expected] of Object.entries(manifest.files)) {
    managedName(name);
    if (!/^[0-9a-f]{64}$/.test(expected) || name === manifestName || name === stateName) throw Error(`invalid manifest entry: ${name}`);
  }
  return manifest;
}
function sourceManifest() {
  const file = path.join(source, manifestName);
  safe(file);
  const manifest = valid(read(file));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const current = path.join(source, name);
    safe(current);
    if (!exists(current) || digest(current) !== expected) throw Error(`source hash mismatch: ${name}`);
  }
  return manifest;
}
function previousFiles(previous, previousManifest) {
  if (!previous || previous.schemaVersion !== 1 || !previous.files || Array.isArray(previous.files) ||
      !previousManifest || !/^[0-9a-f]{64}$/.test(previous.manifestHash || '')) throw Error('invalid previous install state');
  const owned = new Set([...Object.keys(previousManifest.files), manifestName, 'agent/neura/.learn-runtime-lock']);
  for (const name of Object.keys(previous.files)) {
    managedName(name);
    if (!owned.has(name) && !name.startsWith('agent/neura/node_modules/')) throw Error(`unowned previous install entry: ${name}`);
  }
  return previous.files;
}
function ownership(manifest) {
  let oldFiles = {};
  if (exists(asTarget(stateName))) {
    const previous = read(asTarget(stateName));
    const previousManifestPath = asTarget(manifestName);
    if (!exists(previousManifestPath) || digest(previousManifestPath) !== previous.manifestHash) throw Error('previous release manifest drift');
    oldFiles = previousFiles(previous, valid(read(previousManifestPath)));
  } else if (listPaths(path.join(agent, 'neura', 'node_modules')).length) {
    // Legacy installs have no ownership receipt. Never delete unknown packages
    // to make a new receipt pass; migrate them only with an explicit procedure.
    throw Error('unreceipted Learn runtime present; migrate the existing install before activation');
  }
  const allowed = exists(allowlistPath) ? read(allowlistPath) : { schemaVersion: 1, extensions: {} };
  if (allowed.schemaVersion !== 1 || !allowed.extensions || Array.isArray(allowed.extensions)) throw Error('invalid user extension allowlist');
  // Never overwrite an edited managed file or an unrecognized legacy file.
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = asTarget(name);
    safe(file);
    if (exists(file) && digest(file) !== expected && digest(file) !== oldFiles[name]) throw Error(`unowned or modified managed file: ${name}`);
  }
  const dir = path.join(agent, 'extensions');
  safe(dir);
  if (!exists(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    safe(file);
    const name = `agent/extensions/${entry.name}`;
    if (retired.includes(name) || Object.hasOwn(manifest.files, name) ||
        (Object.hasOwn(oldFiles, name) && oldFiles[name] === digest(file))) continue;
    if (!entry.isFile() || !/^[\w.-]+\.(ts|js|mjs)$/.test(entry.name) ||
        !/^[0-9a-f]{64}$/.test(allowed.extensions[entry.name] || '') || digest(file) !== allowed.extensions[entry.name]) {
      throw Error(`unknown or changed live extension: ${entry.name}`);
    }
  }
}
function listPaths(dir, prefix = '') {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    safe(file);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) return listPaths(file, relative);
    if (entry.isFile()) return [relative];
    throw Error(`linked or special runtime file refused: ${relative}`);
  });
}
function listFiles(dir) {
  return Object.fromEntries(listPaths(dir).map(name => [name, digest(path.join(dir, name))]));
}
function state(manifest, root) {
  const files = { ...manifest.files, [manifestName]: digest(path.join(root, manifestName)) };
  const modules = listFiles(path.join(root, 'agent/neura/node_modules'));
  for (const [name, value] of Object.entries(modules)) files[`agent/neura/node_modules/${name}`] = value;
  files['agent/neura/.learn-runtime-lock'] = digest(path.join(root, 'agent/neura/.learn-runtime-lock'));
  let commit = 'unavailable';
  try { commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  return { schemaVersion: 1, sourceCommit: commit, manifestHash: digest(path.join(root, manifestName)),
    version: manifest.neuraVersion, installedAt: new Date().toISOString(), files };
}
function verify(root, expectedState, checkOwnership = true, quick = false) {
  const located = (name) => root === agent ? asTarget(name) : path.join(root, name);
  const manifest = valid(read(located(manifestName)));
  if (expectedState.schemaVersion !== 1 || !expectedState.files || Array.isArray(expectedState.files) ||
      !/^[0-9a-f]{64}$/.test(expectedState.manifestHash || '') ||
      !/^(?:[0-9a-f]{40}|unavailable)$/.test(expectedState.sourceCommit || '') ||
      !Number.isFinite(Date.parse(expectedState.installedAt)) ||
      expectedState.manifestHash !== digest(located(manifestName)) || expectedState.version !== manifest.neuraVersion) throw Error('installed manifest identity mismatch');
  for (const [name, expected] of Object.entries({...manifest.files, [manifestName]: expectedState.manifestHash})) {
    if (expectedState.files[name] !== expected) throw Error(`install receipt missing or mismatched: ${name}`);
  }
  if (!Object.hasOwn(expectedState.files, 'agent/neura/.learn-runtime-lock')) throw Error('Learn runtime receipt missing');
  for (const [name, expected] of Object.entries(expectedState.files)) {
    if (quick && name.startsWith('agent/neura/node_modules/')) continue;
    const file = located(name);
    safe(file);
    if (!exists(file) || digest(file) !== expected) throw Error(`installed file drift: ${name}`);
  }
  if (checkOwnership) {
    if (process.versions.node.split('.').map(Number).some(Number.isNaN) ||
        process.versions.node.localeCompare(manifest.nodeMinimum, undefined, { numeric: true }) < 0) throw Error(`Node ${manifest.nodeMinimum}+ required`);
    ownership(manifest);
  }
  if (!quick) {
    const moduleDir = root === agent ? path.join(agent, 'neura/node_modules') : path.join(root, 'agent/neura/node_modules');
    const expectedModules = new Set(Object.keys(expectedState.files).filter(name => name.startsWith('agent/neura/node_modules/')));
    for (const name of listPaths(moduleDir)) {
      const installedName = `agent/neura/node_modules/${name}`;
      if (!expectedModules.has(installedName)) throw Error(`unknown Learn runtime file: ${installedName}`);
    }
  }
  return expectedState;
}
function recover() {
  const journal = path.join(transaction, 'journal.json');
  if (!exists(journal)) { if (exists(transaction)) fs.rmSync(transaction, { recursive: true, force: true }); return; }
  const entries = read(journal);
  const root = path.join(transaction, 'stage');
  if (!Array.isArray(entries) || !exists(path.join(root, stateName))) throw Error('invalid install journal; manual recovery required');
  const next = read(path.join(root, stateName));
  verify(root, next, false);
  const oldStateIndex = entries.indexOf(stateName);
  const oldStateBackup = path.join(transaction, 'backup', String(oldStateIndex));
  let oldFiles = {};
  if (oldStateIndex < 0) throw Error('install journal omits receipt');
  if (exists(oldStateBackup)) {
    const old = read(oldStateBackup);
    const oldManifestIndex = entries.indexOf(manifestName);
    const oldManifestBackup = path.join(transaction, 'backup', String(oldManifestIndex));
    if (oldManifestIndex < 0 || !exists(oldManifestBackup) || digest(oldManifestBackup) !== old.manifestHash) throw Error('previous release backup missing');
    oldFiles = previousFiles(old, valid(read(oldManifestBackup)));
  }
  const expected = [...new Set([...Object.keys(next.files), stateName,
    ...Object.keys(oldFiles).filter(name => !Object.hasOwn(next.files, name)), ...retired])];
  if (entries.length !== expected.length || entries.some((name, i) => name !== expected[i])) throw Error('install journal contains unowned paths');
  // Validate every operation before changing anything. A missing backup may only
  // remove bytes matching a newly staged owned file, never an existing private file.
  for (const [index, name] of entries.entries()) {
    const target = asTarget(name), backup = path.join(transaction, 'backup', String(index));
    const absent = path.join(transaction, 'backup', `absent-${index}`);
    safe(target); safe(backup); safe(absent);
    if (exists(backup) === exists(absent)) throw Error(`incomplete backup inventory: ${name}`);
    const stagedHash = name === stateName ? digest(path.join(root, stateName)) : next.files[name];
    if (exists(absent) && (fs.readFileSync(absent).length !== 0 ||
        (exists(target) && (!stagedHash || digest(target) !== stagedHash)))) {
      throw Error(`unowned file at previously absent target: ${name}`);
    }
    safe(`${target}.neura-install-${index}.tmp`);
  }
  for (const [index, name] of entries.entries()) {
    const target = asTarget(name), backup = path.join(transaction, 'backup', String(index));
    fs.rmSync(`${target}.neura-install-${index}.tmp`, { force: true });
    if (exists(backup)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(backup, target); }
    else fs.rmSync(target, { force: true });
  }
  fs.rmSync(transaction, { recursive: true, force: true });
}
function prepare() {
  if (exists(transaction)) throw Error('pending install exists; recover or investigate before retrying');
  const manifest = sourceManifest();
  ownership(manifest);
  safe(path.dirname(transaction));
  fs.mkdirSync(path.dirname(transaction), { recursive: true });
  fs.mkdirSync(transaction);
  const root = path.join(transaction, 'stage');
  try {
    for (const [index, name] of Object.keys(manifest.files).concat(manifestName).entries()) {
      const dest = path.join(root, name), src = path.join(source, name);
      safe(dest); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest);
      if (process.env.NEURA_INSTALL_TEST_FAIL_PREPARE_AFTER === String(index + 1)) throw Error('injected staging failure');
    }
    return root;
  } catch (error) {
    fs.rmSync(transaction, { recursive: true, force: true });
    throw error;
  }
}
function seal() {
  const root = path.join(transaction, 'stage');
  const manifest = sourceManifest();
  for (const [name, value] of Object.entries(manifest.files)) if (digest(path.join(root, name)) !== value) throw Error(`staged file drift: ${name}`);
  const receipt = state(manifest, root);
  fs.writeFileSync(path.join(root, stateName), JSON.stringify(receipt, null, 2) + '\n');
  verify(root, receipt, false);
}
function activate() {
  const root = path.join(transaction, 'stage');
  const receipt = read(path.join(root, stateName));
  verify(root, receipt, false);
  ownership(valid(read(path.join(root, manifestName))));
  const old = exists(asTarget(stateName)) ? read(asTarget(stateName)) : null;
  const oldFiles = old ? previousFiles(old, valid(read(asTarget(manifestName)))) : {};
  for (const [name, expected] of Object.entries(receipt.files)) {
    if (!name.startsWith('agent/neura/node_modules/')) continue;
    const target = asTarget(name);
    safe(target);
    if (exists(target) && digest(target) !== expected && digest(target) !== oldFiles[name]) {
      throw Error(`unowned or modified Learn runtime file: ${name}`);
    }
  }
  const stale = Object.keys(oldFiles).filter(name => !Object.hasOwn(receipt.files, name));
  const names = [...new Set([...Object.keys(receipt.files), stateName, ...stale, ...retired])];
  for (const [index, name] of names.entries()) {
    const target = asTarget(name), temporary = `${target}.neura-install-${index}.tmp`;
    safe(target); safe(temporary);
    if (exists(temporary)) throw Error(`temporary install file already exists: ${name}`);
  }
  fs.mkdirSync(path.join(transaction, 'backup'), { recursive: true });
  names.forEach((name, i) => {
    const file = asTarget(name);
    if (exists(file)) fs.copyFileSync(file, path.join(transaction, 'backup', String(i)));
    else fs.writeFileSync(path.join(transaction, 'backup', `absent-${i}`), '');
  });
  fs.writeFileSync(path.join(transaction, 'journal.json'), JSON.stringify(names));
  try {
    names.forEach((name, i) => {
      const dest = asTarget(name), staged = path.join(root, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (exists(staged)) {
        // A copy may be partial on interruption. Publish only complete files.
        const temporary = `${dest}.neura-install-${i}.tmp`;
        if (process.env.NEURA_INSTALL_TEST_CRASH_DURING_COPY === String(i + 1)) {
          fs.writeFileSync(temporary, 'partial'); process.exit(77);
        }
        fs.copyFileSync(staged, temporary, fs.constants.COPYFILE_EXCL);
        fs.renameSync(temporary, dest);
      } else fs.rmSync(dest, { force: true });
      if (process.env.NEURA_INSTALL_TEST_FAIL_AFTER === String(i + 1)) throw Error('injected interruption');
      if (process.env.NEURA_INSTALL_TEST_CRASH_AFTER === String(i + 1)) process.exit(77);
    });
    verify(agent, receipt);
    fs.renameSync(path.join(transaction, 'journal.json'), path.join(transaction, 'complete.json'));
    fs.rmSync(transaction, { recursive: true, force: true });
  } catch (error) {
    try { recover(); }
    catch (recoveryError) { throw Error(`activation failed: ${error.message}; recovery failed: ${recoveryError.message}`); }
    throw error;
  }
}
const mode = process.argv[2];
try {
  if (mode === 'prepare') console.log(prepare());
  else if (mode === 'seal') seal();
  else if (mode === 'activate') activate();
  else if (mode === 'recover') recover();
  else if (mode === 'check') {
    if (exists(path.join(transaction, 'journal.json'))) throw Error('interrupted installation; run installer to recover');
    const receipt = read(asTarget(stateName));
    verify(agent, receipt, true, process.argv.includes('--quick'));
    if (process.argv.includes('--source') && digest(path.join(source, manifestName)) !== receipt.manifestHash) throw Error('live manifest differs from source');
    console.log(`Neura ${receipt.version} manifest ${receipt.manifestHash.slice(0, 12)} commit ${receipt.sourceCommit} installed ${receipt.installedAt}`);
  } else throw Error('usage: runtime-install.mjs prepare|seal|activate|recover|check [--source] [--quick]');
} catch (error) { console.error(`Neura install: ${error.message}`); process.exitCode = 1; }
