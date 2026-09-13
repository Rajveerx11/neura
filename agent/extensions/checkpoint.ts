// checkpoint — silent worktree snapshot before each agent run; /undo restores.
// Complements guardrail.ts (commands) and check-gate.ts (verification): bad EDITS
// are now recoverable. Git plumbing only — no stash entries, no worktree side effects.
// Delete file to unwire.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addCockpitNotice, patchCockpit, removeCockpitNotice } from "../neura/cockpit-state.ts";
import { acquireHostOperation, getMode } from "../neura/mode-state.ts";
import { AUTOMATIC_GIT_ARGUMENTS, automaticGitEnvironment, resolveExecutable } from "../neura/process-security.ts";

type Snap = { tree: string; root: string; directory: string; files: { name: string; mode: number }[]; when: string; label: string };
const MAX_FILES = 50_000;
const MAX_BYTES = 64 * 1024 * 1024;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const executable = resolveExecutable("git", cwd);
    if (!executable) return resolve(null);
    execFile(
      executable,
      [...AUTOMATIC_GIT_ARGUMENTS, ...args],
      { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024, env: automaticGitEnvironment() },
      (err, stdout) => resolve(err ? null : stdout.trim()),
    );
  });
}

function removeSnapshot(snap: Snap | null): void {
  if (snap) try { fs.rmSync(snap.directory, { recursive: true, force: true }); } catch {}
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sourceFile(root: string, name: string): { path: string; stat: fs.Stats } | null {
  const parts = name.split("/");
  if (path.isAbsolute(name) || parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return null;
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) return null;
  }
  const canonical = fs.realpathSync(current);
  if (!inside(root, canonical)) return null;
  return { path: canonical, stat: fs.statSync(canonical) };
}

