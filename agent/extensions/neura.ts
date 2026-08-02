// Neura identity and continuity: one launch wordmark, a compact resume ledger,
// /dash, /notices, session title, and persona injection. Plain pi stays stock.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { getCockpitState, onCockpitChange, resetCockpit } from "../neura/cockpit-state.ts";
import { PALETTE, fg, getGitHealth, truncateText, visibleLength } from "../neura/core.ts";
import { getMode, modeLabel, onModeChange } from "../neura/mode-state.ts";

const NEURA_DIR = path.join(os.homedir(), ".pi", "agent", "neura");
const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");
const { accent: ACC, human: HUMAN, muted: MUT, dim: DIM, text: TXT } = PALETTE;

const FULL_WORDMARK = [
  "███╗   ██╗ ███████╗ ██╗   ██╗ ██████╗   █████╗ ",
  "████╗  ██║ ██╔════╝ ██║   ██║ ██╔══██╗ ██╔══██╗",
  "██╔██╗ ██║ █████╗   ██║   ██║ ██████╔╝ ███████║",
  "██║╚██╗██║ ██╔══╝   ██║   ██║ ██╔══██╗ ██╔══██║",
  "██║ ╚████║ ███████╗ ╚██████╔╝ ██║  ██║ ██║  ██║",
  "╚═╝  ╚═══╝ ╚══════╝  ╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝",
];

const COMPACT_WORDMARK = [
  "N   N EEEEE U   U RRRR   AAA",
  "NN  N E     U   U R   R A   A",
  "N N N EEEE  U   U RRRR  AAAAA",
  "N  NN E     U   U R R   A   A",
  "N   N EEEEE  UUU  R  RR A   A",
];

type RecentThread = { name: string; updated: number };
type ContinuityState = {
  lastTitle: string;
  lastMeta: string;
  nowTitle: string;
  nowMeta: string;
  nextTitle: string;
  nextMeta: string;
};

const JUNK_PROJECT = /[0-9a-f]{8}-[0-9a-f]{4}|^Users-rajve$|^rajve$|Temp|scratchpad|worktre|\.claude/i;

function projectName(raw: string): string {
  const parts = raw.replace(/^--|--$/g, "").split("--").filter(Boolean);
  return (parts.pop() || raw).replace(/-/g, " ").trim();
}

function latestFileTime(directory: string): number {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .reduce((latest, entry) => Math.max(latest, fs.statSync(path.join(directory, entry.name)).mtimeMs), 0);
  } catch {
    return 0;
  }
}

function recentThread(): RecentThread | null {
  try {
    const threads = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: projectName(entry.name), updated: latestFileTime(path.join(SESSIONS_DIR, entry.name)) }))
      .filter((thread) => thread.updated > 0 && !JUNK_PROJECT.test(thread.name))
      .sort((a, b) => b.updated - a.updated);
    return threads[0] ?? null;
  } catch {
    return null;
  }
}

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function initialContinuity(cwd: string): ContinuityState {
  const thread = recentThread();
  const workspace = path.basename(cwd) || cwd;
  return {
    lastTitle: thread?.name ?? "Fresh session",
    lastMeta: thread ? `${timeLabel(thread.updated)} last activity` : "No previous thread found",
    nowTitle: workspace,
    nowMeta: "Inspecting workspace",
    nextTitle: thread ? `Continue ${thread.name}` : "Start a new task",
    nextMeta: "Type below to continue",
  };
}

async function inspectContinuity(cwd: string): Promise<ContinuityState> {
  const state = initialContinuity(cwd);
  const git = await getGitHealth(cwd);
  if (!git.isRepo) {
    state.nowMeta = "Not a git workspace";
    return state;
  }
  state.nowTitle = `${path.basename(cwd) || cwd} · ${git.branch}${git.changed ? "*" : ""}`;
  state.nowMeta = git.changed ? `${git.changed} working tree change${git.changed === 1 ? "" : "s"}` : "Working tree clean";
  state.nextMeta = "/new fresh task · /health readiness";
  return state;
}

function labeled(label: string, value: string, width: number, color = TXT): string {
  const prefix = `${fg(DIM, label.padEnd(9))}`;
  return prefix + fg(color, truncateText(value, Math.max(1, width - visibleLength(prefix))));
}

export function wordmarkLines(width: number): string[] {
  const source = width >= 56 ? FULL_WORDMARK : COMPACT_WORDMARK;
  return source.map((line) => truncateToWidth(fg(ACC, line), width));
}

