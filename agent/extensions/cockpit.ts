// Neura ambient cockpit: responsive footer, policy boundary, current operation,
// proof/recovery receipts, copy rail, and a quiet interruptible working indicator.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getCockpitState, onCockpitChange, patchCockpit, type CockpitState } from "../neura/cockpit-state.ts";
import { PALETTE, fg, truncateText } from "../neura/core.ts";
import { getMode, modeLabel, onModeChange, type AgentMode } from "../neura/mode-state.ts";
import { redactSensitiveText } from "../neura/redaction.ts";
import { GLYPHS, joinFitting, widthTier } from "../neura/ui-tokens.ts";

const { accent: ACC, error: RED, human: HUMAN, plan: PLAN, warning: WARN, dim: DIM, muted: MUT, text: TXT } = PALETTE;

function modeColor(mode: AgentMode): string {
  return mode === "learn" ? PALETTE.learn : mode === "plan" ? PLAN : mode === "work" ? ACC : mode === "human-away" ? HUMAN : RED;
}

function modeGlyph(mode: AgentMode): string {
  return mode === "learn" ? GLYPHS.learn : mode === "plan" ? GLYPHS.plan : mode === "work" ? GLYPHS.neura : mode === "human-away" ? GLYPHS.humanAway : GLYPHS.yolo;
}

export function modeTag(mode = getMode()): string {
  const label = mode === "yolo" ? "YOLO · DANGER" : modeLabel(mode);
  return fg(modeColor(mode), `${modeGlyph(mode)} ${label}`);
}

function contextTag(ctx): string | null {
  try {
    const usage = ctx.getContextUsage?.();
    const window = usage?.contextWindow ?? ctx.model?.contextWindow;
    if (typeof window !== "number" || window <= 0) return null;
    const tokens = usage?.tokens;
    const pct = usage?.percent ?? (typeof tokens === "number" ? (tokens / window) * 100 : null);
    const color = pct != null && pct >= 90 ? RED : pct != null && pct >= 70 ? WARN : MUT;
    return fg(color, `ctx ${typeof tokens === "number" ? tokens.toLocaleString("en-US") : "?"}/${window.toLocaleString("en-US")} (${pct == null ? "?" : Math.round(pct)}%)`);
  } catch {
    return null;
  }
}

function costTag(cost: number): string {
  const threshold = Number(process.env.NEURA_COST_WARNING ?? "");
  const color = Number.isFinite(threshold) && threshold > 0 && cost >= threshold ? WARN : MUT;
  return fg(color, `$${cost.toFixed(3)}`);
}

/** Match Pi's native footer: sum all billable assistant, tool, and summary usage. */
function usageCost(usage): number | null {
  const cost = usage?.cost;
  const value = typeof cost?.total === "number" ? cost.total : typeof cost === "number" ? cost : null;
  return value !== null && Number.isFinite(value) ? value : null;
}

function sessionCost(ctx): number | null {
  try {
    let total = 0;
    let found = false;
    for (const entry of ctx.sessionManager.getEntries()) {
      const usage = entry?.type === "message"
        ? (entry.message?.role === "assistant" || entry.message?.role === "toolResult" ? entry.message?.usage : undefined)
        : (["usage", "branch_summary", "compaction"].includes(entry?.type) ? entry.usage : undefined);
      const value = usageCost(usage);
      if (value !== null) {
        total += value;
        found = true;
      }
    }
    return found ? total : null;
  } catch {
    return null;
  }
}

function shortModel(modelId: string, width: number): string {
  const limit = width < 56 ? 13 : width < 92 ? 20 : 32;
  return truncateText(modelId || "no model", limit);
}

function directoryTag(cwd: string | undefined): string {
  const value = String(cwd ?? "").replace(/[\\/]+$/, "");
  const leaf = value.split(/[\\/]/).filter(Boolean).pop() || value || "no directory";
  return fg(MUT, leaf);
}

function rightFooterParts(data: { directory?: string; branch?: string; model: string; thinking?: string }, tier: ReturnType<typeof widthTier>, width: number): string[] {
  const model = fg(TXT, shortModel(data.model, width));
  const thinking = data.thinking ? fg(MUT, `think ${data.thinking}`) : "";
  const branch = data.branch ? fg(MUT, data.branch) : "";
  const directory = directoryTag(data.directory);
  if (tier === "wide") return [directory, branch, model, thinking];
  if (tier === "standard") return [branch, model, thinking];
  if (tier === "compact") return [model, thinking];
  return [model];
}

