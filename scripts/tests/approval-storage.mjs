import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { isolate } from './isolation.mjs';
const scratch = isolate();
const store = await import('../../agent/neura/approval-store.ts');
const worker = path.join(import.meta.dirname,'approval-worker.mjs');
const audit = directory => path.join(directory,'audit.jsonl');
const select = name => {
  const directory = path.join(scratch,name);
  fs.mkdirSync(directory);
  process.env.NEURA_APPROVAL_DIR=directory;
  return directory;
};
const directory = select('concurrent');
const children = Array.from({length:6},(_,i)=>{
  const child = spawn(process.execPath,[worker,directory,String(i),'barrier'], {env:process.env,windowsHide:true,stdio:'ignore'});
  const done = new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`writer ${i} failed (${code})`)));});
  return {child,done};
});
try {
  const deadline=Date.now()+10000;
  while(fs.readdirSync(directory).filter(n=>n.startsWith('ready-')).length<children.length) {
    assert.ok(Date.now()<deadline,'concurrent writer startup timed out');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  fs.writeFileSync(path.join(directory,'go'),'go');
  await Promise.all(children.map(item=>item.done));
} finally { for(const {child} of children) if(child.exitCode===null) child.kill(); }
assert.deepEqual(store.verifyApprovalAudit(),{valid:true,events:48});
assert.equal(store.listPending().length,48,'concurrent writers lost decisions');

const short=select('short');
assert.equal(spawnSync(process.execPath,[worker,short,'short','short'],{env:process.env,windowsHide:true,stdio:'ignore'}).status,0);
assert.equal(store.verifyApprovalAudit().events,8,'short writes were not retried');
const partial=select('partial');
assert.equal(spawnSync(process.execPath,[worker,partial,'partial','partial'],{env:process.env,windowsHide:true,stdio:'ignore'}).status,0);
assert.throws(()=>store.listPending(),/invalid JSON|hash-chain/,'partial tail allowed approvals');
assert.throws(()=>store.resolveApproval('anything','approved'),/invalid JSON|hash-chain/);
assert.equal(fs.existsSync(path.join(partial,'writer.lock')),false,'failed write leaked active lock');

const valid=fs.readFileSync(audit(directory),'utf8');
for (const [name,content] of [['truncated',valid.slice(0,-12)],['tampered',valid.replace('synthetic edit','changed edit')],['invalid','{broken}\n']]) {
  const target=select(name); fs.writeFileSync(audit(target),content);
  assert.throws(()=>store.verifyApprovalAudit(),/invalid JSON|hash-chain/,`${name} accepted`);
  assert.throws(()=>store.listPending(),/invalid JSON|hash-chain/,`${name} materialized`);
}
const locked=select('crash-lock');
fs.mkdirSync(path.join(locked,'writer.lock'));
const start=Date.now();
assert.throws(()=>store.resolveApproval('missing','approved'),/writer lock timed out/);
assert.ok(Date.now()-start<4000,'stale writer lock wait unbounded');
assert.equal(fs.existsSync(path.join(locked,'writer.lock')),true,'crash lock stolen automatically');
assert.equal(fs.existsSync(audit(locked)),false,'lock failure mutated audit');
console.log('PASS approval-storage: 6 concurrent writers, short writes, truncation, tampering, and crash lock');
