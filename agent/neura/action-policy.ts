import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLAN_MODE_TOOL_NAMES, isPlanToolInputAllowed } from "./plan-policy.ts";
import { HUMAN_AWAY_SANDBOX_TOOL, WORK_SANDBOX_TOOL } from "./human-away-sandbox.ts";
import { redactSensitiveText } from "./redaction.ts";

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
  actionFingerprint: string;
  workspaceFingerprint: string;
  approvalBinding: ApprovalBinding;
  facts: ActionFacts;
};

export type ApprovalBinding = {
  version: 2;
  canonicalTarget: string | null;
  targetStateFingerprint: string;
  head: string;
  indexFingerprint: string;
  worktreeFingerprint: string;
  inputFingerprint: string;
};

type ToolEvent = { toolName?: unknown; input?: unknown };

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const PLAN_TOOLS = new Set(PLAN_MODE_TOOL_NAMES);

export const SECRET_PATH = /(?:^|[\\/\s"'=])(?:\.env(?:\.[\w.-]+)?|\.envrc|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_rsa|id_ed25519|[\w.-]+\.(?:pem|key)|auth\.json|credentials(?:\.[\w.-]+)?|\.aws|\.azure|\.config[\\/]gcloud|\.kube[\\/]config|\.docker[\\/]config\.json)(?=$|[\\/:\s"'`;|&])/i;

const PROTECTED_CONTROL = /(?:^|[\\/\s"'=])(?:\.git(?:[\\/\s"']|$)|\.github[\\/]workflows(?:[\\/\s"']|$)|agent[\\/]settings\.json(?:[\s"']|$)|agent[\\/]keybindings\.json(?:[\s"']|$)|agent[\\/]mcp\.json(?:[\s"']|$)|install\.ps1(?:[\s"']|$)|agent[\\/]extensions[\\/](?:gmail-guardrail|guardrail|human-away-sandbox|modes|plan-artifact)\.ts(?:[\s"']|$)|agent[\\/]neura[\\/](?:action-policy|approval-store|headmaster|human-away-sandbox|mode-state|plan-policy|plan-renderer|redaction)\.(?:ts|md)(?:[\s"']|$))/i;
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
  return spawnSync("git", [
    "--no-pager", "--no-optional-locks", "--no-lazy-fetch",
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
    ...args,
  ], {
    cwd: workspace,
    encoding,
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

function resolveTarget(raw: string, cwd: string, stripToolAlias: boolean): string | null {
  let normalized = raw.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  if (stripToolAlias && normalized.startsWith("@")) normalized = normalized.slice(1);
  if (normalized === "~") normalized = homedir();
  else if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
    normalized = path.join(homedir(), normalized.slice(2));
  }
  if (/^file:\/\//i.test(normalized)) {
    try { normalized = fileURLToPath(normalized); } catch { return null; }
  }
  return path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(cwd, normalized);
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
  const canonical = lexicalTarget === null ? null : canonicalTarget(lexicalTarget);
  const target = canonical ?? lexicalTarget ?? path.resolve(executionCwd, raw);
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
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relative], {
      cwd: workspace,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 1_000,
    });
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

function shellTokens(command: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let started = false;

  for (const character of command) {
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) return null;
  if (started) tokens.push(token);
  return tokens;
}

function hasUnquotedPowerShellOperator(command: string): boolean {
  let quote = "";
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "+" || /[\u2010-\u2015\u2212]/.test(character)) return true;
  }
  return false;
}

function hasUnquotedPowerShellExpansion(command: string): boolean {
  let quote = "";
  let tokenStart = true;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStart = false;
    } else if (/\s/.test(character)) {
      tokenStart = true;
    } else {
      if (character === ",") return true;
      if (tokenStart && character === "@" && /[A-Za-z_({]/.test(command[index + 1] ?? "")) return true;
      tokenStart = false;
    }
  }
  return false;
}

