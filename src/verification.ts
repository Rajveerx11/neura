import { randomUUID } from 'node:crypto';
import { captureWorktree, runProof, proofRunnerArguments, PROOF_UV_VERSION, type ProofResult } from '../agent/neura/verification.ts';
import { runProofInSandbox } from '../agent/neura/human-away-sandbox.ts';
import { assertWorkspaceExecutionAllowed } from './work.ts';

export type WorkspaceReceipt = {
  schemaVersion: 1;
  id: string;
  scope: 'detector-only' | 'full';
  status: 'detector-only' | 'failed' | 'unavailable';
  verified: false;
  testsRun: false;
  fingerprintScope: 'tracked-and-nonignored-untracked';
  fingerprint: string | null;
  validAtCompletion: boolean;
  completedAt: string;
  engine: 'proof-of-work-agent@0.2.0';
  reason: 'detector_pass' | 'detector_fail' | 'runner_unavailable' | 'snapshot_unavailable' | 'candidate_changed' | 'full_evidence_unavailable' | 'approval_denied';
};

/** Operator-owned pinned command only. Audit files live in the sandbox's disposable /tmp. */
export async function runDetectorProof(workspace: string, signal?: AbortSignal, sandbox = runProofInSandbox): Promise<ProofResult> {
  signal?.throwIfAborted();
  assertWorkspaceExecutionAllowed(workspace);
  try {
    return await runProof(workspace, true, { signal, execute: async (file, args, execution) => {
      const expected = proofRunnerArguments(true);
      if (file !== 'uvx' || args.length !== expected.length || args.some((arg, i) => arg !== expected[i])) throw new Error('Unexpected proof command');
      const command = `test "$(uvx --version)" = "uvx ${PROOF_UV_VERSION}" && exec ${[file, ...args, '--db', '/tmp/neura-proof.db'].join(' ')}`;
      const result = await sandbox(execution.cwd, command, execution.timeoutMs, execution.signal);
      return { ok: result.code === 0, completed: result.completed ?? result.code === 0, stdout: result.stdout };
    } });
  } catch {
    signal?.throwIfAborted();
    return { status: 'unavailable', reasons: [] };
  }
}

const dependencies = { capture: captureWorktree, proof: runDetectorProof };
type Options = { signal?: AbortSignal; current: () => boolean; approve: (description: string) => Promise<boolean> };

/** Session-local metadata, not authenticated attestation or authority to deliver a task. */
export async function verifyWorkspace(workspace: string, scope: WorkspaceReceipt['scope'], options: Options, deps = dependencies): Promise<WorkspaceReceipt> {
  const fence = () => {
    options.signal?.throwIfAborted();
    if (!options.current()) throw new Error('Verification mode/session changed; result discarded.');
  };
  fence();
  if (!['detector-only', 'full'].includes(scope)) throw new Error('Unknown verification scope.');
  assertWorkspaceExecutionAllowed(workspace);
  const receipt: WorkspaceReceipt = {
    schemaVersion: 1, id: randomUUID(), scope, status: 'unavailable', verified: false, testsRun: false,
    fingerprintScope: 'tracked-and-nonignored-untracked',
    fingerprint: null, validAtCompletion: false, completedAt: '', engine: 'proof-of-work-agent@0.2.0', reason: 'snapshot_unavailable',
  };
  const finish = () => { fence(); return { ...receipt, completedAt: new Date().toISOString() }; };
  const before = await deps.capture(workspace, { signal: options.signal, requireRoot: true });
  fence();
  if (!before) return finish();
  receipt.fingerprint = before.fingerprint;
  if (scope === 'full') { receipt.reason = 'full_evidence_unavailable'; return finish(); }
  if (!await options.approve(`Run pinned Proof-of-Work 0.2.0 detector-only checks in the network-disabled WSL sandbox?\nCandidate: ${before.fingerprint}\nTests will not run. This cannot mark the task verified.`)) {
    receipt.reason = 'approval_denied'; return finish();
  }
  fence();
  const approved = await deps.capture(workspace, { signal: options.signal, requireRoot: true });
  fence();
  if (!approved || before.root !== approved.root || before.fingerprint !== approved.fingerprint) {
    receipt.reason = 'candidate_changed'; return finish();
  }
  const result = await deps.proof(workspace, options.signal);
  fence();
  const after = await deps.capture(workspace, { signal: options.signal, requireRoot: true });
  fence();
  if (!after || before.root !== after.root || before.fingerprint !== after.fingerprint) {
    receipt.reason = 'candidate_changed'; return finish();
  }
  receipt.validAtCompletion = result.status !== 'unavailable';
  receipt.status = result.status === 'passed' ? 'detector-only' : result.status;
  receipt.reason = ({ passed: 'detector_pass', failed: 'detector_fail', unavailable: 'runner_unavailable' } as const)[result.status];
  return finish();
}

export async function workspaceReceiptStatus(workspace: string, receipt: WorkspaceReceipt, signal?: AbortSignal) {
  signal?.throwIfAborted();
  assertWorkspaceExecutionAllowed(workspace);
  const current = await captureWorktree(workspace, { signal, requireRoot: true });
  signal?.throwIfAborted();
  return { ...receipt, verified: false as const, testsRun: false as const, current: receipt.validAtCompletion && current?.fingerprint === receipt.fingerprint };
}
