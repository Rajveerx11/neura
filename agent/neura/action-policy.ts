import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shellTokens, hasUnquotedPowerShellOperator, hasUnquotedPowerShellExpansion, planShellFilesystemArguments } from "./plan-shell-parser.ts";
import { PLAN_MODE_TOOL_NAMES, isPlanToolInputAllowed } from "./plan-policy.ts";
import { HUMAN_AWAY_SANDBOX_TOOL, WORK_SANDBOX_TOOL } from "./human-away-sandbox.ts";
import { redactSensitiveText } from "./redaction.ts";
import { AUTOMATIC_GIT_ARGUMENTS, automaticGitEnvironment, resolveExecutable } from "./process-security.ts";

export type { PolicyRoute, RiskLevel, ActionCategory, ActionFacts, InspectedAction, ApprovalBinding } from "./action-contracts.ts";
import type { ActionFacts, InspectedAction, ToolEvent } from "./action-contracts.ts";
import { describeCapability, WORKSPACE_READ_TOOL_NAMES } from "./capabilities.ts";
import { SECRET_PATH, PROTECTED_CONTROL } from "./action-paths.ts";
export { SECRET_PATH } from "./action-paths.ts";

const READ_TOOLS = new Set(WORKSPACE_READ_TOOL_NAMES);
const PLAN_TOOLS = new Set(PLAN_MODE_TOOL_NAMES);


