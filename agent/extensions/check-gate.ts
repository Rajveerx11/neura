// check-gate — Neura verifies its own work with proof-of-work (Rajveerx11/proof-of-work).
// Quick scan (--no-tests) after every turn that edited files; failures feed back to the
// agent once per user prompt. /ship runs the full check (real tests, signed log entry).
// Delete file to unwire.

import { execFile } from "node:child_process";
import * as path from "node:path";

const POW = ["--from", "proof-of-work-agent", "proof-of-work", "check", "--json", "--base", "HEAD"];

type Verdict = { passed: boolean; reasons: string[] };

function runPow(cwd: string, quick: boolean, timeoutMs: number): Promise<Verdict | null> {
  const args = quick ? [...POW, "--no-tests"] : POW;
  return new Promise((resolve) => {
    execFile("uvx", args, { cwd, timeout: timeoutMs, windowsHide: true }, (_err, stdout) => {
      try {
        const j = JSON.parse(stdout.trim());
        resolve({ passed: !!j.passed, reasons: j.reasons ?? [] });
      } catch {
        resolve(null); // uvx missing, not a git repo, no HEAD, bad JSON — fail soft, never block
      }
    });
  });
}

function isGitRepo(cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd, windowsHide: true }, (err) =>
      resolve(!err),
    );
  });
}

// fingerprint of the working tree vs HEAD — catches edits from ANY tool (edit, write, bash)
function treeState(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["status", "--porcelain"], { cwd, windowsHide: true }, (err, status) => {
      if (err) return resolve(null);
      execFile(
        "git",
        ["diff", "HEAD"],
        { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
        (err2, diff) => {
          if (err2) return resolve(null);
          const h = require("node:crypto").createHash("sha1");
          h.update(status).update(diff);
          resolve(h.digest("hex"));
        },
      );
    });
  });
}

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  let before: string | null = null; // worktree fingerprint at run start
  let fedBack = false;              // one auto-fix feedback per user prompt
  let checking = false;

  pi.on("input", (event) => {
    if (event.source === "interactive") fedBack = false;
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (before === null) before = await treeState(ctx.cwd);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    // print/JSON mode tears down before async handlers finish and never runs
    // follow-ups — the gate only makes sense in a live session
    if (!ctx.hasUI || checking) return;
    const after = await treeState(ctx.cwd);
    const changed = before !== null && after !== null && before !== after;
    before = null;
    if (!changed) return;
    if (!(await isGitRepo(ctx.cwd))) return;

    checking = true;
    try { ctx.ui.setStatus("neura-proof", "proof · quick"); } catch {}
    const v = await runPow(ctx.cwd, true, 90_000);
    checking = false;
    try { ctx.ui.setStatus("neura-proof", undefined); } catch {}
    if (!v) return;

    try {
      if (v.passed) {
        ctx.ui.notify("proof-of-work: quick check passed");
        return;
      }
      const reasons = v.reasons.join("\n");
      if (!fedBack) {
        fedBack = true; // ponytail: cap 1 auto-retry so a stubborn failure never loops
        pi.sendUserMessage(
          `proof-of-work verification failed on your changes:\n${reasons}\n` +
            `Fix the root cause. Do not delete or weaken tests to make this pass.`,
          { deliverAs: "followUp" },
        );
      } else {
        ctx.ui.notify(`proof-of-work still failing:\n${reasons}`, "warning");
      }
    } catch {} // session may have been replaced mid-check — never crash the harness
  });

  pi.registerCommand("ship", {
    description: "Full proof-of-work check: real test run, signed verdict in the audit log",
    handler: async (_args, ctx) => {
      if (!(await isGitRepo(ctx.cwd))) {
        ctx.ui.notify("not a git repo — nothing to verify", "warning");
        return;
      }
      ctx.ui.notify("running full proof-of-work check (tests + signed log)...");
      ctx.ui.setStatus("neura-proof", "proof · full");
      try {
        const v = await runPow(ctx.cwd, false, 600_000);
        if (!v) {
          ctx.ui.notify("proof-of-work did not produce a verdict (uvx installed? repo has HEAD?)", "warning");
        } else if (v.passed) {
          ctx.ui.notify(`SHIP: verified PASS — verdict signed into the audit log (${path.basename(ctx.cwd)})`);
        } else {
          pi.sendUserMessage(
            `Full proof-of-work check FAILED before ship:\n${v.reasons.join("\n")}\n` +
              `Fix the root cause. Do not delete or weaken tests to make this pass.`,
            { deliverAs: "followUp" },
          );
        }
      } catch {
        // session replaced during the long check — never crash
      } finally {
        try { ctx.ui.setStatus("neura-proof", undefined); } catch {}
      }
    },
  });
}
