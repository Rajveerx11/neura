// neura — Rajveer's personal agent layer: ASCII logo + time-aware greeting,
// auto dashboard (todos from Obsidian · projects from session store · week goals),
// /dash toggle, persona injection from NEURA.md. Delete file to unwire.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { PALETTE, fg, padAnsi, truncateText } from "../neura/core.ts";

const VAULT = process.env.NEURA_VAULT || "C:/Users/rajve/OneDrive/Documents/Obsidian Vault";
const LEARN_PROFILE = process.env.NEURA_LEARN_PROFILE ||
  path.join(os.homedir(), ".claude", "skills", "learn-day", "data", "profile.md");
const NEURA_DIR = path.join(os.homedir(), ".pi", "agent", "neura");
const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");

const { accent: ACC, rose: ROSE, muted: MUT, dim: DIM, text: TXT, border: BORDER } = PALETTE;

// linear blend between two hex colors, t in [0,1] — used for the logo gradient
function mix(a: string, b: string, t: number): string {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((A >> sh) & 255) + (((B >> sh) & 255) - ((A >> sh) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

const LOGO = [
  "███╗   ██╗ ███████╗ ██╗   ██╗ ██████╗   █████╗ ",
  "████╗  ██║ ██╔════╝ ██║   ██║ ██╔══██╗ ██╔══██╗",
  "██╔██╗ ██║ █████╗   ██║   ██║ ██████╔╝ ███████║",
  "██║╚██╗██║ ██╔══╝   ██║   ██║ ██╔══██╗ ██╔══██║",
  "██║ ╚████║ ███████╗ ╚██████╔╝ ██║  ██║ ██║  ██║",
  "╚═╝  ╚═══╝ ╚══════╝  ╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝",
];

function greeting(): string {
  const h = new Date().getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, Rajveer.`;
}

// ---- data sources (all automatic, all fail-soft) ----

function dailyNoteName(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const ddd = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${dd}-${mm}-${yy}(${ddd}).md`;
}

function checkboxes(file: string): { text: string; done: boolean }[] {
  try {
    return fs.readFileSync(file, "utf-8").split("\n")
      .map((l) => /^\s*[-*]\s*\[( |x|X)\]\s*(.+)/.exec(l))
      .filter(Boolean)
      .map((m) => ({ done: m![1] !== " ", text: m![2].trim().slice(0, 40) }));
  } catch { return []; }
}

function todayTodos(): { text: string; done: boolean }[] {
  const items = checkboxes(path.join(VAULT, dailyNoteName(new Date())));
  return items.slice(0, 4);
}

// --- Google Calendar via secret iCal URL (env NEURA_GCAL_ICS) — no OAuth needed ---
// ponytail: RRULE recurring masters are not expanded; single events + all-day covered
let calEvents: string[] = [];

function parseIcsDay(ics: string, day: Date): { t: number; label: string }[] {
  const y = day.getFullYear(), mo = day.getMonth(), da = day.getDate();
  const out: { t: number; label: string }[] = [];
  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const dt = /DTSTART(?:;[^:]*)?:(\d{8})(?:T(\d{6})(Z)?)?/.exec(body);
    const sum = /SUMMARY(?:;[^:]*)?:(.+)/.exec(body);
    if (!dt || !sum) continue;
    const [ds, ts, zulu] = [dt[1], dt[2], dt[3]];
    let start: Date;
    if (!ts) start = new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8));
    else if (zulu) start = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8), +ts.slice(0, 2), +ts.slice(2, 4)));
    else start = new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8), +ts.slice(0, 2), +ts.slice(2, 4));
    if (start.getFullYear() !== y || start.getMonth() !== mo || start.getDate() !== da) continue;
    // no times shown — sorted chronologically, name only
    out.push({ t: ts ? start.getTime() : 0, label: sum[1].trim().slice(0, 26) });
  }
  return out.sort((a, b) => a.t - b.t);
}

function parseIcsToday(ics: string): string[] {
  const today = parseIcsDay(ics, new Date());
  if (today.length) return today.slice(0, 4).map((e) => e.label);
  // nothing today (evening planning pattern) — show tomorrow, labeled
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  return parseIcsDay(ics, tm).slice(0, 4).map((e) => `tmrw ${e.label}`);
}

async function fetchCalendar(): Promise<string[]> {
  const url = process.env.NEURA_GCAL_ICS;
  if (!url) return [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    return parseIcsToday(await res.text());
  } catch { return []; }
}

function weekGoals(): string[] {
  const goals: string[] = [];
  try { // weekly targets from learn-day profile
    const prof = fs.readFileSync(LEARN_PROFILE, "utf-8");
    const t = /weekly_targets:\s*\{\s*posts:\s*(\d+),\s*study_days:\s*(\d+)/.exec(prof);
    if (t) goals.push(`${t[1]} posts · ${t[2]} study days`);
  } catch {}
  // open items from this week's daily notes, newest first
  for (let i = 0; i < 7 && goals.length < 4; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    for (const c of checkboxes(path.join(VAULT, dailyNoteName(d)))) {
      if (!c.done && goals.length < 4 && !goals.includes(c.text)) goals.push(c.text);
    }
  }
  return goals;
}

// not real projects: home dir, temp/scratchpad, worktrees, uuid-named session dirs
const JUNK_PROJECT = /[0-9a-f]{8}-[0-9a-f]{4}|^Users-rajve$|^rajve$|Temp|scratchpad|worktre|\.claude/i;

function recentProjects(): string[] {
  try {
    return fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const st = fs.statSync(path.join(SESSIONS_DIR, e.name));
        // "--C--Axon Landing Page--" -> "Axon Landing Page"
        const parts = e.name.replace(/^--|--$/g, "").split("--").filter(Boolean);
        const name = (parts.pop() || e.name).split(/[\\/]/).pop()!;
        return { name, mtime: st.mtimeMs };
      })
      .filter((p) => !JUNK_PROJECT.test(p.name)) // filter BEFORE truncation, else "…worktre" slips through
      .sort((a, b) => b.mtime - a.mtime).slice(0, 4)
      .map((p) => p.name.slice(0, 24));
  } catch { return []; }
}

