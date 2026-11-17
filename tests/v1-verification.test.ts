import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, writeFile, link, readFile, readdir, copyFile, symlink, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { automaticGitEnvironment, AUTOMATIC_GIT_ARGUMENTS, resolveExecutable } from '../agent/neura/process-security.ts';
import { captureWorktree } from '../agent/neura/verification.ts';
import { runDetectorProof, verifyWorkspace, workspaceReceiptStatus } from '../src/verification.ts';
import { loadWorkspaceReceipt, saveWorkspaceReceipt, MAX_VERIFICATION_RECEIPT_BYTES } from '../src/verification-store.ts';
import { createSession, resumeSession, saveSession, taskRecovery, MAX_SESSION_BYTES } from '../src/session.ts';
import { lockSession } from '../src/session-lock.ts';
import { main } from '../src/cli.ts';

const exec = promisify(execFile);
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'neura-verification-')));
const originalHome = process.env.NEURA_HOME;
process.env.NEURA_HOME = path.join(scratch, 'private');
after(async () => {
  if (originalHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = originalHome;
  await rm(scratch, { recursive: true, force: true });
});

async function repository() {
  const root = await realpath(await mkdtemp(path.join(scratch, 'repo-')));
  const git = resolveExecutable('git', root);
  assert.ok(git, 'The verification tests require real Git');
  const run = (args: string[]) => exec(git, [...AUTOMATIC_GIT_ARGUMENTS, ...args], { cwd: root, env: automaticGitEnvironment(), timeout: 10000 });
  await run(['init', '--initial-branch=main']);
  await writeFile(path.join(root, 'sample.py'), 'print("synthetic")\n');
  await run(['add', 'sample.py']);
  await run(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'fixture']);
  return root;
}
const approved = { current: () => true, approve: async () => true };

test('manual verification binds detector-only receipts to real Git content and invalidates later changes', async () => {
  const root = await repository(); let calls = 0;
  const receipt = await verifyWorkspace(root, 'detector-only', approved, { capture: captureWorktree, proof: async () => { calls++; return { status: 'passed', reasons: ['synthetic-private-value'] }; } });
  assert.equal(calls, 1);
  assert.equal(receipt.status, 'detector-only');
  assert.equal(receipt.verified, false);
  assert.match(receipt.fingerprint!, /^[a-f0-9]{64}$/);
  assert.equal((await workspaceReceiptStatus(root, receipt)).current, true);
  assert.ok(!JSON.stringify(receipt).includes('synthetic-private-value'));
  await writeFile(path.join(root, 'new.py'), 'print("new candidate")\n');
  assert.equal((await workspaceReceiptStatus(root, receipt)).current, false);
  assert.equal(receipt.verified, false);
});

test('full verification remains unavailable and never executes a legacy runner or trusts workspace reports', async () => {
  const root = await repository(); let calls = 0;
  await mkdir(path.join(root, '.proofofwork'));
  await writeFile(path.join(root, '.proofofwork', 'neura-checks.json'), JSON.stringify({ status: 'passed', verified: true }));
  const result = await verifyWorkspace(root, 'full', { ...approved, approve: async () => { throw new Error('Full proof must not request legacy execution'); } }, { capture: captureWorktree, proof: async () => { calls++; return { status: 'passed', reasons: [] }; } });
  assert.equal(calls, 0);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'full_evidence_unavailable');
  assert.equal(result.verified, false);
});

test('denied approval and approval-time edits cannot dispatch proof', async () => {
  for (const mutate of [false, true]) {
    const root = await repository(); let calls = 0;
    const result = await verifyWorkspace(root, 'detector-only', { current: () => true, approve: async () => {
      if (mutate) await writeFile(path.join(root, 'sample.py'), 'changed during approval\n');
      return mutate;
    } }, { capture: captureWorktree, proof: async () => { calls++; return { status: 'passed', reasons: [] }; } });
    assert.equal(calls, 0);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, mutate ? 'candidate_changed' : 'approval_denied');
  }
});

test('proof-time candidate edits, runner failures and unavailable execution never become verified', async () => {
  for (const status of ['passed', 'failed', 'unavailable'] as const) {
    const root = await repository();
    const result = await verifyWorkspace(root, 'detector-only', approved, { capture: captureWorktree, proof: async () => {
      if (status === 'passed') await writeFile(path.join(root, 'sample.py'), 'changed during proof\n');
      return { status, reasons: ['synthetic-private-value'] };
    } });
    assert.equal(result.status, status === 'failed' ? 'failed' : 'unavailable');
    assert.equal(result.verified, false);
    assert.ok(!JSON.stringify(result).includes('synthetic-private-value'));
  }
});