export function footerLine(
  width: number,
  data: { mode: AgentMode; model: string; branch?: string; directory?: string; thinking?: string; context?: string | null; cost?: string | null; launchVisible?: boolean },
): string {
  if (data.launchVisible) return "";
  const tier = widthTier(width);
  const separator = fg(DIM, " · ");
  const left = joinFitting([modeTag(data.mode), data.context ?? "", data.cost ?? ""], separator, Math.max(1, width));
  const right = joinFitting(rightFooterParts(data, tier, width), separator, Math.max(1, width));
  const gap = 2;
  if (visibleWidth(left) + gap + visibleWidth(right) <= width) {
    return `${left}${" ".repeat(width - visibleWidth(left) - visibleWidth(right))}${right}`;
  }
  const availableRight = width - visibleWidth(left) - gap;
  if (availableRight > 8) return `${left}${" ".repeat(gap)}${truncateToWidth(right, availableRight)}`;
  return truncateToWidth(left, width);
}

function operationTarget(event): string {
  const input = event?.input && typeof event.input === "object" ? event.input : {};
  const raw = input.path ?? input.file_path ?? input.command ?? input.query ?? input.pattern ?? "";
  const redacted = redactSensitiveText(raw);
  return truncateText(redacted.replace(/\s+/g, " ").trim(), 72);
}

function phaseColor(state: CockpitState): string {
  if (state.phase === "DEGRADED" || state.phase === "REVIEW") return HUMAN;
  if (state.phase === "VERIFY") return state.proof?.status === "failed" ? RED : state.proof?.status === "passed" ? PALETTE.success : ACC;
  if (state.phase === "RECOVERY") return RED;
  if (state.phase === "COMPLETE") return state.proof?.status === "passed" ? PALETTE.success : ACC;
  return ACC;
}

export function cockpitLines(state: CockpitState, _mode: AgentMode, width: number): string[] {
  const lines: string[] = [];
  const phaseDetail = [state.step, state.task].filter(Boolean).join(" · ");
  if (state.phase !== "READY") {
    lines.push(truncateToWidth(`${fg(phaseColor(state), state.phase === "WORK" ? "RESPONDING" : state.phase)}${phaseDetail ? `  ${fg(MUT, phaseDetail)}` : ""}`, width));
  }

  if (state.approval) {
    lines.push(truncateToWidth(`${fg(HUMAN, GLYPHS.humanAway)} ${fg(HUMAN, `${state.approval.agent} paused`)} ${fg(MUT, `· ${state.approval.risk} boundary · request ${state.approval.id}`)}`, width));
  } else if (state.proof?.status === "failed") {
    lines.push(truncateToWidth(`${fg(RED, GLYPHS.error)} ${fg(RED, "proof failed")} ${fg(MUT, `· ${state.proof.detail || "open /ship for evidence"}`)}`, width));
  } else if (state.proof?.status === "running") {
    lines.push(truncateToWidth(`${fg(ACC, GLYPHS.pending)} ${fg(MUT, `proof ${state.proof.scope} · running`)}`, width));
  } else if (state.operation) {
    const target = state.operation.target ? ` · ${state.operation.target}` : "";
    lines.push(truncateToWidth(`${fg(ACC, GLYPHS.pending)} ${fg(MUT, `${state.operation.verb}${target}`)} ${fg(DIM, "· Esc stops safely")}`, width));
  } else if (state.degraded) {
    lines.push(truncateToWidth(`${fg(HUMAN, "DEGRADED")} ${fg(MUT, `· ${state.degraded}`)}`, width));
  } else if (state.copy.feedback) {
    lines.push(truncateToWidth(fg(PALETTE.success, `${GLYPHS.success} ${state.copy.feedback}`), width));
  } else if (state.copy.available && width >= 48) {
    const code = state.copy.codeBlocks ? ` · Ctrl+Shift+X choose ${state.copy.codeBlocks} code block${state.copy.codeBlocks === 1 ? "" : "s"}` : "";
    lines.push(truncateToWidth(`${fg(MUT, "Ctrl+X copy answer")}${fg(DIM, code)}`, width));
  }

  return lines.slice(0, 2);
}

