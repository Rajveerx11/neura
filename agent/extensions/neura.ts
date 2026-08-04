// Neura identity: one responsive launch wordmark, /dash, /notices,
// session title, and persona injection. Plain pi stays stock.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { getCockpitState, onCockpitChange, patchCockpit, resetCockpit } from "../neura/cockpit-state.ts";
import { PALETTE, fg } from "../neura/core.ts";

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

export function wordmarkLines(width: number): string[] {
  const source = width >= 56 ? FULL_WORDMARK : COMPACT_WORDMARK;
  return source.map((line) => truncateToWidth(fg(ACC, line), width));
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

export default function (pi) {
  if (!process.env.NEURA) return;

  let visible = false;
  let noticesVisible = false;
  let activeContext: any;
  let persona = "";
  let unsubscribeCockpit = () => {};
  try { persona = fs.readFileSync(path.join(NEURA_DIR, "NEURA.md"), "utf-8"); } catch {}

  const show = (ctx) => {
    try {
      ctx.ui.setWidget("neura-launch", () => ({
        render: (width: number) => wordmarkLines(width),
        invalidate() {},
      }));
      visible = true;
      if (!getCockpitState().launchVisible) patchCockpit({ launchVisible: true });
    } catch {}
  };

  const hide = (ctx) => {
    try {
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
  pi.on("session_shutdown", () => unsubscribeCockpit());

  pi.registerCommand("dash", {
    description: "Toggle the Neura logo",
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