test('cancellation and mode/session changes fence proof and prevent publishing a receipt', async () => {
  for (const duringProof of [false, true]) {
    const root = await repository(); const controller = new AbortController(); let current = true;
    const run = verifyWorkspace(root, 'detector-only', { signal: controller.signal, current: () => current, approve: async () => { if (!duringProof) controller.abort(); return true; } }, { capture: captureWorktree, proof: async () => { current = false; return { status: 'passed', reasons: [] }; } });
    if (duringProof) await assert.rejects(run, /mode\/session changed/);
    else await assert.rejects(run, { name: 'AbortError' });
  }
});

test('verification requires the exact repository root and refuses private or Neura runtime roots', async () => {
  const root = await repository(); const child = path.join(root, 'child'); await mkdir(child);
  assert.equal(await captureWorktree(child, { requireRoot: true }), null);
  assert.equal((await captureWorktree(child))?.root, root, 'Historical callers retain their existing root enumeration');
  const external = path.join(scratch, 'private-fixture.txt'); await writeFile(external, 'synthetic-private-value');
  await link(external, path.join(root, 'linked.txt'));
  assert.equal(await captureWorktree(root, { requireRoot: true }), null, 'Hardlinks cannot import bytes from outside the verification workspace');
  await rm(path.join(root, 'linked.txt'));
  const deps = { capture: captureWorktree, proof: async () => { throw new Error('Must not execute'); } };
  const nested = await verifyWorkspace(child, 'detector-only', approved, deps);
  assert.equal(nested.reason, 'snapshot_unavailable');
  const application = fileURLToPath(new URL('..', import.meta.url));
  await assert.rejects(verifyWorkspace(application, 'detector-only', approved, deps), /Neura itself/);
  await mkdir(process.env.NEURA_HOME!);
  await assert.rejects(verifyWorkspace(process.env.NEURA_HOME!, 'detector-only', approved, deps), /private Neura home/);
  await assert.rejects(runDetectorProof(process.env.NEURA_HOME!, 'a'.repeat(40), undefined, async () => { throw new Error('Must not dispatch'); }), /private Neura home/);
});

test('isolated PoW bridge uses exact pinned offline arguments and keeps audit files outside the candidate', async () => {
  const workspace = await repository();
  const base = (await captureWorktree(workspace))!.head;
  assert.match(base, /^[0-9a-f]{40}$/);
  for (const scenario of ['pass', 'fail', 'forged', 'partial', 'malformed', 'unavailable']) {
    let calls = 0;
    const result = await runDetectorProof(workspace, base, undefined, async (root, command, timeout) => {
      calls++;
      assert.equal(root, workspace);
      assert.ok(command.includes('uvx 0.12.11'));
      assert.ok(command.includes('--offline --no-config --no-index'));
      assert.ok(command.includes('proof-of-work-agent==0.2.0'));
      assert.ok(command.endsWith(`--base ${base} --no-tests --db /tmp/neura-proof.db`));
      assert.ok(!command.includes('--base HEAD'), 'a moving ref must never be the proof base');
      assert.equal(timeout, 90000);
      if (scenario === 'unavailable') throw new Error('synthetic-private-value');
      return { code: ['fail', 'forged'].includes(scenario) ? 1 : 0, completed: scenario !== 'partial', stdout: scenario === 'malformed' ? 'synthetic-private-value' : JSON.stringify({ passed: scenario !== 'fail', reasons: [] }), stderr: '' };
    });
    assert.equal(calls, 1);
    const expected = ({ pass: 'passed', fail: 'failed' } as Record<string, string>)[scenario] ?? 'unavailable';
    assert.equal(result.status, expected);
    assert.ok(!JSON.stringify(result).includes('synthetic-private-value'));
  }
});

