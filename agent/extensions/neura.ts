// Neura identity: one responsive launch wordmark, /dash, /notices,
// session title, and persona injection. The exact supplied mark is rendered by
// Neura's Windows Terminal profile; this terminal-native layer stays readable
// over it. Plain Pi stays stock.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CustomEditor, type ExtensionAPI, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getCockpitState, onCockpitChange, patchCockpit, resetCockpit } from "../neura/cockpit-state.ts";
import { padAnsi, PALETTE, fg } from "../neura/core.ts";

const NEURA_DIR = path.join(os.homedir(), ".pi", "agent", "neura");
const { accent: ACC, human: HUMAN, muted: MUT, text: TXT } = PALETTE;

// The image-backed Windows Terminal profile renders the exact supplied mark,
// so this terminal layer adds only the wordmark and never overdraws the
// artwork with a second, approximated mark. The glyphs below are a fixed-width
// five-row block face: every letter occupies the same columns on every row, so
// "NEURA" stays aligned and legible over any artwork or plain background.
const NEURA_WORDMARK = [
  "█  █ █▀▀▀ █  █ █▀▀▄ ▄▀▀▄",
  "██ █ █▀▀  █  █ █  █ █  █",
  "█ ██ ██▀▀ █  █ █▀▀  █▀▀█",
  "█  █ █▀▀  █  █ █ ▀▄ █  █",
  "▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀",
];

export function wordmarkLines(width: number, color: string = TXT): string[] {
  return NEURA_WORDMARK.map((line) => truncateToWidth(fg(color, line), width));
}

function centered(line: string, width: number): string {
  const value = truncateToWidth(line, width, "");
  return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(value)) / 2)))}${value}`;
}

function logoLines(width: number, color: string = TXT): string[] {
  return wordmarkLines(width, color).map((line) => centered(line, width));
}

export function launchSurfaceLines(width: number, theme: Theme, editorLines: string[]): string[] {
  const safeWidth = Math.max(1, width);
  const identity = wordmarkLines(safeWidth, TXT).map((line) => centered(line, safeWidth));
  const status = `${fg(MUT, "Neura Agent v2.5.1")}${fg(HUMAN, "  ·  READY")}`;
  return [
    ...identity,
    centered(status, safeWidth),
    "",
    theme.bg("customMessageBg", theme.fg("text", padAnsi(truncateToWidth("  NEURA AGENT · TYPE YOUR TASK", safeWidth), safeWidth))),
    ...editorLines,
  ].map((line) => truncateToWidth(line, safeWidth));
}

class LaunchEditor extends CustomEditor {
  constructor(tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager, private readonly presentationTheme: Theme) {
    super(tui, editorTheme, keybindings);
  }

  render(width: number): string[] {
    const contentWidth = Math.min(84, width, Math.max(30, Math.floor(width * 0.58)));
    const content = launchSurfaceLines(contentWidth, this.presentationTheme, super.render(contentWidth));
    const left = " ".repeat(Math.max(0, Math.floor((width - contentWidth) / 2)));
    const top = Math.max(0, Math.floor((this.tui.terminal.rows - content.length - 1) / 2));
    return [...Array(top).fill(""), ...content.map((line) => left + line)];
  }
}

function noticeLines(width: number): string[] {
  const notices = getCockpitState().notices;
  const lines = [truncateToWidth(fg(ACC, `NEURA / NOTICES  ${notices.length}`), width)];
  if (!notices.length) return [...lines, fg(PALETTE.success, "No Neura notices.")];
  for (const notice of notices.slice(-4)) {
    const color = notice.tone === "error"
      ? PALETTE.error
      : notice.tone === "warning"
        ? HUMAN
        : notice.tone === "success"
          ? PALETTE.success
          : MUT;
    lines.push(truncateToWidth(`${fg(color, notice.id)}  ${fg(TXT, notice.message)}`, width));
    if (notice.detail) lines.push(truncateToWidth(`${" ".repeat(Math.min(10, width))}${fg(PALETTE.dim, notice.detail)}`, width));
  }
  lines.push(truncateToWidth(fg(PALETTE.dim, "/notices close hides this panel"), width));
  return lines.slice(0, 10);
}

export default function (pi: ExtensionAPI) {
  if (!process.env.NEURA) return;

  let visible = false;
  let noticesVisible = false;
  let activeContext: any;
  let previousEditorFactory: any;
  let launchEditorActive = false;
  let persona = "";
  let unsubscribeCockpit = () => {};
  try { persona = fs.readFileSync(path.join(NEURA_DIR, "NEURA.md"), "utf-8"); } catch {}

  const markVisible = () => {
    visible = true;
    if (!getCockpitState().launchVisible) patchCockpit({ launchVisible: true });
  };

  const showFallback = (ctx) => {
    try {
      ctx.ui.setWidget("neura-launch", () => ({
        render: (width: number) => logoLines(width),
        invalidate() {},
      }));
      markVisible();
    } catch {}
  };

  const show = (ctx) => {
    if (ctx.mode !== "tui" || typeof ctx.ui.setEditorComponent !== "function") {
      showFallback(ctx);
      return;
    }
    if (!launchEditorActive) previousEditorFactory = ctx.ui.getEditorComponent?.();
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => new LaunchEditor(tui, editorTheme, keybindings, ctx.ui.theme));
    launchEditorActive = true;
    markVisible();
  };

  const hide = (ctx) => {
    try {
      if (launchEditorActive) ctx.ui.setEditorComponent(previousEditorFactory);
      launchEditorActive = false;
      previousEditorFactory = undefined;
      ctx.ui.setWidget("neura-launch", undefined);
      visible = false;
      if (getCockpitState().launchVisible) patchCockpit({ launchVisible: false });
    } catch {}
  };

  const showNotices = (ctx) => {
    ctx.ui.setWidget("neura-notices", () => ({ render: (width: number) => noticeLines(width), invalidate() {} }));
    noticesVisible = true;
  };

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    // A resumed session already has chat history. The full-height launch editor
    // belongs only to a fresh conversation; otherwise it pushes history offscreen.
    if (launchEditorActive) hide(ctx);
    resetCockpit();
    try {
      const theme = ctx.ui.getTheme?.("neura-dark");
      if (theme) ctx.ui.setTheme?.(theme);
      ctx.ui.setTitle(`Neura · ${ctx.cwd}`);
    } catch {}

    unsubscribeCockpit();
    unsubscribeCockpit = onCockpitChange(() => {
      if (visible && !getCockpitState().launchVisible) patchCockpit({ launchVisible: true });
      if (noticesVisible && activeContext) showNotices(activeContext);
    });
    const hasConversation = ctx.sessionManager?.getBranch?.().some((entry) => entry.type === "message");
    if (!hasConversation && !["resume", "fork"].includes(_event?.reason)) show(ctx);
  });

  pi.on("agent_start", (_event, ctx) => hide(ctx));
  pi.on("session_shutdown", () => {
    if (activeContext) hide(activeContext);
    unsubscribeCockpit();
  });

  pi.registerCommand("dash", {
    description: "Toggle the Neura launch surface",
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
