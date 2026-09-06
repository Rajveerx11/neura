import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchRoot as scratch, guard, modeState, context } from './harness.mjs';
modeState.setMode('plan');
const { isPathInside } = await import('../../agent/neura/plan-policy.ts');

const workspace = path.join(scratch, 'workspace');
const outside = path.join(scratch, 'workspace-other');
fs.mkdirSync(workspace); fs.mkdirSync(outside);
fs.writeFileSync(path.join(workspace,'source.txt'),'source');
fs.writeFileSync(path.join(outside,'outside.txt'),'synthetic');
fs.symlinkSync(outside,path.join(workspace,'link'),'junction');
let seed = 0x27c0ffee;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
// Fixed seed, bounded corpus, and case number make failures reproducible.
for (let i=0;i<96;i++) {
  const depth = 1 + random()%8;
  const padding = Array.from({length:depth},()=>`s${random()%10000}`).join(path.sep);
  const inside = path.join(workspace,padding,'source.txt');
  assert.equal(isPathInside(workspace,inside),true,`seed=0x27c0ffee case=${i} inside`);
  const escape = path.resolve(workspace,padding,...Array(depth+1).fill('..'),'workspace-other','outside.txt');
  assert.equal(isPathInside(workspace,escape),false,`seed=0x27c0ffee case=${i} traversal`);
  assert.equal((await guard({toolName:'read',input:{path:escape}}, {...context,cwd:workspace}))?.block,true,`case=${i} external read`);
  assert.equal((await guard({toolName:'read',input:{path:path.join(workspace,'link','outside.txt')}}, {...context,cwd:workspace}))?.block,true,`case=${i} junction`);
}
const endings = ['; Remove-Item source.txt', ' && rm source.txt', ' | Set-Content source.txt', '\nRemove-Item source.txt', ' > source.txt', ' $(Remove-Item source.txt)', ' & rm source.txt'];
for (let i=0; i<96; i++) {
  const base = ['pwd', 'Get-Location', 'Get-Content -LiteralPath source.txt'][random()%3];
  assert.equal(await guard({toolName:'bash',input:{command:base}}, {...context,cwd:workspace}),undefined, 'valid read rejected');
  const command = base + endings[random()%endings.length];
  assert.equal((await guard({toolName:'bash',input:{command}}, {...context,cwd:workspace}))?.block,true, 'seed=0x27c0ffee shell case='+i);
}
console.log('PASS fuzz: seed=0x27c0ffee, 96 path and 96 shell mutation cases');
