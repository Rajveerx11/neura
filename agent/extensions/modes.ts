// Neura modes v1: Plan, YOLO, and Human Away Preview. Shift+Tab cycles modes.
// Motion visualizes enforced capability changes; deterministic policy remains authoritative.

import { Key, truncateToWidth } from "@earendil-works/pi-tui";
import { getCockpitState, patchCockpit, type CockpitApproval } from "../neura/cockpit-state.ts";
import { PALETTE, fg } from "../neura/core.ts";
import { getMode, isAgentMode, modeLabel, modePosition, nextMode, setMode, type AgentMode } from "../neura/mode-state.ts";
import { PLAN_MODE_TOOL_NAMES, PUBLISH_PLAN_TOOL } from "../neura/plan-policy.ts";
import { GLYPHS, MOTION, quietRule } from "../neura/ui-tokens.ts";
import {
  findPending,
  grantExactRetry,
  listPending,
  listRecent,
  resolveApproval,
  type ApprovalRecord,
} from "../neura/approval-store.ts";

const MODE_ENTRY = "neura-mode-state";
const PLAN_TOOLS = new Set(PLAN_MODE_TOOL_NAMES);
const { accent: ACC, dim: DIM, error: ERROR, human: HUMAN, muted: MUT, plan: PLAN, success: OK, text: TXT, warning: WARN } = PALETTE;

type PersistedMode = { mode?: AgentMode; changedAt?: string };
type ModeBoundary = { color: string; capabilities: Array<[string, string]>; verdict: string };

const MODE_PROMPTS: Record<AgentMode, string> = {
  plan: `[NEURA MODE: PLAN]
Research the current user prompt, then publish one human-readable visual HTML plan with publish_plan.

Workflow:
1. Understand the objective, scope, constraints, and observable definition of done.
2. Inspect relevant code, documentation, existing actions, schemas, tests, and patterns. Name real evidence. Git inspection is limited to objects, refs, and the index: use \`git --no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false -c format.pretty=medium <command>\`. For \`diff\`, pass \`--no-ext-diff --no-textconv\`; unstaged comparisons require one explicit \`A..B\` or \`A...B\` range followed by \`--\`. For \`log\` or \`show\`, also pass \`--no-ext-diff --no-textconv --no-use-mailmap\`. Worktree status/diff and worktree-aware index modes are blocked.
3. Research current external facts with web_search when libraries, APIs, standards, products, or outside knowledge affect the direction. Prefer primary sources. Direct web_fetch is unavailable because its backend does not expose DNS, connection-IP, or redirect-hop validation.
4. Choose one recommended approach. Ask only when an unresolved choice would materially change architecture or scope.
5. When the planned work changes a visible product, screen, terminal, report, deck, or workflow, include a concrete future-state preview showing the proposed hierarchy, representative copy, controls, and important responsive states. Label it as directional, not already implemented. For invisible backend work, omit it rather than inventing decorative UI.
6. Call publish_plan with simple English, 1-3 meaningful relationship visuals, 2-8 ordered steps, real files, risks, sources, realistic verification, and the future-state preview when applicable.
7. Return the local plan path and a short review note. Stop before implementation until Rajveer approves.

Safety boundary: read-only exploration plus one controlled plan artifact under the project plans/ folder. Do not modify source files, external systems, git state, configuration, or secrets. Generic write/edit and mutating shell remain forbidden. Do not dump the full plan into chat.`,
  yolo: `[NEURA MODE: YOLO]
Full access is active. Neura application guardrails do not block tool calls or ask for approval, and native Windows provides no OS sandbox. Filesystem, network, and external-tool access follow the Neura process and signed-in user's permissions. This changes execution permissions, not task scope: perform only requested work and obey higher-priority instructions. Do not stage, commit, push, publish, deploy, or create unrelated external side effects unless the user requested them.`,
  "human-away": `[NEURA MODE: HUMAN AWAY · PREVIEW]
Rajveer is away. Continue useful unattended work inside the workspace. Deterministic policy may send eligible bounded actions to the isolated Headmaster reviewer. If an action is deferred or denied, do not retry, rephrase, split, encode, or route around the verdict. Choose the documented safer path and continue elsewhere. Pending actions will be shown when Rajveer returns. Native Windows still lacks an OS-enforced sandbox, so opaque shell commands and unaudited external tools remain human-bound.`,
};

