import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { redactSensitiveText } from "./redaction.ts";

export const HUMAN_AWAY_SANDBOX_TOOL = "human_away_exec";
export const WORK_SANDBOX_TOOL = "work_exec";
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_WORKSPACE_ENTRIES = 200_000;

type ProcessResult = { code: number; stdout: string; stderr: string; completed?: boolean };
type ProofTrust = { uvVersion: string; uvSha256: string; uvxSha256: string; wheels: Record<string, string> };
export type ProofSandboxRuntime = { uv: string; uvx: string; wheelhouse: string; trust: ProofTrust };
export type ProofSandboxStatus = { ready: boolean; detail: string; action: string; runtime?: ProofSandboxRuntime };

function wslExecutable(): string {
  const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return path.join(root, "System32", "wsl.exe");
}

function hostEnvironment(): NodeJS.ProcessEnv {
  const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return {
    SystemRoot: root,
    WINDIR: root,
    PATH: path.join(root, "System32"),
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
}

function distroArguments(): string[] {
  const distro = String(process.env.NEURA_WSL_DISTRO ?? "").trim();
  if (!distro) return ["--exec"];
  if (!/^[\w .-]{1,64}$/.test(distro)) throw new Error("NEURA_WSL_DISTRO contains unsupported characters.");
  return ["-d", distro, "--exec"];
}

function runWsl(args: string[], timeoutMs: number, signal?: AbortSignal, redact = true): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(wslExecutable(), [...distroArguments(), ...args], {
      env: hostEnvironment(),
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      signal,
    }, (error, stdout, stderr) => {
      const result = {
        completed: !error || (typeof error.code === "number" && !error.killed),
        code: typeof (error as { code?: unknown } | null)?.code === "number"
          ? Number((error as { code: number }).code)
          : error ? 1 : 0,
        stdout: redact ? redactSensitiveText(stdout, MAX_OUTPUT_BYTES) : String(stdout ?? "").slice(0, MAX_OUTPUT_BYTES),
        stderr: redact ? redactSensitiveText(stderr, MAX_OUTPUT_BYTES) : String(stderr ?? "").slice(0, MAX_OUTPUT_BYTES),
      };
      if (error && !("code" in error)) reject(new Error("Human Away sandbox process could not start."));
      else resolve(result);
    });
  });
}

function proofTrust(): ProofTrust | null {
  try {
    const contract = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./runtime-contract.json", import.meta.url)), "utf8"));
    const trust = contract?.automaticExecutables?.proof;
    if (typeof trust?.uvVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(trust.uvVersion)
        || !/^[a-f0-9]{64}$/.test(trust.uvSha256) || !/^[a-f0-9]{64}$/.test(trust.uvxSha256)
        || !trust.wheels || typeof trust.wheels !== "object" || Array.isArray(trust.wheels)) return null;
    const wheels = Object.entries(trust.wheels);
    if (!wheels.length || wheels.some(([name, hash]) => !/^[A-Za-z0-9_.-]+\.whl$/.test(name) || !/^[a-f0-9]{64}$/.test(String(hash)))) return null;
    return { uvVersion: trust.uvVersion, uvSha256: trust.uvSha256, uvxSha256: trust.uvxSha256,
      wheels: Object.fromEntries(wheels) as Record<string, string> };
  } catch { return null; }
}

function safeWslPath(value: string): boolean {
  return /^\/(?!mnt\/)[A-Za-z0-9._/-]+$/.test(value) && !value.split("/").includes("..");
}

export function validateProofRuntimeInventory(output: string, uvDirectory: string, wheelhouse: string,
  trust: ProofTrust): ProofSandboxRuntime | null {
  const lines = output.trim().split(/\r?\n/);
  const expected = Object.entries(trust.wheels);
  if (lines.length !== 6 + expected.length || lines[0] !== path.posix.join(uvDirectory, "uv")
      || lines[1] !== path.posix.join(uvDirectory, "uvx") || lines[2] !== wheelhouse
      || lines[3] !== trust.uvSha256 || lines[4] !== trust.uvxSha256
      || lines[5 + expected.length] !== String(expected.length)) return null;
  for (let index = 0; index < expected.length; index++) {
    const [name, hash] = expected[index];
    if (lines[5 + index] !== `${name}\t${hash}`) return null;
  }
  return { uv: lines[0], uvx: lines[1], wheelhouse: lines[2], trust };
}