export function continuityLines(width: number, state: ContinuityState): string[] {
  const mode = getMode();
  const notices = getCockpitState().notices.length;
  const modeColor = mode === "plan" ? PALETTE.plan : mode === "human-away" ? HUMAN : ACC;
  const lines = [
    ...wordmarkLines(width),
    labeled("READY", `${state.nowTitle} · ${state.nowMeta}`, width),
    labeled("BOUNDARY", modeLabel(mode), width, modeColor),
    labeled("LAST", `${state.lastTitle} · ${state.lastMeta}`, width, MUT),
    labeled("NEXT", `${state.nextTitle} · ${notices} notice${notices === 1 ? "" : "s"} · /notices`, width, ACC),
  ];
  return lines.slice(0, 10).map((line) => truncateToWidth(line, width));
}

function noticeLines(width: number): string[] {
  const notices = getCockpitState().notices;
  const lines = [truncateToWidth(fg(ACC, `NEURA / NOTICES  ${notices.length}`), width)];
  if (!notices.length) return [...lines, fg(PALETTE.success, "No Neura notices.")];
  for (const notice of notices.slice(-4)) {
    const color = notice.tone === "error" ? PALETTE.error : notice.tone === "warning" ? HUMAN : notice.tone === "success" ? PALETTE.success : MUT;
    lines.push(truncateToWidth(`${fg(color, notice.id)}  ${fg(TXT, notice.message)}`, width));
    if (notice.detail) lines.push(truncateToWidth(`${" ".repeat(Math.min(10, width))}${fg(DIM, notice.detail)}`, width));
  }
  lines.push(truncateToWidth(fg(DIM, "/notices close hides this panel"), width));
  return lines.slice(0, 10);
}

export default function (pi) {
  if (!process.env.NEURA) return;

  let visible = false;
  let noticesVisible = false;
  let continuity: ContinuityState | null = null;
  let activeContext: any;
  let persona = "";
  let unsubscribeMode = () => {};
  let unsubscribeCockpit = () => {};
  try { persona = fs.readFileSync(path.join(NEURA_DIR, "NEURA.md"), "utf-8"); } catch {}

  const show = (ctx) => {
    try {
      continuity ??= initialContinuity(ctx.cwd);
      ctx.ui.setWidget("neura-launch", () => ({
        render: (width: number) => continuityLines(width, continuity!),
        invalidate() {},
      }));
      visible = true;
    } catch {}
  };

  const hide = (ctx) => {
    try {
      ctx.ui.setWidget("neura-launch", undefined);
      visible = false;
    } catch {}
  };

  const showNotices = (ctx) => {
    ctx.ui.setWidget("neura-notices", () => ({ render: (width: number) => noticeLines(width), invalidate() {} }));
    noticesVisible = true;
  };

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    resetCockpit();
    try {
      const theme = ctx.ui.getTheme?.("neura-dark");
      if (theme) ctx.ui.setTheme?.(theme);
      ctx.ui.setTitle(`Neura · ${ctx.cwd}`);
    } catch {}

    unsubscribeMode();
    unsubscribeCockpit();
    unsubscribeMode = onModeChange(() => { if (visible && activeContext) show(activeContext); });
    unsubscribeCockpit = onCockpitChange(() => {
      if (visible && activeContext) show(activeContext);
      if (noticesVisible && activeContext) showNotices(activeContext);
    });

    continuity = initialContinuity(ctx.cwd);
    show(ctx);
    inspectContinuity(ctx.cwd).then((next) => {
      continuity = next;
      if (visible) show(ctx);
    }).catch(() => {});
  });

  pi.on("agent_start", (_event, ctx) => hide(ctx));
  pi.on("session_shutdown", () => { unsubscribeMode(); unsubscribeCockpit(); });

  pi.registerCommand("dash", {
    description: "Toggle the Neura launch identity and continuity ledger",
    handler: async (_args, ctx) => (visible ? hide(ctx) : show(ctx)),
  });

  pi.registerCommand("notices", {
    description: "Show Neura notices without hiding upstream Pi diagnostics",
    handler: async (args, ctx) => {
      if (String(args ?? "").trim().toLowerCase() === "close") {
        ctx.ui.setWidget("neura-notices", undefined);
        noticesVisible = false;
        return;
      }
      showNotices(ctx);
    },
  });

  pi.on("before_agent_start", (event) => persona ? { systemPrompt: `${event.systemPrompt}\n\n${persona}` } : undefined);
}