test('the proof base is the task-start commit as a full id, and anything else is refused before dispatch', async () => {
  const root = await repository();
  const start = (await captureWorktree(root))!.head;
  const git = resolveExecutable('git', root)!;
  await writeFile(path.join(root, 'later.py'), 'print("committed mid-task")\n');
  for (const args of [['add', 'later.py'], ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'mid-task']]) {
    await exec(git, [...AUTOMATIC_GIT_ARGUMENTS, ...args], { cwd: root, env: automaticGitEnvironment(), timeout: 10000 });
  }
  const now = (await captureWorktree(root))!.head;
  assert.notEqual(now, start);
  const seen: string[] = [];
  const deps = { capture: captureWorktree, proof: async (_root: string, base: string) => { seen.push(base); return { status: 'passed' as const, reasons: [] }; } };
  const bound = await verifyWorkspace(root, 'detector-only', { ...approved, base: start }, deps);
  assert.equal(bound.baseCommit, start, 'a commit made during the task must stay inside the compared range');
  const unbound = await verifyWorkspace(root, 'detector-only', approved, deps);
  assert.equal(unbound.baseCommit, now, 'without a session baseline the base is still an explicit commit id');
  assert.deepEqual(seen, [start, now]);
  let dispatched = 0;
  for (const base of ['HEAD', 'main', start.slice(0, 12), start + '; touch /tmp/owned', start + ' --no-tests', '$(id)', '', [start], { toString: () => start }] as string[]) {
    await assert.rejects(verifyWorkspace(root, 'detector-only', { ...approved, base }, deps), /full commit id/);
    await assert.rejects(runDetectorProof(root, base, undefined, async () => { dispatched++; throw new Error('Must not dispatch'); }), /full commit id/);
  }
  assert.equal(dispatched, 0);
  assert.equal(seen.length, 2);
});

const operation = { current: () => true };
async function storedReceipt() {
  const workspace = await repository();
  const key = createHash('sha256').update(process.platform === 'win32' ? workspace.toLowerCase() : workspace).digest('hex');
  const directory = path.join(process.env.NEURA_HOME!, 'sessions', key);
  const session = await createSession(directory);
  const receipt = await verifyWorkspace(workspace, 'detector-only', approved, { capture: captureWorktree, proof: async () => ({ status: 'passed', reasons: ['synthetic-private-value'] }) });
  const root = path.join(directory, 'verification');
  const filename = path.join(root, `${session.id}.json`);
  return { workspace, directory, session, receipt, root, filename };
}

test('bounded private receipts survive fresh-process resume and recalculate current/stale without a provider', async () => {
  const f = await storedReceipt();
  assert.equal(await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), undefined);
  await assert.rejects(readdir(f.root), { code: 'ENOENT' });
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  const bytes = await readFile(f.filename, 'utf8');
  assert.ok(Buffer.byteLength(bytes) <= MAX_VERIFICATION_RECEIPT_BYTES);
  assert.ok(!bytes.includes('synthetic-private-value'));
  assert.ok(!bytes.includes(f.workspace), 'Only a workspace digest is stored');
  assert.ok(!(await readFile(path.join(f.directory, `${f.session.id}.json`), 'utf8')).includes(f.receipt.id), 'Receipts do not enter conversation history');
  const args = ['src/cli.ts', '--cwd', f.workspace, '--resume', f.session.id, '--provider', 'local', '--model', 'fixture', '--prompt', '/verify status'];
  const run = () => exec(process.execPath, args, { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000 });
  const fresh = await run();
  assert.match(fresh.stdout, /"current": true/);
  assert.match(fresh.stdout, /"verified": false/);
  assert.match(fresh.stdout, /"testsRun": false/);
  assert.ok(fresh.stdout.includes(f.receipt.id));
  await writeFile(path.join(f.workspace, 'sample.py'), 'print("edited after restart")\n');
  assert.match((await run()).stdout, /"current": false/);
  assert.equal(await readFile(f.filename, 'utf8'), bytes, 'Checking currency does not rewrite historical metadata');
  const next = await createSession(f.directory);
  assert.equal(await loadWorkspaceReceipt(f.directory, next.id, f.workspace, operation), undefined);
  const unavailable = await verifyWorkspace(f.workspace, 'full', approved);
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, unavailable, operation);
  assert.deepEqual(await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), unavailable);
  assert.equal((await workspaceReceiptStatus(f.workspace, unavailable)).current, false);
});

