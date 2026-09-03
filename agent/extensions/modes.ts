// Neura modes v1: Plan, YOLO, and Human Away Preview. Shift+Tab cycles modes.
// Motion visualizes enforced capability changes; deterministic policy remains authoritative.

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key, truncateToWidth } from "@earendil-works/pi-tui";
import { getCockpitState, patchCockpit, type CockpitApproval } from "../neura/cockpit-state.ts";
import { PALETTE, fg } from "../neura/core.ts";
import { getMode, isAgentMode, modeLabel, modePosition, nextMode, setMode, type AgentMode } from "../neura/mode-state.ts";
import { HUMAN_AWAY_SANDBOX_TOOL } from "../neura/human-away-sandbox.ts";
import { PLAN_MODE_TOOL_NAMES, PLAN_REQUEST_TOOL, PUBLISH_PLAN_TOOL } from "../neura/plan-policy.ts";
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
const PLAN_ONLY_TOOLS = new Set([PUBLISH_PLAN_TOOL, PLAN_REQUEST_TOOL]);
const PROVIDER_PLAN_TOOL_ALIASES = new Map([
  ["Read", "read"],
  ["Bash", "bash"],
  ["Grep", "grep"],
]);
const { accent: ACC, dim: DIM, error: ERROR, human: HUMAN, muted: MUT, plan: PLAN, success: OK, text: TXT, warning: WARN } = PALETTE;

type PersistedMode = { mode?: AgentMode; changedAt?: string };
type ModeBoundary = { color: string; capabilities: Array<[string, string]>; verdict: string };
type McpServerEntry = { disabled?: unknown; enabled?: unknown };

const MODE_PROMPTS: Record<AgentMode, string> = {
  plan: `[NEURA MODE: PLAN]
Research the current user prompt, then publish one human-readable visual HTML plan with publish_plan.

Workflow:
1. Understand the objective, scope, constraints, and observable definition of done.
2. Inspect relevant code, documentation, existing actions, schemas, tests, and patterns. Name real evidence. Git inspection is limited to objects, refs, and the index: use \`git --no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false -c format.pretty=medium <command>\`. For \`diff\`, pass \`--no-ext-diff --no-textconv\`; unstaged comparisons require one explicit \`A..B\` or \`A...B\` range followed by \`--\`. For \`log\` or \`show\`, also pass \`--no-ext-diff --no-textconv --no-use-mailmap\`. Worktree status/diff and worktree-aware index modes are blocked.
3. Research current external facts with web_search when libraries, APIs, standards, products, or outside knowledge affect the direction. Prefer primary sources. Direct web_fetch is unavailable because its backend does not expose DNS, connection-IP, or redirect-hop validation.
4. Choose one recommended approach. Ask only when an unresolved choice would materially change architecture or scope.
   - Prefer questionnaire when its interactive UI can resolve the choice immediately.
   - If you must return a question and wait for a later reply, call plan_request with wait_for_input first. That reply continues the same planning request and must not be treated as a new plan.
5. When the planned work changes a visible product, screen, terminal, report, deck, or workflow, include a concrete future-state preview showing the proposed hierarchy, representative copy, controls, and important responsive states. Label it as directional, not already implemented. For invisible backend work, omit it rather than inventing decorative UI.
6. Call publish_plan with simple English, 1-3 meaningful relationship visuals, 2-8 ordered steps, real files, risks, sources, realistic verification, and the future-state preview when applicable.
7. Return the local plan path and a short review note. Stop before implementation until Rajveer approves.

Request lifecycle:
- After publication, approval, status, and handoff replies do not start another plan and require no publication.
- Before changing the published artifact at Rajveer's request, call plan_request with revise_published, then revise it with the same slug.
- Before planning a separate objective while another request is active, call plan_request with start_new. A genuine new request retains the one-retry publication contract.

Safety boundary: read-only exploration plus one controlled plan artifact under the project plans/ folder. Do not modify source files, external systems, git state, configuration, or secrets. Generic write/edit and mutating shell remain forbidden. Do not dump the full plan into chat.`,
  yolo: `[NEURA MODE: YOLO]
Full access is active. Neura application guardrails do not block tool calls or ask for approval, and native Windows provides no OS sandbox. Filesystem, network, and external-tool access follow the Neura process and signed-in user's permissions. This changes execution permissions, not task scope: perform only requested work and obey higher-priority instructions. Do not stage, commit, push, publish, deploy, or create unrelated external side effects unless the user requested them.`,
  "human-away": `[NEURA MODE: HUMAN AWAY · PREVIEW]
Rajveer is away. Continue useful unattended work only through human_away_exec. It runs inside WSL2 bubblewrap with the active workspace as the only writable mount, no Windows-drive or WSL-home visibility, a cleared host environment, and no network namespace. All normal tools and MCP tools are removed from the provider request. Deterministic policy may send eligible bounded actions to the isolated Headmaster reviewer. If an action is deferred or denied, do not retry, rephrase, split, encode, or route around the verdict. Choose the documented safer path and continue elsewhere. Pending actions will be shown when Rajveer returns. If the sandbox is unavailable, stop tool use and leave a report for Rajveer.`,
};

