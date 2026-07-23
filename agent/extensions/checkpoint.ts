// checkpoint — silent worktree snapshot before each agent run; /undo restores.
// Complements guardrail.ts (commands) and check-gate.ts (verification): bad EDITS
// are now recoverable. Git plumbing only — no stash entries, no worktree side effects.
// Delete file to unwire.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Snap = { tree: string; when: string; label: string };

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined },
      (err, stdout) => resolve(err ? null : stdout.trim()),
    );
  });
}

// snapshot = write the whole worktree (tracked + untracked, minus .gitignored —
// never --force: it would pull node_modules/build dirs into git objects) into a
// tree object via a throwaway index. Worktree and real index stay untouched.
async function snapshot(cwd: string): Promise<string | null> {
  if (!(await git(cwd, ["rev-parse", "--verify", "HEAD"]))) return null;
  const tmpIndex = path.join(os.tmpdir(), `neura-ckpt-${process.pid}-${Date.now()}`);
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    if ((await git(cwd, ["add", "-A", "."], env)) === null) return null;
    return await git(cwd, ["write-tree"], env);
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch {}
  }
}

// restore = overwrite worktree files from the snapshot tree.
// ponytail: files CREATED after the snapshot are left behind (deleting untracked
// files is how you lose real work) — surfaced in the /undo notice instead.
async function restore(cwd: string, tree: string): Promise<boolean> {
  const tmpIndex = path.join(os.tmpdir(), `neura-ckpt-${process.pid}-${Date.now()}`);
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    if ((await git(cwd, ["read-tree", tree], env)) === null) return false;
    return (await git(cwd, ["checkout-index", "-a", "-f"], env)) !== null;
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch {}
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
    const tree = await snapshot(ctx.cwd);
    if (!tree) return;
    if (snaps.length && snaps[snaps.length - 1].tree === tree) return; // nothing changed
    const when = new Date().toTimeString().slice(0, 5);
    snaps.push({ tree, when, label: lastPrompt || "(auto)" });
    if (snaps.length > 20) snaps.shift();
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
      const snap = snaps.pop();
      if (!snap) return void ctx.ui.notify("nothing to undo — no snapshot taken this session", "warning");

      // safety: snapshot the CURRENT state first so /undo itself is reversible
      const now = await snapshot(ctx.cwd);
      const ok = await restore(ctx.cwd, snap.tree);
      if (ok) {
        if (now && now !== snap.tree) snaps.push({ tree: now, when: new Date().toTimeString().slice(0, 5), label: "(state before /undo)" });
        ctx.ui.notify(`restored snapshot ${snap.when} "${snap.label}" — files created after it are left in place`);
      } else {
        snaps.push(snap); // restore failed, keep it available
        ctx.ui.notify("restore failed — snapshot kept, worktree untouched", "error");
      }
    },
  });
}
