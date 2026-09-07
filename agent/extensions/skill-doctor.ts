// skill-doctor — /skill-doctor scans loaded skill dirs for Claude-only tool references
// so you know which skills need porting before they misfire in pi. Delete file to unwire.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getMode } from "../neura/mode-state.ts";

const SKILL_DIRS = [
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".pi", "agent", "skills"),
];

// Tool names that exist in Claude Code's harness but not in pi
const CLAUDE_ONLY = [
  /\bmcp__[a-z0-9_]+__/i,      // Claude-side MCP tool names
  /\bArtifact\b/,               // claude.ai artifacts
  /\bAskUserQuestion\b/,
  /\bWorkflow\(/,
  /\bToolSearch\b/,
  /claude\.ai\/code|claude\.ai connector/i,
];

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  pi.registerCommand("skill-doctor", {
    description: "Scan skills for Claude-only tool references that won't work in pi",
    handler: async (_args, ctx) => {
      if (getMode() !== "yolo") return void ctx.ui.notify("/skill-doctor requires YOLO because it writes a report outside the workspace.", "warning");
      const flagged = [];
      let scanned = 0;
      for (const dir of SKILL_DIRS) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const md = path.join(dir, entry.name, "SKILL.md");
          if (!fs.existsSync(md)) continue;
          scanned++;
          const text = fs.readFileSync(md, "utf-8");
          const hits = CLAUDE_ONLY.filter((re) => re.test(text)).map((re) => String(re));
          if (hits.length) flagged.push({ skill: entry.name, hits });
        }
      }
      const reportPath = path.join(os.homedir(), ".pi", "agent", "skill-doctor-report.md");
      const lines = [
        `# skill-doctor — ${scanned} skills scanned, ${flagged.length} flagged`,
        "",
        ...flagged.map((f) => `- **${f.skill}** — matches: ${f.hits.join(", ")}`),
        "",
        "Flagged skills reference Claude Code harness features. They may still partly work in pi; port or ignore case by case.",
      ];
      fs.writeFileSync(reportPath, lines.join("\n"));
      ctx.ui.notify(`${flagged.length}/${scanned} skills flagged (${flagged.slice(0, 5).map((f) => f.skill).join(", ")}${flagged.length > 5 ? "…" : ""}). Report: ${reportPath}`, flagged.length ? "warning" : "info");
    },
  });
}
