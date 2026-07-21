// cockpit — minimal Neura footer: model · branch · ctx% · cost, tight gaps.
// Extension statuses (subagents etc.) appear as a second line only when present.
// Delete file to unwire (built-in footer returns).

const fg = (hex: string, s: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}\x1b[0m`;
};
const ACC = "#7c9cff", GRN = "#57d4a8", YEL = "#f0b754", DIM = "#525b6e", MUT = "#828da3", PUR = "#b78cf7";

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
  pi.on("session_start", (_e, ctx) => {
    try {
      ctx.ui.setFooter((tui, _theme, footerData) => ({
        invalidate() {},
        render(_width: number): string[] {
          const parts: string[] = [];
          parts.push(fg(GRN, "●") + " " + fg(MUT, ctx.model?.id ?? "no model"));
          const branch = footerData.getGitBranch?.();
          if (branch) parts.push(fg(PUR, branch));
          try {
            const u = ctx.getContextUsage?.();
            const pct = u?.percent ?? (u?.tokens && u?.contextWindow ? (u.tokens / u.contextWindow) * 100 : null);
            if (pct != null) parts.push(fg(MUT, "ctx ") + fg(pct > 75 ? YEL : MUT, Math.round(pct) + "%"));
          } catch {}
          const cost = sessionCost(ctx);
          if (cost != null) parts.push(fg(MUT, "$" + cost.toFixed(2)));
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