const MODE_BOUNDARIES: Record<AgentMode, ModeBoundary> = {
  plan: {
    color: PLAN,
    capabilities: [["workspace", "read + plan artifact"], ["publisher", "plans/*.html only"], ["sensitive", "locked"], ["remote", "research reads only"]],
    verdict: "BOUNDARY APPLIED · research + visual plan · source writes locked",
  },
  yolo: {
    color: ERROR,
    capabilities: [["filesystem", "full access"], ["network", "full access"], ["approvals", "disabled"], ["autogit", "off"]],
    verdict: "DANGER FULL ACCESS · no sandbox · no approvals",
  },
  "human-away": {
    color: HUMAN,
    capabilities: [["workspace", "WSL2 sandbox only"], ["reviewer", "isolated Headmaster"], ["sensitive", "defer to operator"], ["network", "unshared / locked"]],
    verdict: "BOUNDARY APPLIED · workspace-only mount · return queue armed",
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

  let nonPlanTools: string[] | undefined;
  let enforcedRestrictedTools: string[] = [];
  let restrictedMode: "plan" | "human-away" | null = null;
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

  function uniqueToolNames(names: string[]): string[] {
    return [...new Set(names)];
  }

  function availableToolNames(): Set<string> {
    try { return new Set(pi.getAllTools().map((tool) => tool.name)); }
    catch { return new Set(pi.getActiveTools()); }
  }

  function rememberNonPlanSelection(names = pi.getActiveTools()): void {
    nonPlanTools = uniqueToolNames(names.filter((name) => !PLAN_ONLY_TOOLS.has(name)));
  }

  function observePlanSelectionChanges(): void {
    if (!nonPlanTools) rememberNonPlanSelection();
    const current = uniqueToolNames(pi.getActiveTools());
    const currentSet = new Set(current);
    const enforcedSet = new Set(enforcedRestrictedTools);
    const removedPlanTools = new Set(
      enforcedRestrictedTools.filter((name) => !PLAN_ONLY_TOOLS.has(name) && !currentSet.has(name)),
    );
    const retained = nonPlanTools!.filter((name) => !removedPlanTools.has(name));
    const additions = current.filter((name) => !PLAN_ONLY_TOOLS.has(name) && !enforcedSet.has(name));
    nonPlanTools = uniqueToolNames([...retained, ...additions]);
  }

  function planToolNames(): string[] {
    const available = availableToolNames();
    const selected = (nonPlanTools ?? []).filter((name) => available.has(name) && PLAN_TOOLS.has(name));
    for (const name of PLAN_ONLY_TOOLS) {
      if (available.has(name)) selected.push(name);
    }
    return uniqueToolNames(selected);
  }

  function setActiveTools(names: string[]): void {
    const current = pi.getActiveTools();
    if (current.length === names.length && current.every((name, index) => name === names[index])) return;
    pi.setActiveTools(names);
  }

  function readMcpServers(configPath: string): Record<string, McpServerEntry> {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) return {};
      return parsed.mcpServers;
    } catch {
      return {};
    }
  }

  function disabledMcpServers(cwd: string): Set<string> {
    const globalServers = readMcpServers(path.join(getAgentDir(), "mcp.json"));
    const projectConfig = [path.join(cwd, "mcp.json"), path.join(cwd, ".mcp.json")]
      .find((candidate) => fs.existsSync(candidate));
    const projectServers = projectConfig ? readMcpServers(projectConfig) : {};
    const merged = { ...globalServers, ...projectServers };
    return new Set(Object.entries(merged)
      .filter(([, entry]) => entry?.disabled === true || entry?.enabled === false)
      .map(([name]) => name));
  }

  function isDisabledMcpTool(toolName: string, disabledServers: Set<string>): boolean {
    for (const server of disabledServers) {
      if (toolName.startsWith(`mcp__${server}__`)) return true;
    }
    return false;
  }

  function providerToolName(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const tool = value as { name?: unknown; function?: { name?: unknown } };
    if (typeof tool.name === "string") return tool.name;
    return typeof tool.function?.name === "string" ? tool.function.name : undefined;
  }

  function filterRestrictedProviderPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    const record = payload as Record<string, unknown>;
    if (!("tools" in record)) return record;
    if (!Array.isArray(record.tools)) return { ...record, tools: [] };
    return {
      ...record,
      tools: record.tools.filter((tool) => {
        const name = providerToolName(tool);
        if (name === undefined) return false;
        return enforcedRestrictedTools.includes(PROVIDER_PLAN_TOOL_ALIASES.get(name) ?? name);
      }),
    };
  }

  function applyToolBoundary(mode: AgentMode, cwd: string): void {
    if (mode === "plan") {
      if (restrictedMode === "plan") observePlanSelectionChanges();
      else if (restrictedMode === null) rememberNonPlanSelection();
      enforcedRestrictedTools = planToolNames();
      restrictedMode = "plan";
      setActiveTools(enforcedRestrictedTools);
      return;
    }

    if (mode === "human-away") {
      if (restrictedMode === "plan") observePlanSelectionChanges();
      else if (restrictedMode === null) rememberNonPlanSelection();
      const available = availableToolNames();
      enforcedRestrictedTools = available.has(HUMAN_AWAY_SANDBOX_TOOL) ? [HUMAN_AWAY_SANDBOX_TOOL] : [];
      restrictedMode = "human-away";
      setActiveTools(enforcedRestrictedTools);
      return;
    }

    if (restrictedMode === "plan") observePlanSelectionChanges();
    else if (restrictedMode === null) rememberNonPlanSelection();
    const available = availableToolNames();
    const disabledServers = disabledMcpServers(cwd);
    const restored = (nonPlanTools ?? []).filter(
      (name) => available.has(name) && !isDisabledMcpTool(name, disabledServers),
    );
    nonPlanTools = restored;
    restrictedMode = null;
    enforcedRestrictedTools = [];
    setActiveTools(restored);
  }

  function persistMode(): void {
    pi.appendEntry(MODE_ENTRY, { mode: getMode(), changedAt: new Date().toISOString() } satisfies PersistedMode);
  }

  async function confirmYolo(ctx): Promise<boolean> {
    if (!ctx.hasUI || typeof ctx.ui?.confirm !== "function") {
      ctx.ui?.notify?.("YOLO activation blocked: interactive confirmation is required.", "warning");
      return false;
    }
    const confirmed = await ctx.ui.confirm(
      "Enter YOLO · unsandboxed full access?",
      "Neura guardrails and approval prompts will be disabled. Tools inherit your Windows account's filesystem, network, process, and credential access.",
    );
    if (!confirmed) ctx.ui.notify("YOLO activation cancelled; current safety boundary remains active.", "warning");
    return confirmed;
  }

  async function changeMode(next: AgentMode, ctx, source: "command" | "shortcut"): Promise<void> {
    if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
      ctx.ui.notify("Mode change blocked while Neura is running. Finish or abort the turn first.", "warning");
      return;
    }
    if (next === getMode()) {
      ctx.ui.notify(`${modeLabel(next)} already active`);
      return;
    }
    if (next === "yolo" && !await confirmYolo(ctx)) return;
    if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
      ctx.ui.notify("Mode change blocked while Neura is running. Finish or abort the turn first.", "warning");
      return;
    }
    setMode(next, source);
    applyToolBoundary(next, ctx.cwd);
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
    handler: async (ctx) => { await changeMode(nextMode(), ctx, "shortcut"); },
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
      if (selected) await changeMode(selected, ctx, "command");
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

  pi.on("session_start", async (_event, ctx) => {
    returnShown = false;
    let restored: AgentMode = "yolo";
    try {
      const entry = ctx.sessionManager.getEntries()
        .filter((item: { type?: string; customType?: string }) => item.type === "custom" && item.customType === MODE_ENTRY)
        .at(-1) as { data?: PersistedMode } | undefined;
      if (isAgentMode(entry?.data?.mode)) restored = entry.data.mode;
    } catch {}
    if (restored === "yolo") {
      setMode("plan", "restore");
      applyToolBoundary("plan", ctx.cwd);
      if (!await confirmYolo(ctx)) return;
    }
    setMode(restored, "restore");
    applyToolBoundary(restored, ctx.cwd);
  });

  pi.on("input", (event, ctx) => {
    if (getMode() === "plan") applyToolBoundary("plan", ctx.cwd);
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

  pi.on("before_agent_start", (event, ctx) => {
    applyToolBoundary(getMode(), ctx.cwd);
    return { systemPrompt: `${event.systemPrompt}\n\n${MODE_PROMPTS[getMode()]}` };
  });

  // Async extensions can register and activate tools after before_agent_start.
  // Reconcile at the provider boundary and filter its already-snapshotted tool
  // schemas; the deterministic tool-call guard remains defense in depth.
  pi.on("before_provider_request", (event, ctx) => {
    applyToolBoundary(getMode(), ctx.cwd);
    return getMode() === "yolo" ? event.payload : filterRestrictedProviderPayload(event.payload);
  });
}
