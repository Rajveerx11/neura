import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { redactSensitiveText } from "./redaction.ts";

export const HUMAN_AWAY_SANDBOX_TOOL = "human_away_exec";
export const WORK_SANDBOX_TOOL = "work_exec";
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_WORKSPACE_ENTRIES = 200_000;

type ProcessResult = { code: number; stdout: string; stderr: string };

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

function runWsl(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(wslExecutable(), [...distroArguments(), ...args], {
      env: hostEnvironment(),
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      signal,
    }, (error, stdout, stderr) => {
      const result = {
        code: typeof (error as { code?: unknown } | null)?.code === "number"
          ? Number((error as { code: number }).code)
          : error ? 1 : 0,
        stdout: redactSensitiveText(stdout, MAX_OUTPUT_BYTES),
        stderr: redactSensitiveText(stderr, MAX_OUTPUT_BYTES),
      };
      if (error && !("code" in error)) reject(new Error("Human Away sandbox process could not start."));
      else resolve(result);
    });
  });
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

export function bubblewrapArguments(wslWorkspace: string, command: string): string[] {
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
    "--dir", "/workspace",
    "--bind", wslWorkspace, "/workspace",
    "--chdir", "/workspace",
    "--setenv", "HOME", "/tmp/home",
    "--setenv", "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "--setenv", "LANG", "C.UTF-8",
    "--", "sh", "-lc", command,
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
