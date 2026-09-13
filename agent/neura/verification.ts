import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AUTOMATIC_GIT_ARGUMENTS, automaticGitEnvironment, resolveExecutable } from "./process-security.ts";
import { redactSensitiveText } from "./redaction.ts";

export type TreeSnapshot = { root: string; fingerprint: string; files: Record<string, string> };
export type ProofResult = { status: "passed" | "failed" | "unavailable"; reasons: string[] };
export type IncrementalEvidence = {
  schemaVersion: 1; fingerprint: string; completedAt: string;
  status: ProofResult["status"]; suites: { name: string; status: "passed" | "failed" }[];
};
export type VerificationReceipt = {
  schemaVersion: 1;
  scope: "quick" | "full";
  fingerprint: string;
  changedFiles: string[];
  status: ProofResult["status"];
  completedAt: string;
  quick?: { status: ProofResult["status"]; completedAt: string; current: boolean };
  incremental?: IncrementalEvidence & { source: "workspace-report"; current: boolean };
};

const outsideRoot = (relative: string) => relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

export function execute(file: string, args: string[], options: {
  cwd: string; timeoutMs: number; signal?: AbortSignal; maxBuffer?: number; env?: NodeJS.ProcessEnv;
}): Promise<{ ok: boolean; stdout: string; completed?: boolean }> {
  return new Promise(resolve => {
    execFile(file, args, {
      cwd: options.cwd, timeout: options.timeoutMs, signal: options.signal,
      windowsHide: true, maxBuffer: options.maxBuffer ?? 1024 * 1024,
      env: options.env,
    }, (error, stdout) => resolve({ ok: !error,
      completed: !error || (typeof error.code === "number" && !error.killed),
      stdout: String(stdout ?? "") }));
  });
}

// Hash bytes, never Git diff output: no filters, textconv, external diff, or
// directory-collapsed untracked listings. File contents never leave this function.
export async function captureWorktree(cwd: string, options: {
  signal?: AbortSignal; maxBytes?: number; maxFiles?: number; timeoutMs?: number;
} = {}): Promise<TreeSnapshot | null> {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10_000),
    ...(options.signal ? [options.signal] : [])]);
  try {
    const executable = resolveExecutable("git", cwd);
    if (!executable) return null;
    const git = (args: string[]) => execute(executable, [...AUTOMATIC_GIT_ARGUMENTS, ...args], {
      cwd, signal, timeoutMs: 10_000, maxBuffer: 8 * 1024 * 1024, env: automaticGitEnvironment(),
    });
    const top = await git(["rev-parse", "--show-toplevel"]);
    if (!top.ok) return null;
    const root = await fs.realpath(top.stdout.trim());
    // Enumeration is rooted at the repository, even when a session starts below it.
    const run = (args: string[]) => execute(executable, [...AUTOMATIC_GIT_ARGUMENTS, ...args], {
      cwd: root, signal, timeoutMs: 10_000, maxBuffer: 8 * 1024 * 1024, env: automaticGitEnvironment(),
    });
    const [head, index, untracked] = await Promise.all([
      run(["rev-parse", "--verify", "HEAD"]),
      run(["ls-files", "--stage", "-z"]),
      run(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    if (!head.ok || !index.ok || !untracked.ok) return null;
    const tracked = index.stdout.split("\0").filter(Boolean).map(entry => {
      const match = /^(\d+) [0-9a-f]+ (\d)\t([\s\S]+)$/.exec(entry);
      if (!match || match[1] === "160000" || match[2] !== "0") throw new Error("unsupported index entry");
      return match[3]!;
    });
    const names = [...new Set([...tracked, ...untracked.stdout.split("\0").filter(Boolean)])].sort();
    if (names.length > (options.maxFiles ?? 50_000)) return null;
    const files: Record<string, string> = Object.create(null);
    let bytes = 0;
    for (const name of names) {
      signal.throwIfAborted();
      const parts = name.split("/");
      if (path.isAbsolute(name) || parts.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return null;
      const absolute = path.resolve(root, name);
      if (outsideRoot(path.relative(root, absolute))) return null;
      try {
        let current = root;
        for (const part of parts) {
          current = path.join(current, part);
          const entry = await fs.lstat(current);
          if (entry.isSymbolicLink() || (current === absolute ? !entry.isFile() : !entry.isDirectory())) return null;
        }
        const canonical = await fs.realpath(absolute);
        const relative = path.relative(root, canonical);
        if (outsideRoot(relative)) return null;
        const handle = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) return null;
          const identity = await fs.stat(canonical);
          if (identity.dev !== stat.dev || identity.ino !== stat.ino || await fs.realpath(absolute) !== canonical) return null;
          if (bytes + stat.size > (options.maxBytes ?? 64 * 1024 * 1024)) return null;
          const hash = createHash("sha256").update(String(stat.mode & 0o111)).update("\0");
          const buffer = Buffer.alloc(64 * 1024);
          for (;;) {
            signal.throwIfAborted();
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            bytes += bytesRead;
            if (bytes > (options.maxBytes ?? 64 * 1024 * 1024)) return null;
            hash.update(buffer.subarray(0, bytesRead));
          }
          const after = await handle.stat();
          if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs ||
              await fs.realpath(absolute) !== canonical) return null;
          files[name] = hash.digest("hex");
        } finally { await handle.close(); }
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
        files[name] = "missing";
      }
    }
    const hash = createHash("sha256").update(root).update(head.stdout).update(index.stdout).update(JSON.stringify(files));
    return { root, fingerprint: hash.digest("hex"), files };
  } catch { return null; }
}