function attachedOptionValue(argument: string, option: string): string | null {
  const lower = argument.toLowerCase();
  const normalizedOption = option.toLowerCase();
  for (const separator of ["=", ":"]) {
    const prefix = `${normalizedOption}${separator}`;
    if (lower.startsWith(prefix)) return argument.slice(prefix.length);
  }
  return null;
}

const POWERSHELL_ARGUMENTS = {
  "get-childitem": {
    flags: ["-directory", "-file", "-force", "-hidden", "-name", "-readonly", "-recurse", "-system"],
    values: ["-attributes", "-depth", "-exclude", "-filter", "-include"],
    pathValues: ["-path", "-literalpath"],
  },
  "get-content": {
    flags: ["-force", "-raw", "-wait"],
    values: ["-delimiter", "-encoding", "-readcount", "-stream", "-tail", "-totalcount"],
    pathValues: ["-path", "-literalpath"],
  },
  "get-item": {
    flags: ["-force"],
    values: ["-exclude", "-filter", "-include"],
    pathValues: ["-path", "-literalpath"],
  },
  "resolve-path": {
    flags: ["-relative"],
    values: [],
    pathValues: ["-path", "-literalpath", "-relativebasepath"],
  },
  "select-string": {
    flags: ["-allmatches", "-casesensitive", "-list", "-noemphasis", "-notmatch", "-quiet", "-raw", "-simplematch"],
    values: ["-context", "-culture", "-encoding"],
    pathValues: ["-path"],
  },
  "test-path": {
    flags: ["-isvalid"],
    values: ["-olderthan", "-newerthan", "-pathtype"],
    pathValues: ["-path", "-literalpath"],
  },
} as const;

function splitOption(argument: string): { name: string; attached: string | null } {
  const separator = argument.search(/[:=]/);
  return separator === -1
    ? { name: argument.toLowerCase(), attached: null }
    : { name: argument.slice(0, separator).toLowerCase(), attached: argument.slice(separator + 1) };
}

function ambiguousPowerShellArgument(argument: string): boolean {
  return argument === "--%";
}

function powershellFilesystemArguments(command: string, args: string[]): string[] | null {
  if (command === "measure-object") return args.length === 0 ? [] : null;
  const normalizedCommand = command === "ls" ? "get-childitem" : command;
  const spec = POWERSHELL_ARGUMENTS[normalizedCommand as keyof typeof POWERSHELL_ARGUMENTS];
  if (!spec) return null;

  const flags = new Set<string>(spec.flags);
  const values = new Set<string>(spec.values);
  const pathValues = new Set<string>(spec.pathValues);
  const paths: string[] = [];
  let patternSupplied = normalizedCommand !== "select-string";
  let options = true;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    // Commas form PowerShell arrays before cmdlet binding. Splatting and the
    // stop-parsing token also make literal argument recovery ambiguous.
    if (ambiguousPowerShellArgument(argument)) return null;
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument.startsWith("-")) {
      const { name, attached } = splitOption(argument);
      if (pathValues.has(name)) {
        const pathArgument = attached ?? args[++index];
        if (!pathArgument || ambiguousPowerShellArgument(pathArgument)) return null;
        paths.push(pathArgument);
      } else if (normalizedCommand === "select-string" && name === "-pattern") {
        const pattern = attached ?? args[++index];
        if (pattern === undefined || ambiguousPowerShellArgument(pattern)) return null;
        patternSupplied = true;
      } else if (flags.has(name)) {
        if (attached !== null) return null;
      } else if (values.has(name)) {
        const value = attached ?? args[++index];
        if (value === undefined || ambiguousPowerShellArgument(value)) return null;
      } else {
        // PowerShell accepts abbreviated parameter names, but resolving those
        // safely would require the full PowerShell binder. Exact names only.
        return null;
      }
      continue;
    }
    if (!patternSupplied) patternSupplied = true;
    else paths.push(argument);
  }
  return patternSupplied ? paths : null;
}

