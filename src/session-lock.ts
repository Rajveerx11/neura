import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** CLI single-writer lease. Stale locks fail closed; never guess whether a crashed effect ran. */
export async function lockSession(directory: string, id: string): Promise<() => Promise<void>> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid session identity.');
  const canonical = await fs.realpath(directory);
  if (canonical.toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error('Linked session directory denied.');
  const filename = path.join(canonical, `${id}.lock`);
  const token = randomUUID();
  let handle;
  try { handle = await fs.open(filename, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Session is in use or has an unreconciled crash lock. Start a new session; do not replay an uncertain mutation.');
    throw error;
  }
  try { await handle.writeFile(token); await handle.sync(); } finally { await handle.close(); }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== token.length || await fs.realpath(directory) !== canonical || await fs.readFile(filename, 'utf8') !== token) throw new Error('Session lock changed; retained for manual reconciliation.');
    await fs.unlink(filename);
  };
}
