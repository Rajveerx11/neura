// harness-health — on-demand readiness console for the agentic engineering stack.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PALETTE,
  commandVersion,
  fg,
  getGitHealth,
  runProcess,
  truncateText,
} from "../neura/core.ts";
import { addCockpitNotice, patchCockpit, removeCockpitNotice } from "../neura/cockpit-state.ts";
import { fitLine } from "../neura/ui-tokens.ts";

type HealthReport = {
  state: "ready" | "degraded";
  core: string;
  workflow: string;
  context: string;
  workspace: string;
  bridges: string;
  impact: string;
  action: string;
};

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");

function versionLabel(value: string | null): string {
  if (!value) return "missing";
  return value.replace(/^git version\s+/i, "").replace(/^uvx\s+/i, "").split(/\s+/, 2).join(" ");
}

function countSkills(): number {
  const skillDir = path.join(os.homedir(), ".claude", "skills");
  try {
    return fs.readdirSync(skillDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

function mcpSummary(): { label: string; valid: boolean } {
  try {
    const raw = fs.readFileSync(path.join(AGENT_DIR, "mcp.json"), "utf-8");
    const servers = Object.values(JSON.parse(raw)?.mcpServers ?? {}) as { disabled?: boolean }[];
    const enabled = servers.filter((server) => !server.disabled).length;
    return { label: `${enabled}/${servers.length} MCP enabled`, valid: servers.length > 0 };
  } catch {
    return { label: "MCP config missing", valid: false };
  }
}

function modeShortcutReady(): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, "keybindings.json"), "utf-8"));
    const thinking = config?.["app.thinking.cycle"];
    const keys = Array.isArray(thinking) ? thinking : [thinking];
    return !keys.includes("shift+tab");
  } catch {
    return false;
  }
}

async function localModelOnline(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:8080/v1/models", {
      signal: AbortSignal.timeout(700),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function inspect(cwd: string): Promise<HealthReport> {
  const [piVersion, gitVersion, uvxVersion, autogit, git, qwen] = await Promise.all([
    commandVersion("pi"),
    commandVersion("git"),
    commandVersion("uvx"),
    runProcess(process.platform === "win32" ? "where.exe" : "which", ["autogit"]),
    getGitHealth(cwd),
    localModelOnline(),
  ]);

  const checkpoint = fs.existsSync(path.join(AGENT_DIR, "extensions", "checkpoint.ts"));
  const gate = fs.existsSync(path.join(AGENT_DIR, "extensions", "check-gate.ts"));
  const modes = fs.existsSync(path.join(AGENT_DIR, "extensions", "modes.ts"));
  const modeKeys = modeShortcutReady();
  const persona = fs.existsSync(path.join(AGENT_DIR, "neura", "NEURA.md"));
  const memory = fs.existsSync(path.join(AGENT_DIR, "neura", "MEMORY.md"));
  const skills = countSkills();
  const mcp = mcpSummary();
  const requiredOk = !!piVersion && !!gitVersion && !!uvxVersion && checkpoint && gate && modes && modeKeys && persona && skills > 0 && mcp.valid;

  const sync = [git.ahead ? `↑${git.ahead}` : "", git.behind ? `↓${git.behind}` : ""].filter(Boolean).join(" ");
  const changes = git.changed ? `${git.changed} changes` : "clean";
  const missing = [
    !uvxVersion ? "install uv" : "",
    !checkpoint || !gate || !modes ? "sync extensions" : "",
    !modeKeys ? "install mode keybindings" : "",
    !persona ? "restore persona" : "",
    !skills ? "configure skills" : "",
    !mcp.valid ? "restore mcp.json" : "",
  ].filter(Boolean);

  return {
    state: requiredOk ? "ready" : "degraded",
    core: `pi ${versionLabel(piVersion)}  ·  git ${versionLabel(gitVersion)}  ·  uvx ${versionLabel(uvxVersion)}`,
    workflow: `modes ${modes && modeKeys ? "ready" : "missing"} · checkpoint ${checkpoint ? "ready" : "missing"} · proof ${gate ? "ready" : "missing"} · autogit ${autogit.ok ? "ready" : "missing"}`,
    context: `persona ${persona ? "ready" : "missing"} · memory ${memory ? "ready" : "missing"} · skills ${skills || "missing"}`,
    workspace: git.isRepo ? `${git.branch}  ·  ${changes}${sync ? `  ·  ${sync}` : ""}` : "not a git workspace",
    bridges: `${mcp.label}  ·  local Qwen ${qwen ? "online" : "offline"}`,
    impact: requiredOk ? "No capability loss." : "Neura will continue with the listed capability gaps.",
    action: missing.length ? missing.join("  ·  ") : "agentic harness is ready",
  };
}

export function healthLines(report: HealthReport, width: number): string[] {
  const ok = report.state === "ready";
  const stateColor = ok ? PALETTE.success : PALETTE.warning;
  const line = (label: string, value: string, color = PALETTE.text) =>
    `${fg(PALETTE.dim, label.padEnd(10))}${fg(color, truncateText(value, Math.max(12, width - 10)))}`;

  return [
    `${fg(PALETTE.accent, "NEURA / HARNESS HEALTH")}  ${fg(stateColor, report.state.toUpperCase())}`,
    fg(PALETTE.border, "─".repeat(Math.max(1, Math.min(width, 72)))),
    line("core", report.core),
    line("workflow", report.workflow),
    line("context", report.context),
    line("workspace", report.workspace, PALETTE.muted),
    line("bridges", report.bridges, PALETTE.muted),
    line("impact", width < 40 ? "Terminal below 40 columns; emergency layout." : report.impact, width < 40 || !ok ? PALETTE.warning : PALETTE.muted),
    line(ok ? "status" : "next", report.action, ok ? PALETTE.success : PALETTE.warning),
    fg(PALETTE.dim, "/health close hides this panel"),
  ].map((value) => fitLine(value, width));
}

export default function (pi) {
  if (!process.env.NEURA) return;

  pi.registerCommand("health", {
    description: "Inspect Neura runtime, verification, context, workspace, and bridges",
    handler: async (args, ctx) => {
      if ((args ?? "").trim().toLowerCase() === "close") {
        ctx.ui.setWidget("neura-health", undefined);
        ctx.ui.setStatus("neura-health", undefined);
        return;
      }

      ctx.ui.setStatus("neura-health", "health check");
      patchCockpit({ operation: { verb: "health", target: "inspecting capabilities", startedAt: Date.now() } });
      const report = await inspect(ctx.cwd);
      ctx.ui.setStatus("neura-health", undefined);
      patchCockpit({ operation: undefined, phase: report.state === "degraded" ? "DEGRADED" : "READY", degraded: report.state === "degraded" ? report.action : undefined });
      if (report.state === "degraded") {
        addCockpitNotice({ id: "health", message: "Harness degraded", detail: report.action, tone: "warning", persistent: true });
      } else {
        removeCockpitNotice("health");
      }
      ctx.ui.setWidget("neura-health", () => ({
        render: (width: number) => healthLines(report, width),
        invalidate() {},
      }));
    },
  });
}
