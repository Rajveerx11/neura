import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isolate } from './isolation.mjs';
import { repository, git } from './git-fixture.mjs';
const scratch = isolate();
process.env.NEURA = '1';
const { captureWorktree, changedFiles, execute, PROOF_PYTHON, PROOF_UV_VERSION, proofRunnerArguments, runProof, makeReceipt, readIncrementalEvidence } = await import('../../agent/neura/verification.ts');
const { registerCheckGate, runModeProof } = await import('../../agent/extensions/check-gate.ts');
const { captureCheckpoint, restoreCheckpoint } = await import('../../agent/extensions/checkpoint.ts');
const { getGitHealth } = await import('../../agent/neura/core.ts');
const { setMode } = await import('../../agent/neura/mode-state.ts');
const root = repository(scratch);
const runtimeContract = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../agent/neura/runtime-contract.json'), 'utf8'));
assert.equal(PROOF_UV_VERSION, runtimeContract.automaticExecutables.proof.uvVersion, 'proof uv version drifted from runtime contract');
assert.equal(PROOF_PYTHON, '/tmp/neura-bin/python3.12', 'proof Python path drifted from sandbox mount');
assert.deepEqual(proofRunnerArguments(true).slice(0, 2), ['--python', PROOF_PYTHON], 'proof did not select the pinned Python interpreter');
// Reconciliation keeps Work proof in the OS sandbox and Learn fully read-only.
let sandboxProofCalls = 0, hostProofCalls = 0;
const hostProof = async () => { hostProofCalls++; return { ok: true, completed: true, stdout: '{"passed":true,"reasons":[]}' }; };
setMode('work');
for (const quick of [true, false]) {
  const modeProof = await runModeProof(root, quick, { execute: hostProof }, async (cwd, command, timeout) => {
    sandboxProofCalls++;
    assert.equal(cwd, root);
    assert.equal(command, `test "$(uvx --version)" = "uvx ${PROOF_UV_VERSION}" && exec uvx ${proofRunnerArguments(quick).join(' ')}`);
    assert.ok(timeout > 0);
    return { code: 0, completed: true, stdout: '{"passed":true,"reasons":[]}', stderr: '' };
  });
  assert.equal(modeProof.status, 'passed');
}
assert.equal(sandboxProofCalls, 2);
assert.equal(hostProofCalls, 0, 'Work proof executed an ambient host runner');
assert.equal((await runModeProof(root, true, { execute: hostProof }, async () => { throw new Error('synthetic missing sandbox'); })).status, 'unavailable');
assert.equal(hostProofCalls, 0, 'Missing Work sandbox fell back to host execution');
assert.equal((await runModeProof(root, true, {}, async () => ({ code: 1, completed: false, stdout: '{"passed":true,"reasons":[]}', stderr: '' }))).status, 'unavailable');
setMode('learn');
assert.equal((await runModeProof(root, true, { execute: hostProof }, async () => { sandboxProofCalls++; throw new Error('Learn invoked sandbox'); })).status, 'unavailable');
assert.equal(sandboxProofCalls, 2);
assert.equal(hostProofCalls, 0);
setMode('yolo');
assert.equal((await runModeProof(root, true, { execute: hostProof }, async () => ({ code: 0, completed: true, stdout: '{"passed":true,"reasons":[]}', stderr: '' }))).status, 'passed');
assert.equal(hostProofCalls, 0, 'YOLO proof executed an ambient host runner');
setMode('work');
assert.equal((await runProof(root, true)).status, 'unavailable', 'proof ran without an isolated executor');
const { changedPaths, selectSuites, suites } = await import('../test-suites.mjs');
const renameRoot = repository(scratch,'rename');
fs.mkdirSync(path.join(renameRoot,'docs'));
git(renameRoot,'mv','tracked.txt','docs/tracked.md');
assert.deepEqual(changedPaths(renameRoot).sort(),['docs/tracked.md','tracked.txt'],'rename source disappeared from test selection');
assert.deepEqual(selectSuites(changedPaths(renameRoot)),Object.keys(suites),'rename into documentation skipped tests');
const file = path.join(root, 'new file.txt');
fs.writeFileSync(file, 'one');
const initial = await captureWorktree(root);
assert.ok(initial);
assert.equal((await captureWorktree(root)).fingerprint, initial.fingerprint);
fs.writeFileSync(path.join(root,'..config'),'valid source');
assert.ok(await captureWorktree(root),'valid dot-prefixed filename rejected');
fs.unlinkSync(path.join(root,'..config'));
if(process.platform !== 'win32') {
  const tracked = path.join(root,'tracked.txt');
  const modeBefore = await captureWorktree(root);
  fs.chmodSync(tracked,0o755);
  assert.notEqual((await captureWorktree(root)).fingerprint,modeBefore.fingerprint,'executable mode change missed');
  fs.chmodSync(tracked,0o644);
  fs.unlinkSync(tracked);
  execFileSync('mkfifo',[tracked]);
  const fifoStart=Date.now();
  assert.equal(await captureWorktree(root),null,'FIFO accepted');
  assert.ok(Date.now()-fifoStart<3000,'FIFO blocked capture');
  fs.unlinkSync(tracked);
  fs.writeFileSync(tracked,'initial\n');
}
fs.writeFileSync(file, 'two'); // Same length and same Git status; only bytes changed.
const updated = await captureWorktree(root);
assert.notEqual(updated.fingerprint, initial.fingerprint, 'pre-existing untracked content edit was missed');
assert.deepEqual(changedFiles(initial, updated), ['new file.txt']);
fs.mkdirSync(path.join(root, 'nested'));
fs.writeFileSync(path.join(root, 'nested/first.txt'), 'first');
const nested = await captureWorktree(root);
fs.writeFileSync(path.join(root, 'nested/second.txt'), 'second');
assert.deepEqual(changedFiles(nested, await captureWorktree(root)), ['nested/second.txt']);
fs.mkdirSync(path.join(root, 'ignored'));
fs.writeFileSync(path.join(root, 'ignored/private.txt'), 'synthetic-private');
const ignored = await captureWorktree(root);
fs.writeFileSync(path.join(root, 'ignored/private.txt'), 'changed-private');
assert.equal((await captureWorktree(root)).fingerprint, ignored.fingerprint, 'ignored file affected proof');
assert.equal(Object.hasOwn(ignored.files, 'ignored/private.txt'), false);
assert.equal((await captureWorktree(path.join(root, 'nested'))).fingerprint, ignored.fingerprint);
fs.writeFileSync(path.join(root, 'tracked.txt'), Buffer.from([0, 1, 2]));
const binary = await captureWorktree(root);
fs.writeFileSync(path.join(root, 'tracked.txt'), Buffer.from([0, 1, 3]));
assert.deepEqual(changedFiles(binary, await captureWorktree(root)), ['tracked.txt']);
const beforeIndex = await captureWorktree(root);
git(root, 'add', 'tracked.txt');
assert.notEqual((await captureWorktree(root)).fingerprint, beforeIndex.fingerprint, 'index change missed');
fs.unlinkSync(file);
assert.ok(changedFiles(updated, await captureWorktree(root)).includes('new file.txt'));
assert.equal(await captureWorktree(root, { maxBytes: 1 }), null, 'size limit ignored');
assert.equal(await captureWorktree(root, { maxFiles: 1 }), null, 'entry limit ignored');
assert.equal(await captureWorktree(root, { signal: AbortSignal.abort() }), null);
assert.equal(await captureWorktree(scratch), null, 'non-repository granted a fingerprint');
const outside = path.join(scratch, 'outside');
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'outside.txt'),'synthetic outside');
fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
assert.equal(await captureWorktree(root), null, 'junction accepted');
fs.unlinkSync(path.join(root, 'escape'));