export function changedFiles(before: TreeSnapshot, after: TreeSnapshot): string[] {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter(name => before.files[name] !== after.files[name]).sort();
}

export async function runProof(cwd: string, quick: boolean, options: {
  signal?: AbortSignal; timeoutMs?: number;
  execute?: typeof execute;
} = {}): Promise<ProofResult> {
  const args = proofRunnerArguments(quick);
  if (!options.execute) return { status: "unavailable", reasons: ["Proof execution requires the isolated runner."] };
  const result = await options.execute("uvx", args, {
    cwd, signal: options.signal, timeoutMs: options.timeoutMs ?? (quick ? 90_000 : 600_000),
  });
  try {
    if (result.completed === false || options.signal?.aborted) throw new Error("incomplete process");
    const value = JSON.parse(result.stdout.trim());
    if (typeof value?.passed !== "boolean" || !Array.isArray(value.reasons) ||
        !value.reasons.every((reason: unknown) => typeof reason === "string")) throw new Error("invalid verdict");
    // A failed process must never confer PASS, even if it printed valid JSON first.
    if (value.passed && !result.ok) throw new Error("incomplete process");
    return { status: value.passed ? "passed" : "failed",
      reasons: value.reasons.slice(0, 20).map((reason: string) => redactSensitiveText(reason, 500)) };
  } catch { return { status: "unavailable", reasons: ["Proof runner did not return a complete bounded verdict."] }; }
}

export const PROOF_UV_VERSION = "0.12.11";
const PROOF_RUNTIME_PINS = ["cryptography==49.0.0", "cffi==2.1.0", "pycparser==3.0", "PyYAML==6.0.3"] as const;

export function proofRunnerArguments(quick: boolean): string[] {
  return ["--isolated", "--offline", "--no-config", "--no-index", "--find-links", "/tmp/proof-wheels",
    "--from", "proof-of-work-agent==0.2.0",
    ...PROOF_RUNTIME_PINS.flatMap((dependency) => ["--with", dependency]),
    "proof-of-work", "check", "--json", "--base", "HEAD", ...(quick ? ["--no-tests"] : [])];
}

export function makeReceipt(scope: "quick" | "full", before: TreeSnapshot, after: TreeSnapshot | null,
  result: ProofResult, changes: string[], quick?: VerificationReceipt, incremental?: IncrementalEvidence): VerificationReceipt {
  return {
    schemaVersion: 1, scope, fingerprint: before.fingerprint,
    changedFiles: [...changes],
    status: !after || after.root !== before.root || after.fingerprint !== before.fingerprint ? "unavailable" : result.status,
    completedAt: new Date().toISOString(),
    ...(quick ? { quick: { status: quick.status, completedAt: quick.completedAt,
      current: quick.fingerprint === before.fingerprint } } : {}),
    ...(incremental ? { incremental: { ...incremental, source: "workspace-report" as const,
      current: incremental.fingerprint === before.fingerprint } } : {}),
  };
}

// Workspace reports are informational evidence, never authority for a PASS.
export async function readIncrementalEvidence(root: string, cancellation?: AbortSignal): Promise<IncrementalEvidence | undefined> {
  const signal = AbortSignal.any([AbortSignal.timeout(1_000), ...(cancellation ? [cancellation] : [])]);
  try {
    signal.throwIfAborted();
    const directory = path.join(root, ".proofofwork");
    const file = path.join(directory, "neura-checks.json");
    const directoryStat = await fs.lstat(directory);
    const fileStat = await fs.lstat(file);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || fileStat.isSymbolicLink() || !fileStat.isFile()) return;
    if (await fs.realpath(directory) !== directory || fileStat.size > 64 * 1024) return;
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let raw: string;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== fileStat.dev || opened.ino !== fileStat.ino || await fs.realpath(file) !== file) return;
      const buffer = Buffer.alloc(64 * 1024 + 1);
      let offset = 0;
      while (offset < buffer.length) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (offset > 64 * 1024 || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs ||
          opened.ctimeMs !== after.ctimeMs || await fs.realpath(file) !== file) return;
      raw = buffer.subarray(0, offset).toString("utf8");
    } finally { await handle.close(); }
    const data = JSON.parse(raw);
    if (data?.schemaVersion !== 1 || typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint) ||
        typeof data.completedAt !== "string" || data.completedAt.length > 30 || !Number.isFinite(Date.parse(data.completedAt)) ||
        !["passed", "failed", "unavailable"].includes(data.status) || !Array.isArray(data.suites) || data.suites.length > 32 ||
        !data.suites.every((suite: any) => typeof suite?.name === "string" && /^[a-z-]{1,40}$/.test(suite.name) &&
          ["passed", "failed"].includes(suite.status))) return;
    return { schemaVersion: 1, fingerprint: data.fingerprint, completedAt: data.completedAt, status: data.status,
      suites: data.suites.map((suite: any) => ({ name: suite.name, status: suite.status })) };
  } catch { return; }
}
