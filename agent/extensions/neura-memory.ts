// neura-memory — persistent cross-session memory, the Claude Code model:
// one markdown file of facts, injected into every turn, editable by user (/remember)
// and by the agent itself (it's told the path). Delete file to unwire.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getMode } from "../neura/mode-state.ts";

const MEMORY_FILE = path.join(os.homedir(), ".pi", "agent", "neura", "MEMORY.md");

function readMemory(): string {
  try { return fs.readFileSync(MEMORY_FILE, "utf-8").trim(); } catch { return ""; }
}

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  pi.on("before_agent_start", (event) => {
    if (getMode() !== "yolo") return;
    const mem = readMemory();
    if (!mem) return;
    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n# Persistent memory (survives sessions)\n` +
        `Facts worth remembering live in ${MEMORY_FILE} — update it with your file tools when you learn ` +
        `a durable preference, decision, or project fact. Keep one short bullet per fact; prune stale ones.\n\n` +
        mem,
    };
  });

  pi.registerCommand("remember", {
    description: "Save a fact to persistent memory (survives sessions)",
    handler: async (args, ctx) => {
      if (getMode() !== "yolo") return void ctx.ui.notify("/remember requires YOLO; use optional Learn progress for learning notes.", "warning");
      const fact = (args ?? "").trim();
      if (!fact) return void ctx.ui.notify("usage: /remember <fact>", "warning");
      const today = new Date().toISOString().slice(0, 10);
      try {
        fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
        const existing = readMemory();
        const header = existing ? "" : "# Neura memory\n\n";
        fs.appendFileSync(MEMORY_FILE, `${existing ? "" : header}- ${fact} _(${today})_\n`);
        ctx.ui.notify("remembered");
      } catch (e) {
        ctx.ui.notify(`could not write memory: ${e}`, "error");
      }
    },
  });

  pi.registerCommand("memory", {
    description: "Show persistent memory",
    handler: async (_args, ctx) => {
      if (getMode() !== "yolo") return void ctx.ui.notify("Private persistent memory is unavailable in this mode.", "warning");
      const mem = readMemory();
      ctx.ui.notify(mem || "memory is empty — /remember <fact> to add");
    },
  });
}