// Hostile Git helpers must not run during fingerprint capture.
const marker = path.join(scratch, 'helper-ran');
const helper = path.join(scratch, 'helper.sh');
fs.writeFileSync(helper, `#!/bin/sh\ntouch '${marker.replaceAll('\\', '/')}'\n`, { mode: 0o755 });
for (const setting of ['diff.external', 'diff.test.textconv', 'filter.test.clean', 'core.fsmonitor']) git(root, 'config', setting, helper);
fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt diff=test filter=test\n');
assert.ok(await captureWorktree(root));
assert.equal(fs.existsSync(marker), false, 'automatic fingerprint ran a repository executable');
fs.appendFileSync(path.join(root, 'tracked.txt'), 'health change\n');
await getGitHealth(root);
assert.equal(fs.existsSync(marker), false, 'health Git ran a repository filter or monitor');

// Checkpoints copy raw bytes and must not invoke clean/smudge filters or checkout helpers.
setMode('yolo');
fs.writeFileSync(path.join(root, 'tracked.txt'), 'checkpoint content\n');
const checkpoint = await captureCheckpoint(root);
assert.ok(checkpoint, 'safe checkpoint failed');
assert.equal(fs.existsSync(marker), false, 'checkpoint capture ran a repository filter');
fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed after checkpoint\n');
const outsideRestore = path.join(scratch, 'outside-restore.txt');
const predictableRestore = path.join(root, `.neura-restore-${process.pid}-tracked.txt.tmp`);
fs.writeFileSync(outsideRestore, 'outside stays unchanged\n');
try { fs.symlinkSync(outsideRestore, predictableRestore, 'file'); }
catch { fs.linkSync(outsideRestore, predictableRestore); }
assert.equal(await restoreCheckpoint(root, checkpoint), true, 'safe checkpoint restore failed');
assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8'), 'checkpoint content\n');
assert.equal(fs.readFileSync(outsideRestore, 'utf8'), 'outside stays unchanged\n', 'predictable restore temporary followed an outside link');
assert.equal(fs.lstatSync(path.join(root, 'tracked.txt')).isSymbolicLink(), false, 'restored target became a symlink');
fs.unlinkSync(predictableRestore);
assert.equal(fs.existsSync(marker), false, 'checkpoint restore ran a repository helper');
fs.rmSync(checkpoint.directory, { recursive: true, force: true });

