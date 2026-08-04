import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { PLAN_MODE_TOOL_NAMES, isPlanToolInputAllowed } from "./plan-policy.ts";

export type PolicyRoute = "allow" | "review" | "human" | "deny";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ActionCategory =
  | "read-only"
  | "workspace-change"
  | "bounded-delete"
  | "protected-data"
  | "protected-control"
  | "remote-mutation"
  | "broad-destruction"
  | "unclassified-shell"
  | "external-tool";

export type ActionFacts = {
  target?: string;
  insideWorkspace?: boolean;
  exists?: boolean;
  file?: boolean;
  directory?: boolean;
  tracked?: boolean;
  generated?: boolean;
  size?: number;
};

export type InspectedAction = {
  toolName: string;
  workspace: string;
  summary: string;
  category: ActionCategory;
  risk: RiskLevel;
  route: PolicyRoute;
  reason: string;
  saferPath: string;
  requiresHumanInYolo: boolean;
  actionFingerprint: string;
  workspaceFingerprint: string;
  facts: ActionFacts;
};

type ToolEvent = { toolName?: unknown; input?: unknown };

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const PLAN_TOOLS = new Set(PLAN_MODE_TOOL_NAMES);

export const SECRET_PATH = /(?:^|[\\/\s"'=])(?:\.env(?:\.[\w.-]+)?|id_rsa|id_ed25519|[\w.-]+\.(?:pem|key)|auth\.json|credentials(?:\.[\w.-]+)?)(?=$|[\\/\s"'`;|&])/i;

const PROTECTED_CONTROL = /(?:^|[\\/])(?:\.git(?:[\\/]|$)|\.github[\\/]workflows(?:[\\/]|$)|agent[\\/]settings\.json$|agent[\\/]keybindings\.json$|agent[\\/]mcp\.json$|install\.ps1$|agent[\\/]extensions[\\/](?:guardrail|modes|autogit|plan-artifact)\.ts$|agent[\\/]neura[\\/](?:action-policy|approval-store|headmaster|mode-state|plan-policy|plan-renderer)\.(?:ts|md)$)/i;
const GENERATED_PATH = /(?:^|[\\/])(?:dist|build|coverage|\.cache|cache|tmp|temp)(?:[\\/]|$)|\.(?:tmp|cache)$/i;
const SHELL_CONTROL = /(?:\r|\n|;|&&|\|\||(?<!\|)\|(?!\|)|>|<|`|\$\()/;

const HARD_DENY = [
  { re: /\b(?:mkfs(?:\.[\w-]+)?|format\s+[a-z]:)(?:\s|$)/i, why: "disk formatting can destroy data outside the workspace" },
  { re: /\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b/i, why: "broad database destruction is irreversible" },
  { re: /\bterraform\s+destroy\b/i, why: "infrastructure destruction exceeds unattended authority" },
  { re: /\bkubectl\s+delete\s+(?:namespace|ns)\b/i, why: "namespace deletion has broad cluster impact" },
  { re: /\bdocker\s+system\s+prune\b/i, why: "system-wide Docker pruning is broader than the workspace" },
  { re: /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive[^\r\n]*--force|--force[^\r\n]*--recursive)\b|remove-item\b[^\r\n]*-recurse[^\r\n]*-force|remove-item\b[^\r\n]*-force[^\r\n]*-recurse|\b(?:rmdir|rd)\s+\/s\b|\bdel\s+\/[sf]\b/i, why: "recursive forced deletion is too broad for unattended approval" },
];

const HUMAN_ONLY_SHELL = [
  { re: /\bgit\s+push\b[^\r\n]*(?:--force(?:-with-lease)?\b|-f\b)/i, why: "force-push can rewrite shared history", yolo: true },
  { re: /\bgit\s+reset\s+--hard\b/i, why: "hard reset discards local work", yolo: true },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, why: "git clean deletes untracked work", yolo: true },
  { re: /\bgit\s+(?:checkout\s+--|restore\s+(?:--worktree\s+)?(?:\.|--source)|branch\s+-D\b)/i, why: "destructive git operation can discard work", yolo: true },
  { re: /\bgit\s+push\b/i, why: "command mutates a remote repository", yolo: false },
  { re: /\b(?:npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|gh\s+pr\s+merge|terraform\s+apply|kubectl\s+(?:apply|delete)|vercel\s+deploy|netlify\s+deploy)\b/i, why: "command mutates a remote or production-like system", yolo: true },
];

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedWorkspace(cwd: string): string {
  cwd = typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
  try { return fs.realpathSync(cwd); } catch { return path.resolve(cwd); }
}

export function workspaceFingerprint(cwd: string): string {
  const workspace = normalizedWorkspace(cwd);
  const git = spawnSync("git", ["status", "--porcelain=v1", "--branch"], {
    cwd: workspace,
    encoding: "utf-8",
    windowsHide: true,
    timeout: 1_500,
    maxBuffer: 4 * 1024 * 1024,
  });
  const state = git.status === 0 ? String(git.stdout ?? "") : "not-a-git-workspace";
  return sha256(`${workspace}\n${state}`);
}

function actionFingerprint(toolName: string, input: Record<string, unknown>, workspace: string): string {
  return sha256(JSON.stringify(stableValue({ toolName, input, workspace })));
}

function rawPath(input: Record<string, unknown>): string {
  return String(input.path ?? input.file_path ?? input.filePath ?? "").trim();
}

function insideWorkspace(target: string, cwd: string): boolean {
  const relative = path.relative(cwd, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function targetFacts(raw: string, cwd: string): ActionFacts {
  if (!raw) return {};
  const target = path.resolve(cwd, raw);
  const facts: ActionFacts = { target, insideWorkspace: insideWorkspace(target, cwd) };
  try {
    const stat = fs.statSync(target);
    facts.exists = true;
    facts.file = stat.isFile();
    facts.directory = stat.isDirectory();
    facts.size = stat.size;
  } catch {
    facts.exists = false;
  }
  facts.generated = GENERATED_PATH.test(path.relative(cwd, target));
  if (facts.insideWorkspace) {
    const relative = path.relative(cwd, target);
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relative], {
      cwd,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 1_000,
    });
    facts.tracked = tracked.status === 0;
  }
  return facts;
}

function redactCommand(command: string): string {
  return command
    .replace(/\b(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, "$1[REDACTED]")
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/g, "$1[REDACTED]")
    .replace(/(--?(?:password|token|api-key|secret)\s+)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, "$1[REDACTED]")
    .slice(0, 280);
}

function deleteTarget(command: string): string | null {
  const powershell = /\bremove-item\b(?:\s+-[\w-]+(?:\s+[^\s"']+)?)*\s+(?:-literalpath\s+|-path\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/i.exec(command);
  if (powershell) return powershell[1] ?? powershell[2] ?? powershell[3] ?? null;
  const posix = /(?:^|\s)rm\s+(?:-[a-z]+\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))\s*$/i.exec(command.trim());
  return posix ? posix[1] ?? posix[2] ?? posix[3] ?? null : null;
}

export function isPlanSafeShellCommand(command: string): boolean {
  const value = command.trim();
  if (!value || SHELL_CONTROL.test(value) || SECRET_PATH.test(value)) return false;
  if (/(?:^|\s)(?:\.\.[\\/]|~[\\/]|[a-z]:[\\/]|\\\\)|\b(?:env|variable|function|cert|registry|hklm|hkcu):/i.test(value)) return false;
  if (/--(?:pre(?:-glob)?|output)(?:=|\s|$)/i.test(value)) return false;
  return [
    /^(?:pwd|get-location)\b/i,
    /^(?:ls|get-childitem|get-item|get-content|select-string|resolve-path|test-path|measure-object)\b/i,
    /^rg\b/i,
    /^git\s+(?:status|diff|log|show|rev-parse|ls-files)\b/i,
    /^git\s+branch(?:\s+(?:--show-current|-a|-r|--all|--remotes))*\s*$/i,
  ].some((pattern) => pattern.test(value));
}

function isKnownDevelopmentCommand(command: string): boolean {
  const value = command.trim();
  if (!value || SHELL_CONTROL.test(value)) return false;
  return [
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|build|check|typecheck|verify)(?:\s|$)/i,
    /^(?:npx\s+)?(?:tsc|eslint|prettier|vitest|jest)(?:\s|$)/i,
    /^(?:node\s+--test|python\s+-m\s+pytest|pytest|go\s+test|cargo\s+(?:test|check|build)|dotnet\s+(?:test|build))(?:\s|$)/i,
    /^git\s+(?:add|commit)(?:\s|$)/i,
    /^(?:mkdir|new-item\s+-itemtype\s+directory)(?:\s|$)/i,
  ].some((pattern) => pattern.test(value));
}

function result(
  base: Pick<InspectedAction, "toolName" | "workspace" | "actionFingerprint" | "workspaceFingerprint">,
  details: Omit<InspectedAction, "toolName" | "workspace" | "actionFingerprint" | "workspaceFingerprint">,
): InspectedAction {
  return { ...base, ...details };
}

export function inspectAction(event: ToolEvent, cwdInput: string): InspectedAction {
  const workspace = normalizedWorkspace(cwdInput);
  const toolName = String(event.toolName ?? "unknown");
  const input = inputRecord(event.input);
  const workspaceState = workspaceFingerprint(workspace);
  const base = {
    toolName,
    workspace,
    actionFingerprint: actionFingerprint(toolName, input, workspace),
    workspaceFingerprint: workspaceState,
  };

  if (READ_TOOLS.has(toolName)) {
    const requestedPath = rawPath(input);
    const facts = requestedPath ? targetFacts(requestedPath, workspace) : {};
    if (requestedPath && SECRET_PATH.test(requestedPath)) {
      return result(base, {
        summary: `${toolName} protected secret path`, category: "protected-data", risk: "high", route: "human",
        reason: "Protected credentials must never enter unattended model context.",
        saferPath: "Use a masked key-name inspector or provide the required non-secret value manually.",
        requiresHumanInYolo: true, facts,
      });
    }
    if (requestedPath && facts.insideWorkspace === false) {
      return result(base, {
        summary: `${toolName} outside workspace: ${redactCommand(requestedPath)}`, category: "protected-control", risk: "high", route: "human",
        reason: "The requested path is outside Neura's active workspace boundary.",
        saferPath: "Copy a non-sensitive artifact into the workspace or inspect it with Rajveer present.",
        requiresHumanInYolo: true, facts,
      });
    }
    return result(base, {
      summary: requestedPath ? `${toolName} ${path.relative(workspace, path.resolve(workspace, requestedPath)) || "."}` : toolName,
      category: "read-only", risk: "low", route: "allow", reason: "Read-only workspace inspection.",
      saferPath: "", requiresHumanInYolo: false, facts,
    });
  }

  if (toolName === "edit" || toolName === "write") {
    const requestedPath = rawPath(input);
    const facts = requestedPath ? targetFacts(requestedPath, workspace) : {};
    const relative = requestedPath ? path.relative(workspace, path.resolve(workspace, requestedPath)) : "unknown path";
    if (!requestedPath || facts.insideWorkspace === false) {
      return result(base, {
        summary: `${toolName} outside workspace: ${redactCommand(requestedPath || "unknown path")}`,
        category: "protected-control", risk: "high", route: "human",
        reason: "Unattended writes are limited to the active workspace.",
        saferPath: "Move the target into the workspace or wait for Rajveer.", requiresHumanInYolo: true, facts,
      });
    }
    if (SECRET_PATH.test(requestedPath)) {
      return result(base, {
        summary: `${toolName} protected secret path: ${relative}`, category: "protected-data", risk: "critical", route: "human",
        reason: "Secret-bearing files stay under direct human control.",
        saferPath: "Edit a checked-in example file or ask Rajveer to apply the secret value.", requiresHumanInYolo: true, facts,
      });
    }
    if (PROTECTED_CONTROL.test(relative)) {
      return result(base, {
        summary: `${toolName} protected control file: ${relative}`, category: "protected-control", risk: "high", route: "human",
        reason: "This file controls Neura's safety boundary, credentials, or deployment behavior.",
        saferPath: "Prepare a patch for human review instead of changing the control plane unattended.", requiresHumanInYolo: true, facts,
      });
    }
    return result(base, {
      summary: `${toolName} ${relative}`, category: "workspace-change", risk: "low", route: "allow",
      reason: "Routine change inside the active workspace.", saferPath: "", requiresHumanInYolo: false, facts,
    });
  }

  if (toolName === "bash") {
    const command = String(input.command ?? "").trim();
    if (!command) {
      return result(base, {
        summary: "empty shell command", category: "unclassified-shell", risk: "high", route: "deny",
        reason: "An empty command cannot be meaningfully reviewed.", saferPath: "Provide one explicit command.",
        requiresHumanInYolo: true, facts: {},
      });
    }
    if (SECRET_PATH.test(command)) {
      return result(base, {
        summary: "shell command touching a protected secret path", category: "protected-data", risk: "critical", route: "human",
        reason: "The action may expose or modify credentials.",
        saferPath: "Use a masked inspector or wait for Rajveer to handle the secret-bearing file.",
        requiresHumanInYolo: true, facts: {},
      });
    }
    const hard = HARD_DENY.find(({ re }) => re.test(command));
    if (hard) {
      return result(base, {
        summary: redactCommand(command), category: "broad-destruction", risk: "critical", route: "deny",
        reason: hard.why, saferPath: "Narrow the action to one literal, recoverable workspace target.",
        requiresHumanInYolo: true, facts: {},
      });
    }
    const humanOnly = HUMAN_ONLY_SHELL.find(({ re }) => re.test(command));
    if (humanOnly) {
      return result(base, {
        summary: redactCommand(command), category: /push|publish|merge|apply|deploy/i.test(command) ? "remote-mutation" : "protected-control",
        risk: "critical", route: "human", reason: humanOnly.why,
        saferPath: "Use a reversible local operation or wait for Rajveer to approve the exact command.",
        requiresHumanInYolo: humanOnly.yolo, facts: {},
      });
    }
    const rawDeleteTarget = deleteTarget(command);
    if (rawDeleteTarget) {
      const facts = targetFacts(rawDeleteTarget, workspace);
      const automaticallyReviewable = facts.insideWorkspace === true && facts.file === true && facts.tracked === false && facts.generated === true;
      return result(base, {
        summary: `delete ${facts.insideWorkspace ? path.relative(workspace, facts.target!) : redactCommand(rawDeleteTarget)}`,
        category: "bounded-delete", risk: automaticallyReviewable ? "medium" : "high",
        route: automaticallyReviewable ? "review" : "human",
        reason: automaticallyReviewable
          ? "One untracked generated file can be reviewed for exact-action approval."
          : "Deletion is not proven generated, untracked, literal, and bounded to one workspace file.",
        saferPath: "Regenerate or archive the target; otherwise wait for exact human approval.",
        requiresHumanInYolo: true, facts,
      });
    }
    if (isPlanSafeShellCommand(command)) {
      return result(base, {
        summary: redactCommand(command), category: "read-only", risk: "low", route: "allow",
        reason: "Command matches Neura's exact read-only allowlist.", saferPath: "", requiresHumanInYolo: false, facts: {},
      });
    }
    if (isKnownDevelopmentCommand(command)) {
      return result(base, {
        summary: redactCommand(command), category: "workspace-change", risk: "medium", route: "allow",
        reason: "Known local build, test, validation, or git-recording command.", saferPath: "", requiresHumanInYolo: false, facts: {},
      });
    }
    return result(base, {
      summary: redactCommand(command), category: "unclassified-shell", risk: "high", route: "human",
      reason: "Opaque shell execution cannot be bounded reliably without an OS sandbox.",
      saferPath: "Use built-in read/edit/write tools or one command from the documented development allowlist.",
      requiresHumanInYolo: false, facts: {},
    });
  }

  return result(base, {
    summary: `${toolName} external tool call`, category: "external-tool", risk: "high", route: "human",
    reason: "This custom tool has no audited unattended policy yet.",
    saferPath: "Use a built-in workspace tool or wait for Rajveer to approve the external action.",
    requiresHumanInYolo: false, facts: {},
  });
}

export function isPlanActionAllowed(event: ToolEvent, cwd: string): boolean {
  const toolName = String(event.toolName ?? "unknown");
  if (!PLAN_TOOLS.has(toolName)) return false;
  if (toolName === "bash") return isPlanSafeShellCommand(String(inputRecord(event.input).command ?? ""));
  if (toolName === "read") return inspectAction(event, cwd).route === "allow";
  return isPlanToolInputAllowed(toolName, event.input);
}
