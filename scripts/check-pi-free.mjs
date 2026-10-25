import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const forbidden = /(?:@(?:earendil-works|mariozechner)\/pi-|(?:^|\/)pi-subagents(?:\/|$)|@(?:spences10|ollama)\/pi-)/;
let entries = 0;
for (const relative of ['package.json', 'package-lock.json', 'agent/neura/package.json', 'agent/neura/package-lock.json']) {
  const json = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(json[group] ?? {})) {
      assert.ok(!forbidden.test(name), `Pi dependency in ${relative}: ${name}`);
      assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `Non-exact direct pin: ${name}`);
    }
  }
  for (const [name, entry] of Object.entries(json.packages ?? {})) {
    entries++;
    assert.ok(!forbidden.test(name) && !forbidden.test(entry.name ?? ''), `Pi package in ${relative}: ${name}`);
    if (name) assert.ok(entry.integrity, `Missing package integrity: ${name}`);
  }
}
// Trace only the active app and its local static/dynamic module imports, not retained historical adapters.
const visited = new Set();
function visit(file) {
  file = path.resolve(file);
  if (visited.has(file)) return;
  visited.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map(match => match[1]);
  for (const specifier of imports) {
    assert.ok(!forbidden.test(specifier), `Pi import reachable from ${path.relative(root, file)}: ${specifier}`);
    if (specifier.startsWith('.')) visit(path.resolve(path.dirname(file), specifier));
  }
}
visit(path.join(root, 'src/cli.ts'));
const launcher = fs.readFileSync(path.join(root, 'launcher/neura.cmd'), 'utf8');
assert.ok(launcher.includes('src\\cli.ts'), 'Launcher does not invoke the new application');
assert.ok(!/^\s*(?:call\s+)?pi(?:\s|$)/mi.test(launcher), 'Launcher invokes Pi');
assert.ok(!launcher.includes('PI_CODING_AGENT_DIR'), 'Launcher reuses legacy profile');
console.log(`PASS: ${entries} lock entries and ${visited.size} reachable local modules checked; active Neura graph is Pi-free by package/import identity.`);
console.log('This does not certify all embedded third-party source, licensing, production readiness or removal of independent/running Pi installations.');
if (process.argv.includes('--distribution')) throw new Error('Distribution blocked: bundled Mastra EE license scope and complete dependency approval remain unresolved. Development verification cannot waive this gate.');