const RG_FLAGS = new Set([
  "--all", "--block-buffered", "--byte-offset", "--case-sensitive", "--column",
  "--count", "--count-matches", "--crlf", "--debug", "--files", "--files-with-matches",
  "--files-without-match", "--fixed-strings", "--heading", "--hidden", "--ignore-case",
  "--include-zero", "--invert-match", "--json", "--line-buffered", "--line-number",
  "--messages", "--mmap", "--multiline", "--multiline-dotall", "--no-config", "--no-filename",
  "--no-heading", "--no-ignore", "--no-ignore-dot", "--no-ignore-exclude", "--no-ignore-files",
  "--no-ignore-global", "--no-ignore-messages", "--no-ignore-parent", "--no-ignore-vcs", "--no-line-number",
  "--no-messages", "--no-mmap", "--no-require-git", "--null", "--null-data", "--one-file-system",
  "--only-matching", "--passthru", "--pcre2", "--pcre2-unicode", "--pretty", "--quiet",
  "--smart-case", "--stats", "--stop-on-nonmatch", "--text", "--trim", "--type-list",
  "--unrestricted", "--version", "--vimgrep", "--with-filename", "--word-regexp", "--line-regexp",
  "-0", "-a", "-b", "-c", "-f", "-h", "-i", "-j", "-l", "-m", "-n", "-o", "-p", "-q",
  "-s", "-u", "-v", "-w", "-x",
]);
const RG_VALUE_OPTIONS = new Set([
  "--after-context", "--before-context", "--color", "--colors", "--context", "--context-separator",
  "--dfa-size-limit", "--encoding", "--engine", "--field-context-separator", "--field-match-separator",
  "--glob", "--iglob", "--max-columns", "--max-count", "--max-depth", "--max-filesize",
  "--path-separator", "--regex-size-limit", "--replace", "--sort", "--sortr", "--type", "--type-add",
  "--type-clear", "-A", "-B", "-C", "-E", "-g", "-M", "-m", "-r", "-t", "-T",
]);
const RG_PATTERN_OPTIONS = new Set(["--regexp", "-e"]);
const RG_PATH_OPTIONS = new Set(["--file", "--ignore-file", "-f"]);

function ripgrepFilesystemArguments(args: string[]): string[] | null {
  const paths: string[] = [];
  let patternSupplied = false;
  let filesMode = false;
  let options = true;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument.startsWith("-")) {
      if (/^(?:-L|--follow)$/.test(argument)) return null;
      const equals = argument.indexOf("=");
      const option = equals === -1 ? argument : argument.slice(0, equals);
      const attached = equals === -1 ? null : argument.slice(equals + 1);
      if (RG_PATH_OPTIONS.has(option)) {
        const value = attached ?? args[++index];
        if (!value) return null;
        paths.push(value);
        patternSupplied = true;
      } else if (RG_PATTERN_OPTIONS.has(option)) {
        const value = attached ?? args[++index];
        if (value === undefined) return null;
        patternSupplied = true;
      } else if (RG_VALUE_OPTIONS.has(option)) {
        const value = attached ?? args[++index];
        if (value === undefined) return null;
      } else if (RG_FLAGS.has(argument)) {
        filesMode ||= argument === "--files";
      } else if (/^-[egftT].+/.test(argument)) {
        const shortOption = argument.slice(0, 2);
        const value = argument.slice(2);
        if (RG_PATH_OPTIONS.has(shortOption)) {
          paths.push(value);
          patternSupplied = true;
        } else if (RG_PATTERN_OPTIONS.has(shortOption)) patternSupplied = true;
      } else {
        return null;
      }
      continue;
    }
    if (!filesMode && !patternSupplied) patternSupplied = true;
    else paths.push(argument);
  }
  return filesMode || patternSupplied ? paths : null;
}

// Read-only Git commands can still launch configured pagers, filesystem monitors,
// hooks, signature verification, diff/text converters, or worktree filters. Keep
// global hardening exact; subcommand parsers admit only object/ref/index reads.
const PLAN_GIT_PREFIX = Object.freeze([
  "--no-pager",
  "--no-optional-locks",
  "--no-lazy-fetch",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "log.showSignature=false",
  "-c", "log.mailmap=false",
  "-c", "format.pretty=medium",
]);

