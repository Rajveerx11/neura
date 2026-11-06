import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGraph, checkManifestLock, permissive, traceImports } from '../scripts/check-pi-free.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const entry = (extra: Record<string, unknown> = {}) => ({ version: '1.0.0', integrity: 'sha512-x', license: 'MIT', ...extra });
const lock = (packages: Record<string, unknown>, dependencies: Record<string, string> = { ok: '1.0.0' }) =>
  ({ lockfileVersion: 3, packages: { '': { dependencies }, 'node_modules/ok': entry(), ...packages } });
const fails = (json: unknown, pattern: RegExp) => {
  const { errors } = checkGraph('synthetic', json);
  assert.ok(errors.some(error => pattern.test(error)), errors.join('\n') || 'no errors');
};

test('real manifests and both active locks pass the dependency gate', () => {
  for (const file of ['package.json', 'package-lock.json', 'agent/neura/package.json', 'agent/neura/package-lock.json']) {
    assert.deepEqual(checkGraph(file, read(file)).errors, [], file);
  }
  assert.ok(checkGraph('root', read('package-lock.json')).entries > 0 && checkGraph('learn', read('agent/neura/package-lock.json')).entries > 0);
  assert.deepEqual(checkManifestLock('root', read('package.json'), read('package-lock.json')), []);
  assert.deepEqual(checkManifestLock('learn', read('agent/neura/package.json'), read('agent/neura/package-lock.json')), []);
  assert.deepEqual(traceImports(root, path.join(root, 'src/cli.ts')).errors, []);
});

test('synthetic clean lock passes; SPDX OR needs one permissive branch', () => {
  assert.deepEqual(checkGraph('synthetic', lock({})).errors, []);
  assert.equal(permissive('(AFL-2.1 OR BSD-3-Clause)'), true);
  assert.equal(permissive('MIT'), true);
  for (const bad of ['MIT AND GPL-3.0-only', 'MIT OR GPL-3.0-only AND Apache-2.0', 'MIT WITH x', '(MIT OR (BSD-3-Clause))', 'MIT OR', 'MIT OR OR', 'OR OR MIT', '', 'GPL-3.0-only']) {
    assert.equal(permissive(bad), false, bad);
  }
});

test('pi-tui, install script, missing license, disallowed license and range pin each fail', () => {
  fails(lock({ 'node_modules/@earendil-works/pi-tui': entry() }), /Pi package/);
  fails(lock({ 'node_modules/@earendil-works/pi-tui': entry({ name: 'renamed' }) }), /Pi package/);
  fails(lock({ 'node_modules/hook': entry({ hasInstallScript: true }) }), /Unreviewed install script.*hook@1\.0\.0/);
  fails(lock({ 'node_modules/bare': entry({ license: undefined }) }), /Missing license.*bare@1\.0\.0/);
  fails(lock({ 'node_modules/gpl': entry({ license: 'GPL-3.0-only' }) }), /Unreviewed license "GPL-3.0-only"/);
  fails(lock({}, { ok: '^1.0.0' }), /Non-exact direct pin.*ok@\^1\.0\.0/);
  fails({ dependencies: { ok: '~1.0.0' } }, /Non-exact direct pin/);
  fails({ lockfileVersion: 3 }, /Unsupported lockfile/);
  fails({ lockfileVersion: 2, packages: lock({}).packages }, /Unsupported lockfile/);
  assert.match(checkGraph('package-lock.json', {}).errors.join(), /Unsupported lockfile/);
});

test('manifest/lock drift and unresolved regular edges fail; peer and optional edges may be absent', () => {
  const manifest = { dependencies: { ok: '1.0.0' } };
  assert.deepEqual(checkManifestLock('synthetic', manifest, lock({})), []);
  assert.match(checkManifestLock('synthetic', { dependencies: { ok: '1.0.0', extra: '2.0.0' } }, lock({})).join(), /disagree.*extra \(2\.0\.0 vs absent\)/);
  assert.match(checkManifestLock('synthetic', { dependencies: { ok: '1.0.1' } }, lock({})).join(), /disagree.*ok \(1\.0\.1 vs 1\.0\.0\)/);
  assert.match(checkManifestLock('synthetic', {}, lock({})).join(), /disagree.*ok \(absent vs 1\.0\.0\)/);
  fails(lock({}, { ok: '1.0.0', gone: '1.0.0' }), /Unresolved dependency.*\(root\) -> gone/);
  fails(lock({ 'node_modules/a': entry({ dependencies: { gone: '1.0.0' } }) }), /Unresolved dependency.*node_modules\/a -> gone/);
  fails({ lockfileVersion: 3, packages: { '': { devDependencies: { gone: '1.0.0' } } } }, /Unresolved dependency.*\(root\) -> gone/);
  assert.deepEqual(checkGraph('synthetic', lock({ 'node_modules/a': entry({ devDependencies: { unlocked: '1.0.0' } }) })).errors, []);
  const edges = { 'node_modules/a': entry({ dependencies: { ok: '1.0.0', b: '1.0.0' }, peerDependencies: { p: '1.0.0' }, optionalDependencies: { o: '1.0.0' } }), 'node_modules/a/node_modules/b': entry({ dependencies: { ok: '1.0.0' } }) };
  assert.deepEqual(checkGraph('synthetic', lock(edges)).errors, []);
});

test('reviewed exceptions bind to the exact version; license exceptions only cover dev entries', () => {
  assert.deepEqual(checkGraph('synthetic', lock({ 'node_modules/tesseract.js': entry({ version: '7.0.0', hasInstallScript: true }) })).errors, []);
  fails(lock({ 'node_modules/tesseract.js': entry({ version: '7.0.1', hasInstallScript: true }) }), /Unreviewed install script.*tesseract\.js@7\.0\.1/);
  assert.deepEqual(checkGraph('synthetic', lock({ 'node_modules/axe-core': entry({ version: '4.14.0', license: 'MPL-2.0', dev: true }) })).errors, []);
  fails(lock({ 'node_modules/axe-core': entry({ version: '4.15.0', license: 'MPL-2.0', dev: true }) }), /Unreviewed license "MPL-2.0".*axe-core@4\.15\.0/);
  fails(lock({ 'node_modules/axe-core': entry({ version: '4.14.0', license: 'MPL-2.0' }) }), /Unreviewed license "MPL-2.0".*axe-core@4\.14\.0/);
  fails(lock({ 'node_modules/axe-core': entry({ version: '4.14.0', license: 'MPL-2.0', dev: 'false' }) }), /Unreviewed license "MPL-2.0".*axe-core@4\.14\.0/);
  fails(lock({ 'node_modules/axe-core': entry({ version: '4.14.0', license: 'GPL-3.0-only', dev: true }) }), /Unreviewed license "GPL-3.0-only".*axe-core@4\.14\.0/);
});