// A failure after one replacement must restore every pre-undo byte.
fs.writeFileSync(path.join(root, 'tracked.txt'), 'transaction snapshot one\n');
fs.writeFileSync(path.join(root, 'transaction-two.txt'), 'transaction snapshot two\n');
const transactional = await captureCheckpoint(root);
assert.ok(transactional, 'transaction checkpoint failed');
fs.writeFileSync(path.join(root, 'tracked.txt'), 'current one\n');
fs.writeFileSync(path.join(root, 'transaction-two.txt'), 'current two\n');
let replacedTracked = false;
assert.equal(await restoreCheckpoint(root, transactional, { beforeWrite(name) {
  if (name === 'tracked.txt') replacedTracked = true;
  if (name === 'transaction-two.txt' && replacedTracked) throw new Error('synthetic mid-restore failure');
} }), false, 'mid-restore fault unexpectedly succeeded');
assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8'), 'current one\n', 'rollback lost the first pre-undo file');
assert.equal(fs.readFileSync(path.join(root, 'transaction-two.txt'), 'utf8'), 'current two\n', 'rollback lost the second pre-undo file');
fs.writeFileSync(path.join(root, 'tracked.txt'), 'recovery current one\n');
fs.writeFileSync(path.join(root, 'transaction-two.txt'), 'recovery current two\n');
assert.equal(await restoreCheckpoint(root, transactional, {
  beforeWrite(name) { if (name === 'transaction-two.txt') throw new Error('synthetic restore failure'); },
  beforeRollbackWrite(name) { if (name === 'tracked.txt') throw new Error('synthetic rollback failure'); },
}), false, 'rollback-failure fault unexpectedly succeeded');
assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8'), 'transaction snapshot one\n', 'rollback failure state was reported as recovered');
assert.equal(fs.readFileSync(path.join(root, 'transaction-two.txt'), 'utf8'), 'recovery current two\n', 'rollback failure corrupted an untouched file');
assert.equal(transactional.recoveryDirectories?.length, 1, 'rollback failure discarded recovery evidence');
assert.ok(fs.existsSync(transactional.recoveryDirectories[0]), 'rollback recovery evidence was deleted');
assert.equal(await restoreCheckpoint(root, transactional), true, 'checkpoint retry was not idempotent');
assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8'), 'transaction snapshot one\n');
assert.equal(fs.readFileSync(path.join(root, 'transaction-two.txt'), 'utf8'), 'transaction snapshot two\n');
for (const directory of transactional.recoveryDirectories) fs.rmSync(directory, { recursive: true, force: true });
fs.rmSync(transactional.directory, { recursive: true, force: true });
setMode('work');

