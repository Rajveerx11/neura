// Neura identity: one responsive launch wordmark, /dash, /notices,
// session title, and persona injection. Plain pi stays stock.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getCockpitState, onCockpitChange, patchCockpit, resetCockpit } from "../neura/cockpit-state.ts";
import { padAnsi, PALETTE, fg } from "../neura/core.ts";

const NEURA_DIR = path.join(os.homedir(), ".pi", "agent", "neura");
const { accent: ACC, human: HUMAN, muted: MUT, text: TXT } = PALETTE;

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

export function wordmarkLines(width: number, color: string = ACC): string[] {
  const source = width >= 56 ? FULL_WORDMARK : COMPACT_WORDMARK;
  return source.map((line) => truncateToWidth(fg(color, line), width));
}

function centered(line: string, width: number): string {
  const value = truncateToWidth(line, width, "");
  return " ".repeat(Math.max(0, Math.floor((width - visibleWidth(value)) / 2))) + value;
}

export function launchSurfaceLines(width: number, theme: Theme, model: string, workspace: string): string[] {
  const safeWidth = Math.max(1, width);
  const status = padAnsi(truncateToWidth(`  WORK  ${model}  ${workspace}`, safeWidth, "…", true), safeWidth);
  return [
    ...wordmarkLines(safeWidth, TXT).map((line) => centered(line, safeWidth)),
    "",
    theme.bg("customMessageBg", theme.fg("text", padAnsi("  TYPE YOUR TASK BELOW", safeWidth))),
    theme.bg("selectedBg", theme.fg("muted", status)),
  ];
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
  let launchHandle: OverlayHandle | undefined;
  let finishLaunch: (() => void) | undefined;
  let launchGeneration = 0;
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
        render: (width: number) => wordmarkLines(width),
        invalidate() {},
      }));
      markVisible();
    } catch {}
  };

  const show = (ctx) => {
    const generation = ++launchGeneration;
    if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
      showFallback(ctx);
      return;
    }
    markVisible();
    const model = ctx.model?.id || "model pending";
    const workspace = path.basename(ctx.cwd) || ctx.cwd;
    void ctx.ui.custom(
      (_tui, theme, _keybindings, done) => {
        finishLaunch = done;
        return {
          render: (width: number) => launchSurfaceLines(width, theme, model, workspace),
          invalidate() {},
        };
      },
      {
        overlay: true,
        overlayOptions: {
          width: "72%",
          minWidth: 30,
          maxHeight: 10,
          anchor: "center",
          margin: 1,
          nonCapturing: true,
        },
        onHandle: (handle) => {
          if (generation !== launchGeneration || !visible) handle.hide();
          else launchHandle = handle;
        },
      },
    ).catch(() => {
      if (generation === launchGeneration && visible) showFallback(ctx);
    }).finally(() => {
      if (generation === launchGeneration) {
        launchHandle = undefined;
        finishLaunch = undefined;
      }
    });
  };

  const hide = (ctx) => {
    try {
      launchGeneration++;
      finishLaunch?.();
      finishLaunch = undefined;
      launchHandle?.hide();
      launchHandle = undefined;
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
    show(ctx);
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
