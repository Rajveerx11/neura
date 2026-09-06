import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export function pinnedPi(repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent/neura/runtime-contract.json'), 'utf8'));
  const roots = {};
  for (const name of ['pi-coding-agent', 'pi-tui']) {
    const root = path.join(repoRoot, 'node_modules/@earendil-works', name);
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(installed.version, manifest.devDependencies[`@earendil-works/${name}`], `${name}: run npm ci --ignore-scripts`);
    assert.equal(installed.version, contract.piVersion, `${name}: runtime contract mismatch`);
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false, `${name}: ambient package link refused`);
    roots[name] = root;
  }
  return {
    loaderPath: path.join(roots['pi-coding-agent'], 'dist/core/extensions/loader.js'),
    tuiPath: path.join(roots['pi-tui'], 'dist/index.js'),
  };
}