const verdict = (value, ok = true) => async () => ({ ok, stdout: JSON.stringify(value) });
assert.equal((await runProof(root, true, { execute: verdict({ passed: true, reasons: [] }) })).status, 'passed');
assert.equal((await runProof(root, false, { execute: verdict({ passed: false, reasons: ['test failed'] }, false) })).status, 'failed');
for (const value of [{ passed: 'yes', reasons: [] }, { passed: true, reasons: 'bad' }, {}, null]) {
  assert.equal((await runProof(root, true, { execute: verdict(value) })).status, 'unavailable');
}
assert.equal((await runProof(root, true, { execute: verdict({ passed: true, reasons: [] }, false) })).status, 'unavailable');
assert.equal((await runProof(root, true, { execute: async () => ({ok:false, stdout:'{"passed":'}) })).status, 'unavailable');
const redacted = await runProof(root, true, { execute: verdict({ passed: false, reasons: ['Authorization: Bearer synthetic-proof-secret'] }) });
assert.doesNotMatch(redacted.reasons.join(''), /synthetic-proof-secret/);
const started = Date.now();
const timeout = await execute(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {cwd:root, timeoutMs:80});
assert.equal(timeout.ok, false);
assert.ok(Date.now() - started < 5000, 'timeout did not bound execution');
const controller = new AbortController();
const cancelled = execute(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {cwd:root, timeoutMs:5000, signal:controller.signal});
controller.abort();
assert.equal((await cancelled).ok, false);
const excess = await execute(process.execPath, ['-e', 'process.stdout.write("x".repeat(8192))'], {cwd:root,timeoutMs:5000,maxBuffer:32});
assert.equal(excess.ok, false, 'output bound ignored');

// Exercise the actual extension event handlers, with only the external runner substituted.
const handlers = new Map(), commands = new Map(), entries = [], messages = [];
let calls = 0, result = {status:'passed',reasons:[]}, mutate = false;
const pi = { on:(name, fn)=>handlers.set(name, fn), registerCommand:(name, def)=>commands.set(name,def),
  appendEntry:(type,data)=>entries.push({type,data}), sendUserMessage:message=>messages.push(message) };
registerCheckGate(pi, {captureWorktree, runProof:async (_cwd, quick) => {
  calls++;
  if (mutate) fs.appendFileSync(file, 'changed-during-proof');
  return result;
}});
const ctx = {cwd:root,hasUI:true,ui:{setStatus(){},notify(){}}};
await handlers.get('agent_start')({},ctx);
await handlers.get('agent_settled')({},ctx);
assert.equal(calls,0,'unchanged worktree ran proof');
await handlers.get('agent_start')({},ctx);
fs.writeFileSync(file,'new');
await handlers.get('agent_settled')({},ctx);
assert.equal(calls,1);
assert.deepEqual(entries.at(-1).data.changedFiles,['new file.txt']);
assert.equal(entries.at(-1).data.scope,'quick');
await commands.get('ship').handler('',ctx);
assert.equal(calls,2,'full ship reused quick verdict');
assert.equal(entries.at(-1).data.quick.current,true);
fs.writeFileSync(file,'another');
await commands.get('ship').handler('',ctx);
assert.equal(entries.at(-1).data.quick.current,false,'stale quick evidence marked current');
mutate=true;
await commands.get('ship').handler('',ctx);
assert.equal(entries.at(-1).data.status,'unavailable','changed-during-proof received PASS');
mutate=false;
result={status:'failed',reasons:['fixture failure']};
for(let turn=0;turn<2;turn++) {
  await handlers.get('agent_start')({},ctx);
  fs.appendFileSync(file,'next');
  await handlers.get('agent_settled')({},ctx);
}
assert.equal(messages.length,1,'automatic failure feedback loop was not capped');
handlers.get('input')({source:'interactive'});
await handlers.get('agent_start')({},ctx);
fs.appendFileSync(file,'new prompt');
await handlers.get('agent_settled')({},ctx);
assert.equal(messages.length,2);
handlers.get('session_start')();
await commands.get('ship').handler('',ctx);
assert.equal(entries.at(-1).data.quick,undefined,'quick evidence leaked across sessions');
// A disappearing UI must not wedge the in-flight guard.
const throwingUi={...ctx,ui:{setStatus(){throw new Error('synthetic disposed UI');},notify(){throw new Error('synthetic disposed UI');}}};
await commands.get('ship').handler('',throwingUi);
const afterThrow=calls;
await commands.get('ship').handler('',ctx);
assert.equal(calls,afterThrow+1,'disposed UI wedged later verification');

