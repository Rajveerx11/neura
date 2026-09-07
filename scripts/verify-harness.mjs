import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { suites, selectSuites, changedPaths } from './test-suites.mjs';
import { captureWorktree } from '../agent/neura/verification.ts';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const incremental = args[0] === '--changed';
const before = incremental ? await captureWorktree(root) : null;
if (incremental && !before) throw new Error('Cannot bind incremental checks to this worktree; run full verification.');
let selected = Object.keys(suites);
if (args[0] === '--suite' && args.length === 2 && Object.hasOwn(suites,args[1])) selected = [args[1]];
else if (args[0] === '--changed' && args.length === 1) {
  selected = selectSuites(changedPaths(root));
} else if (args.length) throw new Error('Usage: node scripts/verify-harness.mjs [--suite NAME | --changed]');

let failed = false;
const results = [];
for (const name of selected) {
  const start = Date.now();
  const result = spawnSync(process.execPath, [suites[name]], {
    cwd: root, stdio: 'inherit', windowsHide: true, timeout: 180_000,
  });
  console.log(`${name}: ${result.status === 0 ? 'PASS' : 'FAIL'} (${((Date.now()-start)/1000).toFixed(1)}s)`);
  if (result.status !== 0) failed = true;
  results.push({ name, status: result.status === 0 ? 'passed' : 'failed' });
}
if (incremental) {
  const after = await captureWorktree(root);
  const stable = after?.fingerprint === before.fingerprint;
  if (!stable) {
    failed = true;
    console.error('Worktree changed during incremental verification; evidence marked unavailable.');
  }
  const directory = path.join(before.root, '.proofofwork');
  await fs.mkdir(directory, {recursive:true});
  if ((await fs.lstat(directory)).isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error('Linked evidence directory refused.');
  const temporary = path.join(directory, `neura-checks-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify({schemaVersion:1,fingerprint:before.fingerprint,
      completedAt:new Date().toISOString(),status:stable ? (failed ? 'failed' : 'passed') : 'unavailable',suites:results}), {flag:'wx'});
    await fs.rename(temporary,path.join(directory,'neura-checks.json'));
  } finally { await fs.rm(temporary,{force:true}); }
}
console.log(`Neura verify: ${selected.length} independent suites; ${failed ? 'FAILED' : 'passed'}.`);
process.exitCode = failed ? 1 : 0;
