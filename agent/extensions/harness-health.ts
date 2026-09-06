// harness-health — on-demand readiness console for the agentic engineering stack.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PALETTE,
  commandVersion,
  fg,
  getGitHealth,
  truncateText,
} from "../neura/core.ts";
import { addCockpitNotice, patchCockpit, removeCockpitNotice } from "../neura/cockpit-state.ts";
import { humanAwaySandboxAvailable } from "../neura/human-away-sandbox.ts";
import { fitLine } from "../neura/ui-tokens.ts";

type HealthReport = {
  state: "ready" | "degraded";
  pi: PiRuntimeStatus;
  core: string;
  workflow: string;
  context: string;
  workspace: string;
  bridges: string;
  impact: string;
  action: string;
};

type RuntimeContract = {
  schemaVersion?: unknown;
  piVersion?: unknown;
};

export type PiRuntimeStatus = {
  valid: boolean;
  installed: string | null;
  required: string | null;
  label: string;
  action: string | null;
};

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const RUNTIME_CONTRACT = fileURLToPath(new URL("../neura/runtime-contract.json", import.meta.url));

function versionLabel(value: string | null): string {
  if (!value) return "missing";
  return value.replace(/^git version\s+/i, "").replace(/^uvx\s+/i, "").split(/\s+/, 2).join(" ");
}

export function parseRuntimeContract(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contract = value as RuntimeContract;
  if (contract.schemaVersion !== 1 || typeof contract.piVersion !== "string") return null;
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(contract.piVersion) ? contract.piVersion : null;
}

function requiredPiVersion(): string | null {
  try { return parseRuntimeContract(JSON.parse(fs.readFileSync(RUNTIME_CONTRACT, "utf-8"))); }
  catch { return null; }
}

