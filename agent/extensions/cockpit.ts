// cockpit v3 — responsive Neura footer: model · branch · context · cost · live operations.
// ctx% renders as an 8-cell bar; cost color-ramps by spend. Extension statuses show as a
// second line only when present. Delete file to unwire (built-in footer returns).

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { PALETTE, fg } from "../neura/core.ts";

const { accent: ACC, rose: ROSE, error: RED, warning: YEL, dim: DIM, muted: MUT } = PALETTE;

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
        render(width: number): string[] {
          const parts: string[] = [fg(ACC, "▊ ") + fg(MUT, ctx.model?.id ?? "no model")];
          const branch = footerData.getGitBranch?.();
          if (branch) parts.push(fg(ROSE, branch));
          try {
            const u = ctx.getContextUsage?.();
            const pct = u?.percent ?? (u?.tokens && u?.contextWindow ? (u.tokens / u.contextWindow) * 100 : null);
            if (pct != null) parts.push(ctxBar(pct));
          } catch {}
          const cost = sessionCost(ctx);
          if (cost != null) parts.push(costTag(cost));
          const separator = fg(DIM, "  ·  ");
          const selected: string[] = [];
          for (const part of parts) {
            const candidate = " " + [...selected, part].join(separator);
            if (selected.length && visibleWidth(candidate) > width) break;
            selected.push(part);
          }
          const lines = [truncateToWidth(" " + selected.join(separator), width)];
          // ops line: only when an extension publishes status (subagents, lsp, ...)
          try {
            const statuses = footerData.getExtensionStatuses?.();
            if (statuses && statuses.size > 0) {
              const statusLine = " " + [...statuses.values()].map((s) => fg(MUT, String(s))).join(separator);
              lines.push(truncateToWidth(statusLine, width));
            }
          } catch {}
          return lines;
        },
        dispose: footerData.onBranchChange?.(() => tui.requestRender()),
      }));
    } catch {}
  });
}
