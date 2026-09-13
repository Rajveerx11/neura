import { execFile } from "node:child_process";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AUTOMATIC_GIT_ARGUMENTS, automaticGitEnvironment, resolveExecutable, scopedProcessEnvironment } from "./process-security.ts";
import { PALETTE } from "./ui-tokens.ts";

export { PALETTE } from "./ui-tokens.ts";

const ANSI = /\x1b\[[0-9;]*m/g;

export function fg(hex: string, value: string): string {
  const color = Number.parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}m${value}\x1b[0m`;
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI, "");
}

export function visibleLength(value: string): number {
  return visibleWidth(stripAnsi(value));
}

export function truncateText(value: string, width: number): string {
  if (width <= 0) return "";
  if (Array.from(value).length <= width) return value;
  if (width === 1) return "…";
  return Array.from(value).slice(0, width - 1).join("") + "…";
}

export function padAnsi(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

export type ProcessResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export function runProcess(
  file: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 3_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: options.env,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout ?? "").trim(),
          stderr: String(stderr ?? "").trim(),
        });
      },
    );
  });
}

export async function commandVersion(command: string, args = ["--version"], cwd = process.cwd()): Promise<string | null> {
  const executable = resolveExecutable(command, cwd);
  if (!executable) return null;
  let result: ProcessResult;
  if (process.platform === "win32" && [".bat", ".cmd"].includes(path.extname(executable).toLowerCase())) {
    const shell = resolveExecutable(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe", cwd);
    if (!shell) return null;
    result = await runProcess(shell,
      ["/d", "/s", "/c", `"${executable}" ${args.map((argument) => `"${argument.replaceAll('"', '""')}"`).join(" ")}`],
      { env: scopedProcessEnvironment() });
  } else result = await runProcess(executable, args, { env: scopedProcessEnvironment() });
  if (!result.ok) return null;
  return (result.stdout || result.stderr).split(/\r?\n/, 1)[0]?.trim() || null;
}

export type GitHealth = {
  isRepo: boolean;
  branch: string;
  changed: number;
  ahead: number;
  behind: number;
};

export async function getGitHealth(cwd: string): Promise<GitHealth> {
  const executable = resolveExecutable("git", cwd);
  if (!executable) return { isRepo: false, branch: "", changed: 0, ahead: 0, behind: 0 };
  const result = await runProcess(executable,
    [...AUTOMATIC_GIT_ARGUMENTS, "status", "--porcelain=v1", "--branch", "--ignore-submodules=all"],
    { cwd, env: automaticGitEnvironment() });
  if (!result.ok) return { isRepo: false, branch: "", changed: 0, ahead: 0, behind: 0 };

  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const head = lines[0] ?? "";
  const branch = /^##\s+([^.]+?)(?:\.\.\.|$)/.exec(head)?.[1]?.trim() || "detached";
  const ahead = Number(/\[ahead\s+(\d+)/.exec(head)?.[1] ?? 0);
  const behind = Number(/behind\s+(\d+)/.exec(head)?.[1] ?? 0);
  return {
    isRepo: true,
    branch,
    changed: Math.max(0, lines.length - 1),
    ahead,
    behind,
  };
}
