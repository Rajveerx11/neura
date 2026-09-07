import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readLearnProgress, writeLearnArtifact } from "../agent/neura/learn-store.ts";

if (process.argv[2] === "--first-writer") {
  await writeLearnArtifact(process.argv[3], "progress", JSON.stringify({ writer: Number(process.argv[4]) }));
  process.exit(0);
}

// Synthetic, deterministic filesystem interleavings. Patching a builtin schedules
// the directory replacement at a specific await boundary; real OS links, handles,
// identity checks and writes still run. Never run these patches concurrently.
const temporaryRoot = await fs.realpath(tmpdir());
const scratch = await fs.mkdtemp(path.join(temporaryRoot, "neura-learn-storage-"));
const original = { mkdir: fs.mkdir, open: fs.open, rename: fs.rename };
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
async function swapDirectory(value, directory = value.storage) {
  await fs.rename(directory, path.join(value.root, "original-storage"));
  await fs.symlink(value.outside, directory, linkType);
}
function restoreBuiltins() {
  fs.mkdir = original.mkdir;
  fs.open = original.open;
  fs.rename = original.rename;
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
  const concurrent = await fixture("concurrent-first-use");
  const writes = await Promise.all(Array.from({ length: 8 }, (_, writer) =>
    writeLearnArtifact(concurrent.workspace, "progress", JSON.stringify({ writer }))));
  assert.equal(new Set(writes).size, 8); checks++;
  for (const [writer, filename] of writes.entries()) {
    assert.deepEqual(await readLearnProgress(concurrent.workspace, path.basename(filename)), { writer });
  }
  checks++;

  const crossProcess = await fixture("cross-process-first-use");
  await Promise.all(Array.from({ length: 6 }, (_, writer) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--first-writer", crossProcess.workspace, String(writer)], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe"], timeout: 10_000,
      env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {},
    });
    let errorText = "";
    child.stderr.on("data", chunk => { errorText += String(chunk).slice(0, 2000 - errorText.length); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`First writer failed: ${errorText || code}`)));
  })));
  const published = (await fs.readdir(crossProcess.storage)).filter(name => name.startsWith("progress-"));
  assert.equal(published.length, 6); checks++;
  const writerIds = await Promise.all(published.map(async filename => (await readLearnProgress(crossProcess.workspace, filename)).writer));
  assert.deepEqual(writerIds.sort(), [0, 1, 2, 3, 4, 5]); checks++;

  const interrupted = await fixture("interrupted-initialization");
  fs.open = async (file, flags, ...args) => {
    const handle = await original.open(file, flags, ...args);
    if (flags === "wx" && path.basename(String(file)) === "owner") {
      // Simulate process interruption after exclusive creation, during its write.
      handle.writeFile = async () => { throw new Error("synthetic initialization interruption"); };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try { await assert.rejects(() => writeLearnArtifact(interrupted.workspace, "lesson", payload), /synthetic initialization interruption/); checks++; }
  finally { restoreBuiltins(); }
  await assert.rejects(() => fs.stat(interrupted.storage), { code: "ENOENT" }); checks++;
  const interruptedStages = (await fs.readdir(interrupted.workspace)).filter(name => name.startsWith(".neura-learning-init-"));
  assert.equal(interruptedStages.length, 1); checks++;
  assert.equal((await fs.readFile(path.join(interrupted.workspace, interruptedStages[0], "owner"))).length, 0); checks++;
  const retry = await writeLearnArtifact(interrupted.workspace, "lesson", payload);
  assert.equal(await fs.readFile(retry, "utf8"), payload); checks++;

  for (const contents of [[], ["unrelated.txt"]]) {
    const unowned = await fixture(`unowned-${contents.length}`);
    await fs.mkdir(unowned.storage);
    for (const name of contents) await fs.writeFile(path.join(unowned.storage, name), "synthetic unrelated data");
    await assert.rejects(() => writeLearnArtifact(unowned.workspace, "lesson", payload)); checks++;
    assert.deepEqual(await fs.readdir(unowned.storage), contents); checks++;
  }

  const appeared = await fixture("unowned-appeared-during-init");
  fs.open = async (file, flags, ...args) => {
    const handle = await original.open(file, flags, ...args);
    if (flags === "wx" && path.basename(String(file)) === "owner") {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (...writeArgs) => { await write(...writeArgs); await original.mkdir(appeared.storage); };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try { await assert.rejects(() => writeLearnArtifact(appeared.workspace, "lesson", payload)); checks++; }
  finally { restoreBuiltins(); }
  assert.deepEqual(await fs.readdir(appeared.storage), [], "Publication must not replace an unowned empty target on POSIX"); checks++;

  const renameFailure = await fixture("publication-io-failure");
  fs.rename = async () => { throw Object.assign(new Error("synthetic publication I/O failure"), { code: "EIO" }); };
  syncBuiltinESMExports();
  try { await assert.rejects(() => writeLearnArtifact(renameFailure.workspace, "lesson", payload), /synthetic publication I\/O failure/); checks++; }
  finally { restoreBuiltins(); }
  await assert.rejects(() => fs.stat(renameFailure.storage), { code: "ENOENT" }); checks++;
  assert.equal(await fs.readFile(await writeLearnArtifact(renameFailure.workspace, "lesson", payload), "utf8"), payload); checks++;

  const ordinary = await fixture("ordinary");
  const board = await writeLearnArtifact(ordinary.workspace, "lesson", payload);
  assert.equal(await fs.readFile(board, "utf8"), payload); checks++;
  const saved = await writeLearnArtifact(ordinary.workspace, "progress", JSON.stringify({ synthetic: true }));
  assert.deepEqual(await readLearnProgress(ordinary.workspace, path.basename(saved)), { synthetic: true }); checks++;

  const linkedAncestor = await fixture("linked-ancestor");
  const alias = path.join(linkedAncestor.root, "workspace-alias");
  await fs.symlink(linkedAncestor.root, alias, linkType);
  await rejectsMutation(() => writeLearnArtifact(path.join(alias, "workspace"), "lesson", payload));
  assert.deepEqual(await fs.readdir(linkedAncestor.workspace), []); checks++;
  await fs.unlink(alias);

  const staticLink = await fixture("static-link");
  await fs.symlink(staticLink.outside, staticLink.storage, linkType);
  await rejectsMutation(() => writeLearnArtifact(staticLink.workspace, "lesson", payload));
  assert.deepEqual(await fs.readdir(staticLink.outside), []); checks++;

  const mkdirSwap = await fixture("mkdir-swap");
  let swapped = false;
  fs.mkdir = async (directory, ...args) => {
    const result = await original.mkdir(directory, ...args);
    if (path.dirname(String(directory)) === mkdirSwap.workspace && path.basename(String(directory)).startsWith(".neura-learning-init-") && !swapped) {
      swapped = true; await swapDirectory(mkdirSwap, directory);
    }
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
      const directory = path.dirname(String(file));
      const ours = directory === beforeOpen.storage || (path.dirname(directory) === beforeOpen.workspace && path.basename(directory).startsWith(".neura-learning-init-"));
      if (flags === "wx" && ours && path.basename(String(file)).startsWith(target) && !swapped) {
        swapped = true;
        await swapDirectory(beforeOpen, directory);
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
  console.log(`Learn storage: ${checks} checks passed; concurrent/interrupted initialization, unowned targets, publication failures, links, open swaps, hardlinks and traversal.`);
} finally {
  restoreBuiltins();
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith("neura-learn-storage-")) throw new Error("Unexpected storage-test cleanup path.");
  await fs.rm(resolved, { recursive: true, force: true });
}
