// cockpit v2 — Neura footer: model · branch · ctx meter · cost, tight gaps, saffron palette.
// ctx% renders as an 8-cell bar; cost color-ramps by spend. Extension statuses show as a
// second line only when present. Delete file to unwire (built-in footer returns).

const fg = (hex: string, s: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}\x1b[0m`;
};
const ACC = "#a583d9", TEAL = "#d495b5", RED = "#e06c6c", YEL = "#d9a44a", DIM = "#56525e", MUT = "#8d8a94"; // orchid dusk

function ctxBar(pct: number): string {
  const cells = 8, filled = Math.round((pct / 100) * cells);
  const color = pct > 85 ? RED : pct > 60 ? YEL : ACC;
  return fg(color, "▰".repeat(filled)) + fg(DIM, "▱".repeat(cells - filled)) + " " + fg(MUT, Math.round(pct) + "%");
}

function costTag(cost: number): string {
  const color = cost >= 10 ? RED : cost >= 2 ? YEL : MUT;
  return fg(color, "$" + cost.toFixed(2));
}

function sessionCost(ctx): number | null {
  // ponytail: sum whatever usage/cost shape assistant messages carry; null when unknown
  try {
    let total = 0, found = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      const u = entry?.message?.usage;
      if (!u) continue;
      const c = typeof u.cost === "number" ? u.cost
        : u.cost && typeof u.cost === "object" ? Object.values(u.cost).reduce((a: number, b) => a + (typeof b === "number" ? b : 0), 0)
        : null;
      if (c !== null) { total += c as number; found = true; }
    }
    return found ? total : null;
  } catch { return null; }
}

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  pi.on("session_start", (_e, ctx) => {
    try {
      ctx.ui.setFooter((tui, _theme, footerData) => ({
        invalidate() {},
        render(_width: number): string[] {
          const parts: string[] = [];
          parts.push(fg(ACC, "▊ ") + fg(MUT, ctx.model?.id ?? "no model"));
          const branch = footerData.getGitBranch?.();
          if (branch) parts.push(fg(TEAL, branch));
          try {
            const u = ctx.getContextUsage?.();
            const pct = u?.percent ?? (u?.tokens && u?.contextWindow ? (u.tokens / u.contextWindow) * 100 : null);
            if (pct != null) parts.push(ctxBar(pct));
          } catch {}
          const cost = sessionCost(ctx);
          if (cost != null) parts.push(costTag(cost));
          const lines = [" " + parts.join(fg(DIM, "  ·  "))];
          // ops line: only when an extension publishes status (subagents, lsp, ...)
          try {
            const statuses = footerData.getExtensionStatuses?.();
            if (statuses && statuses.size > 0) {
              lines.push(" " + [...statuses.values()].map((s) => fg(DIM, String(s))).join(fg(DIM, "  ·  ")));
            }
          } catch {}
          return lines;
        },
        dispose: footerData.onBranchChange?.(() => tui.requestRender()),
      }));
    } catch {}
  });
}