const GENERATED_PATH = /(?:^|[\\/])(?:dist|build|coverage|\.cache|cache|tmp|temp)(?:[\\/]|$)|\.(?:tmp|cache)$/i;
const SHELL_CONTROL = /(?:\r|\n|[;&|><`()]|\$\()/;

const HARD_DENY = [
  { re: /\b(?:mkfs(?:\.[\w-]+)?|format\s+[a-z]:)(?:\s|$)/i, why: "disk formatting can destroy data outside the workspace" },
  { re: /\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b/i, why: "broad database destruction is irreversible" },
  { re: /\bterraform\s+destroy\b/i, why: "infrastructure destruction exceeds unattended authority" },
  { re: /\bkubectl\s+delete\s+(?:namespace|ns)\b/i, why: "namespace deletion has broad cluster impact" },
  { re: /\bdocker\s+system\s+prune\b/i, why: "system-wide Docker pruning is broader than the workspace" },
  { re: /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive[^\r\n]*--force|--force[^\r\n]*--recursive)\b|remove-item\b[^\r\n]*-recurse[^\r\n]*-force|remove-item\b[^\r\n]*-force[^\r\n]*-recurse|\b(?:rmdir|rd)\s+\/s\b|\bdel\s+\/[sf]\b/i, why: "recursive forced deletion is too broad for unattended approval" },
  { re: /\brm\s+(?:-[a-z]*r[a-z]*|--recursive)(?:\s|$)|\bfind\b[^\r\n]*\s-delete(?:\s|$)/i, why: "recursive or discovered-set deletion is too broad for unattended approval" },
];

const HUMAN_ONLY_SHELL = [
  { re: /\bgit\s+(?:add|commit)(?:\s|$)/i, why: "Git index and history mutation require direct human approval" },
  { re: /\bgit\s+push\b[^\r\n]*(?:--force(?:-with-lease)?\b|-f\b)/i, why: "force-push can rewrite shared history" },
  { re: /\bgit\s+reset\s+--hard\b/i, why: "hard reset discards local work" },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, why: "git clean deletes untracked work" },
  { re: /\bgit\s+(?:checkout\s+--|restore\s+(?:--worktree\s+)?(?:\.|--source)|branch\s+-D\b)/i, why: "destructive git operation can discard work" },
  { re: /\bgit\s+push\b/i, why: "command mutates a remote repository" },
  { re: /\b(?:npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|gh\s+pr\s+merge|terraform\s+apply|kubectl\s+(?:apply|delete)|vercel\s+deploy|netlify\s+deploy)\b/i, why: "command mutates a remote or production-like system" },
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

function hashFile(file: string): string {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

function pathState(target: string | undefined): string {
  if (!target) return sha256("no-target");
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    if (stat.isSymbolicLink()) return sha256(`symlink\0${fs.readlinkSync(target)}`);
    if (stat.isFile()) return sha256(`file\0${stat.size}\0${hashFile(target)}`);
    return sha256(`node\0${stat.mode}\0${stat.size}\0${stat.mtimeNs}`);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    return sha256(`missing\0${code}`);
  }
}

function git(workspace: string, args: string[], encoding: BufferEncoding | null = "utf-8") {
  const executable = resolveExecutable("git", workspace);
  if (!executable) throw new Error("Git executable unavailable.");
  return spawnSync(executable, [...AUTOMATIC_GIT_ARGUMENTS, ...args], {
    cwd: workspace,
    encoding,
    env: automaticGitEnvironment(),
    windowsHide: true,
    timeout: 2_500,
    maxBuffer: 16 * 1024 * 1024,
  });
}

type WorkspaceState = {
  head: string;
  indexFingerprint: string;
  worktreeFingerprint: string;
  fingerprint: string;
};

function captureWorkspaceState(cwd: string): WorkspaceState {
  const workspace = normalizedWorkspace(cwd);
  const headResult = git(workspace, ["rev-parse", "--verify", "HEAD"]);
  const head = headResult.status === 0 ? String(headResult.stdout ?? "").trim() : "no-head";
  const indexResult = git(workspace, ["ls-files", "--stage", "-z"], null);
  const indexBytes = indexResult.status === 0 && Buffer.isBuffer(indexResult.stdout)
    ? indexResult.stdout
    : Buffer.from("no-index");
  const indexFingerprint = createHash("sha256").update(indexBytes).digest("hex");
  const statusResult = git(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"], null);
  const statusBytes = statusResult.status === 0 && Buffer.isBuffer(statusResult.stdout)
    ? statusResult.stdout
    : Buffer.from("not-a-git-workspace");
  const statusEntries = statusBytes.toString("utf-8").split("\0").filter(Boolean);
  const changedState: string[] = [];
  for (let index = 0; index < statusEntries.length; index++) {
    const entry = statusEntries[index];
    const code = entry.slice(0, 2);
    const relative = entry.slice(3);
    if (relative) changedState.push(`${relative}\0${pathState(path.resolve(workspace, relative))}`);
    if (/[RC]/.test(code) && statusEntries[index + 1]) index++;
  }
  const worktreeFingerprint = sha256(`${statusBytes.toString("base64")}\n${changedState.sort().join("\n")}`);
  return {
    head,
    indexFingerprint,
    worktreeFingerprint,
    fingerprint: sha256(`${workspace}\n${head}\n${indexFingerprint}\n${worktreeFingerprint}`),
  };
}

function normalizedWorkspace(cwd: string): string {
  cwd = typeof cwd === "string" && cwd.trim() ? cwd : process.cwd();
  try { return fs.realpathSync(cwd); } catch { return path.resolve(cwd); }
}

export function workspaceFingerprint(cwd: string): string {
  return captureWorkspaceState(cwd).fingerprint;
}

function actionFingerprint(toolName: string, input: Record<string, unknown>, workspace: string): string {
  return sha256(JSON.stringify(stableValue({ toolName, input, workspace })));
}

function rawPath(input: Record<string, unknown>): string {
  return String(input.path ?? input.file_path ?? input.filePath ?? "").trim();
}

function targetsSecretPath(requestedPath: string, facts: ActionFacts, workspace: string): boolean {
  if (SECRET_PATH.test(requestedPath)) return true;
  return typeof facts.target === "string" && SECRET_PATH.test(path.relative(workspace, facts.target));
}

function normalizedFilesystemPath(raw: string, stripToolAlias: boolean): string | null {
  let normalized = raw.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  if (stripToolAlias && normalized.startsWith("@")) normalized = normalized.slice(1);
  if (/^file:\/\//i.test(normalized)) {
    try { normalized = fileURLToPath(normalized); } catch { return null; }
  }
  // NTFS streams (including the unnamed ::$DATA alias), drive-relative paths,
  // UNC/device/extended namespaces have no supported ordinary-file identity.
  // Reject before target I/O or approval, including decoded file-URL spellings.
  if (!normalized || /[\x00-\x1f\x7f]/.test(normalized) || /^[\\/]{2}|^[\\/]\?\?[\\/]/.test(normalized)
      || (process.platform === "win32" && /^[\\/]/.test(normalized))
      || /:/.test(normalized.replace(/^[a-z]:[\\/]/i, ""))) return null;
  return normalized;
}

function resolveTarget(raw: string, cwd: string, stripToolAlias: boolean): string | null {
  let normalized = normalizedFilesystemPath(raw, stripToolAlias);
  if (normalized === null) return null;
  if (normalized === "~") normalized = homedir();
  else if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
    normalized = path.join(homedir(), normalized.slice(2));
  }
  return path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(cwd, normalized);
}

function shellFilesystemSpellings(command: string, cwd: string): { paths: string[]; uncertain: boolean } | null {
  const tokens = shellTokens(command);
  if (tokens === null) return null;
  // Reuse the command-specific binder: rg patterns and Git objects are not paths.
  const parsed = planShellFilesystemArguments(tokens);
  if (parsed !== null) return { paths: parsed, uncertain: false };
  const packageManager = /^(?:npm|pnpm|yarn|bun)$/i.test(tokens[0] ?? "");
  const scriptIndex = tokens[1]?.toLowerCase() === "run" ? 2 : 1;
  const msbuild = tokens[0]?.toLowerCase() === "dotnet" && /^(?:test|build)$/i.test(tokens[1] ?? "");
  const fallbackPathContext = isKnownDevelopmentCommand(command) || deleteTarget(command) !== null;
  const paths: string[] = [];
  let uncertain = false;
  let literalArguments = false;
  let codeArgument = false;
  for (const [index, token] of tokens.entries()) {
    if (codeArgument) { codeArgument = false; uncertain = true; continue; }
    if (token === "--") { literalArguments = true; continue; }
    // Script names do not identify files and do not extend the development allowlist.
    if (packageManager && index === scriptIndex && /^[\w.-]+(?::[\w.-]+)*$/.test(token)) continue;
    if (tokens[0] === "node" && !literalArguments) {
      if (/^(?:-e|-p|--eval|--print)$/.test(token)) { codeArgument = true; uncertain = true; continue; }
      if (/^--(?:eval|print)=/.test(token)) { uncertain = true; continue; }
    }
    if (tokens[0] === "git" && !literalArguments) {
      // Before --, show/log's colon operands name objects, not working-tree streams.
      if (/^(?:show|log)$/.test(tokens[1] ?? "") && index > 1 && /^[^-]+:/.test(token)
          && !/^[a-z]:|^file:|^[\\/]/i.test(token)) { uncertain = true; continue; }
      if (tokens[1] === "clone" && index === 2 && /^[\w.-]+@[\w.-]+:[^\s]+$/.test(token)) continue;
    }
    let raw = token;
    let propertyValue = false;
    // Only dotnet test/build's recognized property options, before --. Values
    // still undergo screening; properties can contain paths as well as text.
    if (msbuild && index > 1 && !literalArguments && /^[-/](?:p|property):/i.test(token)) {
      const property = /^[-/](?:p|property):[a-z_][\w]*=(.+)$/i.exec(token);
      if (property) { raw = property[1]; propertyValue = true; }
    }
    const option = propertyValue ? null : /^--?([^=:]+)=(.*)$/.exec(raw);
    if (option) raw = option[2];
    if (/^[a-z][\w+.-]+:\/\//i.test(raw) && !/^file:/i.test(raw)) continue;
    if (raw.includes(":")) {
      // Unknown option values may be query text, not files. --output is the
      // explicit output-path spelling screened by this fallback, not a binder.
      if ((option && option[1] !== "output") || raw.startsWith("-")) {
        uncertain = true;
        continue;
      }
      if (!/^file:|^[a-z]:|[\\/]|:\$DATA$/i.test(raw)) {
        // An existing basename alone cannot turn unknown command text into a
        // path. In development/delete contexts it only escalates to denial;
        // a missing/changed base never grants automatic execution.
        if (!fallbackPathContext) { uncertain = true; continue; }
        const base = resolvePlanShellTarget(raw.slice(0, raw.indexOf(":")), cwd);
        if (base === null || !fs.existsSync(base)) { uncertain = true; continue; }
      }
      paths.push(raw);
    } else if (/[\\/]|\.[\w-]+$/.test(raw)) paths.push(raw);
  }
  return { paths, uncertain };
}

function shellTouchesControl(command: string, spellings: string[], workspace: string, cwd: string): boolean {
  if (PROTECTED_CONTROL.test(command)) return true;
  return spellings.some(raw => {
    const lexical = resolvePlanShellTarget(raw, cwd);
    const canonical = lexical === null ? null : canonicalTarget(lexical);
    return canonical !== null && PROTECTED_CONTROL.test(path.relative(workspace, canonical));
  });
}

function resolveToolTarget(raw: string, cwd: string): string | null {
  return resolveTarget(raw, cwd, true);
}

function resolvePlanShellTarget(raw: string, cwd: string): string | null {
  return resolveTarget(raw, cwd, false);
}

function canonicalTarget(target: string): string | null {
  const unresolved: string[] = [];
  let candidate = target;

  while (true) {
    try {
      return path.resolve(fs.realpathSync(candidate), ...unresolved);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      const parent = path.dirname(candidate);
      if (parent === candidate) return null;
      unresolved.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

function insideWorkspace(target: string, cwd: string): boolean {
  const relative = path.relative(cwd, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function targetFacts(raw: string, workspace: string, executionCwd = workspace): ActionFacts {
  if (!raw) return {};
  const lexicalTarget = resolveToolTarget(raw, executionCwd);
  if (lexicalTarget === null) return { insideWorkspace: false };
  const canonical = canonicalTarget(lexicalTarget);
  const target = canonical ?? lexicalTarget;
  const facts: ActionFacts = {
    target,
    insideWorkspace: canonical !== null && insideWorkspace(target, workspace),
  };
  try {
    const stat = fs.statSync(target);
    facts.exists = true;
    facts.file = stat.isFile();
    facts.directory = stat.isDirectory();
    facts.size = stat.size;
  } catch {
    facts.exists = false;
  }
  facts.generated = GENERATED_PATH.test(path.relative(workspace, target));
  if (facts.insideWorkspace) {
    const relative = path.relative(workspace, target);
    const tracked = git(workspace, ["ls-files", "--error-unmatch", "--", relative]);
    facts.tracked = tracked.status === 0;
  }
  return facts;
}

function redactCommand(command: string): string {
  return redactSensitiveText(command, 280);
}

function deleteTarget(command: string): string | null {
  const powershell = /\bremove-item\b(?:\s+-[\w-]+(?:\s+[^\s"']+)?)*\s+(?:-literalpath\s+|-path\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/i.exec(command);
  if (powershell) return powershell[1] ?? powershell[2] ?? powershell[3] ?? null;
  const posix = /(?:^|\s)rm\s+(?:-[a-z]+\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))\s*$/i.exec(command.trim());
  return posix ? posix[1] ?? posix[2] ?? posix[3] ?? null : null;
}

function isContainedPlanShellPath(raw: string, workspace: string): boolean {
  if (!raw || /[\0*?\[\]{}]/.test(raw)) return false;
  const fileUrl = /^file:\/\//i.test(raw);
  const localDrivePath = /^[A-Za-z]:[\\/]/.test(raw);
  if (!fileUrl && !localDrivePath && (/^[^\\/\s]+:/.test(raw) || raw.includes("::"))) return false;
  const lexical = resolvePlanShellTarget(raw, workspace);
  const canonical = lexical === null ? null : canonicalTarget(lexical);
  return canonical !== null && insideWorkspace(canonical, workspace);
}

export function isPlanSafeShellCommand(command: string, cwdInput = process.cwd()): boolean {
  const value = command.trim();
  if (!value || SHELL_CONTROL.test(value) || SECRET_PATH.test(value)) return false;
  if (/\$(?!\()|%[^%\s]+%|@\(|\b(?:env|variable|function|cert|registry|hklm|hkcu):/i.test(value)) return false;
  if (/--(?:pre(?:-glob)?|output)(?:=|\s|$)/i.test(value)) return false;
  if (hasUnquotedPowerShellExpansion(value)) return false;
  const tokens = shellTokens(value);
  const shellCommand = tokens?.[0]?.toLowerCase();
  if (shellCommand && ["ls", "get-childitem", "get-item", "get-content", "select-string", "resolve-path", "test-path", "measure-object"].includes(shellCommand)
      && hasUnquotedPowerShellOperator(value)) return false;
  const filesystemArguments = tokens === null ? null : planShellFilesystemArguments(tokens);
  if (filesystemArguments === null) return false;
  const workspace = normalizedWorkspace(cwdInput);
  return filesystemArguments.every((argument) => isContainedPlanShellPath(argument, workspace));
}

function isKnownDevelopmentCommand(command: string): boolean {
  const value = command.trim();
  if (!value || SHELL_CONTROL.test(value)) return false;
  return [
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|build|check|typecheck|verify)(?::[\w.-]+)?(?:\s|$)/i,
    /^(?:npx\s+)?(?:tsc|eslint|prettier|vitest|jest)(?:\s|$)/i,
    /^(?:node\s+--test|python\s+-m\s+pytest|pytest|go\s+test|cargo\s+(?:test|check|build)|dotnet\s+(?:test|build))(?:\s|$)/i,
    /^(?:mkdir|new-item\s+-itemtype\s+directory)(?:\s|$)/i,
  ].some((pattern) => pattern.test(value));
}

function isWorkSandboxGitStatus(command: string): boolean {
  if (!command.trim() || SHELL_CONTROL.test(command)) return false;
  const tokens = shellTokens(command.trim());
  if (!tokens || tokens[0]?.toLowerCase() !== "git" || tokens[1]?.toLowerCase() !== "status") return false;
  return tokens.slice(2).every((argument) => /^(?:--short|-s|--branch|-b|--porcelain(?:=v[12])?|--untracked-files=(?:no|normal|all)|--ignored=(?:no|traditional|matching)|--ahead-behind|--no-ahead-behind|--show-stash)$/.test(argument));
}

function isWorkSandboxVerification(command: string): boolean {
  const value = command.trim();
  if (!value || SHELL_CONTROL.test(value)) return false;
  return /^node\s+(?:\.?[\\/])?scripts[\\/](?:verify|check)-[\w.-]+\.(?:mjs|js)(?:\s|$)/i.test(value);
}

function result(
  base: Pick<InspectedAction, "toolName" | "workspace" | "actionFingerprint" | "workspaceFingerprint"> & {
    input: Record<string, unknown>;
    workspaceState: WorkspaceState;
  },
  details: Omit<InspectedAction, "toolName" | "workspace" | "actionFingerprint" | "workspaceFingerprint" | "approvalBinding" | "capability">,
): InspectedAction {
  const { input, workspaceState, ...publicBase } = base;
  const canonicalTarget = details.facts.target ? path.normalize(details.facts.target) : null;
  return {
    ...publicBase,
    ...details,
    capability: {
      ...describeCapability(publicBase.toolName),
      ...(details.route !== "allow" ? { approvalClass: "exception-boundary" as const } : {}),
      ...(details.facts.insideWorkspace === false ? { scope: "unknown" as const } : {}),
    },
    approvalBinding: {
      version: 2,
      canonicalTarget,
      targetStateFingerprint: pathState(details.facts.target),
      head: workspaceState.head,
      indexFingerprint: workspaceState.indexFingerprint,
      worktreeFingerprint: workspaceState.worktreeFingerprint,
      inputFingerprint: sha256(JSON.stringify(stableValue(input))),
    },
  };
}

export function inspectAction(
  event: ToolEvent,
  cwdInput: string,
  options: { protectControlReads?: boolean } = {},
): InspectedAction {
  const executionCwd = typeof cwdInput === "string" && cwdInput.trim() ? path.resolve(cwdInput) : process.cwd();
  const toolName = String(event.toolName ?? "unknown");
  const input = inputRecord(event.input);
  const filesystemTool = READ_TOOLS.has(toolName) || toolName === "edit" || toolName === "write";
  if (filesystemTool && rawPath(input) && normalizedFilesystemPath(rawPath(input), true) === null) {
    // A denial is never retry-approvable. Do not inspect any filesystem or Git
    // state to construct an approval binding for an unsupported namespace.
    const unavailable = sha256("unavailable: unsupported filesystem path");
    return result({
      toolName, workspace: executionCwd, input,
      actionFingerprint: actionFingerprint(toolName, input, executionCwd), workspaceFingerprint: unavailable,
      workspaceState: { head: "unavailable", indexFingerprint: unavailable, worktreeFingerprint: unavailable, fingerprint: unavailable },
    }, {
      summary: `${toolName} unsupported filesystem path`, category: "protected-control", risk: "high", route: "deny",
      reason: "Streams and ambiguous filesystem namespaces have no supported ordinary-file identity.",
      saferPath: "Use an ordinary local-drive or workspace-relative path.", facts: {},
    });
  }
  const workspace = normalizedWorkspace(executionCwd);
  const workspaceState = captureWorkspaceState(workspace);
  const base = {
    toolName,
    workspace,
    actionFingerprint: actionFingerprint(toolName, input, workspace),
    workspaceFingerprint: workspaceState.fingerprint,
    input,
    workspaceState,
  };

  if (READ_TOOLS.has(toolName)) {
    const requestedPath = rawPath(input);
    const facts = requestedPath ? targetFacts(requestedPath, workspace, executionCwd) : {};
    if (requestedPath && targetsSecretPath(requestedPath, facts, workspace)) {
      return result(base, {
        summary: `${toolName} protected secret path`, category: "protected-data", risk: "high", route: "human",
        reason: "Protected credentials must never enter unattended model context.",
        saferPath: "Use a masked key-name inspector or provide the required non-secret value manually.",
        facts,
      });
    }
    if (requestedPath && facts.insideWorkspace === false) {
      return result(base, {
        summary: `${toolName} outside workspace: ${redactCommand(requestedPath)}`, category: "protected-control", risk: "high", route: "human",
        reason: "The requested path is outside Neura's active workspace boundary.",
        saferPath: "Copy a non-sensitive artifact into the workspace or inspect it with Rajveer present.",
        facts,
      });
    }
    const relative = requestedPath ? path.relative(workspace, facts.target ?? workspace) : "";
    if (options.protectControlReads && requestedPath && PROTECTED_CONTROL.test(relative)) {
      return result(base, {
        summary: `${toolName} protected control file: ${relative}`,
        category: "protected-control", risk: "high", route: "human",
        reason: "This file controls Neura's safety boundary, credentials, or deployment behavior.",
        saferPath: "Use hardened Git inspection or approve this exact protected-file read.", facts,
      });
    }
    return result(base, {
      summary: requestedPath ? `${toolName} ${path.relative(workspace, facts.target ?? workspace) || "."}` : toolName,
      category: "read-only", risk: "low", route: "allow", reason: "Read-only workspace inspection.",
      saferPath: "", facts,
    });
  }

  if (toolName === "edit" || toolName === "write") {
    const requestedPath = rawPath(input);
    const facts = requestedPath ? targetFacts(requestedPath, workspace, executionCwd) : {};
    const relative = requestedPath ? path.relative(workspace, facts.target ?? workspace) : "unknown path";
    if (!requestedPath || facts.insideWorkspace === false) {
      return result(base, {
        summary: `${toolName} outside workspace: ${redactCommand(requestedPath || "unknown path")}`,
        category: "protected-control", risk: "high", route: "human",
        reason: "Unattended writes are limited to the active workspace.",
        saferPath: "Move the target into the workspace or wait for Rajveer.", facts,
      });
    }
    if (targetsSecretPath(requestedPath, facts, workspace)) {
      return result(base, {
        summary: `${toolName} protected secret path: ${relative}`, category: "protected-data", risk: "critical", route: "human",
        reason: "Secret-bearing files stay under direct human control.",
        saferPath: "Edit a checked-in example file or ask Rajveer to apply the secret value.", facts,
      });
    }
    if (PROTECTED_CONTROL.test(relative)) {
      return result(base, {
        summary: `${toolName} protected control file: ${relative}`, category: "protected-control", risk: "high", route: "human",
        reason: "This file controls Neura's safety boundary, credentials, or deployment behavior.",
        saferPath: "Prepare a patch for human review instead of changing the control plane unattended.", facts,
      });
    }
    return result(base, {
      summary: `${toolName} ${relative}`, category: "workspace-change", risk: "low", route: "allow",
      reason: "Routine change inside the active workspace.", saferPath: "", facts,
    });
  }

  if (toolName === "bash" || toolName === HUMAN_AWAY_SANDBOX_TOOL || toolName === WORK_SANDBOX_TOOL) {
    const command = String(input.command ?? "").trim();
    if (!command) {
      return result(base, {
        summary: "empty shell command", category: "unclassified-shell", risk: "high", route: "deny",
        reason: "An empty command cannot be meaningfully reviewed.", saferPath: "Provide one explicit command.",
        facts: {},
      });
    }
    const hard = HARD_DENY.find(({ re }) => re.test(command));
    if (hard) {
      return result(base, {
        summary: redactCommand(command), category: "broad-destruction", risk: "critical", route: "deny",
        reason: hard.why, saferPath: "Narrow the action to one literal, recoverable workspace target.",
        facts: {},
      });
    }
    const screening = shellFilesystemSpellings(command, executionCwd) ?? { paths: [], uncertain: true };
    const spellings = screening.paths;
    if (spellings.some(raw => normalizedFilesystemPath(raw, false) === null)) {
      return result(base, {
        summary: "shell command with unsupported filesystem path", category: "protected-control", risk: "high", route: "deny",
        reason: "Streams and ambiguous filesystem namespaces cannot be authorized through shell commands.",
        saferPath: "Use ordinary local-drive or workspace-relative paths.", facts: {},
      });
    }
    if (SECRET_PATH.test(command)) {
      return result(base, {
        summary: "shell command touching a protected secret path", category: "protected-data", risk: "critical", route: "human",
        reason: "The action may expose or modify credentials.",
        saferPath: "Use a masked inspector or wait for Rajveer to handle the secret-bearing file.",
        facts: {},
      });
    }
    if ((toolName === HUMAN_AWAY_SANDBOX_TOOL || toolName === WORK_SANDBOX_TOOL)
        && shellTouchesControl(command, spellings, workspace, executionCwd)) {
      return result(base, {
        summary: redactCommand(command), category: "protected-control", risk: "high", route: "human",
        reason: "The sandbox command touches Neura's safety, credential, Git, or deployment control plane.",
        saferPath: "Prepare a patch for Rajveer instead of changing protected control files unattended.",
        facts: {},
      });
    }
    const humanOnly = HUMAN_ONLY_SHELL.find(({ re }) => re.test(command));
    if (humanOnly) {
      return result(base, {
        summary: redactCommand(command), category: /push|publish|merge|apply|deploy/i.test(command) ? "remote-mutation" : "protected-control",
        risk: "critical", route: "human", reason: humanOnly.why,
        saferPath: "Use a reversible local operation or wait for Rajveer to approve the exact command.",
        facts: {},
      });
    }
    if (screening.uncertain) {
      return result(base, {
        summary: redactCommand(command), category: "unclassified-shell", risk: "high", route: "human",
        reason: "Colon-bearing arguments may be command syntax or text rather than filesystem operands.",
        saferPath: "Use a recognized command form or wait for exact human review; ambiguous arguments cannot run unattended.",
        facts: {},
      });
    }
    const rawDeleteTarget = deleteTarget(command);
    if (rawDeleteTarget) {
      const facts = targetFacts(rawDeleteTarget, workspace, executionCwd);
      const automaticallyReviewable = facts.insideWorkspace === true && facts.file === true && facts.tracked === false && facts.generated === true;
      return result(base, {
        summary: `delete ${facts.insideWorkspace ? path.relative(workspace, facts.target!) : redactCommand(rawDeleteTarget)}`,
        category: "bounded-delete", risk: automaticallyReviewable ? "medium" : "high",
        route: automaticallyReviewable ? "review" : "human",
        reason: automaticallyReviewable
          ? "One untracked generated file can be reviewed for exact-action approval."
          : "Deletion is not proven generated, untracked, literal, and bounded to one workspace file.",
        saferPath: "Regenerate or archive the target; otherwise wait for exact human approval.",
        facts,
      });
    }
    if (isPlanSafeShellCommand(command, executionCwd)) {
      return result(base, {
        summary: redactCommand(command), category: "read-only", risk: "low", route: "allow",
        reason: "Command matches Neura's exact read-only allowlist.", saferPath: "", facts: {},
      });
    }
    if (toolName === WORK_SANDBOX_TOOL && (isWorkSandboxGitStatus(command) || isWorkSandboxVerification(command))) {
      return result(base, {
        summary: redactCommand(command), category: "read-only", risk: "low", route: "allow",
        reason: "Known inspection or verification command runs inside the WORK OS sandbox.", saferPath: "", facts: {},
      });
    }
    if (isKnownDevelopmentCommand(command)) {
      return result(base, {
        summary: redactCommand(command), category: "workspace-change", risk: "medium", route: "allow",
        reason: "Known local build, test, validation, or git-recording command.", saferPath: "", facts: {},
      });
    }
    if (toolName === HUMAN_AWAY_SANDBOX_TOOL || toolName === WORK_SANDBOX_TOOL) {
      return result(base, {
        summary: redactCommand(command), category: "unclassified-shell", risk: "high", route: "human",
        reason: "The OS sandbox limits reach, but an opaque command can still destroy writable workspace contents.",
        saferPath: "Use one command from the deterministic read-only or development allowlist; otherwise wait for Rajveer.",
        facts: {},
      });
    }
    return result(base, {
      summary: redactCommand(command), category: "unclassified-shell", risk: "high", route: "human",
      reason: "Opaque shell execution cannot be bounded reliably without an OS sandbox.",
      saferPath: "Use built-in read/edit/write tools or one command from the documented development allowlist.",
      facts: {},
    });
  }

  return result(base, {
    summary: `${toolName} external tool call`, category: "external-tool", risk: "high", route: "human",
    reason: "This custom tool has no audited unattended policy yet.",
    saferPath: "Use a built-in workspace tool or wait for Rajveer to approve the external action.",
    facts: {},
  });
}

export function isPlanActionAllowed(event: ToolEvent, cwd: string): boolean {
  const toolName = String(event.toolName ?? "unknown");
  if (!PLAN_TOOLS.has(toolName)) return false;
  if (toolName === "bash") return isPlanSafeShellCommand(String(inputRecord(event.input).command ?? ""), cwd);
  if (READ_TOOLS.has(toolName)) {
    return isPlanToolInputAllowed(toolName, event.input) && inspectAction(event, cwd).route === "allow";
  }
  return isPlanToolInputAllowed(toolName, event.input);
}

// Research needs containment, not approval fingerprints or Git execution.
export function isBoundedResearchReadAllowed(event: ToolEvent, cwd: string): boolean {
  const toolName = String(event.toolName ?? "");
  if (toolName !== "read" && toolName !== "ls") return false;
  const input = inputRecord(event.input);
  const requested = input.path ?? (toolName === "ls" ? "." : "");
  if (typeof requested !== "string" || !requested || requested.length > 4096
      || /[\x00-\x1f\x7f\u00A0\u2000-\u200A\u202F\u205F\u3000]/.test(requested) || /^[\\/]{2}|^[@~]/.test(requested)
      || (process.platform === "win32" && /^[\\/]/.test(requested))
      || /:/.test(requested.replace(/^[a-z]:[\\/]/i, "")) || SECRET_PATH.test(requested)) return false;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || /^[\\/]{2}/.test(cwd)
      || /[\x00-\x1f\x7f]/.test(cwd) || /:/.test(cwd.replace(/^[a-z]:[\\/]/i, ""))) return false;
  const workspace = normalizedWorkspace(cwd);
  const lexical = path.resolve(workspace, requested);
  const sensitive = (target: string): boolean => {
    if (SECRET_PATH.test(target)) return true;
    const components = target.split(/[\\/]/);
    if (components.some((part) => part.startsWith(".") || /^(?:node_modules|sessions|approvals)$/i.test(part))) return true;
    return /^(?:memory\.(?:md|json|txt)|(?:auth|models|settings|mcp|keybindings|tokens|credentials|secrets)\.json|credentials(?:\.[\w.-]+)?)$/i.test(path.basename(target));
  };
  if (!insideWorkspace(lexical, workspace) || sensitive(lexical)) return false;
  try {
    let current = workspace;
    for (const component of path.relative(workspace, lexical).split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    }
    const canonical = fs.realpathSync(lexical);
    if (!insideWorkspace(canonical, workspace) || sensitive(canonical)) return false;
    const stat = fs.lstatSync(canonical);
    if (toolName === "read") return stat.isFile() && stat.nlink === 1 && stat.size <= 8 * 1024 * 1024;
    if (!stat.isDirectory()) return false;
    // Pi ls stats each child. Reject linked children before it can follow an
    // outside/UNC target just to decide whether to append a directory suffix.
    return fs.readdirSync(canonical, { withFileTypes: true }).every((entry) => !entry.isSymbolicLink());
  } catch {
    return false;
  }
}

export function isApprovalRetryEligible(action: InspectedAction): boolean {
  if (action.route === "deny") return false;
  if (action.approvalBinding.canonicalTarget !== null) return true;
  return action.category === "remote-mutation";
}