export function piRuntimeStatus(installedVersion: string | null, requiredVersion: string | null): PiRuntimeStatus {
  const installed = installedVersion?.trim() || null;
  if (!requiredVersion) {
    return {
      valid: false,
      installed,
      required: null,
      label: `pi ${versionLabel(installed)} (runtime contract missing)`,
      action: "restore runtime-contract.json",
    };
  }
  if (!installed) {
    return {
      valid: false,
      installed: null,
      required: requiredVersion,
      label: `pi missing (requires ${requiredVersion})`,
      action: `npm install -g @earendil-works/pi-coding-agent@${requiredVersion}`,
    };
  }
  if (installed !== requiredVersion) {
    return {
      valid: false,
      installed,
      required: requiredVersion,
      label: `pi ${versionLabel(installed)} (requires ${requiredVersion})`,
      action: `npm install -g @earendil-works/pi-coding-agent@${requiredVersion}`,
    };
  }
  return {
    valid: true,
    installed,
    required: requiredVersion,
    label: `pi ${versionLabel(installed)} (required ${requiredVersion})`,
    action: null,
  };
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
  const [piVersion, gitVersion, uvxVersion, git, qwen, sandbox] = await Promise.all([
    commandVersion("pi"),
    commandVersion("git"),
    commandVersion("uvx"),
    getGitHealth(cwd),
    localModelOnline(),
    humanAwaySandboxAvailable(),
  ]);
  const pi = piRuntimeStatus(piVersion, requiredPiVersion());

  const checkpoint = fs.existsSync(path.join(AGENT_DIR, "extensions", "checkpoint.ts"));
  const gate = fs.existsSync(path.join(AGENT_DIR, "extensions", "check-gate.ts"));
  const modes = fs.existsSync(path.join(AGENT_DIR, "extensions", "modes.ts"));
  const modeKeys = modeShortcutReady();
  const persona = fs.existsSync(path.join(AGENT_DIR, "neura", "NEURA.md"));
  const memory = fs.existsSync(path.join(AGENT_DIR, "neura", "MEMORY.md"));
  const skills = countSkills();
  const mcp = mcpSummary();
  const requiredOk = pi.valid && !!gitVersion && !!uvxVersion && checkpoint && gate && modes && modeKeys && persona && skills > 0 && mcp.valid && sandbox;

  const sync = [git.ahead ? `↑${git.ahead}` : "", git.behind ? `↓${git.behind}` : ""].filter(Boolean).join(" ");
  const changes = git.changed ? `${git.changed} changes` : "clean";
  const missing = [
    pi.action ?? "",
    !uvxVersion ? "install uv" : "",
    !checkpoint || !gate || !modes ? "sync extensions" : "",
    !modeKeys ? "install mode keybindings" : "",
    !persona ? "restore persona" : "",
    !skills ? "configure skills" : "",
    !mcp.valid ? "restore mcp.json" : "",
    !sandbox ? "install WSL2 + bubblewrap" : "",
  ].filter(Boolean);

  return {
    state: requiredOk ? "ready" : "degraded",
    pi,
    core: `git ${versionLabel(gitVersion)}  ·  uvx ${versionLabel(uvxVersion)}`,
    workflow: `modes ${modes && modeKeys ? "ready" : "missing"} · sandbox ${sandbox ? "ready" : "missing"} · proof ${gate ? "ready" : "missing"}`,
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
  const line = (label: string, value: string, color: string = PALETTE.text) =>
    `${fg(PALETTE.dim, label.padEnd(10))}${fg(color, truncateText(value, Math.max(12, width - 10)))}`;

  const wrapPlain = (value: string, color: string): string[] => {
    const characters = Array.from(value);
    const lines: string[] = [];
    for (let offset = 0; offset < characters.length; offset += Math.max(1, width)) {
      lines.push(fg(color, characters.slice(offset, offset + Math.max(1, width)).join("")));
    }
    return lines.length ? lines : [""];
  };
  const piLines = [
    ...wrapPlain(`pi installed ${report.pi.installed ?? "missing"}`, report.pi.valid ? PALETTE.text : PALETTE.warning),
    ...wrapPlain(`pi required  ${report.pi.required ?? "missing"}`, report.pi.valid ? PALETTE.muted : PALETTE.warning),
  ];
  const header = `${fg(PALETTE.accent, "NEURA / HARNESS HEALTH")}  ${fg(stateColor, report.state.toUpperCase())}`;
  const runtimeRows = [header, ...piLines];

  if (!ok) {
    const [primaryAction = "inspect degraded harness state"] = report.action.split("  ·  ").filter(Boolean);
    const prefix = "next ";
    const continuation = " ".repeat(prefix.length);
    const chunkWidth = Math.max(1, width - prefix.length);
    const characters = Array.from(primaryAction);
    const actionLines: string[] = [];
    for (let offset = 0; offset < characters.length; offset += chunkWidth) {
      const chunk = characters.slice(offset, offset + chunkWidth).join("");
      actionLines.push(`${fg(PALETTE.dim, offset === 0 ? prefix : continuation)}${fg(PALETTE.warning, chunk)}`);
    }
    const diagnostics = [
      { id: "core", line: line("core", report.core) },
      { id: "workflow", line: line("workflow", report.workflow) },
      { id: "context", line: line("context", report.context) },
      { id: "workspace", line: line("workspace", report.workspace, PALETTE.muted) },
      { id: "bridges", line: line("bridges", report.bridges, PALETTE.muted) },
      { id: "impact", line: line("impact", report.impact, PALETTE.warning) },
    ];
    const priorities = [
      /uv|extension|mode|sandbox|keybinding|proof/i.test(report.action) ? "workflow" : "",
      /skills|persona|memory/i.test(report.action) ? "context" : "",
      /mcp|qwen/i.test(report.action) ? "bridges" : "",
      /git|workspace/i.test(report.action) ? "workspace" : "",
      "core", "workflow", "context", "workspace", "bridges", "impact",
    ].filter(Boolean);
    const orderedDiagnostics = [...new Set(priorities)]
      .map((id) => diagnostics.find((item) => item.id === id)!)
      .filter(Boolean);
    const diagnosticBudget = Math.max(0, 10 - runtimeRows.length - actionLines.length);
    return [
      ...runtimeRows,
      ...orderedDiagnostics.slice(0, diagnosticBudget).map((item) => item.line),
      ...actionLines,
    ].map((value) => fitLine(value, width));
  }

  return [
    header,
    fg(PALETTE.border, "─".repeat(Math.max(1, Math.min(width, 72)))),
    ...piLines,
    line("core", report.core),
    line("workflow", report.workflow),
    line("context", report.context),
    line("workspace", report.workspace, PALETTE.muted),
    line("bridges", report.bridges, PALETTE.muted),
    line(ok ? "status" : "next", report.action, ok ? PALETTE.success : PALETTE.warning),
  ].map((value) => fitLine(value, width));
}

export function registerHealth(pi, inspectHealth = inspect) {
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
      const report = await inspectHealth(ctx.cwd);
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

export default function (pi) { registerHealth(pi); }
