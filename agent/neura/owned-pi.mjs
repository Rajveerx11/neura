// Resolve only the sealed private runtime. Never consult PATH, NODE_PATH or Pi's bundled bin.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const pi = '@earendil-works/pi-coding-agent';
const undiciVersion = '8.12.2';
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function resolveOwnedPi(root, { release, receipt } = {}) {
  root = path.resolve(root);
  const installedResolution = !release && !receipt;
  const noLinks = file => {
    const components = [];
    for (let current = file; ; current = path.dirname(current)) {
      components.unshift(current);
      if (current === path.dirname(current)) break;
    }
    // Walk from the filesystem root, before touching children of a junction.
    for (const component of components) {
      try { if (fs.lstatSync(component).isSymbolicLink()) throw Error('linked owned Pi path'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  const contained = relative => {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw Error('owned Pi path escape');
    noLinks(file);
    if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) throw Error('invalid owned Pi path');
    return file;
  };
  const checked = relative => {
    const file = contained(relative);
    if (!fs.statSync(file).isFile()) throw Error('invalid owned Pi file');
    if (receipt && receipt.files?.[`agent/neura/${relative.replaceAll(path.sep, '/')}`] !== sha(file)) throw Error(`owned Pi file drift: ${relative}`);
    return file;
  };
  const json = relative => JSON.parse(fs.readFileSync(checked(relative), 'utf8'));
  if (!receipt && !release) {
    // Headmaster requires an installed receipt; source/dev resolution must be explicit.
    receipt = json('.install-state.json');
  }
  if (!release) {
    const manifest = checked('release-manifest.json');
    if (receipt.manifestHash !== sha(manifest)) throw Error('owned Pi release identity mismatch');
    release = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  }
  if (receipt) {
    if (receipt.schemaVersion !== 1 || !receipt.files || Array.isArray(receipt.files)) throw Error('invalid owned Pi receipt');
    for (const name of ['owned-pi.mjs', 'runtime-contract.json', 'package.json', 'package-lock.json']) {
      const key = `agent/neura/${name}`;
      if (release.files?.[key] !== receipt.files[key] || !/^[0-9a-f]{64}$/.test(release.files?.[key] ?? '')) throw Error('owned Pi metadata is not release-owned');
      checked(name);
    }
  }
  const contract = json('runtime-contract.json');
  const declared = json('package.json');
  const lock = json('package-lock.json');
  if (contract.schemaVersion !== 1 || contract.piVersion !== release.piVersion ||
      !/^\d+\.\d+\.\d+$/.test(release.piVersion) || declared.dependencies?.[pi] !== release.piVersion ||
      declared.dependencies?.undici !== undiciVersion || declared.overrides?.['undici@8.10.2'] !== undiciVersion ||
      lock.packages?.['']?.dependencies?.[pi] !== release.piVersion || lock.packages?.['']?.dependencies?.undici !== undiciVersion) {
    throw Error('owned Pi declared runtime identity mismatch');
  }
  const piRoot = `node_modules/${pi}`;
  const installed = json(`${piRoot}/package.json`);
  const external = json('node_modules/undici/package.json');
  if (installed.name !== pi || installed.version !== release.piVersion || external.name !== 'undici' || external.version !== undiciVersion ||
      external.main !== 'index.js' || external.exports !== undefined ||
      lock.packages?.[piRoot]?.version !== release.piVersion || lock.packages?.['node_modules/undici']?.version !== undiciVersion) {
    throw Error('owned Pi installed runtime identity mismatch');
  }
  // Node resolves undici from dist/core upward. No nearer package may shadow the
  // fixed external dependency, even if NODE_PATH points at a different graph.
  for (const parent of [`${piRoot}/dist/core`, `${piRoot}/dist`, piRoot, 'node_modules/@earendil-works']) {
    const candidate = path.join(root, parent, 'node_modules/undici');
    noLinks(candidate);
    try { fs.lstatSync(candidate); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Error('shadowed owned Pi Undici');
  }
  const entry = checked(`${piRoot}/dist/cli.js`);
  const dispatcher = checked(`${piRoot}/dist/core/http-dispatcher.js`);
  const undiciEntry = checked('node_modules/undici/index.js');
  if (installedResolution) {
    // A separate child needs a fresh complete graph check, not the launcher's
    // earlier preflight. Installer callers already verify the full receipt.
    const prefix = 'agent/neura/';
    const owned = new Set([...Object.keys(release.files), `${prefix}release-manifest.json`, `${prefix}.learn-runtime-lock`]);
    const modules = new Set();
    for (const [name, expected] of Object.entries(receipt.files)) {
      if (name.includes('..') || name.split('/').some(part => !part || part === '.') ||
          !/^(agent\/(extensions|themes|neura)\/[\w.@/-]+|agent\/mcp\.json|launcher\/neura\.cmd)$/.test(name) ||
          (!owned.has(name) && !name.startsWith(`${prefix}node_modules/`)) || typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) {
        throw Error('unowned or invalid owned Pi receipt entry');
      }
      if (name.startsWith(`${prefix}node_modules/`)) modules.add(name.slice(prefix.length));
    }
    const walk = relative => {
      for (const entry of fs.readdirSync(contained(relative), { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else if (entry.isFile()) {
          if (!modules.has(child)) throw Error(`unknown owned Pi module: ${child}`);
          checked(child);
          modules.delete(child);
        } else throw Error(`linked or special owned Pi module: ${child}`);
      }
    };
    walk('node_modules');
    if (modules.size) throw Error(`missing owned Pi module: ${modules.values().next().value}`);
  }
  return { entry, dispatcher, undiciEntry, version: installed.version };
}