function isSafeGitRefAtom(value: string): boolean {
  let candidate = value;
  while (true) {
    const suffix = /(?:\^\{(?:commit|tree|tag|object)\}|@\{\d+\}|~\d*|\^\d*)$/.exec(candidate);
    if (!suffix) break;
    candidate = candidate.slice(0, -suffix[0].length);
  }
  if (/^(?:HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD)$/.test(candidate)) return true;
  if (/^[0-9a-f]{4,64}$/i.test(candidate)) return true;
  if (!candidate.startsWith("refs/") || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(candidate)) return false;
  return !candidate.includes("..")
    && !candidate.includes("//")
    && !candidate.endsWith("/")
    && !candidate.endsWith(".")
    && candidate.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"));
}

function isSafeGitRevision(value: string, allowExclusion = false): boolean {
  if (allowExclusion && value.startsWith("^")) return isSafeGitRefAtom(value.slice(1));
  const range = /^(.*?)(\.\.\.?)(.*?)$/.exec(value);
  if (range) return isSafeGitRefAtom(range[1]) && isSafeGitRefAtom(range[3]);
  return isSafeGitRefAtom(value);
}

function isSafeGitTreePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\") || /[\0:*?\[\]{}]/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..")
    && !SECRET_PATH.test(`/${value}`);
}

function isSafeGitObject(value: string): boolean {
  const separator = value.indexOf(":");
  return separator === -1
    ? isSafeGitRevision(value)
    : isSafeGitRevision(value.slice(0, separator)) && isSafeGitTreePath(value.slice(separator + 1));
}

function gitDiffFilesystemArguments(args: string[]): string[] | null {
  const flags = new Set([
    "--no-ext-diff", "--no-textconv", "--cached", "--staged", "--merge-base",
    "--stat", "--numstat", "--shortstat", "--summary", "--name-only", "--name-status",
    "--check", "--raw", "--patch", "-p", "-u", "--no-patch", "-s", "--full-index",
    "--binary", "--minimal", "--patience", "--histogram", "--ignore-space-at-eol",
    "--ignore-space-change", "-b", "--ignore-all-space", "-w", "--ignore-blank-lines",
    "--exit-code", "--quiet", "--find-renames", "--find-copies", "--no-renames",
  ]);
  const paths: string[] = [];
  let options = true;
  let externalDiffDisabled = false;
  let textConversionDisabled = false;
  let staged = false;
  let separatorSupplied = false;
  const revisions: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (options && argument === "--") {
      options = false;
      separatorSupplied = true;
      continue;
    }
    if (!options) {
      paths.push(argument);
      continue;
    }
    if (!argument.startsWith("-")) {
      if (!isSafeGitRevision(argument)) return null;
      revisions.push(argument);
      continue;
    }
    if (argument === "--no-ext-diff") externalDiffDisabled = true;
    if (argument === "--no-textconv") textConversionDisabled = true;
    if (argument === "--cached" || argument === "--staged") staged = true;
    if (flags.has(argument)
      || /^--abbrev(?:=\d+)?$/.test(argument)
      || /^--unified(?:=\d+)?$/.test(argument)
      || /^-U\d+$/.test(argument)
      || /^--inter-hunk-context=\d+$/.test(argument)
      || /^--diff-algorithm=(?:myers|minimal|patience|histogram)$/.test(argument)
      || /^--find-renames=\d+%?$/.test(argument)
      || /^--find-copies=\d+%?$/.test(argument)
      || /^-[MC]\d*%?$/.test(argument)
      || /^--diff-filter=[ACDMRTUXB*]+$/i.test(argument)
      || /^--color=(?:always|never|auto)$/.test(argument)
      || /^--word-diff(?:=(?:color|plain|porcelain|none))?$/.test(argument)) {
      continue;
    }
    if (argument === "--word-diff-regex") {
      if (args[++index] === undefined) return null;
      continue;
    }
    return null;
  }
  const rangeComparison = revisions.length === 1 && /\.\.\.?/.test(revisions[0]);
  const safeInputs = staged ? revisions.length <= 1 && !rangeComparison : rangeComparison && separatorSupplied;
  return externalDiffDisabled && textConversionDisabled && safeInputs ? paths : null;
}

