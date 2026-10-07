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

function excluded(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (SECRET_PATH.test(`/${relative}`) || relative.split(/[\\/]/).some(part => PRIVATE_COMPONENT.test(part))
      || PRIVATE_FILE.test(path.basename(relative))) return true;
  const project = findProjectRoot(root);
  if (fs.existsSync(path.join(project, ".git")) && relative) {
    // --no-index applies ignore rules even to tracked files. No ignore cache:
    // authorization must reflect a rule change between enumeration and reading.
    return gitMetadata(project, ["check-ignore", "--no-index", "-z", "--stdin"], `${path.relative(project, target).replaceAll("\\", "/")}\0`).length > 0;
  }
  return false;
}

export function authorizePlanPath(cwd: string, requested: string): { root: string; lexical: string; canonical: string; stat: fs.Stats } {
  if (!requested || requested.length > 4096 || /[\x00-\x1f\x7f*?\[\]{}]/.test(requested)
      || /^[@~]|^[\\/]{2}/.test(requested) || /:/.test(requested.replace(/^[a-z]:[\\/]/i, ""))) {
    throw new Error("Plan requires a concrete workspace path (no aliases, devices, or wildcards).");
  }
  const root = fs.realpathSync(cwd);
  const lexical = path.resolve(root, requested);
  if (!isPathInside(root, lexical) || excluded(root, lexical)) throw new Error("Plan path is outside the workspace or confidential.");
  const canonical = fs.realpathSync(lexical);
  if (!isPathInside(root, canonical) || excluded(root, canonical)) throw new Error("Plan link resolves outside the workspace or to confidential data.");
  const stat = fs.statSync(canonical);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error("Plan supports only regular files and directories.");
  if (stat.isFile() && stat.nlink !== 1) throw new Error("Plan rejects hard-linked files.");
  if (stat.isFile() && stat.size > MAX_FILE_BYTES) throw new Error("Plan file size limit reached.");
  return { root, lexical, canonical, stat };
}

function sameFile(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

export function readPlanFile(cwd: string, requested: string): Buffer {
  const before = authorizePlanPath(cwd, requested);
  if (!before.stat.isFile()) throw new Error("Plan read requires a regular file.");
  const fd = fs.openSync(before.canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!sameFile(before.stat, opened) || !opened.isFile() || opened.nlink !== 1) throw new Error("Plan file changed during authorization.");
    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) throw new Error("Plan file changed during reading.");
      offset += count;
    }
    const after = authorizePlanPath(cwd, requested);
    if (before.canonical !== after.canonical || !sameFile(opened, fs.fstatSync(fd)) || !sameFile(opened, after.stat)) {
      throw new Error("Plan file changed during reading.");
    }
    // Opaque/binary payloads cannot be text-redacted before model delivery.
    if (buffer.includes(0) || buffer.toString("utf8").includes("\uFFFD")) throw new Error("Plan inspection supports UTF-8 text only.");
    return Buffer.from(redactSensitiveText(buffer.toString("utf8")));
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
  async function visit(requested: string): Promise<void> {
    await setImmediate();
    checkBudget();
    if (++visited > 10_000 || matches >= limit) { stopped = true; return; }
    let target: ReturnType<typeof authorizePlanPath>;
    try { target = authorizePlanPath(cwd, requested); } catch (error) {
      if (error instanceof Error && error.message === "Plan file size limit reached.") throw error;
      return;
    }
    const display = path.relative(start.stat.isDirectory() ? start.lexical : path.dirname(start.lexical), target.lexical).replaceAll("\\", "/");
    if (target.stat.isDirectory()) {
      if (seen.has(target.canonical)) return;
      seen.add(target.canonical);
      // Reauthorize immediately before enumeration. Each child is separately
      // authorized before stat, output, traversal, and (for grep) content read.
      authorizePlanPath(cwd, requested);
      for (const name of fs.readdirSync(target.canonical).sort()) {
        if (stopped) break;
        await visit(path.join(target.lexical, name));
      }
      return;
    }
    if (tool === "ls") { output.push(display); matches++; return; }
    if (!(matchesGlob(glob, display) || (!glob.includes("/") && matchesGlob(glob, path.basename(display))))) return;
    if (tool === "find") { output.push(display); matches++; return; }
    let text: string;
    try { text = readPlanFile(cwd, target.lexical).toString("utf8"); } catch (error) {
      if (error instanceof Error && error.message === "Plan file size limit reached.") throw error;
      return;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length && matches < limit; index++) {
      if (index % 32 === 0) await setImmediate();
      checkBudget();
      const line = lines[index];
      if (line.length > 16_384) throw new Error("Plan grep line length limit reached (16,384 characters); narrow the path.");
      const hit = regex ? regex.test(line) : (input.ignoreCase ? line.toLowerCase().includes(pattern.toLowerCase()) : line.includes(pattern));
      if (!hit) continue;
      matches++;
      for (let row = Math.max(0, index - context); row <= Math.min(lines.length - 1, index + context); row++) output.push(`${display}:${row + 1}:${lines[row].slice(0, 500)}`);
    }
  }
  if (tool === "ls") {
    if (!start.stat.isDirectory()) throw new Error("Plan ls requires a directory.");
    for (const name of fs.readdirSync(start.canonical).sort()) {
      checkBudget();
      if (matches >= limit) { stopped = true; break; }
      try {
        const child = authorizePlanPath(cwd, path.join(start.lexical, name));
        output.push(`${name}${child.stat.isDirectory() ? "/" : ""}`); matches++;
      } catch (error) {
        if (error instanceof Error && error.message === "Plan file size limit reached.") throw error;
        // Confidential/unreadable entries are not listed.
      }
      await setImmediate();
    }
  } else await visit(start.lexical);
  return redactSensitiveText(output.join("\n") || "No authorized matches.") + (stopped || matches >= limit ? "\n[Plan inspection limit reached; narrow the path or pattern.]" : "");
}

export function planMetadata(cwd: string, command: "pwd" | "head"): string {
  return command === "pwd" ? fs.realpathSync(cwd) : gitMetadata(cwd, ["rev-parse", "--short", "HEAD"]).trim();
}