// ---- rendering ----

type DashSection = { title: string; color: string; empty: string; items: string[] };

function dashboardSections(): DashSection[] {
  const events = calEvents.map((event) => `${fg(ACC, "•")} ${fg(TXT, event)}`);
  const todos = todayTodos().map((todo) =>
    `${fg(todo.done ? DIM : TXT, todo.done ? "[x]" : "[ ]")} ${fg(todo.done ? DIM : TXT, todo.text)}`,
  );
  return [
    { title: "Today", color: ACC, empty: "nothing scheduled", items: [...events, ...todos].slice(0, 5) },
    {
      title: "Projects",
      color: ROSE,
      empty: "none yet",
      items: recentProjects().map((project) => `${fg(ROSE, "•")} ${fg(TXT, project)}`),
    },
    {
      title: "This week",
      color: MUT,
      empty: "no open goals",
      items: weekGoals().map((goal) => `${fg(MUT, "•")} ${fg(TXT, goal)}`),
    },
  ];
}

function dashboard(width: number): string[] {
  const sections = dashboardSections();
  if (width >= 92) {
    const columnWidth = Math.max(24, Math.floor((width - 6) / 3));
    const rows = Math.max(...sections.map((section) => Math.max(1, section.items.length)));
    const separator = fg(BORDER, " │ ");
    const lines = [
      sections.map((section) => padAnsi(fg(section.color, `▸ ${section.title}`), columnWidth)).join(separator),
      sections.map(() => fg(BORDER, "─".repeat(columnWidth))).join(fg(BORDER, "─┼─")),
    ];
    for (let row = 0; row < rows; row++) {
      lines.push(sections.map((section) => {
        const value = section.items[row] ?? (row === 0 ? fg(DIM, section.empty) : "");
        return padAnsi(truncateToWidth(value, columnWidth), columnWidth);
      }).join(separator));
    }
    return lines;
  }

  const itemWidth = Math.max(12, width - 2);
  return sections.flatMap((section) => {
    const summary = section.items.length
      ? section.items.slice(0, width < 58 ? 1 : 2).map((item) => truncateText(item.replace(/\x1b\[[0-9;]*m/g, ""), itemWidth)).join("  ·  ")
      : section.empty;
    return [
      fg(section.color, `▸ ${section.title}`),
      fg(section.items.length ? TXT : DIM, truncateText(summary, itemWidth)),
    ];
  });
}

// pi caps widgets at 10 lines each — logo and dashboard are separate widgets
function logoLines(width: number): string[] {
  const date = new Date().toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  if (width < 72) {
    return [
      truncateToWidth(`${fg(ACC, "◆ NEURA")} ${fg(DIM, "/")} ${fg(ROSE, "agentic engineering console")}`, width),
      truncateToWidth(fg(TXT, greeting()), width),
      truncateToWidth(fg(DIM, `${date} · /health readiness`), width),
    ];
  }
  return [
    // vertical violet -> rose gradient down the wordmark
    ...LOGO.map((l, i) => fg(mix(ACC, ROSE, i / (LOGO.length - 1)), l)),
    "",
    `${fg(TXT, greeting())}  ${fg(DIM, `${date} · /dash dashboard · /health readiness`)}`,
  ];
}

// ---- extension ----

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  let visible = false;
  let persona = "";
  try { persona = fs.readFileSync(path.join(NEURA_DIR, "NEURA.md"), "utf-8"); } catch {}

  const show = (ctx, full: boolean) => {
    try {
      if (full) {
        ctx.ui.setWidget("neura-logo", () => ({
          render: (width: number) => logoLines(width),
          invalidate() {},
        }));
      }
      ctx.ui.setWidget("neura-dash", () => ({
        render: (width: number) => dashboard(width),
        invalidate() {},
      }));
      visible = true;
    } catch {}
  };
  const hide = (ctx) => {
    try {
      ctx.ui.setWidget("neura-logo", undefined);
      ctx.ui.setWidget("neura-dash", undefined);
      visible = false;
    } catch {}
  };

  pi.on("session_start", (_e, ctx) => {
    // session-only theme: Theme INSTANCE path does not persist to settings,
    // so plain `pi` keeps its own theme
    try {
      const t = ctx.ui.getTheme?.("neura-dark");
      if (t) ctx.ui.setTheme?.(t);
    } catch {}
    show(ctx, true); // logo + greeting + dashboard on launch
    // calendar arrives async; re-render if the dashboard is still up
    fetchCalendar().then((ev) => {
      if (ev.length) { calEvents = ev; if (visible) show(ctx, true); }
    }).catch(() => {});
  });
  pi.on("agent_start", (_e, ctx) => hide(ctx));         // auto-hide once work starts

  pi.registerCommand("dash", {
    description: "Toggle the Neura dashboard (todos · projects · week goals)",
    handler: async (_args, ctx) => (visible ? hide(ctx) : show(ctx, false)),
  });

  // persona: every turn, after other extensions' prompt changes
  pi.on("before_agent_start", (event) => {
    if (!persona) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + persona };
  });
}