function gitHistoryFilesystemArguments(args: string[], showObjects: boolean): string[] | null {
  const flags = new Set([
    "--no-ext-diff", "--no-textconv", "--oneline", "--stat", "--numstat", "--shortstat",
    "--summary", "--name-only", "--name-status", "--raw", "--patch", "-p", "--no-patch",
    "-s", "--full-diff", "--no-merges", "--merges", "--first-parent", "--reverse", "--graph",
    "--decorate", "--no-decorate", "--source", "--no-source", "--date-order", "--author-date-order",
    "--topo-order", "--all", "--branches", "--tags", "--remotes", "--no-use-mailmap",
  ]);
  const valueOptions = new Set(["--max-count", "-n", "--skip", "--since", "--after", "--until", "--before", "--author", "--committer", "--grep"]);
  const paths: string[] = [];
  let options = true;
  let externalDiffDisabled = false;
  let textConversionDisabled = false;
  let mailmapDisabled = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (!options) {
      paths.push(argument);
      continue;
    }
    if (!argument.startsWith("-")) {
      if (!(showObjects ? isSafeGitObject(argument) : isSafeGitRevision(argument, true))) return null;
      continue;
    }
    if (argument === "--no-ext-diff") externalDiffDisabled = true;
    if (argument === "--no-textconv") textConversionDisabled = true;
    if (argument === "--no-use-mailmap") mailmapDisabled = true;
    if (flags.has(argument)
      || /^-\d+$/.test(argument)
      || /^--max-count=\d+$/.test(argument)
      || /^--skip=\d+$/.test(argument)
      || /^--decorate=(?:short|full|auto|no)$/.test(argument)
      || /^--date=(?:relative|local|iso|iso-strict|rfc|short|raw|human|unix)$/.test(argument)
      || /^--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw)$/.test(argument)) {
      continue;
    }
    if (valueOptions.has(argument)) {
      const value = args[++index];
      if (value === undefined || ((argument === "--max-count" || argument === "-n" || argument === "--skip") && !/^\d+$/.test(value))) return null;
      continue;
    }
    return null;
  }
  return externalDiffDisabled && textConversionDisabled && mailmapDisabled ? paths : null;
}

