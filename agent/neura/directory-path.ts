import { lstat } from 'node:fs/promises';
import path from 'node:path';

/** Check actual directory components, not equivalent spellings such as Windows 8.3 names. */
export async function assertUnlinkedDirectoryAncestors(directory: string, message: string): Promise<void> {
  for (let current = path.resolve(directory);; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(message);
    if (path.dirname(current) === current) return;
  }
}
