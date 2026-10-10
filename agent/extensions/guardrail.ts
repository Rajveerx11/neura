// Neura guardrail v2 — mode-aware action mediation.
// Plan blocks mutation. WORK contains routine engineering and confirms broader actions.
// YOLO deliberately bypasses Neura application guardrails. Human Away sends eligible actions to the isolated Headmaster, then clamps every
// verdict through deterministic policy and queues anything not approved.

import { createReadToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createBashToolDefinition, SettingsManager, truncateHead } from "@earendil-works/pi-coding-agent";
import { authorizePlanPath, readPlanFile, inspectPlanFiles, parsePlanInspection, planMetadata } from "../neura/plan-files.ts";
import { redactSensitiveValue } from "../neura/redaction.ts";
import { getMode, isModeRestorePending } from "../neura/mode-state.ts";
import { isLearnActionAllowed } from "../neura/learn-policy.ts";
import { patchCockpit } from "../neura/cockpit-state.ts";
import { inspectAction, isApprovalRetryEligible, isPlanActionAllowed } from "../neura/action-policy.ts";
import { consumeExactRetry, recordDecision, type ReviewDecision } from "../neura/approval-store.ts";
import { reviewWithHeadmaster } from "../neura/headmaster.ts";

export default function (pi) {
  if (!process.env.NEURA) return;

  const safePlanCalls = new Set<string>();
  const localTools = { read: createReadToolDefinition, grep: createGrepToolDefinition, find: createFindToolDefinition, ls: createLsToolDefinition, bash: createBashToolDefinition };
  let nativeSettings: SettingsManager;
  pi.on("session_start", () => {
    safePlanCalls.clear();
    // Match Pi's runtime settings snapshot, including on /reload. Its public
    // getters preserve shell-path normalization without private SDK access.
    nativeSettings = SettingsManager.inMemory(pi.getSettings());
  });
  async function planExecute(name, input, signal, ctx, callId, onUpdate) {
    if (signal?.aborted) throw new Error("Plan inspection aborted.");
    if (name === "bash") {
      const inspection = parsePlanInspection(String(input.command ?? ""));
      if (inspection.tool === "metadata") return { content: [{ type: "text", text: planMetadata(ctx.cwd, inspection.command) }], details: {} };
      return planExecute(inspection.tool, inspection.input, signal, ctx, callId, onUpdate);
    }
    if (name === "read") {
      const deadline = Date.now() + 10_000;
      const checkBudget = () => {
        if (signal?.aborted) throw new Error("Plan inspection aborted.");
        if (Date.now() > deadline) throw new Error("Plan inspection deadline reached; narrow the path or pattern.");
      };
      return createReadToolDefinition(ctx.cwd, { operations: {
        access: async file => { checkBudget(); authorizePlanPath(ctx.cwd, file); checkBudget(); },
        readFile: async file => readPlanFile(ctx.cwd, file, checkBudget),
        detectImageMimeType: async () => null,
      } }).execute(callId, input, signal, onUpdate, ctx);
    }
    const text = await inspectPlanFiles(ctx.cwd, name, input, signal);
    const truncation = truncateHead(text);
    return { content: [{ type: "text", text: truncation.content + (truncation.truncated ? "\n[Output truncated; narrow inspection.]" : "") }], details: { truncation } };
  }
  for (const [name, factory] of Object.entries(localTools)) {
    const definition = factory(process.cwd());
    pi.registerTool({ ...definition, async execute(callId, input, signal, onUpdate, ctx) {
      if (isModeRestorePending()) throw new Error("Session restoration is pending.");
      if (getMode() !== "plan") {
        // Registered tools replace Pi's configured built-ins, not their defaults.
        if (!nativeSettings) throw new Error("Native session settings are not initialized.");
        const native = name === "read" ? createReadToolDefinition(ctx.cwd, { autoResizeImages: nativeSettings.getImageAutoResize() })
          : name === "bash" ? createBashToolDefinition(ctx.cwd, { commandPrefix: nativeSettings.getShellCommandPrefix(), shellPath: nativeSettings.getShellPath() })
          : factory(ctx.cwd);
        return native.execute(callId, input, signal, onUpdate, ctx);
      }
      const result = await planExecute(name, input, signal, ctx, callId, onUpdate);
      safePlanCalls.add(callId);
      return redactSensitiveValue(result);
    } });
  }
  pi.on("tool_result", event => {
    if (getMode() === "plan") return { content: redactSensitiveValue(event.content), details: redactSensitiveValue(event.details), structuredContent: redactSensitiveValue(event.structuredContent) };
  });
  pi.on("context", event => {
    if (getMode() !== "plan") return;
    // A restored session or a previous mode's native tool result has not passed
    // this service. Never recycle its bytes into Plan research context.
    return { messages: event.messages.map(message => message.role === "toolResult" && !safePlanCalls.has(message.toolCallId)
      ? { ...message, content: [{ type: "text", text: "[Earlier tool content withheld in Plan; inspect again through authorized tools.]" }], details: undefined, structuredContent: undefined }
      : message) };
  });

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
    if (isModeRestorePending()) return { block: true, reason: "Session restoration is waiting for the previous host operation to finish. All tools are blocked." };
    const mode = getMode();
    // Pi's indirect tools reach registered capabilities beyond the active list.
    // Keep them YOLO-only until Neura has reviewed their complete execution surface.
    if (mode !== "yolo" && ["codemode", "tool_search"].includes(event.toolName)) {
      return { block: true, reason: `${event.toolName} is available only in YOLO mode.` };
    }

    if (mode === "learn") {
      if (isLearnActionAllowed(event, ctx.cwd)) return;
      return { block: true, reason: `LEARN mode blocked ${event.toolName}. Use bounded research and learning tools; host execution, generic writes, and remote actions are unavailable.` };
    }

    if (mode === "plan") {
      if (isPlanActionAllowed(event, ctx.cwd)) {
        if (!Object.hasOwn(localTools, event.toolName)) safePlanCalls.add(event.toolCallId);
        return;
      }
      return {
        block: true,
        reason: `PLAN mode blocked ${event.toolName}. Use research tools or publish_plan for one plans/*.html artifact; switch with Shift+Tab or /mode before implementation.`,
      };
    }

    // Match Codex --yolo: no sandbox and no approval prompts. Scope still comes
    // from the user's request and higher-priority instructions, not this hook.
    if (mode === "yolo") return;
    if (mode !== "human-away" && mode !== "work") return { block: true, reason: "Unknown Neura mode: all tool calls are blocked." };

    const action = inspectAction(event, ctx.cwd, { protectControlReads: mode === "work" });

    if (mode === "work") {
      if (action.route === "allow") {
        if (event.toolName === "bash" && action.category !== "read-only") {
          return {
            block: true,
            reason: "WORK mode runs tests, builds, and workspace-changing shell commands through work_exec. Native bash is limited to hardened read-only inspection.",
          };
        }
        return;
      }
      if (action.route === "deny") {
        return { block: true, reason: `WORK mode denied ${action.summary}: ${action.reason}\nSafer path: ${action.saferPath}` };
      }
      if (!ctx.hasUI || typeof ctx.ui?.confirm !== "function") {
        return { block: true, reason: `WORK mode blocked ${action.summary}: explicit interactive approval is required.\nSafer path: ${action.saferPath}` };
      }
      const approved = await ctx.ui.confirm(
        `WORK approval · ${action.risk} risk`,
        `${action.summary}\n\nBoundary: ${action.reason}\nSafer path: ${action.saferPath}\n\nAllow this action once?`,
      );
      if (!approved) return { block: true, reason: `WORK mode approval denied for ${action.summary}.` };
      return;
    }

    if (consumeExactRetry(action)) return;
    if (action.route === "allow") return;

    patchCockpit({ phase: "REVIEW", operation: { verb: "Headmaster reviewing", target: action.summary, startedAt: Date.now() } });
    try { if (ctx.hasUI) ctx.ui.setStatus("neura-headmaster", "headmaster review"); } catch {}
    const verdict = await reviewWithHeadmaster(action, {
      provider: ctx.model?.provider,
      modelId: ctx.model?.id,
      signal: ctx.signal,
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