export async function inspectProofSandboxRuntime(signal?: AbortSignal): Promise<ProofSandboxStatus> {
  const action = "set NEURA_WSL_UV_DIR and NEURA_WSL_PROOF_WHEELHOUSE to the reviewed uv 0.12.11 bundle";
  if (process.platform !== "win32") return { ready: false, detail: "proof sandbox requires Windows WSL2", action };
  const trust = proofTrust();
  const uvDirectory = String(process.env.NEURA_WSL_UV_DIR ?? "").trim();
  const wheelhouse = String(process.env.NEURA_WSL_PROOF_WHEELHOUSE ?? "").trim();
  if (!trust || !safeWslPath(uvDirectory) || !safeWslPath(wheelhouse)) {
    return { ready: false, detail: "trusted WSL proof paths are not configured", action };
  }
  const names = Object.keys(trust.wheels);
  const script = 'set -eu; uvdir=$(readlink -f -- "$1"); wheels=$(readlink -f -- "$2"); '
    + 'test -d "$uvdir" -a -d "$wheels" -a -f "$uvdir/uv" -a -x "$uvdir/uv" -a -f "$uvdir/uvx" -a -x "$uvdir/uvx"; '
    + 'printf "%s\\n%s\\n%s\\n" "$uvdir/uv" "$uvdir/uvx" "$wheels"; '
    + 'sha256sum "$uvdir/uv" "$uvdir/uvx" | cut -d" " -f1; shift 2; '
    + 'for name do test -f "$wheels/$name" -a ! -L "$wheels/$name"; printf "%s\\t" "$name"; sha256sum "$wheels/$name" | cut -d" " -f1; done; '
    + 'find "$wheels" -mindepth 1 -maxdepth 1 | wc -l';
  try {
    const result = await runWsl(["sh", "-c", script, "neura-proof", uvDirectory, wheelhouse, ...names], 15_000, signal, false);
    if (result.code !== 0) return { ready: false, detail: "trusted WSL proof files are unavailable", action };
    const runtime = validateProofRuntimeInventory(result.stdout, uvDirectory, wheelhouse, trust);
    return runtime
      ? { ready: true, detail: `uvx ${trust.uvVersion} · ${names.length} verified wheels`, action: "", runtime }
      : { ready: false, detail: "WSL proof runtime integrity mismatch", action };
  } catch { return { ready: false, detail: "WSL proof runtime probe failed", action }; }
}

export function assertWorkspaceHasNoLinks(workspace: string): void {
  const root = fs.realpathSync(workspace);
  const pending = [root];
  let visited = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++visited > MAX_WORKSPACE_ENTRIES) throw new Error("Workspace link scan exceeded its safe entry limit.");
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`Human Away sandbox refused linked workspace entry: ${path.relative(root, candidate)}`);
      }
      if (stat.isDirectory()) pending.push(candidate);
    }
  }
}

async function toWslPath(workspace: string): Promise<string> {
  const result = await runWsl(["wslpath", "-a", "-u", "--", fs.realpathSync(workspace)], 10_000);
  const converted = result.stdout.trim();
  if (result.code !== 0 || !converted.startsWith("/") || converted.includes("\n")) {
    throw new Error("Human Away sandbox could not map the workspace into WSL2.");
  }
  return converted;
}

export function bubblewrapArguments(wslWorkspace: string, command: string, proof?: ProofSandboxRuntime): string[] {
  const verifiedCommand = proof
    ? `printf '%s\\n' ${[
      `${proof.trust.uvSha256}  /tmp/neura-bin/uv`,
      `${proof.trust.uvxSha256}  /tmp/neura-bin/uvx`,
      ...Object.entries(proof.trust.wheels).map(([name, hash]) => `${hash}  /tmp/proof-wheels/${name}`),
    ].map((line) => `'${line}'`).join(" ")} | sha256sum -c - >/dev/null && mkdir /tmp/uv-cache && UV_CACHE_DIR=/tmp/uv-cache ${command}`
    : command;
  return [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--cap-drop", "ALL",
    "--clearenv",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", "/etc", "/etc",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--dir", "/tmp/home",
    ...(proof ? [
      "--dir", "/tmp/neura-bin",
      "--ro-bind", proof.uv, "/tmp/neura-bin/uv",
      "--ro-bind", proof.uvx, "/tmp/neura-bin/uvx",
      "--ro-bind", proof.wheelhouse, "/tmp/proof-wheels",
    ] : []),
    "--dir", "/workspace",
    "--bind", wslWorkspace, "/workspace",
    "--chdir", "/workspace",
    "--setenv", "HOME", "/tmp/home",
    "--setenv", "PATH", `${proof ? "/tmp/neura-bin:" : ""}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    "--setenv", "LANG", "C.UTF-8",
    "--", "sh", "-lc", verifiedCommand,
  ];
}

export async function humanAwaySandboxAvailable(): Promise<boolean> {
  if (process.platform !== "win32" || !fs.existsSync(wslExecutable())) return false;
  try {
    const result = await runWsl(["sh", "-lc", "command -v bwrap >/dev/null 2>&1"], 10_000);
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function runInHumanAwaySandbox(
  workspace: string,
  command: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  if (process.platform !== "win32") throw new Error("Human Away sandbox currently requires Windows with WSL2.");
  if (!command.trim()) throw new Error("Human Away sandbox command is empty.");
  if (!fs.statSync(workspace).isDirectory()) throw new Error("Human Away sandbox workspace is not a directory.");
  assertWorkspaceHasNoLinks(workspace);
  if (!await humanAwaySandboxAvailable()) throw new Error("Human Away sandbox unavailable: install WSL2 and bubblewrap.");
  const wslWorkspace = await toWslPath(workspace);
  return runWsl(["bwrap", ...bubblewrapArguments(wslWorkspace, command)], timeoutMs, signal);
}

export async function runProofInSandbox(
  workspace: string,
  command: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  if (!command.trim()) throw new Error("Proof sandbox command is empty.");
  if (!fs.statSync(workspace).isDirectory()) throw new Error("Proof sandbox workspace is not a directory.");
  assertWorkspaceHasNoLinks(workspace);
  if (!await humanAwaySandboxAvailable()) throw new Error("Proof sandbox unavailable: install WSL2 and bubblewrap.");
  const status = await inspectProofSandboxRuntime(signal);
  if (!status.runtime) throw new Error(status.detail);
  const wslWorkspace = await toWslPath(workspace);
  return runWsl(["bwrap", ...bubblewrapArguments(wslWorkspace, command, status.runtime)], timeoutMs, signal);
}
