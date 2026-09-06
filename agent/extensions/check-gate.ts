// Quick verification follows changed bytes; /ship always obtains a fresh full verdict.
import { addCockpitNotice, patchCockpit, removeCockpitNotice } from "../neura/cockpit-state.ts";
import { captureWorktree, changedFiles, makeReceipt, readIncrementalEvidence, runProof } from "../neura/verification.ts";
import type { TreeSnapshot, VerificationReceipt } from "../neura/verification.ts";

export function registerCheckGate(pi, dependencies = { captureWorktree, runProof }) {
  if (!process.env.NEURA) return;
  let before: TreeSnapshot | null = null;
  let quick: { root: string; receipt: VerificationReceipt } | undefined;
  let fedBack = false;
  let running: AbortController | undefined;
  let generation = 0;

  const reset = () => {
    generation++;
    running?.abort();
    running = undefined;
    before = null;
    quick = undefined;
    fedBack = false;
  };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);
  pi.on("input", event => { if (event.source === "interactive") fedBack = false; });
  pi.on("agent_start", async (_event, ctx) => {
    const owner = generation;
    const snapshot = await dependencies.captureWorktree(ctx.cwd);
    if (owner === generation) before = snapshot;
  });

  async function check(scope: "quick" | "full", snapshot: TreeSnapshot, changes: string[], ctx) {
    if (running) {
      if (scope === "full") ctx.ui.notify("Verification already running. Retry /ship after it finishes.", "warning");
      return;
    }
    const controller = new AbortController();
    running = controller;
    const owner = generation;
    const signal = ctx.signal ? AbortSignal.any([controller.signal, ctx.signal]) : controller.signal;
    patchCockpit({ phase: "VERIFY", operation: { verb: "proof", target: `${scope} worktree check`, startedAt: Date.now() },
      proof: { scope, status: "running" } });
    try {
      try { ctx.ui.setStatus("neura-proof", `proof · ${scope}`); } catch {}
      const result = await dependencies.runProof(snapshot.root, scope === "quick", { signal });
      const after = signal.aborted ? null : await dependencies.captureWorktree(snapshot.root, { signal });
      if (owner !== generation) return;
      const previous = scope === "full" && quick?.root === snapshot.root ? quick.receipt : undefined;
      const incremental = scope === "full" ? await readIncrementalEvidence(snapshot.root, signal) : undefined;
      if (owner !== generation) return;
      const receipt = makeReceipt(scope, snapshot, after, result, changes, previous, incremental);
      pi.appendEntry("neura-verification", receipt);
      if (scope === "quick") quick = { root: snapshot.root, receipt };
      const detail = receipt.status === "unavailable"
        ? "Verification unavailable or workspace changed during the check. Run /ship again."
        : result.reasons[0] || "Review /ship evidence.";
      patchCockpit({ phase: receipt.status === "passed" ? "COMPLETE" : receipt.status === "unavailable" ? "DEGRADED" : "VERIFY",
        proof: { scope, status: receipt.status, ...(receipt.status === "passed" ? {} : { detail }) },
        degraded: receipt.status === "unavailable" ? detail : undefined });
      if (receipt.status === "passed") {
        removeCockpitNotice("proof");
        if (scope === "full") ctx.ui.notify(`SHIP: verified PASS · full receipt recorded${previous ? ` · quick evidence ${receipt.quick!.current ? "current" : "stale (not reused)"}` : ""}${incremental ? ` · incremental report ${receipt.incremental!.current ? "current" : "stale"}` : ""}`);
        return;
      }
      addCockpitNotice({ id: "proof", message: `Proof ${receipt.status}`, detail,
        tone: receipt.status === "failed" ? "error" : "warning", persistent: true });
      if (receipt.status === "failed" && (scope === "full" || !fedBack)) {
        fedBack = true;
        pi.sendUserMessage(`proof-of-work verification failed on your changes:\n${result.reasons.join("\n")}\nFix the root cause. Do not delete or weaken tests to make this pass.`, { deliverAs: "followUp" });
      } else ctx.ui.notify(detail, "warning");
    } catch {
      if (owner === generation) {
        patchCockpit({ phase: "DEGRADED", proof: { scope, status: "unavailable" }, degraded: "Verification failed to complete." });
        try { ctx.ui.notify("Verification failed to complete. Run /ship again.", "warning"); } catch {}
      }
    } finally {
      if (owner === generation) {
        running = undefined;
        patchCockpit({ operation: undefined });
        try { ctx.ui.setStatus("neura-proof", undefined); } catch {}
      }
    }
  }

  pi.on("agent_settled", async (_event, ctx) => {
    if (!ctx.hasUI || running) return;
    const owner = generation;
    const start = before;
    before = null;
    const after = await dependencies.captureWorktree(ctx.cwd);
    if (owner !== generation) return;
    if (!start || !after || start.root !== after.root) {
      patchCockpit({ proof: { scope: "quick", status: "unavailable" }, phase: "DEGRADED", degraded: "Worktree change detection unavailable." });
      return;
    }
    if (start.fingerprint !== after.fingerprint) await check("quick", after, changedFiles(start, after), ctx);
  });

  pi.registerCommand("ship", {
    description: "Full proof-of-work check with a worktree-bound receipt and prior quick-check evidence",
    handler: async (_args, ctx) => {
      const owner = generation;
      const snapshot = await dependencies.captureWorktree(ctx.cwd);
      if (owner !== generation) return;
      if (!snapshot) {
        ctx.ui.notify("Cannot capture a bounded Git worktree with HEAD. Full verification unavailable.", "warning");
        return;
      }
      await check("full", snapshot, quick?.root === snapshot.root ? quick.receipt.changedFiles : [], ctx);
    },
  });
}

export default function (pi) { registerCheckGate(pi); }