function gitFilesystemArguments(args: string[]): string[] | null {
  if (!PLAN_GIT_PREFIX.every((argument, index) => args[index] === argument)) return null;
  const subcommand = args[PLAN_GIT_PREFIX.length]?.toLowerCase();
  if (!subcommand) return null;
  const commandArgs = args.slice(PLAN_GIT_PREFIX.length + 1);
  if (subcommand === "branch") {
    return commandArgs.every((argument) => /^(?:--show-current|-a|-r|--all|--remotes)$/.test(argument)) ? [] : null;
  }
  if (subcommand === "rev-parse") {
    const paths: string[] = [];
    for (let index = 0; index < commandArgs.length; index++) {
      const argument = commandArgs[index];
      const attached = attachedOptionValue(argument, "--resolve-git-dir");
      if (attached !== null) {
        if (!attached) return null;
        paths.push(attached);
      } else if (argument === "--resolve-git-dir") {
        const pathArgument = commandArgs[++index];
        if (!pathArgument) return null;
        paths.push(pathArgument);
      } else if (/^(?:--show-toplevel|--show-prefix|--show-cdup|--git-dir|--absolute-git-dir|--is-inside-git-dir|--is-inside-work-tree|--is-bare-repository|--is-shallow-repository|--show-superproject-working-tree|--verify|--quiet|-q|--revs-only|--no-revs|--flags|--no-flags|--symbolic|--symbolic-full-name)$/.test(argument)
        || /^--short(?:=\d+)?$/.test(argument)
        || /^--abbrev-ref(?:=(?:strict|loose))?$/.test(argument)
        || /^--path-format=(?:absolute|relative)$/.test(argument)) {
        continue;
      } else if (!argument.startsWith("-")) {
        if (!isSafeGitRevision(argument)) return null;
      } else {
        return null;
      }
    }
    return paths;
  }
  if (subcommand === "status") return null;
  if (subcommand === "diff") return gitDiffFilesystemArguments(commandArgs);
  if (subcommand === "log" || subcommand === "show") return gitHistoryFilesystemArguments(commandArgs, subcommand === "show");
  if (subcommand !== "ls-files") return null;

  const separator = commandArgs.indexOf("--");
  const paths = separator === -1 ? [] : commandArgs.slice(separator + 1);
  const options = separator === -1 ? commandArgs : commandArgs.slice(0, separator);
  for (const argument of options) {
    if (/^(?:-z|-t|-v|-f|-c|--cached|-s|--stage|-u|--unmerged|--resolve-undo|--full-name|--error-unmatch|--deduplicate|--sparse)$/.test(argument)) {
      continue;
    } else if (!argument.startsWith("-")) {
      paths.push(argument);
    } else {
      return null;
    }
  }
  return paths;
}

function planShellFilesystemArguments(tokens: string[]): string[] | null {
  const command = tokens[0]?.toLowerCase();
  const args = tokens.slice(1);
  if (!command) return null;
  if (command === "pwd" || command === "get-location") return args.length === 0 ? [] : null;
  if (["ls", "get-childitem", "get-item", "get-content", "select-string", "resolve-path", "test-path", "measure-object"].includes(command)) {
    return powershellFilesystemArguments(command, args);
  }
  if (command === "rg") return ripgrepFilesystemArguments(args);
  if (command === "git") return gitFilesystemArguments(args);
  return null;
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
  details: Omit<InspectedAction, "toolName" | "workspace" | "actionFingerprint" | "workspaceFingerprint" | "approvalBinding">,
): InspectedAction {
  const { input, workspaceState, ...publicBase } = base;
  const canonicalTarget = details.facts.target ? path.normalize(details.facts.target) : null;
  return {
    ...publicBase,
    ...details,
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
  const workspace = normalizedWorkspace(executionCwd);
  const toolName = String(event.toolName ?? "unknown");
  const input = inputRecord(event.input);
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
    if (SECRET_PATH.test(command)) {
      return result(base, {
        summary: "shell command touching a protected secret path", category: "protected-data", risk: "critical", route: "human",
        reason: "The action may expose or modify credentials.",
        saferPath: "Use a masked inspector or wait for Rajveer to handle the secret-bearing file.",
        facts: {},
      });
    }
    if ((toolName === HUMAN_AWAY_SANDBOX_TOOL || toolName === WORK_SANDBOX_TOOL) && PROTECTED_CONTROL.test(command)) {
      return result(base, {
        summary: redactCommand(command), category: "protected-control", risk: "high", route: "human",
        reason: "The sandbox command touches Neura's safety, credential, Git, or deployment control plane.",
        saferPath: "Prepare a patch for Rajveer instead of changing protected control files unattended.",
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
    const humanOnly = HUMAN_ONLY_SHELL.find(({ re }) => re.test(command));
    if (humanOnly) {
      return result(base, {
        summary: redactCommand(command), category: /push|publish|merge|apply|deploy/i.test(command) ? "remote-mutation" : "protected-control",
        risk: "critical", route: "human", reason: humanOnly.why,
        saferPath: "Use a reversible local operation or wait for Rajveer to approve the exact command.",
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

export function isApprovalRetryEligible(action: InspectedAction): boolean {
  if (action.route === "deny") return false;
  if (action.approvalBinding.canonicalTarget !== null) return true;
  return action.category === "remote-mutation";
}
