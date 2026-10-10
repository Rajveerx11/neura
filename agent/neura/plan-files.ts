// Plan's local inspection service. Never execute a model-supplied shell command.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { setImmediate } from "node:timers/promises";
import { SECRET_PATH, findProjectRoot, isPathInside } from "./plan-policy.ts";
import { AUTOMATIC_GIT_ARGUMENTS, automaticGitEnvironment, resolveExecutable } from "./process-security.ts";
import { redactSensitiveText } from "./redaction.ts";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PRIVATE_COMPONENT = /^(?:\.git|\.pi|\.neura|\.claude|\.ssh|\.aws|\.azure|\.config|\.kube|\.docker|node_modules|sessions|approvals|memory|private|secrets)$/i;
const PRIVATE_FILE = /^(?:memory\.(?:md|json|txt)|(?:auth|models|settings|mcp|keybindings|tokens|credentials|secrets)\.json)$/i;

function gitMetadata(cwd: string, args: string[], input?: string): string {
  const executable = resolveExecutable("git", cwd);
  if (!executable) throw new Error("Plan inspection requires trusted Git for ignore authorization.");
  // Only exclusion metadata may consult global config. All executable surfaces
  // remain explicitly overridden. Other Git metadata keeps the shared hardening.
  const ignoreQuery = args[0] === "check-ignore";
  const prefix = ignoreQuery ? AUTOMATIC_GIT_ARGUMENTS.filter((arg, index, all) =>
    arg !== "core.excludesFile=/dev/null" && !(arg === "-c" && all[index + 1] === "core.excludesFile=/dev/null")) : AUTOMATIC_GIT_ARGUMENTS;
  const environment = automaticGitEnvironment();
  if (ignoreQuery) {
    // Preserve Git's exclusion lookup locations: explicit global config, HOME,
    // and XDG config/default ignore. No command overrides or executable env.
    if (process.env.GIT_CONFIG_GLOBAL) environment.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
    else delete environment.GIT_CONFIG_GLOBAL;
    if (process.env.XDG_CONFIG_HOME) environment.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
  }
  const result = spawnSync(executable, [...prefix, ...args], {
    cwd, input, encoding: "utf8", env: environment, windowsHide: true,
    timeout: 2500, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.signal || (result.status !== 0 && !(args[0] === "check-ignore" && result.status === 1))) {
    throw new Error("Plan Git metadata authorization failed closed.");
  }
  return result.stdout;
}

function privatePath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return SECRET_PATH.test(`/${relative}`) || relative.split(/[\\/]/).some(part => PRIVATE_COMPONENT.test(part))
    || PRIVATE_FILE.test(path.basename(relative));
}

function validateModelPath(requested: string): void {
  if (!requested || requested.length > 4096 || /[\x00-\x1f\x7f*?\[\]{}]/.test(requested)
      || /^[@~]|^[\\/]{2}/.test(requested) || /:/.test(requested.replace(/^[a-z]:[\\/]/i, ""))) {
    throw new Error("Plan requires a concrete workspace path (no aliases, devices, or wildcards).");
  }
}

type PlanPath = { root: string; lexical: string; canonical: string; stat: fs.Stats };

// Only internal enumeration may supply literal filesystem names. Model paths
// still pass validateModelPath; containment/private/link/type checks are shared.
function concreteIdentity(root: string, requested: string): PlanPath {
  if (!requested || requested.length > 4096 || /[\x00-\x1f\x7f]/.test(requested)) throw new Error("Unsupported Plan filesystem identity.");
  const lexical = path.resolve(root, requested);
  if (!isPathInside(root, lexical) || privatePath(root, lexical)) throw new Error("Plan path is outside the workspace or confidential.");
  const canonical = fs.realpathSync(lexical);
  if (!isPathInside(root, canonical) || privatePath(root, canonical)) throw new Error("Plan link resolves outside the workspace or to confidential data.");
  const stat = fs.statSync(canonical);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error("Plan supports only regular files and directories.");
  if (stat.isFile() && stat.nlink !== 1) throw new Error("Plan rejects hard-linked files.");
  return { root, lexical, canonical, stat };
}

