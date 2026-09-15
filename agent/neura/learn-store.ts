import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { learnPathInside, readLearnRegular, realLearnDirectory, writeLearnExclusive } from "./learn-files.ts";

const DIRECTORY = ".neura-learning";
const MARKER = "neura-learning-v1\n";
export const MAX_LEARN_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const NAME = /^(?:lesson|progress)-[a-f0-9-]{36}\.(?:html|json)$/;

async function storage(workspace: string, create: boolean): Promise<string> {
  const root = await realLearnDirectory(path.resolve(workspace));
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
      // Node exposes no portable RENAME_NOREPLACE for directories. On POSIX,
      // rename can overwrite an unowned empty target created after our check;
      // Windows refuses an existing directory atomically. Keep first creation
      // on the supported host rather than weaken that ownership boundary.
      if (process.platform !== "win32") throw new Error("First-time Learn storage creation requires native Windows. Create and use the learning workspace with Neura on Windows; an existing complete store remains usable on this platform.");
      // Publish only a complete directory. Other first writers never observe
      // half-written ownership markers, and an interrupted attempt cannot poison
      // the final path. Unpublished stages contain metadata only; leave them
      // untouched rather than recursively deleting through a replaceable path.
      const staging = path.join(root, `${DIRECTORY}-init-${randomUUID()}`);
      await realLearnDirectory(root);
      await fs.mkdir(staging, { mode: 0o700 });
      await writeLearnExclusive(staging, ".gitignore", "*\n");
      await writeLearnExclusive(staging, "owner", MARKER);
      await realLearnDirectory(root);
      await realLearnDirectory(staging);
      try {
        // Reuse a target published meanwhile. Windows's native directory rename
        // also rejects any target that appears after this check, including an
        // unowned empty directory; the ownership check below still applies.
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
  const canonical = await realLearnDirectory(directory);
  if (!learnPathInside(root, canonical) || path.dirname(canonical) !== root) throw new Error("Learning storage escaped the workspace.");
  if (await readLearnRegular(path.join(canonical, "owner"), 64) !== MARKER) throw new Error("Existing learning directory is not owned by Neura.");
  if (await readLearnRegular(path.join(canonical, ".gitignore"), 64) !== "*\n") throw new Error("Learning storage Git exclusion was changed.");
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
  await writeLearnExclusive(directory, filename, content, limit);
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
  const text = await readLearnRegular(path.join(directory, filename), MAX_LEARN_SNAPSHOT_BYTES);
  await storage(workspace, false);
  try { return JSON.parse(text); } catch { throw new Error("Saved learning progress is not valid JSON."); }
}