test('receipt storage refuses cross-workspace/session copies and workspace-authored reports', async () => {
  const a = await storedReceipt(); const b = await storedReceipt();
  await saveWorkspaceReceipt(a.directory, a.session.id, a.workspace, a.receipt, operation);
  await assert.rejects(loadWorkspaceReceipt(a.directory, a.session.id, b.workspace, operation), /workspace directory mismatch/);
  await assert.rejects(saveWorkspaceReceipt(a.directory, a.session.id, b.workspace, a.receipt, operation), /workspace directory mismatch/);
  const second = await createSession(a.directory);
  await copyFile(a.filename, path.join(a.root, `${second.id}.json`));
  await assert.rejects(loadWorkspaceReceipt(a.directory, second.id, a.workspace, operation), /session\/workspace mismatch/);
  await mkdir(b.root);
  await copyFile(a.filename, path.join(b.root, `${a.session.id}.json`));
  await assert.rejects(loadWorkspaceReceipt(b.directory, a.session.id, b.workspace, operation), /session\/workspace mismatch/);
  const authored = path.join(a.workspace, 'verification'); await mkdir(authored);
  await copyFile(a.filename, path.join(authored, `${a.session.id}.json`));
  await assert.rejects(loadWorkspaceReceipt(a.workspace, a.session.id, a.workspace, operation), /private Neura home/);
  for (const id of ['../receipt', 'HEAD', 'a'.repeat(36), [a.session.id]] as string[]) await assert.rejects(loadWorkspaceReceipt(a.directory, id, a.workspace, operation), /Invalid verification session id/);
  await assert.rejects(loadWorkspaceReceipt(path.join(scratch, '.pi', 'sessions'), a.session.id, a.workspace, operation), /outside .pi/);
});

test('malformed, oversized and contradictory receipt bytes fail closed on read and replacement', async () => {
  const f = await storedReceipt();
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  const original = await readFile(f.filename, 'utf8');
  const data = JSON.parse(original);
  const corrupt = [
    '', '{', 'synthetic-private-value', 'null', '[]', ' '.repeat(MAX_VERIFICATION_RECEIPT_BYTES + 1),
    JSON.stringify({ ...data, version: 2 }), JSON.stringify({ ...data, sessionId: randomUUID() }),
    JSON.stringify({ ...data, workspaceKey: '0'.repeat(64) }),
    ...[
      { verified: true }, { testsRun: true }, { scope: 'full' }, { status: 'passed' }, { validAtCompletion: false },
      { fingerprint: null }, { fingerprint: 'not-a-digest' }, { baseCommit: 'HEAD' }, { engine: 'proof-of-work-agent@0.3.0' },
      { completedAt: 'yesterday' }, { reason: 'approval_denied' }, { payload: 'synthetic-private-value' },
    ].map(change => JSON.stringify({ ...data, receipt: { ...data.receipt, ...change } })),
    JSON.stringify({ ...data, transcript: 'synthetic-private-value' }),
  ];
  for (const bytes of corrupt) {
    await writeFile(f.filename, bytes);
    await assert.rejects(loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), (error: Error) => !error.message.includes('synthetic-private-value'));
    await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation));
    assert.equal(await readFile(f.filename, 'utf8'), bytes);
  }
  await writeFile(f.filename, original);
  await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, { ...f.receipt, testsRun: true } as unknown as typeof f.receipt, operation), /Invalid verification receipt metadata/);
  assert.equal(await readFile(f.filename, 'utf8'), original);
});

test('failed, denied, changed and unavailable outcomes round-trip without promoting their evidence', async () => {
  const f = await storedReceipt();
  const capture = captureWorktree;
  const receipts = [
    await verifyWorkspace(f.workspace, 'detector-only', { ...approved, approve: async () => false }),
    await verifyWorkspace(f.workspace, 'detector-only', approved, { capture, proof: async () => ({ status: 'failed', reasons: [] }) }),
    await verifyWorkspace(f.workspace, 'detector-only', approved, { capture, proof: async () => ({ status: 'unavailable', reasons: [] }) }),
    await verifyWorkspace(f.workspace, 'detector-only', approved, { capture: async () => null, proof: async () => { throw new Error('Must not execute'); } }),
    await verifyWorkspace(f.workspace, 'full', approved),
    await verifyWorkspace(f.workspace, 'detector-only', approved, { capture, proof: async () => {
      await writeFile(path.join(f.workspace, 'sample.py'), 'print("changed during proof")\n');
      return { status: 'passed', reasons: [] };
    } }),
  ];
  for (const receipt of receipts) {
    await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, receipt, operation);
    assert.deepEqual(await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), receipt);
    assert.equal(receipt.verified, false); assert.equal(receipt.testsRun, false);
  }
});

test('publication snapshots validated metadata before awaiting filesystem work', async () => {
  const f = await storedReceipt();
  const pending = saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  Object.assign(f.receipt, { testsRun: true, payload: 'synthetic-private-value' });
  await pending;
  assert.equal((await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation))?.testsRun, false);
  assert.ok(!(await readFile(f.filename, 'utf8')).includes('synthetic-private-value'));
});

