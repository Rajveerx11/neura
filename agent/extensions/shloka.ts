// shloka — one short Sanskrit verse bottom-right on each new Neura session.
// Compact 2-line display: ॥ verse ॥ over meaning — source. Rotates through
// ~50 short verses in ~/.pi/agent/neura/shlokas.json. Neura-only (NEURA env).
// Delete file to unwire.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const DIR = path.join(os.homedir(), ".pi", "agent", "neura");
const STATE = path.join(DIR, "shloka-state.json");

const fg = (hex: string, s: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}\x1b[0m`;
};
const SAND = "#e8a34a", DIM = "#4e5751"; // saffron reserved for the shloka alone

// display width via grapheme clusters — handles Devanagari conjuncts/matras
const seg = new Intl.Segmenter("hi", { granularity: "grapheme" });
const dispWidth = (s: string) => [...seg.segment(s.replace(/\x1b\[[0-9;]*m/g, ""))].length;
const rightAlign = (s: string, width: number) => " ".repeat(Math.max(0, width - dispWidth(s) - 1)) + s;

function nextShloka(): { sa: string; en: string; src: string } | null {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(DIR, "shlokas.json"), "utf-8"));
    if (!Array.isArray(list) || !list.length) return null;
    let idx = 0;
    try { idx = JSON.parse(fs.readFileSync(STATE, "utf-8")).idx ?? 0; } catch {}
    fs.writeFileSync(STATE, JSON.stringify({ idx: (idx + 1) % list.length }));
    return list[idx % list.length];
  } catch { return null; }
}

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  pi.on("session_start", (_e, ctx) => {
    const s = nextShloka();
    if (!s) return;
    try {
      ctx.ui.setWidget("neura-shloka", (_tui, _theme) => ({
        invalidate() {},
        render(width: number): string[] {
          return [
            rightAlign(fg(SAND, `॥ ${s.sa} ॥`), width),
            rightAlign(fg(DIM, `${s.en} — ${s.src}`), width),
          ];
        },
      }), { placement: "belowEditor" });
    } catch {}
  });

  pi.on("agent_start", (_e, ctx) => {
    try { ctx.ui.setWidget("neura-shloka", undefined); } catch {}
  });
}
