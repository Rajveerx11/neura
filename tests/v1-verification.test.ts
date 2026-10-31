import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, writeFile, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { automaticGitEnvironment, AUTOMATIC_GIT_ARGUMENTS, resolveExecutable } from '../agent/neura/process-security.ts';
import { captureWorktree } from '../agent/neura/verification.ts';
import { runDetectorProof, verifyWorkspace, workspaceReceiptStatus } from '../src/verification.ts';

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
  await assert.rejects(runDetectorProof(process.env.NEURA_HOME!, undefined, async () => { throw new Error('Must not dispatch'); }), /private Neura home/);
});

test('isolated PoW bridge uses exact pinned offline arguments and keeps audit files outside the candidate', async () => {
  const workspace = await repository();
  for (const scenario of ['pass', 'fail', 'forged', 'partial', 'malformed', 'unavailable']) {
    let calls = 0;
    const result = await runDetectorProof(workspace, undefined, async (root, command, timeout) => {
      calls++;
      assert.equal(root, workspace);
      assert.ok(command.includes('uvx 0.12.11'));
      assert.ok(command.includes('--offline --no-config --no-index'));
      assert.ok(command.includes('proof-of-work-agent==0.2.0'));
      assert.ok(command.endsWith('--no-tests --db /tmp/neura-proof.db'));
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