test('receipt hardlinks and linked directory ancestors cannot read or replace private metadata', async () => {
  const f = await storedReceipt();
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  const original = await readFile(f.filename, 'utf8');
  const linked = path.join(scratch, 'hardlinked-receipt.json');
  await link(f.filename, linked);
  await assert.rejects(loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), /Unsafe verification receipt file/);
  await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation), /Unsafe verification receipt file/);
  assert.equal(await readFile(linked, 'utf8'), original);
  await unlink(linked);
  const moved = path.join(f.directory, 'moved-receipts');
  await rename(f.root, moved);
  await symlink(moved, f.root, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), /Linked session directory denied/);
  await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation), /Linked session directory denied/);
  assert.equal(await readFile(path.join(moved, `${f.session.id}.json`), 'utf8'), original);
  await unlink(f.root);
});

test('receipt file symlinks are refused', async t => {
  const f = await storedReceipt();
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  const external = path.join(f.directory, 'symlink-target.json');
  await rename(f.filename, external);
  try { await symlink(external, f.filename, 'file'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('File symlink privilege unavailable; directory junction refusal covered separately.'); return; } throw error; }
  await assert.rejects(loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), /Unsafe verification receipt file/);
  await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation), /Unsafe verification receipt file/);
  assert.equal(JSON.parse(await readFile(external, 'utf8')).receipt.id, f.receipt.id);
});

test('single-writer locks, late cancellation/session replacement and publication failure preserve the prior receipt', async () => {
  const f = await storedReceipt();
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  const original = await readFile(f.filename, 'utf8');
  const next = { ...f.receipt, id: randomUUID() };
  const release = await lockSession(f.root, f.session.id);
  await assert.rejects(loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation), /Session is in use/);
  await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, next, operation), /Session is in use/);
  await release();
  for (const cancelled of [false, true]) {
    let checks = 0; const controller = new AbortController();
    await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, next, { signal: controller.signal, current: () => {
      checks++;
      if (cancelled && checks === 4) controller.abort();
      return checks < 4;
    } }));
    assert.equal(checks, 4, 'The last fence runs after writing and checking the temporary file');
    assert.equal(await readFile(f.filename, 'utf8'), original);
    assert.deepEqual(await readdir(f.root), [`${f.session.id}.json`]);
  }
  let publications = 0;
  await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, next, operation, { publish: () => { publications++; throw new Error('Synthetic publication failure'); } }), /Synthetic publication failure/);
  assert.equal(publications, 1);
  assert.equal(await readFile(f.filename, 'utf8'), original);
  assert.deepEqual(await readdir(f.root), [`${f.session.id}.json`]);
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, next, operation);
  assert.equal((await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation))?.id, next.id);
  assert.deepEqual(await readdir(f.root), [`${f.session.id}.json`]);
});

test('CLI cancellation/session replacement cannot publish into the old or new conversation', async () => {
  for (const replacement of [false, true]) {
    const f = await storedReceipt();
    await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
    const original = await readFile(f.filename, 'utf8'); const output: string[] = [];
    let controls: { execute: (text: string) => Promise<boolean>; cancel: () => void };
    await main(['--cwd', f.workspace, '--resume', f.session.id, '--provider', 'local', '--model', 'fixture'], {
      write: text => { output.push(text); },
      approve: async () => { if (replacement) await controls.execute('/new'); else controls.cancel(); return true; },
      serve: async session => {
        controls = session;
        await assert.rejects(session.execute('/verify quick'), replacement ? /mode\/session changed/ : { name: 'AbortError' });
        await session.execute('/verify status');
      },
    });
    assert.equal(await readFile(f.filename, 'utf8'), original);
    if (replacement) assert.match(output.join(''), /No verification receipt in this session/);
    else assert.ok(output.join('').includes(f.receipt.id));
  }
});

test('CLI quick/full commands publish only bounded unavailable metadata into their selected saved session', async () => {
  const f = await storedReceipt(); const output: string[] = [];
  await main(['--cwd', f.workspace, '--resume', f.session.id, '--provider', 'local', '--model', 'fixture'], {
    write: text => { output.push(text); }, approve: async () => false,
    serve: async session => {
      await session.execute('/verify quick');
      assert.equal((await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation))?.reason, 'approval_denied');
      await session.execute('/verify full');
      assert.equal((await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation))?.reason, 'full_evidence_unavailable');
      await session.execute('/verify status');
    },
  });
  assert.match(output.join(''), /"current": false/);
  assert.match(output.join(''), /"testsRun": false/);
  assert.deepEqual(await readdir(f.root), [`${f.session.id}.json`]);
});

