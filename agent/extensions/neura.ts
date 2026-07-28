// neura: Rajveer's personal agent layer.
// Continuity launch, /dash toggle, and persona injection. Delete file to unwire.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { PALETTE, fg, getGitHealth, truncateText, visibleLength } from "../neura/core.ts";

const NEURA_DIR = path.join(os.homedir(), ".pi", "agent", "neura");
const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");
const { accent: ACC, success: OK, muted: MUT, dim: DIM, text: TXT, border: BORDER } = PALETTE;

type RecentThread = {
  name: string;
  updated: number;
};

type ContinuityState = {
  lastTitle: string;
  lastMeta: string;
  nowTitle: string;
  nowMeta: string;
  nextTitle: string;
  nextMeta: string;
};

const JUNK_PROJECT = /[0-9a-f]{8}-[0-9a-f]{4}|^Users-rajve$|^rajve$|Temp|scratchpad|worktre|\.claude/i;

function greeting(): string {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${part}, Rajveer.`;
}

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
      .map((entry) => ({
        name: projectName(entry.name),
        updated: latestFileTime(path.join(SESSIONS_DIR, entry.name)),
      }))
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
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
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
  state.nowTitle = `${path.basename(cwd) || cwd}  ·  ${git.branch}`;
  state.nowMeta = git.changed ? `${git.changed} working tree change${git.changed === 1 ? "" : "s"}` : "Working tree clean";
  state.nextMeta = "/new starts a fresh task  ·  /health checks readiness";
  return state;
}

function header(width: number): string {
  const date = new Date().toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  const left = `${fg(ACC, "NEURA")}  ${fg(OK, "READY")}`;
  if (width < 48) return truncateToWidth(left, width);
  const gap = " ".repeat(Math.max(1, width - visibleLength(left) - date.length));
  return truncateToWidth(left + gap + fg(MUT, date), width);
}

function spineLine(label: string, title: string, width: number, active = false): string {
  const color = active ? ACC : MUT;
  const prefix = `${fg(color, label.padEnd(5))}${fg(ACC, "│")} `;
  return prefix + fg(active ? ACC : TXT, truncateText(title, Math.max(1, width - visibleLength(prefix))));
}

function metaLine(value: string, width: number): string {
  const prefix = `${" ".repeat(5)}${fg(ACC, "│")} `;
  return prefix + fg(DIM, truncateText(value, Math.max(1, width - visibleLength(prefix))));
}

function continuityLines(width: number, state: ContinuityState): string[] {
  if (width < 48) {
    return [
      header(width),
      truncateToWidth(fg(TXT, greeting()), width),
      spineLine("LAST", state.lastTitle, width),
      spineLine("NOW", state.nowTitle, width),
      spineLine("NEXT", state.nextTitle, width, true),
      truncateToWidth(fg(DIM, "Type below  ·  /new fresh task"), width),
    ];
  }
  return [
    header(width),
    fg(BORDER, "─".repeat(Math.max(1, width))),
    truncateToWidth(`${fg(TXT, greeting())}  ${fg(DIM, "Context restored.")}`, width),
    spineLine("LAST", state.lastTitle, width),
    metaLine(state.lastMeta, width),
    spineLine("NOW", state.nowTitle, width),
    metaLine(state.nowMeta, width),
    spineLine("NEXT", state.nextTitle, width, true),
    metaLine(state.nextMeta, width),
  ];
}

export default function (pi) {
  if (!process.env.NEURA) return;

  let visible = false;
  let continuity: ContinuityState | null = null;
  let persona = "";
  try {
    persona = fs.readFileSync(path.join(NEURA_DIR, "NEURA.md"), "utf-8");
  } catch {}

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

  pi.on("session_start", (_event, ctx) => {
    try {
      const theme = ctx.ui.getTheme?.("neura-dark");
      if (theme) ctx.ui.setTheme?.(theme);
    } catch {}

    continuity = initialContinuity(ctx.cwd);
    show(ctx);
    inspectContinuity(ctx.cwd).then((next) => {
      continuity = next;
      if (visible) show(ctx);
    }).catch(() => {});
  });

  pi.on("agent_start", (_event, ctx) => hide(ctx));

  pi.registerCommand("dash", {
    description: "Toggle the Neura continuity launch",
    handler: async (_args, ctx) => (visible ? hide(ctx) : show(ctx)),
  });

  pi.on("before_agent_start", (event) => {
    if (!persona) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + persona };
  });
}
