// neura — Rajveer's personal agent layer: ASCII logo + time-aware greeting,
// auto dashboard (todos from Obsidian · projects from session store · week goals),
// /dash toggle, persona injection from NEURA.md. Delete file to unwire.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const VAULT = "C:/Users/rajve/OneDrive/Documents/Obsidian Vault"; // from plan-day/learn-day profile
const LEARN_PROFILE = path.join(os.homedir(), ".claude", "skills", "learn-day", "data", "profile.md");
const NEURA_DIR = path.join(os.homedir(), ".pi", "agent", "neura");
const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");

// truecolor helpers (no emojis — geometric symbols only)
const fg = (hex: string, s: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}\x1b[0m`;
};
const ACC = "#3d8f7a", GRN = "#7fc4ae", PUR = "#8a938e", DIM = "#4e5751", TXT = "#dde3df"; // jade · mint · slate

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

function recentProjects(): string[] {
  try {
    return fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const st = fs.statSync(path.join(SESSIONS_DIR, e.name));
        // "--C--Axon Landing Page--" -> "Axon Landing Page"
        const parts = e.name.replace(/^--|--$/g, "").split("--").filter(Boolean);
        const name = (parts.pop() || e.name).split(/[\\/]/).pop()!;
        return { name: name.slice(0, 26), mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime).slice(0, 4)
      .map((p) => {
        const days = Math.floor((Date.now() - p.mtime) / 86400000);
        const ago = days === 0 ? "today" : days === 1 ? "1d ago" : days < 7 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
        return `${p.name} ${fg(DIM, "· " + ago)}`;
      });
  } catch { return []; }
}

// ---- rendering ----

// ponytail: fixed 34-char columns; a width-aware renderer can come later
const COL = 34;
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s: string) => s + " ".repeat(Math.max(0, COL - strip(s).length));

function dashboard(): string[] {
  const todos = todayTodos().map((t) => `${t.done ? fg(DIM, "[x]") : fg(TXT, "[ ]")} ${fg(t.done ? DIM : TXT, t.text)}`);
  const projects = recentProjects();
  const goals = weekGoals().map((g) => fg(TXT, g.slice(0, 30)));
  const cols: [string, string[]][] = [
    [fg(ACC, "▸ Today"), todos.length ? todos : [fg(DIM, "no daily note found")]],
    [fg(GRN, "▸ Projects"), projects.length ? projects : [fg(DIM, "none yet")]],
    [fg(PUR, "▸ This week"), goals.length ? goals : [fg(DIM, "no open goals")]],
  ];
  const rows = Math.max(...cols.map(([, c]) => c.length)) + 1;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(cols.map(([h, c]) => pad(r === 0 ? h : c[r - 1] ?? "")).join(""));
  }
  return lines;
}

function banner(): string[] {
  return [
    ...LOGO.map((l) => fg(ACC, l)),
    "",
    `${fg(TXT, greeting())}  ${fg(DIM, "/dash toggles this dashboard")}`,
    "",
    ...dashboard(),
  ];
}

// ---- extension ----

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  let visible = false;
  let persona = "";
  try { persona = fs.readFileSync(path.join(NEURA_DIR, "NEURA.md"), "utf-8"); } catch {}

  const show = (ctx, full: boolean) => {
    try { ctx.ui.setWidget("neura", full ? banner() : dashboard()); visible = true; } catch {}
  };
  const hide = (ctx) => { try { ctx.ui.setWidget("neura", undefined); visible = false; } catch {} };

  pi.on("session_start", (_e, ctx) => {
    // session-only theme: Theme INSTANCE path does not persist to settings,
    // so plain `pi` keeps its own theme
    try {
      const t = ctx.ui.getTheme?.("neura-dark");
      if (t) ctx.ui.setTheme?.(t);
    } catch {}
    show(ctx, true); // logo + greeting + dashboard on launch
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
