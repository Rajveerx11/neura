// shloka — on every new session, one Sanskrit shloka bottom-right (below editor),
// rotating through ~105 verses in ~/.pi/agent/neura/shlokas.json. Hides when work starts.
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
const SAND = "#f2c98a", DIM = "#525b6e";

// terminal display width ~ chars minus ANSI codes and Devanagari combining marks
const dispWidth = (s: string) =>
  s.replace(/\x1b\[[0-9;]*m/g, "").replace(/[ऀ-ःऺ-्॑-ॗॢॣ]/g, "").length;
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
  pi.on("session_start", (_e, ctx) => {
    const s = nextShloka();
    if (!s) return;
    try {
      ctx.ui.setWidget("neura-shloka", (_tui, _theme) => ({
        invalidate() {},
        render(width: number): string[] {
          // ponytail: split long shlokas at the danda so lines stay readable
          const parts = s.sa.split("। ").map((p, i, a) => (i < a.length - 1 ? p + "।" : p));
          return [
            "",
            ...parts.map((p) => rightAlign(fg(SAND, p), width)),
            rightAlign(fg(DIM, `${s.en}`), width),
            rightAlign(fg(DIM, `— ${s.src}`), width),
          ];
        },
      }), { placement: "belowEditor" });
    } catch {}
  });

  pi.on("agent_start", (_e, ctx) => {
    try { ctx.ui.setWidget("neura-shloka", undefined); } catch {}
  });
}
