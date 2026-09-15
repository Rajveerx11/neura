import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";

export function learnPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function realLearnDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Learning storage requires a real directory, not a link or junction.");
  const real = await fs.realpath(resolved);
  const compare = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (compare(resolved) !== compare(real)) throw new Error("Learning storage path contains a linked ancestor.");
  return real;
}

// Validate the opened file before writing any content, then write through that
// handle. A post-write path check alone cannot prevent disclosure through a swap.
export async function writeLearnExclusive(directory: string, filename: string, content: string, limit = Number.POSITIVE_INFINITY): Promise<void> {
  if (typeof filename !== "string" || !filename || filename === "." || filename === ".." || /[\\/:]/.test(filename) || path.basename(filename) !== filename) throw new Error("Learning destination must be one plain filename.");
  if (typeof content !== "string" || Buffer.byteLength(content) > limit) throw new Error("Learning artifact exceeds its size limit.");
  const canonicalDirectory = await realLearnDirectory(directory);
  const destination = path.join(canonicalDirectory, filename);
  const handle = await fs.open(destination, "wx", 0o600);
  try {
    await realLearnDirectory(canonicalDirectory);
    const canonical = await fs.realpath(destination);
    const stat = await fs.lstat(destination);
    const opened = await handle.stat();
    if (path.dirname(canonical) !== canonicalDirectory || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || opened.nlink !== 1 || stat.dev !== opened.dev || stat.ino !== opened.ino) {
      throw new Error("Learning destination changed while opening; content was not written.");
    }
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await realLearnDirectory(canonicalDirectory);
    const after = await fs.lstat(destination);
    const openedAfter = await handle.stat();
    if (after.isSymbolicLink() || !after.isFile() || after.nlink !== 1 || openedAfter.nlink !== 1 || after.dev !== openedAfter.dev || after.ino !== openedAfter.ino) {
      throw new Error("Learning destination changed while writing.");
    }
  } finally { await handle.close(); }
}

export async function readLearnRegular(file: string, limit: number): Promise<string> {
  const before = await fs.lstat(file);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || before.size > limit) {
    throw new Error("Learning file must be a bounded, unlinked regular file.");
  }
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size > limit || opened.nlink !== 1) {
      throw new Error("Learning file changed while opening.");
    }
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(bytes, count, bytes.length - count, count);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > limit) throw new Error("Learning file exceeds its size limit.");
    return bytes.subarray(0, count).toString("utf-8");
  } finally { await handle.close(); }
}