export default function (pi) {
  if (!process.env.NEURA) return;

  let requestRender = () => {};
  let cachedCost: number | null = null;
  let unsubscribeCockpit = () => {};
  let unsubscribeMode = () => {};

  const refreshWidget = (ctx) => {
    try {
      ctx.ui.setWidget("neura-cockpit", () => ({
        render: (width: number) => cockpitLines(getCockpitState(), getMode(), width),
        invalidate() {},
      }), { placement: "belowEditor" });
    } catch {}
  };

  pi.on("session_start", (_event, ctx) => {
    cachedCost = sessionCost(ctx);
    try {
      ctx.ui.setHiddenThinkingLabel("Thinking · Ctrl+O expand");
      ctx.ui.setWorkingVisible(true);
      ctx.ui.setWorkingIndicator({
        frames: [fg(DIM, "▪"), fg(MUT, "▪"), fg(ACC, "■"), fg(MUT, "▪")],
        intervalMs: 180,
      });
    } catch {}

    refreshWidget(ctx);
    unsubscribeCockpit();
    unsubscribeMode();
    unsubscribeCockpit = onCockpitChange(() => requestRender());
    unsubscribeMode = onModeChange(() => requestRender());

    ctx.ui.setFooter((tui, _theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribeBranch = footerData.onBranchChange?.(() => { cachedCost = sessionCost(ctx); tui.requestRender(); });
      const localModeUnsubscribe = onModeChange(() => tui.requestRender());
      const localCockpitUnsubscribe = onCockpitChange(() => tui.requestRender());
      return {
        invalidate() {},
        render(width: number): string[] {
          const context = contextTag(ctx);
          const cost = cachedCost;
          const state = getCockpitState();
          if (state.launchVisible) return [];
          const lines = [footerLine(width, {
            mode: getMode(),
            model: ctx.model?.id ?? "no model",
            branch: footerData.getGitBranch?.(),
            directory: ctx.cwd,
            thinking: ctx.thinkingLevel,
            context,
            cost: cost === null ? fg(DIM, "cost n/a") : costTag(cost),
            launchVisible: state.launchVisible,
          })];
          return lines;
        },
        dispose() {
          try { unsubscribeBranch?.(); } catch {}
          localModeUnsubscribe();
          localCockpitUnsubscribe();
        },
      };
    });
  });

  pi.on("input", (event) => {
    if (event.source !== "interactive") return;
    patchCockpit({
      phase: "BRIEF",
      task: truncateText(String(event.text ?? "").replace(/\s+/g, " ").trim(), 72),
      step: undefined,
      operation: undefined,
      proof: undefined,
      approval: undefined,
      copy: { available: false, codeBlocks: 0 },
      degraded: undefined,
    });
  });

  pi.on("agent_start", (_event, ctx) => {
    patchCockpit({ phase: "WORK", step: "active", operation: { verb: "working", startedAt: Date.now() } });
    try { ctx.ui.setWorkingMessage("Working · Esc stops safely"); } catch {}
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const target = operationTarget(event);
    patchCockpit({ phase: "WORK", operation: { verb: String(event.toolName ?? "tool"), target: target || undefined, startedAt: Date.now() } });
    try { ctx.ui.setWorkingMessage(`${String(event.toolName ?? "working")}${target ? ` · ${target}` : ""} · Esc stops safely`); } catch {}
  });

  pi.on("tool_execution_end", () => patchCockpit({ operation: { verb: "composing response", startedAt: Date.now() } }));

  pi.on("message_end", (event) => {
    if (event.message?.role !== "assistant" && event.message?.role !== "toolResult") return;
    const cost = usageCost(event.message.usage);
    if (cost === null) return;
    cachedCost = (cachedCost ?? 0) + cost;
    requestRender();
  });

  pi.on("agent_end", (_event, ctx) => {
    cachedCost = sessionCost(ctx);
    const state = getCockpitState();
    const phase = state.approval ? "REVIEW"
      : state.degraded ? "DEGRADED"
        : state.proof?.status === "failed" ? "VERIFY"
          : "COMPLETE";
    patchCockpit({ phase, step: undefined, operation: undefined });
    try { ctx.ui.setWorkingMessage(); } catch {}
  });

  pi.on("session_shutdown", () => {
    unsubscribeCockpit();
    unsubscribeMode();
  });
}