function replaceFile(source: string, target: string, mode: number): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.neura-restore-${process.pid}-${path.basename(target)}.tmp`);
  try {
    fs.copyFileSync(source, temporary);
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, target);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}

// Snapshot raw bytes outside Git's object database. Git only enumerates names;
// repository filters, attributes, hooks, and checkout helpers never process data.
export async function captureCheckpoint(cwd: string): Promise<Snap | null> {
  const release = acquireHostOperation();
  if (!release) return null;
  let snap: Snap | null = null;
  try {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    if (!top) return null;
    const root = fs.realpathSync(top);
    if (!await git(root, ["rev-parse", "--verify", "HEAD"])) return null;
    const listed = await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    if (listed === null) return null;
    const names = [...new Set(listed.split("\0").filter(Boolean))].sort();
    if (names.length > MAX_FILES) return null;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neura-ckpt-"));
    snap = { tree: "", root, directory, files: [], when: "", label: "" };
    const hash = createHash("sha256");
    let bytes = 0;
    for (const name of names) {
      let source: ReturnType<typeof sourceFile>;
      try { source = sourceFile(root, name); }
      catch (error: any) { if (error?.code === "ENOENT") continue; throw error; }
      if (!source) return null;
      if (bytes + source.stat.size > MAX_BYTES) return null;
      const descriptor = fs.openSync(source.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.dev !== source.stat.dev || opened.ino !== source.stat.ino) return null;
        const content = fs.readFileSync(descriptor);
        bytes += content.length;
        const after = fs.fstatSync(descriptor);
        if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || fs.realpathSync(source.path) !== source.path) return null;
        const destination = path.join(directory, ...name.split("/"));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content, { mode: opened.mode & 0o777 });
        snap.files.push({ name, mode: opened.mode & 0o777 });
        hash.update(name).update("\0").update(String(opened.mode & 0o111)).update("\0").update(content);
      } finally { fs.closeSync(descriptor); }
    }
    snap.tree = hash.digest("hex");
    return snap;
  } catch { return null; }
  finally {
    if (snap && !snap.tree) removeSnapshot(snap);
    release();
  }
}

// Restore only paths present in the snapshot. Files created later remain.
// ponytail: files CREATED after the snapshot are left behind (deleting untracked
// files is how you lose real work) — surfaced in the /undo notice instead.
export async function restoreCheckpoint(cwd: string, snap: Snap,
  options: { beforeWrite?: (name: string, index: number) => void } = {}): Promise<boolean> {
  const release = acquireHostOperation();
  if (!release) return false;
  let rollbackDirectory: string | null = null;
  try {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    if (!top || fs.realpathSync(top) !== snap.root) return false;
    const entries = snap.files.map((file) => {
      const source = path.join(snap.directory, ...file.name.split("/"));
      if (!fs.lstatSync(source).isFile() || !inside(snap.directory, fs.realpathSync(source))) return false;
      const target = path.resolve(snap.root, ...file.name.split("/"));
      if (!inside(snap.root, target)) return false;
      let current = snap.root;
      for (const part of file.name.split("/").slice(0, -1)) {
        current = path.join(current, part);
        if (fs.existsSync(current) && (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink())) return false;
      }
      if (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())) return false;
      return { file, source, target, existed: fs.existsSync(target), mode: fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0 };
    });
    if (entries.some((entry) => entry === false)) return false;
    const valid = entries as { file: Snap["files"][number]; source: string; target: string; existed: boolean; mode: number }[];
    rollbackDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "neura-rollback-"));
    for (const entry of valid) {
      if (!entry.existed) continue;
      const backup = path.join(rollbackDirectory, ...entry.file.name.split("/"));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(entry.target, backup);
    }
    try {
      valid.forEach((entry, index) => {
        options.beforeWrite?.(entry.file.name, index);
        replaceFile(entry.source, entry.target, entry.file.mode);
      });
      return true;
    } catch {
      let rolledBack = true;
      for (const entry of [...valid].reverse()) {
        try {
          if (entry.existed) replaceFile(path.join(rollbackDirectory, ...entry.file.name.split("/")), entry.target, entry.mode);
          else if (fs.existsSync(entry.target)) fs.unlinkSync(entry.target);
        } catch { rolledBack = false; }
      }
      if (!rolledBack) throw new Error("Checkpoint rollback failed.");
      return false;
    }
  } catch { return false; }
  finally {
    if (rollbackDirectory) try { fs.rmSync(rollbackDirectory, { recursive: true, force: true }); } catch {}
    release();
  }
}

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  const snaps: Snap[] = []; // newest last; in-memory (ponytail: restarts start fresh)
  let lastPrompt = "";

  pi.on("input", (event) => {
    if (event.source === "interactive" && typeof event.text === "string") {
      lastPrompt = event.text.slice(0, 40);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (getMode() !== "yolo") return;
    try { if (ctx.hasUI) ctx.ui.setStatus("neura-checkpoint", "checkpoint"); } catch {}
    patchCockpit({ checkpoint: "capturing", operation: { verb: "checkpoint", target: "capturing worktree", startedAt: Date.now() } });
    try {
      const snap = await captureCheckpoint(ctx.cwd);
      if (!snap) {
        patchCockpit({ checkpoint: "failed" });
        addCockpitNotice({ id: "checkpoint", message: "Checkpoint unavailable", detail: "No Git snapshot was created; work can continue.", tone: "warning", persistent: true });
        return;
      }
      if (snaps.length && snaps[snaps.length - 1].tree === snap.tree) {
        removeSnapshot(snap);
        patchCockpit({ checkpoint: "ready" });
        removeCockpitNotice("checkpoint");
        return;
      }
      const when = new Date().toTimeString().slice(0, 5);
      snap.when = when;
      snap.label = lastPrompt || "(auto)";
      snaps.push(snap);
      if (snaps.length > 20) removeSnapshot(snaps.shift() ?? null);
      patchCockpit({ checkpoint: "ready" });
      removeCockpitNotice("checkpoint");
    } finally {
      try { if (ctx.hasUI) ctx.ui.setStatus("neura-checkpoint", undefined); } catch {}
      patchCockpit({ operation: undefined });
    }
  });

  pi.registerCommand("undo", {
    description: "Restore the worktree snapshot taken before the last agent run (`/undo list` to inspect)",
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim();
      if (arg === "list") {
        if (!snaps.length) return void ctx.ui.notify("no snapshots this session");
        const lines = snaps.map((s, i) => `${i === snaps.length - 1 ? "▸" : " "} ${s.when}  ${s.label}`).reverse();
        ctx.ui.notify(`snapshots (newest first):\n${lines.join("\n")}`);
        return;
      }
      if (getMode() !== "yolo") return void ctx.ui.notify("/undo requires YOLO; current mode does not permit worktree changes.", "warning");
      const snap = snaps.pop();
      if (!snap) return void ctx.ui.notify("nothing to undo · no snapshot taken this session", "warning");

      // safety: snapshot the CURRENT state first so /undo itself is reversible
      patchCockpit({ phase: "RECOVERY", checkpoint: "restoring", operation: { verb: "restore", target: `snapshot ${snap.when}`, startedAt: Date.now() } });
      const now = await captureCheckpoint(ctx.cwd);
      const ok = await restoreCheckpoint(ctx.cwd, snap);
      if (ok) {
        removeSnapshot(snap);
        if (now && now.tree !== snap.tree) {
          now.when = new Date().toTimeString().slice(0, 5);
          now.label = "(state before /undo)";
          snaps.push(now);
        } else removeSnapshot(now);
        patchCockpit({ phase: "RECOVERY", checkpoint: "restored", operation: undefined });
        removeCockpitNotice("checkpoint");
        ctx.ui.notify(`restored snapshot ${snap.when} "${snap.label}" · files created after it are left in place`);
      } else {
        const after = await captureCheckpoint(ctx.cwd);
        const unchanged = !!now && !!after && now.tree === after.tree;
        removeSnapshot(after);
        removeSnapshot(now);
        snaps.push(snap); // restore failed, keep it available
        patchCockpit({ phase: "RECOVERY", checkpoint: "failed", operation: undefined });
        const detail = unchanged ? "Rollback restored the pre-undo state; snapshot remains available."
          : "Pre-undo state could not be confirmed; inspect the worktree before continuing.";
        addCockpitNotice({ id: "checkpoint", message: "Snapshot restore failed", detail, tone: "error", persistent: true });
        ctx.ui.notify(`restore failed · ${detail.toLowerCase()}`, "error");
      }
    },
  });

  pi.on("session_shutdown", () => {
    for (const snap of snaps.splice(0)) removeSnapshot(snap);
  });
}
