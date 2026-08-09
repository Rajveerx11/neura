// Neura guardrail v2 — mode-aware action mediation.
// Plan blocks mutation. YOLO deliberately bypasses Neura application guardrails.
// Human Away sends eligible actions to the isolated Headmaster, then clamps every
// verdict through deterministic policy and queues anything not approved.

import { getMode } from "../neura/mode-state.ts";
import { patchCockpit } from "../neura/cockpit-state.ts";
import { inspectAction, isApprovalRetryEligible, isPlanActionAllowed } from "../neura/action-policy.ts";
import { consumeExactRetry, recordDecision, type ReviewDecision } from "../neura/approval-store.ts";
import { reviewWithHeadmaster } from "../neura/headmaster.ts";

export default function (pi) {
  if (!process.env.NEURA) return;

  let consecutiveStops = 0;
  const rollingStops: boolean[] = [];

  function noteOutcome(decision: ReviewDecision, ctx): boolean {
    const stopped = decision !== "approve_once";
    consecutiveStops = stopped ? consecutiveStops + 1 : 0;
    rollingStops.push(stopped);
    if (rollingStops.length > 50) rollingStops.shift();
    const circuitOpen = consecutiveStops >= 3 || rollingStops.filter(Boolean).length >= 10;
    if (circuitOpen) {
      try { ctx.abort(); } catch {}
    }
    return circuitOpen;
  }

  pi.on("agent_start", () => { consecutiveStops = 0; });

  pi.on("tool_call", async (event, ctx) => {
    const mode = getMode();

    if (mode === "plan") {
      if (isPlanActionAllowed(event, ctx.cwd)) return;
      return {
        block: true,
        reason: `PLAN mode blocked ${event.toolName}. Use research tools or publish_plan for one plans/*.html artifact; switch with Shift+Tab or /mode before implementation.`,
      };
    }

    // Match Codex --yolo: no sandbox and no approval prompts. Scope still comes
    // from the user's request and higher-priority instructions, not this hook.
    if (mode === "yolo") return;

    const action = inspectAction(event, ctx.cwd);
    if (consumeExactRetry(action)) return;
    if (action.route === "allow") return;

    patchCockpit({ phase: "REVIEW", operation: { verb: "Headmaster reviewing", target: action.summary, startedAt: Date.now() } });
    try { if (ctx.hasUI) ctx.ui.setStatus("neura-headmaster", "headmaster review"); } catch {}
    const verdict = await reviewWithHeadmaster(action, {
      provider: ctx.model?.provider,
      modelId: ctx.model?.id,
    });
    try { if (ctx.hasUI) ctx.ui.setStatus("neura-headmaster", undefined); } catch {}

    if (verdict.decision === "approve_once") {
      noteOutcome(verdict.decision, ctx);
      try { recordDecision(action, verdict, "executed", false); } catch {}
      patchCockpit({ phase: "WORK", operation: undefined, approval: undefined });
      return;
    }

    let approvalId = "unlogged";
    try {
      const record = recordDecision(action, verdict, "pending", isApprovalRetryEligible(action));
      approvalId = record.id;
      patchCockpit({
        phase: "REVIEW",
        operation: undefined,
        approval: {
          id: record.id,
          agent: "Neura",
          task: record.category,
          exactAction: record.summary,
          boundary: record.verdict.reason,
          fallback: record.verdict.saferPath,
          risk: record.risk,
          approvable: record.approvable,
        },
      });
    } catch (error) {
      patchCockpit({ phase: "DEGRADED", operation: undefined, approval: undefined, degraded: "Approval audit unavailable; action denied." });
      try { if (ctx.hasUI) ctx.ui.notify(`approval audit failed closed: ${error}`, "error"); } catch {}
    }
    const circuitOpen = noteOutcome(verdict.decision, ctx);
    return {
      block: true,
      reason:
        `HUMAN AWAY · PREVIEW ${verdict.decision.toUpperCase()} [${approvalId}]: ${verdict.reason}\n` +
        `Safer path: ${verdict.saferPath}\n` +
        (circuitOpen
          ? "Review circuit opened after repeated stops; this turn was aborted. Do not retry or route around the verdict."
          : "Queued for Rajveer. Do not retry or rephrase this action; continue through a materially safer path."),
    };
  });
}