test('--no-history verification never creates a private receipt or session directory', async () => {
  const workspace = await repository(); const home = path.join(scratch, 'no-history-home');
  await assert.rejects(exec(process.execPath, ['src/cli.ts', '--cwd', workspace, '--no-history', '--provider', 'local', '--model', 'fixture', '--prompt', '/verify full'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, NEURA_HOME: home }, timeout: 15000,
  }), (error: Error & { code?: number; stdout?: string }) => error.code === 1 && /full_evidence_unavailable/.test(error.stdout ?? '') && /"testsRun": false/.test(error.stdout ?? ''));
  await assert.rejects(readdir(home), { code: 'ENOENT' });
});

test('cancellation triggered inside the final currency callback cannot publish receipt bytes', async () => {
  const f = await storedReceipt();
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  const original = await readFile(f.filename, 'utf8');
  const controller = new AbortController(); let checks = 0;
  await assert.rejects(saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, { ...f.receipt, id: randomUUID() }, {
    signal: controller.signal, current: () => { if (++checks === 4) controller.abort(); return true; },
  }), { name: 'AbortError' });
  assert.equal(checks, 4);
  assert.equal(await readFile(f.filename, 'utf8'), original);
  assert.deepEqual(await readdir(f.root), [`${f.session.id}.json`]);
  const beforeCapture = new AbortController(); let captures = 0;
  await assert.rejects(verifyWorkspace(f.workspace, 'full', {
    signal: beforeCapture.signal, current: () => { beforeCapture.abort(); return true; }, approve: approved.approve,
  }, { capture: async () => { captures++; return null; }, proof: async () => { throw new Error('Must not dispatch'); } }), { name: 'AbortError' });
  assert.equal(captures, 0);
});

test('session metadata rejects coerced envelopes and unmatched malformed tool results', async () => {
  const f = await storedReceipt();
  const filename = path.join(f.directory, `${f.session.id}.json`);
  const malformed = [
    { ...f.session, createdAt: 1 }, { ...f.session, updatedAt: [f.session.updatedAt] },
    { ...f.session, createdAt: '2026-01-01' }, { ...f.session, authority: 'ignored-extra' },
    { ...f.session, messages: [{ role: 'tool', content: [{ type: 'tool-result' }] }] },
    { ...f.session, messages: [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'unknown' }] }] },
  ];
  for (const invalid of malformed) {
    await writeFile(filename, JSON.stringify(invalid));
    await assert.rejects(resumeSession(f.directory, f.session.id));
  }
  await writeFile(filename, JSON.stringify(f.session));
  const inherited = Object.assign(Object.create({ role: 'user' }), { content: 'synthetic' });
  await assert.rejects(saveSession(f.directory, { ...f.session, messages: [inherited] }));
  const messages = [
    { role: 'user', content: 'synthetic' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'one', toolName: 'read', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'one', toolName: 'read', output: { type: 'text', value: 'synthetic' } }] },
  ];
  await saveSession(f.directory, { ...f.session, messages });
  assert.deepEqual((await resumeSession(f.directory, f.session.id)).messages, messages);
  await writeFile(filename, ' '.repeat(MAX_SESSION_BYTES + 1));
  await assert.rejects(resumeSession(f.directory, f.session.id), /exceeds/);
});

test('session publication snapshots validated messages and recovery before awaiting filesystem work', async () => {
  const f = await storedReceipt();
  const baseline = (await captureWorktree(f.workspace))!;
  const recovery = taskRecovery(path.basename(f.directory), baseline);
  const draft = { ...f.session, messages: [{ role: 'user', content: 'original synthetic task' }], recovery };
  const pending = saveSession(f.directory, draft);
  draft.messages[0].content = 'changed after dispatch'; recovery.baseHead = 'HEAD'; baseline.files['forged.ts'] = 'raw payload';
  await pending;
  const saved = await resumeSession(f.directory, f.session.id);
  assert.equal(saved.messages[0].content, 'original synthetic task');
  assert.notEqual(saved.recovery?.baseHead, 'HEAD');
  assert.equal(saved.recovery?.baseline?.files['forged.ts'], undefined);
});

