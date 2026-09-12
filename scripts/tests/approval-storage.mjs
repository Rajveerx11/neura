import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
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
  const child = spawn(process.execPath,[worker,directory,String(i),'barrier'], {env:process.env,windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr = '';
  child.stderr.on('data',chunk=>{ stderr += String(chunk).slice(0,Math.max(0,4096-stderr.length)); });
  const done = new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>code===0?resolve():reject(new Error(`writer ${i} failed (exit ${code}, signal ${signal ?? 'none'}): ${stderr.trim() || 'no stderr'}`)));});
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

const extended=select('extended-lock');
const extendedLock=path.join(extended,'writer.lock');
fs.mkdirSync(extendedLock);
const waiting=spawn(process.execPath,[worker,extended,'extended','barrier'],{env:process.env,windowsHide:true,stdio:'ignore'});
const waitingDone=new Promise((resolve,reject)=>{waiting.once('error',reject);waiting.once('close',code=>code===0?resolve():reject(new Error(`extended lock writer failed with exit ${code}`)));});
try {
  const deadline=Date.now()+10000;
  while(!fs.existsSync(path.join(extended,'ready-extended'))) {
    assert.ok(Date.now()<deadline,'extended lock writer startup timed out');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  fs.writeFileSync(path.join(extended,'go'),'go');
  await new Promise(resolve=>setTimeout(resolve,2500));
  fs.rmdirSync(extendedLock);
  await waitingDone;
} finally {
  if(fs.existsSync(extendedLock)) fs.rmdirSync(extendedLock);
  if(waiting.exitCode===null) waiting.kill();
}
assert.equal(store.verifyApprovalAudit().events,8,'writer did not survive contention beyond the old deadline');

// Reproduce Windows's transient EPERM on mkdir without changing the real lock,
// append, or audit validation. Permanent denial must retain the bounded failure.
const originalMkdir = fs.mkdirSync;
for (const kind of ['transient', 'persistent', 'io-error']) {
  const target = select(`permission-${kind}`);
  const lock = path.join(target,'writer.lock');
  let calls = 0;
  fs.mkdirSync = (name, ...args) => {
    if (name === lock) {
      calls++;
      if (kind !== 'transient' || calls === 1) {
        throw Object.assign(new Error('synthetic lock creation failure'), { code: kind === 'io-error' ? 'EIO' : 'EPERM' });
      }
    }
    return originalMkdir(name, ...args);
  };
  syncBuiltinESMExports();
  const started = Date.now();
  try {
    const write = () => store.recordDecision({workspace:path.join(target,'workspace'),toolName:'edit',summary:'synthetic edit',
      category:'protected',risk:'high',actionFingerprint:kind,workspaceFingerprint:'synthetic',approvalBinding:{target:'synthetic'}},
      {decision:'defer',reason:'synthetic test',saferPath:'review',reviewer:'policy'},'pending',true);
    if (kind === 'transient' && process.platform === 'win32') {
      write();
      assert.equal(calls,2,'transient EPERM did not retry real acquisition');
      assert.equal(store.verifyApprovalAudit().events,1,'successful retry lost or duplicated the decision');
    } else {
      const boundedRetry = kind === 'persistent' && process.platform === 'win32';
      assert.throws(write,boundedRetry ? /writer lock timed out/ : {code:kind === 'io-error' ? 'EIO' : 'EPERM'});
      if (boundedRetry) assert.ok(calls>1 && Date.now()-started<12000,'permanent EPERM did not fail within the lock deadline');
      else assert.equal(calls,1,'unrelated or POSIX errors were retried');
      assert.equal(fs.existsSync(audit(target)),false,'failed acquisition mutated the audit');
    }
    assert.equal(fs.existsSync(lock),false,'permission handling leaked a lock');
  } finally { fs.mkdirSync=originalMkdir; syncBuiltinESMExports(); }
}

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
assert.ok(Date.now()-start<12000,'stale writer lock wait unbounded');
assert.equal(fs.existsSync(path.join(locked,'writer.lock')),true,'crash lock stolen automatically');
assert.equal(fs.existsSync(audit(locked)),false,'lock failure mutated audit');
console.log('PASS approval-storage: 6 concurrent writers, short writes, truncation, tampering, and crash lock');
