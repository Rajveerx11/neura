import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sessionDirectory } from './session.ts';

/** CLI single-writer lease. Stale locks fail closed; never guess whether a crashed effect ran. */
export async function lockSession(directory: string, id: string): Promise<(() => Promise<void>) & { assertOwned: () => Promise<void> }> {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid session identity.');
  const canonical = await sessionDirectory(directory);
  const directoryStat = await fs.lstat(canonical);
  const filename = path.join(canonical, `${id}.lock`);
  const token = randomUUID();
  let handle;
  try { handle = await fs.open(filename, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Session is in use or has an unreconciled crash lock. Start a new session; do not replay an uncertain mutation.');
    throw error;
  }
  let acquired: Stats;
  try { await handle.writeFile(token); await handle.sync(); acquired = await handle.stat(); } finally { await handle.close(); }
  const sameFile = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
  const changed = () => new Error('Session lock changed; retained for manual reconciliation.');
  const assertOwned = async () => {
    if (await sessionDirectory(directory) !== canonical) throw changed();
    const root = await fs.lstat(canonical);
    if (root.dev !== directoryStat.dev || root.ino !== directoryStat.ino) throw changed();
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== Buffer.byteLength(token) || !sameFile(acquired, stat)) throw changed();
    const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.nlink !== 1 || !sameFile(stat, opened)) throw changed();
      const buffer = Buffer.alloc(Buffer.byteLength(token) + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== Buffer.byteLength(token) || buffer.subarray(0, bytesRead).toString('utf8') !== token || !sameFile(opened, await file.stat())) throw changed();
    } finally { await file.close(); }
    if (await sessionDirectory(directory) !== canonical || !sameFile(stat, await fs.lstat(filename))) throw changed();
  };
  await assertOwned();
  let released = false;
  return Object.assign(async () => {
    if (released) return;
    released = true;
    await assertOwned();
    await fs.unlink(filename);
  }, { assertOwned });
}
