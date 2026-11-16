import { createHash, randomUUID } from 'node:crypto';
import { constants, renameSync, type Stats } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { COMMIT_ID } from '../agent/neura/verification.ts';
import { sessionDirectory } from './session.ts';
import { lockSession } from './session-lock.ts';
import { assertWorkspaceOutsideNeuraHome } from './work.ts';
import type { WorkspaceReceipt } from './verification.ts';

export const MAX_VERIFICATION_RECEIPT_BYTES = 4096;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fingerprint = /^[0-9a-f]{64}$/;
type Operation = { signal?: AbortSignal; current: () => boolean };

function fence(options: Operation) {
  options.signal?.throwIfAborted();
  if (!options.current()) throw new Error('Verification mode/session changed; result discarded.');
  options.signal?.throwIfAborted();
}

function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

/** Strict metadata only. Valid stored bytes still cannot establish authenticity or approval. */
function receiptMetadata(value: unknown): WorkspaceReceipt {
  if (!keys(value, ['schemaVersion', 'id', 'scope', 'status', 'verified', 'testsRun', 'fingerprintScope', 'fingerprint', 'baseCommit', 'validAtCompletion', 'completedAt', 'engine', 'reason'])) throw new Error('Invalid verification receipt metadata.');
  const data = value as WorkspaceReceipt;
  if (data.schemaVersion !== 1 || typeof data.id !== 'string' || !uuid.test(data.id)
    || !['detector-only', 'full'].includes(data.scope) || !['detector-only', 'failed', 'unavailable'].includes(data.status)
    || data.verified !== false || data.testsRun !== false || data.fingerprintScope !== 'tracked-and-nonignored-untracked'
    || !(data.fingerprint === null || typeof data.fingerprint === 'string' && fingerprint.test(data.fingerprint))
    || !(data.baseCommit === null || typeof data.baseCommit === 'string' && COMMIT_ID.test(data.baseCommit))
    || data.engine !== 'proof-of-work-agent@0.2.0' || typeof data.completedAt !== 'string'
    || !Number.isFinite(Date.parse(data.completedAt)) || new Date(data.completedAt).toISOString() !== data.completedAt
    || data.validAtCompletion !== (data.status !== 'unavailable')) throw new Error('Invalid verification receipt metadata.');
  if (data.status === 'unavailable') {
    if (!['runner_unavailable', 'snapshot_unavailable', 'candidate_changed', 'full_evidence_unavailable', 'approval_denied'].includes(data.reason)
      || (data.scope === 'full' && !['snapshot_unavailable', 'full_evidence_unavailable'].includes(data.reason))
      || (data.scope === 'detector-only' && data.reason === 'full_evidence_unavailable')) throw new Error('Invalid verification receipt outcome.');
  } else if (data.scope !== 'detector-only' || data.reason !== (data.status === 'detector-only' ? 'detector_pass' : 'detector_fail')) throw new Error('Invalid verification receipt outcome.');
  if (data.reason === 'snapshot_unavailable' ? data.fingerprint !== null || data.baseCommit !== null : data.fingerprint === null || data.baseCommit === null) throw new Error('Invalid verification receipt candidate.');
  return data;
}

async function location(directory: string, id: string, workspace: string, create: boolean) {
  if (typeof id !== 'string' || !uuid.test(id)) throw new Error('Invalid verification session id.');
  const sessions = await sessionDirectory(directory);
  const candidate = await realpath(workspace);
  assertWorkspaceOutsideNeuraHome(candidate, sessions);
  const workspaceKey = createHash('sha256').update(process.platform === 'win32' ? candidate.toLowerCase() : candidate).digest('hex');
  if (path.basename(sessions) !== workspaceKey) throw new Error('Verification receipt workspace directory mismatch.');
  const root = await sessionDirectory(path.join(sessions, 'verification'), create);
  return { root, workspaceKey, filename: path.join(root, `${id}.json`) };
}

function safeFile(stat: Stats) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_VERIFICATION_RECEIPT_BYTES) throw new Error('Unsafe verification receipt file.');
}

async function inspect(filename: string): Promise<Stats | undefined> {
  try { const stat = await lstat(filename); safeFile(stat); return stat; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function sameFile(before: Stats | undefined, after: Stats | undefined) {
  return before === undefined ? after === undefined : after !== undefined && before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

async function readMetadata(target: Awaited<ReturnType<typeof location>>, id: string) {
  const before = await inspect(target.filename);
  if (!before) return undefined;
  const file = await open(target.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await file.stat(); safeFile(stat);
    if (!sameFile(before, stat)) throw new Error('Verification receipt changed while reading.');
    const buffer = Buffer.alloc(MAX_VERIFICATION_RECEIPT_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size || bytesRead > MAX_VERIFICATION_RECEIPT_BYTES || !sameFile(stat, await file.stat())) throw new Error('Verification receipt changed while reading.');
    bytes = buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
  if (await sessionDirectory(target.root) !== target.root || !sameFile(before, await inspect(target.filename))) throw new Error('Verification receipt changed while reading.');
  let data: unknown;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid verification receipt JSON.'); }
  if (!keys(data, ['version', 'sessionId', 'workspaceKey', 'receipt']) || data.version !== 1 || data.sessionId !== id || data.workspaceKey !== target.workspaceKey) throw new Error('Verification receipt session/workspace mismatch.');
  return { receipt: receiptMetadata(data.receipt), stat: before };
}

/** Only the explicit private sessions directory is consulted; never discover workspace reports. */
export async function loadWorkspaceReceipt(directory: string, id: string, workspace: string, options: Operation): Promise<WorkspaceReceipt | undefined> {
  fence(options);
  let target: Awaited<ReturnType<typeof location>>;
  try { target = await location(directory, id, workspace, false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  fence(options);
  const release = await lockSession(target.root, id);
  try {
    const saved = await readMetadata(target, id);
    fence(options);
    return saved?.receipt;
  } finally { await release(); }
}

/** One bounded receipt per session. Crash locks fail closed; failed publication keeps the prior receipt. */
export async function saveWorkspaceReceipt(directory: string, id: string, workspace: string, receipt: WorkspaceReceipt, options: Operation, deps = { publish: renameSync }): Promise<void> {
  fence(options);
  const metadata = { ...receiptMetadata(receipt) };
  const target = await location(directory, id, workspace, true);
  fence(options);
  const bytes = JSON.stringify({ version: 1, sessionId: id, workspaceKey: target.workspaceKey, receipt: metadata });
  if (Buffer.byteLength(bytes) > MAX_VERIFICATION_RECEIPT_BYTES) throw new Error('Verification receipt exceeds metadata limits.');
  const release = await lockSession(target.root, id);
  const temporary = path.join(target.root, `.${id}.${randomUUID()}.tmp`);
  try {
    const before = (await readMetadata(target, id))?.stat;
    fence(options);
    const file = await open(temporary, 'wx', 0o600);
    let written: Stats;
    try { await file.writeFile(bytes); await file.sync(); written = await file.stat(); safeFile(written); }
    finally { await file.close(); }
    if (written.size !== Buffer.byteLength(bytes) || await sessionDirectory(target.root) !== target.root || !sameFile(before, await inspect(target.filename)) || !sameFile(written, await inspect(temporary))) throw new Error('Verification receipt changed before publication.');
    await release.assertOwned();
    // Synchronous rename keeps the final ownership/cancellation fence and publication in one event-loop turn.
    fence(options);
    deps.publish(temporary, target.filename);
  } finally {
    try { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
    finally { await release(); }
  }
}
