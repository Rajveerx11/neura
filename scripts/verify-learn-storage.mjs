import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { readLearnProgress, writeLearnArtifact } from "../agent/neura/learn-store.ts";

// Synthetic, deterministic filesystem interleavings. Patching a builtin schedules
// the directory replacement at a specific await boundary; real OS links, handles,
// identity checks and writes still run. Never run these patches concurrently.
const scratch = await fs.mkdtemp(path.join(tmpdir(), "neura-learn-storage-"));
const original = { mkdir: fs.mkdir, open: fs.open };
const payload = "SYNTHETIC PRIVATE LESSON — must not reach the outside directory";
const linkType = process.platform === "win32" ? "junction" : "dir";
let checks = 0;

async function fixture(name) {
  const root = path.join(scratch, name);
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  await original.mkdir(workspace, { recursive: true });
  await original.mkdir(outside);
  return { root, workspace, outside, storage: path.join(workspace, ".neura-learning") };
}
async function swapDirectory(value) {
  await fs.rename(value.storage, path.join(value.root, "original-storage"));
  await fs.symlink(value.outside, value.storage, linkType);
}
function restoreBuiltins() {
  fs.mkdir = original.mkdir;
  fs.open = original.open;
  syncBuiltinESMExports();
}
async function emptyOutside(value) {
  for (const entry of await fs.readdir(value.outside)) {
    const bytes = await fs.readFile(path.join(value.outside, entry));
    assert.equal(bytes.length, 0, `Content leaked through ${entry}`);
  }
  checks++;
}
async function rejectsMutation(operation) {
  await assert.rejects(operation, /link|junction|changed|escaped/i);
  checks++;
}

try {
  const ordinary = await fixture("ordinary");
  const board = await writeLearnArtifact(ordinary.workspace, "lesson", payload);
  assert.equal(await fs.readFile(board, "utf8"), payload); checks++;
  const saved = await writeLearnArtifact(ordinary.workspace, "progress", JSON.stringify({ synthetic: true }));
  assert.deepEqual(await readLearnProgress(ordinary.workspace, path.basename(saved)), { synthetic: true }); checks++;

  const staticLink = await fixture("static-link");
  await fs.symlink(staticLink.outside, staticLink.storage, linkType);
  await rejectsMutation(() => writeLearnArtifact(staticLink.workspace, "lesson", payload));
  assert.deepEqual(await fs.readdir(staticLink.outside), []); checks++;

  const mkdirSwap = await fixture("mkdir-swap");
  let swapped = false;
  fs.mkdir = async (directory, ...args) => {
    const result = await original.mkdir(directory, ...args);
    if (directory === mkdirSwap.storage && !swapped) { swapped = true; await swapDirectory(mkdirSwap); }
    return result;
  };
  syncBuiltinESMExports();
  try { await rejectsMutation(() => writeLearnArtifact(mkdirSwap.workspace, "lesson", payload)); }
  finally { restoreBuiltins(); }
  assert.equal(swapped, true); checks++;
  assert.deepEqual(await fs.readdir(mkdirSwap.outside), [], "Markers must not be written before directory validation"); checks++;

  for (const target of [".gitignore", "owner", "lesson-", "progress-"]) {
    const beforeOpen = await fixture(`before-open-${target.replace(/\W/g, "")}`);
    swapped = false;
    fs.open = async (file, flags, ...args) => {
      if (flags === "wx" && path.dirname(String(file)) === beforeOpen.storage && path.basename(String(file)).startsWith(target) && !swapped) {
        swapped = true;
        await swapDirectory(beforeOpen);
      }
      return original.open(file, flags, ...args);
    };
    syncBuiltinESMExports();
    try { await rejectsMutation(() => writeLearnArtifact(beforeOpen.workspace, target === "progress-" ? "progress" : "lesson", payload)); }
    finally { restoreBuiltins(); }
    assert.equal(swapped, true, `Expected exclusive open for ${target}`); checks++;
    await emptyOutside(beforeOpen); // An exclusive empty file may exist, but no data may be written.
  }

  const afterOpen = await fixture("after-open");
  swapped = false;
  let blockedByOs = false;
  fs.open = async (file, flags, ...args) => {
    const handle = await original.open(file, flags, ...args);
    if (flags === "wx" && path.basename(String(file)).startsWith("lesson-") && !swapped) {
      swapped = true;
      try { await swapDirectory(afterOpen); }
      catch (error) {
        // Windows can refuse parent-directory rename while the file is open.
        if (process.platform === "win32" && ["EPERM", "EBUSY", "EACCES"].includes(error.code)) blockedByOs = true;
        else { await handle.close(); throw error; }
      }
    }
    return handle;
  };
  syncBuiltinESMExports();
  let afterOpenError, afterOpenBoard;
  try { afterOpenBoard = await writeLearnArtifact(afterOpen.workspace, "lesson", payload); }
  catch (error) { afterOpenError = error; }
  finally { restoreBuiltins(); }
  assert.equal(swapped, true); checks++;
  await emptyOutside(afterOpen);
  if (blockedByOs) {
    assert.equal(afterOpenError, undefined);
    assert.equal(await fs.readFile(afterOpenBoard, "utf8"), payload);
  } else {
    assert.match(String(afterOpenError?.message), /link|junction|changed|escaped/i);
    const originalFiles = await fs.readdir(path.join(afterOpen.root, "original-storage"));
    const emptyBoard = originalFiles.find(name => name.startsWith("lesson-"));
    assert.ok(emptyBoard); assert.equal((await fs.readFile(path.join(afterOpen.root, "original-storage", emptyBoard))).length, 0);
  }
  checks++;

  const hardlink = path.join(ordinary.storage, `progress-${"b".repeat(36)}.json`);
  await fs.link(saved, hardlink);
  await assert.rejects(() => readLearnProgress(ordinary.workspace, path.basename(saved)), /unlinked/); checks++;
  await fs.unlink(hardlink);
  await assert.rejects(() => readLearnProgress(ordinary.workspace, "../outside.json"), /filename/); checks++;
  console.log(`Learn storage: ${checks} checks passed; regular saves, links, mkdir/open swaps, no leaked content, hardlinks and traversal.`);
} finally {
  restoreBuiltins();
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("neura-learn-storage-")) throw new Error("Unexpected storage-test cleanup path.");
  await fs.rm(resolved, { recursive: true, force: true });
}