// Session replacement aborts in-flight work; late success cannot enter the new session.
const lateHandlers=new Map(), lateCommands=new Map(), lateEntries=[];
let release, capturedSignal;
registerCheckGate({on:(name,fn)=>lateHandlers.set(name,fn),registerCommand:(name,def)=>lateCommands.set(name,def),
  appendEntry:(_type,data)=>lateEntries.push(data),sendUserMessage(){}}, {
  captureWorktree,
  runProof:async (_cwd,_quick,{signal})=>{
    capturedSignal=signal;
    return new Promise(resolve=>{release=()=>resolve({status:'passed',reasons:[]});});
  },
});
const late=lateCommands.get('ship').handler('',ctx);
while(!release) await new Promise(resolve=>setTimeout(resolve,5));
lateHandlers.get('session_start')();
assert.equal(capturedSignal.aborted,true,'session replacement did not cancel proof');
release(); await late;
assert.equal(lateEntries.length,0,'old session recorded late PASS');

// Incremental suite results are attached as untrusted, current/stale evidence.
fs.appendFileSync(path.join(root,'.gitignore'),'.proofofwork/\n');
fs.mkdirSync(path.join(root,'.proofofwork'));
const evidencePath=path.join(root,'.proofofwork/neura-checks.json');
const evidenceSnapshot=await captureWorktree(root);
const evidence={schemaVersion:1,fingerprint:evidenceSnapshot.fingerprint,completedAt:new Date().toISOString(),
  status:'failed',suites:[{name:'proof',status:'failed'}]};
fs.writeFileSync(evidencePath,JSON.stringify(evidence));
result={status:'passed',reasons:[]};
await commands.get('ship').handler('',ctx);
assert.equal(entries.at(-1).data.incremental.current,true);
assert.equal(entries.at(-1).data.incremental.source,'workspace-report');
assert.equal(entries.at(-1).data.incremental.status,'failed');
fs.appendFileSync(file,'stale');
await commands.get('ship').handler('',ctx);
assert.equal(entries.at(-1).data.incremental.current,false);
result={status:'failed',reasons:['full failure']};
fs.writeFileSync(evidencePath,JSON.stringify({...evidence,status:'passed'}));
await commands.get('ship').handler('',ctx);
assert.equal(entries.at(-1).data.status,'failed','workspace report overrode full proof');
for(const invalid of ['{',JSON.stringify({...evidence,suites:[{name:'invalid\nname',status:'passed'}]}),'x'.repeat(65537)]) {
  fs.writeFileSync(evidencePath,invalid);
  assert.equal(await readIncrementalEvidence(root),undefined,'malformed incremental evidence accepted');
}
fs.unlinkSync(evidencePath);
fs.symlinkSync(outside,evidencePath,'junction');
assert.equal(await readIncrementalEvidence(root),undefined,'linked evidence accepted');
fs.unlinkSync(evidencePath);
if(process.platform !== 'win32') {
  execFileSync('mkfifo',[evidencePath]);
  const start=Date.now();
  assert.equal(await readIncrementalEvidence(root),undefined,'FIFO evidence accepted');
  assert.ok(Date.now()-start<3000,'FIFO evidence blocked receipt');
  fs.unlinkSync(evidencePath);
}
fs.writeFileSync(evidencePath,JSON.stringify(evidence));
assert.equal(await readIncrementalEvidence(root,AbortSignal.abort()),undefined,'cancelled evidence read continued');
delete process.env.NEURA;
registerCheckGate({on(){assert.fail('plain Pi registered a proof handler');},registerCommand(){assert.fail('plain Pi registered ship');}});
console.log('PASS proof: content changes, containment, bounded execution, and worktree-bound receipts');