test('unsupported session hardlinks give recovery guidance and preserve existing history', async () => {
  const f = await storedReceipt();
  const source = `
    import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module'; import path from 'node:path';
    import { createSession, listSessions } from './src/session.ts';
    const directory = path.join(process.argv[1], 'unsupported-hardlinks');
    const previous = await createSession(directory);
    const previousPath = path.join(directory, previous.id + '.json');
    const previousBytes = await fs.readFile(previousPath, 'utf8');
    const link = fs.link;
    for (const code of ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EEXIST', 'EIO']) {
      const failure = Object.assign(new Error('Synthetic link failure'), { code });
      fs.link = async () => { throw failure; }; syncBuiltinESMExports();
      try {
        await assert.rejects(createSession(directory), error => {
          if (['EEXIST', 'EIO'].includes(code)) return error === failure;
          assert.match(error.message, /hardlink.*NEURA_HOME.*--no-history/i);
          assert.equal(error.cause, failure); return true;
        });
      } finally { fs.link = link; syncBuiltinESMExports(); }
      assert.deepEqual(await fs.readdir(directory), [previous.id + '.json']);
      assert.equal(await fs.readFile(previousPath, 'utf8'), previousBytes);
      assert.equal((await listSessions(directory)).length, 1);
    }
  `;
  await exec(process.execPath, ['--input-type=module', '-e', source, f.directory], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000,
  });
});

test('failed new-session cleanup rolls back only its own published link and preserves other sessions', async () => {
  const f = await storedReceipt();
  const source = `
    import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    import { createSession, listSessions } from './src/session.ts';
    const unlink = fs.unlink;
    for (const replace of [false, true]) {
      const directory = path.join(process.argv[1], replace ? 'replaced-cleanup' : 'owned-cleanup');
      const previous = await createSession(directory);
      const previousPath = path.join(directory, previous.id + '.json');
      const previousBytes = await fs.readFile(previousPath, 'utf8');
      let published; let replacement;
      fs.unlink = async filename => {
        if (String(filename).endsWith('.tmp')) {
          const id = path.basename(filename).slice(1, 37); published = path.join(directory, id + '.json');
          if (replace) {
            const session = JSON.parse(await fs.readFile(published, 'utf8'));
            session.messages = [{ role: 'user', content: 'synthetic human replacement' }];
            replacement = JSON.stringify(session);
            await unlink(published); await fs.writeFile(published, replacement);
          }
          throw Object.assign(new Error('Synthetic temporary-unlink failure'), { code: 'EPERM' });
        }
        return unlink(filename);
      }; syncBuiltinESMExports();
      try { await assert.rejects(createSession(directory), /Synthetic temporary-unlink failure/); }
      finally { fs.unlink = unlink; syncBuiltinESMExports(); }
      assert.equal(await fs.readFile(previousPath, 'utf8'), previousBytes);
      if (replace) assert.equal(await fs.readFile(published, 'utf8'), replacement);
      else await assert.rejects(fs.lstat(published), { code: 'ENOENT' });
      assert.equal((await listSessions(directory)).length, replace ? 2 : 1);
    }
  `;
  await exec(process.execPath, ['--input-type=module', '-e', source, f.directory], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000,
  });
});