const MODE_BOUNDARIES: Record<AgentMode, ModeBoundary> = {
  plan: {
    color: PLAN,
    capabilities: [["workspace", "read + plan artifact"], ["publisher", "plans/*.html only"], ["sensitive", "locked"], ["remote", "research reads only"]],
    verdict: "BOUNDARY APPLIED · research + visual plan · source writes locked",
  },
  yolo: {
    color: ACC,
    capabilities: [["filesystem", "full access"], ["network", "full access"], ["approvals", "disabled"], ["autogit", "off"]],
    verdict: "DANGER FULL ACCESS · no sandbox · no approvals",
  },
  "human-away": {
    color: HUMAN,
    capabilities: [["workspace", "one generated file"], ["reviewer", "isolated Headmaster"], ["sensitive", "defer to operator"], ["remote", "locked"]],
    verdict: "BOUNDARY APPLIED · return queue armed · OS sandbox pending",
  },
};

function modeGlyph(mode: AgentMode): string {
  return mode === "plan" ? GLYPHS.plan : mode === "human-away" ? GLYPHS.humanAway : GLYPHS.yolo;
}

export function modeTransitionLines(mode: AgentMode, frame: number, width: number): string[] {
  const boundary = MODE_BOUNDARIES[mode];
  const progress = Math.max(0, Math.min(MOTION.frames - 1, frame));
  const resolved = Math.min(4, Math.max(0, progress - 1));
  const lines = [
    truncateToWidth(`${fg(DIM, "NEURA / BOUNDARY CHANGE")}  ${fg(boundary.color, modePosition(mode))}`, width),
    truncateToWidth(`${fg(boundary.color, modeGlyph(mode))} ${fg(boundary.color, modeLabel(mode))}`, width),
  ];
  boundary.capabilities.forEach(([label, value], index) => {
    const active = index < resolved || progress === MOTION.frames - 1;
    lines.push(truncateToWidth(`${fg(DIM, label.toUpperCase().padEnd(11))}${fg(active ? TXT : MUT, value)}`, width));
  });
  const final = progress === MOTION.frames - 1;
  lines.push(truncateToWidth(fg(final ? boundary.color : MUT, final ? boundary.verdict : `APPLYING POLICY · ${resolved} / 4`), width));
  return lines.slice(0, 7);
}

function approvalState(record: ApprovalRecord): CockpitApproval {
  return {
    id: record.id,
    agent: "Neura",
    task: record.category,
    exactAction: record.summary,
    boundary: record.verdict.reason,
    fallback: record.verdict.saferPath,
    risk: record.risk,
    approvable: record.approvable,
  };
}

