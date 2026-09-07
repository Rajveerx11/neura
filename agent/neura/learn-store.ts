import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const DIRECTORY = ".neura-learning";
const MARKER = "neura-learning-v1\n";
export const MAX_LEARN_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const NAME = /^(?:lesson|progress)-[a-f0-9-]{36}\.(?:html|json)$/;

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function realDirectory(directory: string): Promise<string> {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Learning storage requires a real directory, not a link or junction.");
  const real = await fs.realpath(directory);
  const compare = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (compare(path.resolve(directory)) !== compare(real)) throw new Error("Learning storage path contains a linked ancestor.");
  return real;
}

// Validate the opened file before writing any content, then write through that
// handle. A post-write path check alone cannot prevent disclosure through a swap.
async function writeExclusive(directory: string, filename: string, content: string): Promise<void> {
  await realDirectory(directory);
  const destination = path.join(directory, filename);
  const handle = await fs.open(destination, "wx", 0o600);
  try {
    await realDirectory(directory);
    const canonical = await fs.realpath(destination);
    const stat = await fs.lstat(destination);
    const opened = await handle.stat();
    if (path.dirname(canonical) !== directory || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || opened.nlink !== 1 || stat.dev !== opened.dev || stat.ino !== opened.ino) {
      throw new Error("Learning destination changed while opening; content was not written.");
    }
    await handle.writeFile(content, "utf-8");
  } finally { await handle.close(); }
}

async function readRegular(file: string, limit: number): Promise<string> {
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

async function storage(workspace: string, create: boolean): Promise<string> {
  const root = await realDirectory(path.resolve(workspace));
  const directory = path.join(root, DIRECTORY);
  if (create) {
    let exists = true;
    try {
      await fs.lstat(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      exists = false;
    }
    if (!exists) {
      // Publish only a complete directory. Other first writers never observe
      // half-written ownership markers, and an interrupted attempt cannot poison
      // the final path. Unpublished stages contain metadata only; leave them
      // untouched rather than recursively deleting through a replaceable path.
      const staging = path.join(root, `${DIRECTORY}-init-${randomUUID()}`);
      await realDirectory(root);
      await fs.mkdir(staging, { mode: 0o700 });
      await writeExclusive(staging, ".gitignore", "*\n");
      await writeExclusive(staging, "owner", MARKER);
      await realDirectory(root);
      await realDirectory(staging);
      try {
        // Preserve any target created meanwhile, including unowned empty dirs
        // that POSIX rename would otherwise replace. Cooperating publishers
        // always publish a nonempty directory, so only one rename can win.
        await fs.lstat(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try { await fs.rename(staging, directory); }
        catch (renameError) {
          if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes((renameError as NodeJS.ErrnoException).code ?? "")) throw renameError;
          // If a concurrent writer won, normal validation below checks its
          // directory and both markers. Otherwise retain the real rename error.
          try { await fs.lstat(directory); } catch { throw renameError; }
        }
      }
    }
  }
  const canonical = await realDirectory(directory);
  if (!inside(root, canonical) || path.dirname(canonical) !== root) throw new Error("Learning storage escaped the workspace.");
  if (await readRegular(path.join(canonical, "owner"), 64) !== MARKER) throw new Error("Existing learning directory is not owned by Neura.");
  if (await readRegular(path.join(canonical, ".gitignore"), 64) !== "*\n") throw new Error("Learning storage Git exclusion was changed.");
  return canonical;
}

export async function writeLearnArtifact(workspace: string, kind: "lesson" | "progress", content: string): Promise<string> {
  const limit = kind === "lesson" ? MAX_ARTIFACT_BYTES : MAX_LEARN_SNAPSHOT_BYTES;
  if (typeof content !== "string" || Buffer.byteLength(content) > limit) throw new Error("Learning artifact exceeds its size limit.");
  if (kind !== "lesson" && kind !== "progress") throw new Error("Unsupported learning artifact kind.");
  const directory = await storage(workspace, true);
  const filename = `${kind}-${randomUUID()}.${kind === "lesson" ? "html" : "json"}`;
  const destination = path.join(directory, filename);
  await storage(workspace, false);
  await writeExclusive(directory, filename, content);
  await storage(workspace, false);
  return destination;
}

export async function listLearnProgress(workspace: string): Promise<string[]> {
  let directory: string;
  try { directory = await storage(workspace, false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && NAME.test(entry.name) && entry.name.startsWith("progress-") && entry.name.endsWith(".json"));
  if (candidates.length > 10_000) throw new Error("Too many saved learning files; archive older snapshots before listing.");
  const dated = await Promise.all(candidates.map(async (entry) => ({ name: entry.name, modified: (await fs.lstat(path.join(directory, entry.name))).mtimeMs })));
  return dated.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name)).slice(0, 100).map((entry) => entry.name);
}

export async function readLearnProgress(workspace: string, filename: string): Promise<unknown> {
  if (typeof filename !== "string" || !NAME.test(filename) || !filename.startsWith("progress-") || !filename.endsWith(".json")) {
    throw new Error("Resume requires a progress filename from /learn saved.");
  }
  const directory = await storage(workspace, false);
  const text = await readRegular(path.join(directory, filename), MAX_LEARN_SNAPSHOT_BYTES);
  await storage(workspace, false);
  try { return JSON.parse(text); } catch { throw new Error("Saved learning progress is not valid JSON."); }
}