function ignoredPaths(root: string, targets: PlanPath[]): Set<string> {
  // One fresh query per batch. Results are local to this synchronous enumeration
  // or authorization, never reused for another directory/call or a content read.
  const paths = new Set(targets.flatMap(target => [target.lexical, target.canonical]).filter(target => target !== root));
  if (!paths.size) return new Set();
  const project = findProjectRoot(root);
  if (!fs.existsSync(path.join(project, ".git"))) return new Set();
  const input = [...paths].map(target => path.relative(project, target).replaceAll("\\", "/")).join("\0") + "\0";
  const ignored = gitMetadata(project, ["check-ignore", "--no-index", "-z", "--stdin"], input);
  return new Set(ignored.split("\0").filter(Boolean).map(relative => path.resolve(project, relative)));
}

function authorizeConcretePath(root: string, requested: string): PlanPath {
  const target = concreteIdentity(root, requested);
  const ignored = ignoredPaths(root, [target]);
  if (ignored.has(target.lexical) || ignored.has(target.canonical)) throw new Error("Plan path is outside the workspace or confidential.");
  return target;
}

export function authorizePlanPath(cwd: string, requested: string): PlanPath {
  validateModelPath(requested);
  return authorizeConcretePath(fs.realpathSync(cwd), requested);
}

function sameFile(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

export function readPlanFile(cwd: string, requested: string, checkBudget?: () => void): Buffer {
  validateModelPath(requested);
  return readConcreteFile(fs.realpathSync(cwd), requested, checkBudget);
}

function readConcreteFile(root: string, requested: string, checkBudget?: () => void): Buffer {
  checkBudget?.();
  const before = authorizeConcretePath(root, requested);
  checkBudget?.();
  if (!before.stat.isFile()) throw new Error("Plan read requires a regular file.");
  if (before.stat.size > MAX_FILE_BYTES) throw new Error("Plan file size limit reached.");
  const fd = fs.openSync(before.canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!sameFile(before.stat, opened) || !opened.isFile() || opened.nlink !== 1) throw new Error("Plan file changed during authorization.");
    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      checkBudget?.();
      const count = fs.readSync(fd, buffer, offset, Math.min(64 * 1024, buffer.length - offset), offset);
      if (!count) throw new Error("Plan file changed during reading.");
      offset += count;
      checkBudget?.();
    }
    const after = authorizeConcretePath(root, requested);
    checkBudget?.();
    if (before.canonical !== after.canonical || !sameFile(opened, fs.fstatSync(fd)) || !sameFile(opened, after.stat)) {
      throw new Error("Plan file changed during reading.");
    }
    // Opaque/binary payloads cannot be text-redacted before model delivery.
    const text = buffer.toString("utf8");
    if (buffer.includes(0) || text.includes("\uFFFD")) throw new Error("Plan inspection supports UTF-8 text only.");
    return Buffer.from(redactSensitiveText(text, Number.POSITIVE_INFINITY, checkBudget));
  } finally { fs.closeSync(fd); }
}

export type PlanInspection = { tool: "read" | "grep" | "find" | "ls"; input: Record<string, unknown> } | { tool: "metadata"; command: "pwd" | "head" };