export function approvalLines(records: ApprovalRecord[], width: number, audit = false): string[] {
  const title = audit ? `NEURA / REVIEW AUDIT  ${records.length}` : `NEURA / AGENT ACTION REQUEST  ${records.length}`;
  const lines = [truncateToWidth(fg(ACC, title), width), fg(PALETTE.border, quietRule(width))];
  if (!records.length) {
    lines.push(truncateToWidth(fg(OK, audit ? "No review records." : "No Neura actions are waiting."), width));
    return lines;
  }
  if (audit) {
    for (const record of records.slice(0, 4)) {
      const riskColor = record.risk === "critical" ? ERROR : record.risk === "high" ? WARN : MUT;
      lines.push(truncateToWidth(`${fg(riskColor, `[${record.risk.toUpperCase()}]`)} ${fg(TXT, record.id)}  ${record.summary}`, width));
      lines.push(truncateToWidth(`${fg(DIM, record.status.toUpperCase())}  ${fg(MUT, record.verdict.reason)}`, width));
    }
    return lines.slice(0, 10);
  }

  const record = records[0];
  lines.push(truncateToWidth(`${fg(HUMAN, GLYPHS.humanAway)} ${fg(HUMAN, "Neura paused at a policy boundary")}  ${fg(DIM, record.id)}`, width));
  lines.push(truncateToWidth(`${fg(DIM, "TASK       ")}${fg(TXT, record.category)}`, width));
  lines.push(truncateToWidth(`${fg(DIM, "INTENT     ")}${fg(TXT, "complete the active task within policy")}`, width));
  lines.push(truncateToWidth(`${fg(DIM, "ACTION     ")}${fg(TXT, record.summary)}`, width));
  lines.push(truncateToWidth(`${fg(DIM, "EVIDENCE   ")}${fg(MUT, `${record.verdict.reviewer} · ${record.risk} risk`)}`, width));
  lines.push(truncateToWidth(`${fg(DIM, "BOUNDARY   ")}${fg(HUMAN, record.verdict.reason)}`, width));
  lines.push(truncateToWidth(`${fg(DIM, "FALLBACK   ")}${fg(MUT, record.verdict.saferPath)}`, width));
  lines.push(truncateToWidth(fg(record.approvable ? HUMAN : ERROR, record.approvable ? "GRANT      one identical retry · one use · 120 s" : "GRANT      unavailable · policy denied"), width));
  return lines.slice(0, 10);
}

