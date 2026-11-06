// Active dependency gate (#115). Lock metadata only: it does not certify embedded source,
// native/WASM behavior, Mastra EE scope or distribution rights.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = /(?:@(?:earendil-works|mariozechner)\/pi-|(?:^|\/)pi-subagents(?:\/|$)|@(?:spences10|ollama)\/pi-)/;
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
// Derived from both active locks on 2026-11-05. A new license id fails until reviewed here.
export const PERMISSIVE = new Set(['Apache-2.0', 'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0']);
// Reviewed exceptions bind to name@version, so any version change forces a fresh review.
// License exceptions are dev-only: they never cover a production-reachable (non-`dev`) entry.
export const REVIEWED_LICENSES = Object.freeze({
  'axe-core@4.14.0': { license: 'MPL-2.0', reason: 'File-level copyleft; dev-only Learn accessibility test dependency, unmodified, never shipped by the source-linked install.' },
});
export const REVIEWED_INSTALL_SCRIPTS = Object.freeze({
  'tesseract.js@7.0.0': '`opencollective-postinstall || true` donation banner only; every supported install uses --ignore-scripts.',
});

// ponytail: SPDX ids joined only by OR, optionally in one outer paren pair. AND, WITH, a bare OR operand, nesting or
// any other syntax counts as not permissive. Under OR the licensee may elect the permissive branch.
const SPDX_ID = /^[\w.+-]+$/;
export function permissive(license) {
  if (typeof license !== 'string') return false;
  const ids = (/^\(([^()]*)\)$/.exec(license)?.[1] ?? license).split(' OR ');
  return ids.every(id => SPDX_ID.test(id) && !['AND', 'OR', 'WITH'].includes(id)) && ids.some(id => PERMISSIVE.has(id));
}

// Node resolution over lock keys: nearest nested node_modules first, then each parent, then the root.
function resolvesInLock(packages, from, dependency) {
  for (let base = from; ; base = base.slice(0, Math.max(base.lastIndexOf('/node_modules/'), 0))) {
    if (packages[`${base ? `${base}/` : ''}node_modules/${dependency}`]) return true;
    if (!base) return false;
  }
}

const DIRECT_GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies'];
// A dependency present only in the manifest would otherwise skip every lock-entry check above.
export function checkManifestLock(relative, manifest, lock) {
  const errors = [];
  const root = lock.packages?.[''] ?? {};
  for (const group of DIRECT_GROUPS) {
    const declared = manifest[group] ?? {};
    const locked = root[group] ?? {};
    for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
      if (declared[name] !== locked[name]) errors.push(`Manifest and lock disagree in ${relative}: ${group} ${name} (${declared[name] ?? 'absent'} vs ${locked[name] ?? 'absent'})`);
    }
  }
  return errors;
}

// Works for package.json (top-level groups) and lockfile v3 (packages[""] groups plus entries).
export function checkGraph(relative, json) {
  const errors = [];
  const lock = relative.endsWith('package-lock.json') || Object.hasOwn(json, 'lockfileVersion') || Object.hasOwn(json, 'packages');
  // A lock without its v3 packages map must fail, not be read as a manifest with nothing to check.
  if (lock && (json.lockfileVersion !== 3 || !json.packages?.[''])) return { errors: [`Unsupported lockfile in ${relative}: lockfileVersion 3 with packages[""] required`], entries: 0 };
  const direct = lock ? json.packages[''] : json;
  for (const group of DIRECT_GROUPS) {
    for (const [name, version] of Object.entries(direct[group] ?? {})) {
      if (FORBIDDEN.test(name)) errors.push(`Pi dependency in ${relative}: ${name}`);
      if (!EXACT.test(version)) errors.push(`Non-exact direct pin in ${relative}: ${name}@${version}`);
    }
  }
  let entries = 0;
  for (const [key, entry] of Object.entries(json.packages ?? {})) {
    // Regular edges must resolve so the closure has no unchecked package. Peer and optional edges may be absent.
    for (const dependency of Object.keys(entry.dependencies ?? {})) {
      if (!resolvesInLock(json.packages, key, dependency)) errors.push(`Unresolved dependency in ${relative}: ${key || '(root)'} -> ${dependency}`);
    }
    if (!key) continue;
    entries++;
    const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const id = `${name}@${entry.version}`;
    if (FORBIDDEN.test(key) || FORBIDDEN.test(name)) errors.push(`Pi package in ${relative}: ${key}`);
    if (!entry.integrity) errors.push(`Missing package integrity in ${relative}: ${key}`);
    if (entry.hasInstallScript && !Object.hasOwn(REVIEWED_INSTALL_SCRIPTS, id)) errors.push(`Unreviewed install script in ${relative}: ${id}`);
    if (!entry.license) errors.push(`Missing license in ${relative}: ${id}`);
    else if (!permissive(entry.license) && !(Object.hasOwn(REVIEWED_LICENSES, id) && REVIEWED_LICENSES[id].license === entry.license && entry.dev === true)) errors.push(`Unreviewed license ${JSON.stringify(entry.license)} in ${relative}: ${id}`);
  }
  return { errors, entries };
}

// Trace only the active app and its local static/dynamic module imports, not retained historical adapters.
export function traceImports(root, entry) {
  const visited = new Set();
  const errors = [];
  const visit = file => {
    file = path.resolve(file);
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)) {
      if (FORBIDDEN.test(specifier)) errors.push(`Pi import reachable from ${path.relative(root, file)}: ${specifier}`);
      if (specifier.startsWith('.')) visit(path.resolve(path.dirname(file), specifier));
    }
  };
  visit(entry);
  return { errors, modules: visited.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const errors = [];
  let entries = 0;
  for (const relative of ['package.json', 'package-lock.json', 'agent/neura/package.json', 'agent/neura/package-lock.json']) {
    const result = checkGraph(relative, JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')));
    errors.push(...result.errors);
    entries += result.entries;
  }
  for (const directory of ['', 'agent/neura/']) {
    const read = file => JSON.parse(fs.readFileSync(path.join(root, directory, file), 'utf8'));
    errors.push(...checkManifestLock(`${directory}package.json`, read('package.json'), read('package-lock.json')));
  }
  const trace = traceImports(root, path.join(root, 'src/cli.ts'));
  errors.push(...trace.errors);
  const launcher = fs.readFileSync(path.join(root, 'launcher/neura.cmd'), 'utf8');
  if (!launcher.includes('src\\cli.ts')) errors.push('Launcher does not invoke the new application');
  if (/^\s*(?:call\s+)?pi(?:\s|$)/mi.test(launcher)) errors.push('Launcher invokes Pi');
  if (launcher.includes('PI_CODING_AGENT_DIR')) errors.push('Launcher reuses legacy profile');
  if (errors.length) {
    console.error(errors.map(error => `FAIL: ${error}`).join('\n'));
    process.exit(1);
  }
  console.log(`PASS: ${entries} lock entries and ${trace.modules} reachable local modules checked; exact pins, integrity, reviewed install scripts and permissive or reviewed licenses; active Neura graph is Pi-free by package/import identity.`);
  console.log('This does not certify all embedded third-party source, licensing, production readiness or removal of independent/running Pi installations.');
  if (process.argv.includes('--distribution')) {
    console.error('Distribution blocked: the owner accepted Mastra EE license terms for local development and testing only (2026-11-05). Distribution or production use still needs Mastra commercial EE terms or an EE-free upstream artifact. Development verification cannot waive this gate.');
    process.exit(1);
  }
}