// Deliberately a closed grammar, not a shell tokenizer/parser. Quotes may wrap
// one literal argument; expansion, pipelines, command composition and scripts
// have no meaning here and are rejected, never passed to a host shell.
export function parsePlanInspection(command: string): PlanInspection {
  if (!command || command.length > 4096 || /[\r\n\x00;&|><`$()]/.test(command)) throw new Error("Unsupported Plan inspection command.");
  const tokens = command.trim().match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g) ?? [];
  if (tokens.join(" ") !== command.trim().replace(/\s+/g, " ")) throw new Error("Unsupported Plan quoting.");
  const args = tokens.map(token => /^["']/.test(token) ? token.slice(1, -1) : token);
  const name = args.shift()?.toLowerCase();
  if ((name === "pwd" || name === "get-location") && !args.length) return { tool: "metadata", command: "pwd" };
  if (name === "git" && args.join(" ") === "rev-parse --short HEAD") return { tool: "metadata", command: "head" };
  if (name === "rg") {
    if (args[0] === "--files" && args.length <= 2) return { tool: "find", input: { pattern: "**/*", path: args[1] ?? "." } };
    const input: Record<string, unknown> = {};
    while (args[0]?.startsWith("-")) {
      const flag = args.shift();
      if (flag === "--") break;
      if (flag === "-n" || flag === "--line-number") continue;
      if (flag === "-i" || flag === "--ignore-case") input.ignoreCase = true;
      else if (flag === "-F" || flag === "--fixed-strings") input.literal = true;
      else throw new Error("Unsupported Plan rg option; use grep for structured inspection.");
    }
    if (args.length < 1 || args.length > 2) throw new Error("Plan rg requires one pattern and optional concrete path.");
    return { tool: "grep", input: { ...input, pattern: args[0], path: args[1] ?? "." } };
  }
  if (name === "get-content") {
    if (args[0]?.toLowerCase() === "-literalpath") args.shift();
    if (args.length === 1) return { tool: "read", input: { path: args[0] } };
  }
  if (name === "ls" || name === "get-childitem") {
    if (args[0]?.toLowerCase() === "-literalpath") args.shift();
    if (args.length <= 1) return { tool: "ls", input: { path: args[0] ?? "." } };
  }
  if (name === "select-string" && args.length === 4 && args[0].toLowerCase() === "-literalpath" && args[2].toLowerCase() === "-pattern") {
    return { tool: "grep", input: { path: args[1], pattern: args[3] } };
  }
  throw new Error("Plan bash accepts only documented local inspection forms; Git historical content is unavailable.");
}

function boundedNumber(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) throw new Error("Invalid Plan inspection limit.");
  return Number(value);
}

// Bounded glob matching without a backtracking regex generated from wildcards.
function matchesGlob(glob: string, value: string): boolean {
  let row = new Uint8Array(value.length + 1); row[0] = 1;
  for (const token of glob.match(/\*\*\/|\*\*|\*|\?|./g) ?? []) {
    const next = new Uint8Array(row.length);
    if (token === "**/") {
      next.set(row); // zero directories
      let active = false;
      for (let index = 0; index < value.length; index++) {
        active ||= Boolean(row[index]);
        if (active && value[index] === "/") next[index + 1] = 1;
      }
    } else if (token === "*" || token === "**") {
      next[0] = row[0];
      for (let index = 0; index < value.length; index++) next[index + 1] = row[index + 1] || (next[index] && (token === "**" || value[index] !== "/")) ? 1 : 0;
    } else {
      for (let index = 0; index < value.length; index++) if (row[index] && (token === "?" ? value[index] !== "/" : token === value[index])) next[index + 1] = 1;
    }
    row = next;
  }
  return Boolean(row[value.length]);
}

export async function inspectPlanFiles(cwd: string, tool: "grep" | "find" | "ls", input: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const start = authorizePlanPath(cwd, String(input.path ?? "."));
  const deadline = Date.now() + 10_000;
  const limit = boundedNumber(input.limit, tool === "grep" ? 100 : tool === "find" ? 1000 : 500, 1000);
  const context = boundedNumber(input.context, 0, 20);
  const output: string[] = [];
  let matches = 0;
  let visited = 0;
  let stopped = false;
  const seen = new Set<string>();
  const pattern = String(input.pattern ?? "");
  if (tool !== "ls" && (!pattern || pattern.length > 500)) throw new Error("Plan inspection needs a bounded pattern.");
  // Without repetition, matching work is bounded by line and pattern length.
  // Even one unanchored .* can cause quadratic failed matches; do not accept it.
  if (tool === "grep" && !input.literal && /[(){}+*?\\]/.test(pattern)) throw new Error("Plan regex supports simple alternatives/classes/anchors and single-character . only (no repetition); use literal=true for arbitrary text.");
  const regex = tool === "grep" && !input.literal ? new RegExp(pattern, input.ignoreCase ? "i" : "") : null;
  const glob = String(tool === "find" ? input.pattern : input.glob ?? "**/*");
  if (glob.length > 500 || /[\\{}\[\]]/.test(glob)) throw new Error("Plan glob supports *, ** and ? only.");
  function checkBudget(): void {
    if (signal?.aborted) throw new Error("Plan inspection aborted.");
    if (Date.now() > deadline) throw new Error("Plan inspection deadline reached; narrow the path or pattern.");
  }
  let skippedContent = false;
  function displayPath(target: PlanPath): string {
    return path.relative(start.stat.isDirectory() ? start.lexical : path.dirname(start.lexical), target.lexical).replaceAll("\\", "/");
  }
  function selected(target: PlanPath): boolean {
    const display = displayPath(target);
    return matchesGlob(glob, display) || (!glob.includes("/") && matchesGlob(glob, path.basename(display)));
  }
  function enumerate(requested: string): PlanPath[] {
    checkBudget();
    // Fresh directory authorization immediately before enumeration, even when a
    // parent's batch previously allowed it. Never carry ignore results into it.
    const directory = authorizeConcretePath(start.root, requested);
    checkBudget();
    if (!directory.stat.isDirectory() || seen.has(directory.canonical)) return [];
    seen.add(directory.canonical);
    const children: PlanPath[] = [];
    for (const name of fs.readdirSync(directory.canonical).sort()) {
      checkBudget();
      if (++visited > 10_000) { stopped = true; break; }
      try { children.push(concreteIdentity(start.root, path.join(directory.lexical, name))); }
      catch { /* Confidential/unreadable/non-regular entries are not listed. */ }
    }
    const ignored = ignoredPaths(start.root, children);
    checkBudget();
    return children.filter(child => {
      if (ignored.has(child.lexical) || ignored.has(child.canonical)) return false;
      try {
        // Do not publish a stale identity if a link/file changed while Git ran.
        const current = concreteIdentity(start.root, child.lexical);
        return current.canonical === child.canonical && sameFile(current.stat, child.stat);
      } catch { return false; }
    });
  }
  async function grepFile(target: PlanPath): Promise<void> {
    await setImmediate();
    checkBudget();
    let text: string;
    try { text = readConcreteFile(start.root, target.lexical, checkBudget).toString("utf8"); } catch (error) {
      // Abort/expiry during preprocessing is not an unreadable no-match result.
      checkBudget();
      if (error instanceof Error && error.message === "Plan file size limit reached.") skippedContent = true;
      return;
    }
    const lines = text.split("\n");
    // Skip the whole file before matching/output, including overlong context
    // lines. The notice has no filename/count and is only set after authorization.
    for (let index = 0; index < lines.length; index++) {
      if (index % 32 === 0) checkBudget();
      if (lines[index].length > 16_384) { skippedContent = true; return; }
    }
    const display = displayPath(target);
    for (let index = 0; index < lines.length && matches < limit; index++) {
      if (index % 32 === 0) await setImmediate();
      checkBudget();
      const line = lines[index];
      const hit = regex ? regex.test(line) : (input.ignoreCase ? line.toLowerCase().includes(pattern.toLowerCase()) : line.includes(pattern));
      if (!hit) continue;
      matches++;
      for (let row = Math.max(0, index - context); row <= Math.min(lines.length - 1, index + context); row++) output.push(`${display}:${row + 1}:${lines[row].slice(0, 500)}`);
    }
  }
  async function visitDirectory(requested: string): Promise<void> {
    await setImmediate();
    checkBudget();
    let children: PlanPath[];
    try { children = enumerate(requested); } catch (error) {
      checkBudget();
      if (error instanceof Error && error.message.includes("Git")) throw error;
      return;
    }
    // Metadata output is synchronous with its fresh batch: no yield, recursion
    // or content read can change ignores between that query and child delivery.
    for (const child of children) {
      checkBudget();
      if (matches >= limit) { stopped = true; return; }
      if (tool === "ls") {
        output.push(`${path.basename(child.lexical)}${child.stat.isDirectory() ? "/" : ""}`); matches++;
      } else if (tool === "find" && child.stat.isFile() && selected(child)) {
        output.push(displayPath(child)); matches++;
      }
    }
    if (tool === "ls" || stopped) return;
    for (const child of children) {
      checkBudget();
      if (stopped || matches >= limit) { stopped = true; return; }
      if (child.stat.isDirectory()) await visitDirectory(child.lexical);
      else if (tool === "grep" && selected(child)) await grepFile(child);
    }
  }
  if (tool === "ls" && !start.stat.isDirectory()) throw new Error("Plan ls requires a directory.");
  visited = 1;
  if (!limit) stopped = true;
  else if (start.stat.isDirectory()) await visitDirectory(start.lexical);
  else if (selected(start)) {
    if (tool === "find") { output.push(displayPath(start)); matches++; }
    else await grepFile(start);
  }
  return redactSensitiveText(output.join("\n") || "No authorized matches.", Number.POSITIVE_INFINITY, checkBudget)
    + (skippedContent ? "\n[Plan skipped files exceeding content limits; narrow the path or glob.]" : "")
    + (stopped || matches >= limit ? "\n[Plan inspection limit reached; narrow the path or pattern.]" : "");
}

export function planMetadata(cwd: string, command: "pwd" | "head"): string {
  return command === "pwd" ? fs.realpathSync(cwd) : gitMetadata(cwd, ["rev-parse", "--short", "HEAD"]).trim();
}