export default function (pi) {
  if (!process.env.NEURA) return;

  let normalTools: string[] | undefined;
  let transitionGeneration = 0;
  let returnShown = false;

  function showApprovalWidget(ctx, records = listPending(ctx.cwd), audit = false): void {
    if (!ctx.hasUI) return;
    const first = records[0];
    const current = getCockpitState();
    patchCockpit({
      phase: first && !audit ? "REVIEW" : current.phase === "REVIEW" ? "READY" : current.phase,
      approval: first && !audit ? approvalState(first) : undefined,
    });
    ctx.ui.setWidget("neura-approvals", () => ({
      render: (width: number) => approvalLines(records, width, audit),
      invalidate() {},
    }));
  }

  function clearTransition(ctx, generation: number): void {
    if (generation !== transitionGeneration) return;
    try {
      ctx.ui.setWidget("neura-mode-transition", undefined);
      ctx.ui.setStatus("neura-mode-transition", undefined);
    } catch {}
  }

  function showTransition(ctx, mode: AgentMode): void {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const generation = ++transitionGeneration;
    const reduced = process.env.NEURA_REDUCED_MOTION === "1";
    ctx.ui.setStatus("neura-mode-transition", `mode · ${modeLabel(mode).toLowerCase()}`);
    ctx.ui.setWidget("neura-mode-transition", (tui) => {
      let frame = reduced ? MOTION.frames - 1 : 0;
      let interval: ReturnType<typeof setInterval> | undefined;
      let hold: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (interval) clearInterval(interval);
        hold = setTimeout(() => clearTransition(ctx, generation), reduced ? 400 : MOTION.holdMs);
        hold.unref?.();
      };
      if (reduced) finish();
      else {
        interval = setInterval(() => {
          frame++;
          if (frame >= MOTION.frames - 1) {
            frame = MOTION.frames - 1;
            finish();
          }
          try { tui.requestRender(); } catch {}
        }, MOTION.frameMs);
        interval.unref?.();
      }
      return {
        render: (width: number) => modeTransitionLines(mode, frame, width),
        invalidate() {},
        dispose() {
          if (interval) clearInterval(interval);
          if (hold) clearTimeout(hold);
        },
      };
    }, { placement: "belowEditor" });
  }

  function planToolNames(): string[] {
    try { return pi.getAllTools().map((tool) => tool.name).filter((name) => PLAN_TOOLS.has(name)); }
    catch { return (normalTools ?? pi.getActiveTools()).filter((name) => PLAN_TOOLS.has(name)); }
  }

  function applyToolBoundary(mode: AgentMode): void {
    if (!normalTools) normalTools = pi.getActiveTools().filter((name) => name !== PUBLISH_PLAN_TOOL);
    pi.setActiveTools(mode === "plan" ? planToolNames() : normalTools);
  }

  function persistMode(): void {
    pi.appendEntry<PersistedMode>(MODE_ENTRY, { mode: getMode(), changedAt: new Date().toISOString() });
  }

  function changeMode(next: AgentMode, ctx, source: "command" | "shortcut"): void {
    if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
      ctx.ui.notify("Mode change blocked while Neura is running. Finish or abort the turn first.", "warning");
      return;
    }
    if (next === getMode()) {
      ctx.ui.notify(`${modeLabel(next)} already active`);
      return;
    }
    setMode(next, source);
    applyToolBoundary(next);
    persistMode();
    returnShown = false;
    patchCockpit({ approval: undefined });
    showTransition(ctx, next);
  }

  function approveRecord(record: ApprovalRecord, ctx): void {
    if (!record.approvable) {
      ctx.ui.notify("This request is policy-denied. Exact retry cannot be granted.", "error");
      return;
    }
    resolveApproval(record.id, "approved");
    const grant = grantExactRetry(record);
    showApprovalWidget(ctx);
    ctx.ui.notify(`Exact retry ${record.id} granted for ${Math.round((grant.expiresAt - Date.now()) / 1000)} s.`);
    pi.sendUserMessage(
      `Rajveer approved exact retry ${record.id}: ${record.summary}. Retry only the identical action now. If any input or workspace state changed, stop and request a new review.`,
      { deliverAs: "followUp" },
    );
  }

  function rejectRecord(record: ApprovalRecord, ctx, resolution: "denied" | "dismissed" = "denied"): void {
    resolveApproval(record.id, resolution);
    showApprovalWidget(ctx);
    ctx.ui.notify(`Neura request ${record.id} ${resolution}.`);
  }

  async function interactiveApprovals(ctx): Promise<void> {
    const records = listPending(ctx.cwd);
    showApprovalWidget(ctx, records);
    if (!records.length || !ctx.hasUI) return;
    const labels = records.map((record) => `${record.id}  [${record.risk.toUpperCase()}]  ${record.summary}`);
    const selected = await ctx.ui.select("Neura action requests", [...labels, "Close"]);
    if (!selected || selected === "Close") return;
    const id = selected.split(/\s+/, 1)[0];
    const record = findPending(id, ctx.cwd);
    if (!record) return;
    showApprovalWidget(ctx, [record]);
    const evidence =
      `Agent: Neura\nTask: ${record.category}\nIntent / exact action: ${record.summary}\n` +
      `Evidence: ${record.verdict.reviewer} · ${record.risk} risk\nBoundary: ${record.verdict.reason}\n` +
      `Safe fallback: ${record.verdict.saferPath}\nGrant: one identical retry · one use · 120 s`;
    const actions = record.approvable
      ? ["Keep denied", "Grant exact retry", "Dismiss request", "Back"]
      : ["Keep denied", "Dismiss request", "Back"];
    const action = await ctx.ui.select(`Neura paused · request ${record.id}\n${evidence}`, actions);
    if (action === "Grant exact retry") approveRecord(record, ctx);
    else if (action === "Keep denied") rejectRecord(record, ctx, "denied");
    else if (action === "Dismiss request") rejectRecord(record, ctx, "dismissed");
  }

  pi.registerShortcut(Key.shift(Key.tab), {
    description: "Cycle Neura mode: Plan → YOLO → Human Away Preview",
    handler: async (ctx) => changeMode(nextMode(), ctx, "shortcut"),
  });

  pi.registerCommand("mode", {
    description: "Select Neura mode: /mode plan|yolo|human-away",
    handler: async (args, ctx) => {
      const requested = String(args ?? "").trim().toLowerCase().replace(/_/g, "-");
      if (requested === "status") {
        ctx.ui.notify(`${modeLabel(getMode())} active · ${modePosition(getMode())} · Shift+Tab cycles`);
        return;
      }
      if (requested === "next") return changeMode(nextMode(), ctx, "command");
      if (isAgentMode(requested)) return changeMode(requested, ctx, "command");
      if (requested) return void ctx.ui.notify("usage: /mode plan | yolo | human-away | next | status", "warning");
      if (!ctx.hasUI) return;
      const selection = await ctx.ui.select(`Neura mode · ${modeLabel(getMode())} active`, [
        "PLAN · research + local plan artifact",
        "YOLO · full access · no approvals",
        "HUMAN AWAY · PREVIEW · delegated review",
      ]);
      const selected = selection?.startsWith("PLAN") ? "plan" : selection?.startsWith("YOLO") ? "yolo" : selection?.startsWith("HUMAN") ? "human-away" : null;
      if (selected) changeMode(selected, ctx, "command");
    },
  });

  pi.registerCommand("approvals", {
    description: "Review Neura action requests and grant exact retries",
    handler: async (args, ctx) => {
      try {
        const [verb = "", id = ""] = String(args ?? "").trim().split(/\s+/, 2);
        if (verb === "close") {
          ctx.ui.setWidget("neura-approvals", undefined);
          patchCockpit({ approval: undefined });
          return;
        }
        if (verb === "audit") return void showApprovalWidget(ctx, listRecent(ctx.cwd), true);
        if (["approve", "deny", "dismiss"].includes(verb)) {
          const record = findPending(id, ctx.cwd);
          if (!record) return void ctx.ui.notify(`Pending request not found: ${id || "missing id"}`, "warning");
          if (verb === "approve") approveRecord(record, ctx);
          else rejectRecord(record, ctx, verb === "dismiss" ? "dismissed" : "denied");
          return;
        }
        if (verb) return void ctx.ui.notify("usage: /approvals [audit|close|approve <id>|deny <id>|dismiss <id>]", "warning");
        await interactiveApprovals(ctx);
      } catch (error) {
        patchCockpit({ phase: "DEGRADED", approval: undefined, degraded: "Approval audit unavailable; actions remain denied." });
        ctx.ui.notify(`Approval audit unavailable · requests remain denied · ${error}`, "error");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    normalTools ??= pi.getActiveTools().filter((name) => name !== PUBLISH_PLAN_TOOL);
    returnShown = false;
    let restored: AgentMode = "yolo";
    try {
      const entry = ctx.sessionManager.getEntries()
        .filter((item: { type?: string; customType?: string }) => item.type === "custom" && item.customType === MODE_ENTRY)
        .at(-1) as { data?: PersistedMode } | undefined;
      if (isAgentMode(entry?.data?.mode)) restored = entry.data.mode;
    } catch {}
    setMode(restored, "restore");
    applyToolBoundary(restored);
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "interactive" || getMode() !== "human-away" || returnShown) return;
    let pending: ApprovalRecord[] = [];
    try { pending = listPending(ctx.cwd); }
    catch (error) {
      ctx.ui.notify(`Approval audit unavailable: ${error}`, "error");
      return;
    }
    if (!pending.length) return;
    returnShown = true;
    showApprovalWidget(ctx, pending);
    ctx.ui.notify(`${pending.length} Neura action request${pending.length === 1 ? " is" : "s are"} waiting · /approvals`, "warning");
  });

  pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\n\n${MODE_PROMPTS[getMode()]}` }));
}