test('partial session reads, truncated temporary writes, replacement and lost receipt leases fail without replacing prior bytes', async () => {
  const f = await storedReceipt();
  await saveWorkspaceReceipt(f.directory, f.session.id, f.workspace, f.receipt, operation);
  const source = `
    import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module'; import { randomUUID } from 'node:crypto';
    import { createSession, resumeSession, saveSession, listSessions } from './src/session.ts';
    import { loadWorkspaceReceipt, saveWorkspaceReceipt } from './src/verification-store.ts';
    const [directory, id, workspace] = process.argv.slice(1);
    const filename = path.join(directory, id + '.json'); const receiptFile = path.join(directory, 'verification', id + '.json');
    const original = await fs.readFile(filename, 'utf8'); const receiptBytes = await fs.readFile(receiptFile, 'utf8');
    const session = await resumeSession(directory, id); const options = { current: () => true };
    const receipt = await loadWorkspaceReceipt(directory, id, workspace, options); const open = fs.open;
    for (const method of ['writeFile', 'sync']) {
      const failedRoot = path.join(directory, 'failed-create-' + method);
      fs.open = async (...args) => {
        const file = await open(...args);
        if (String(args[0]).startsWith(failedRoot)) file[method] = async () => {
          if (method === 'writeFile') await file.write('{');
          throw new Error('Synthetic session ' + method + ' failure');
        };
        return file;
      }; syncBuiltinESMExports();
      try {
        await assert.rejects(createSession(failedRoot), /Synthetic session/);
        assert.deepEqual(await listSessions(failedRoot), []);
        assert.deepEqual(await fs.readdir(failedRoot), []);
      } finally { fs.open = open; syncBuiltinESMExports(); }
    }
    try {
      await fs.writeFile(filename, original + ' '.repeat(128));
      fs.open = async (...args) => {
        const file = await open(...args);
        if (args[0] === filename) {
          const read = file.read.bind(file);
          file.read = (buffer, offset, length, position) => read(buffer, offset, Buffer.byteLength(original), position);
        }
        return file;
      }; syncBuiltinESMExports();
      await assert.rejects(resumeSession(directory, id), /changed while reading/);
    } finally { fs.open = open; syncBuiltinESMExports(); await fs.writeFile(filename, original); }
    for (const mode of ['history-truncated', 'history-replaced', 'receipt-truncated', 'receipt-lock-lost']) {
      const target = mode.startsWith('history') ? filename : receiptFile;
      const before = await fs.readFile(target, 'utf8'); let injected = 0;
      fs.open = async (...args) => {
        const file = await open(...args);
        if (String(args[0]).endsWith('.tmp')) {
          const sync = file.sync.bind(file);
          file.sync = async () => {
            if (mode.endsWith('truncated')) await file.truncate(1);
            if (mode === 'history-replaced') { await fs.rename(filename, filename + '.retained'); await fs.writeFile(filename, original); }
            if (mode === 'receipt-lock-lost') await fs.writeFile(path.join(directory, 'verification', id + '.lock'), 'replacement-owner');
            injected++; await sync();
          };
        }
        return file;
      }; syncBuiltinESMExports();
      try {
        const save = mode.startsWith('history') ? saveSession(directory, { ...session, messages: [{ role: 'user', content: 'must not publish' }] })
          : saveWorkspaceReceipt(directory, id, workspace, { ...receipt, id: randomUUID() }, options);
        await assert.rejects(save, /changed/);
        assert.equal(injected, 1);
        assert.equal(await fs.readFile(target, 'utf8'), before);
        assert.ok(!(await fs.readdir(path.dirname(target))).some(name => name.endsWith('.tmp')));
        if (mode === 'receipt-lock-lost') assert.equal(await fs.readFile(path.join(directory, 'verification', id + '.lock'), 'utf8'), 'replacement-owner');
      } finally { fs.open = open; syncBuiltinESMExports(); }
    }
    assert.equal(await fs.readFile(receiptFile, 'utf8'), receiptBytes);
  `;
  await exec(process.execPath, ['--input-type=module', '-e', source, f.directory, f.session.id, f.workspace], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 15000,
  });
});

test('resumed verification keeps the original task base and uncertain recovery cannot replace its stored receipt', async () => {
  const f = await storedReceipt();
  const baseline = await captureWorktree(f.workspace); assert.ok(baseline);
  const recovery = { ...taskRecovery(path.basename(f.directory), baseline), stage: 'unfinished' as const };
  const saved = await saveSession(f.directory, { ...f.session, recovery });
  const git = resolveExecutable('git', f.workspace); assert.ok(git);
  await writeFile(path.join(f.workspace, 'sample.py'), 'print("committed during task")\n');
  await exec(git, [...AUTOMATIC_GIT_ARGUMENTS, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-am', 'task change'], {
    cwd: f.workspace, env: automaticGitEnvironment(), timeout: 10000,
  });
  let approvals = 0;
  const launch = (serve: NonNullable<Parameters<typeof main>[1]>['serve']) => main(['--cwd', f.workspace, '--resume', f.session.id, '--provider', 'local', '--model', 'fixture'], {
    write: () => {}, approve: async () => { approvals++; return true; }, serve,
  });
  await launch(async session => { await session.execute('/verify full'); await session.execute('/verify status'); });
  const receipt = await loadWorkspaceReceipt(f.directory, f.session.id, f.workspace, operation);
  assert.equal(receipt?.baseCommit, baseline.head);
  assert.equal(receipt?.reason, 'full_evidence_unavailable');
  assert.equal(receipt?.verified, false); assert.equal(receipt?.testsRun, false);
  const original = await readFile(f.filename, 'utf8');
  await saveSession(f.directory, { ...saved, recovery: { ...recovery, stage: 'reconcile' } });
  await launch(async session => {
    await assert.rejects(session.execute('/verify quick'), /reconciliation is missing/);
    await session.execute('/verify status');
  });
  assert.equal(approvals, 0);
  assert.equal(await readFile(f.filename, 'utf8'), original);
});
