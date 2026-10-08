import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";

export type ProcessOptions = {
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBuffer: number;
  env?: NodeJS.ProcessEnv;
};

export type ProcessOutcome = {
  ok: boolean;
  // A normal nonzero exit completed; abort, timeout, spawn and buffer errors did not.
  completed: boolean;
  termination: "exited" | "spawn-failed" | "cancelled" | "timed-out" | "output-limit" | "failed";
  exitCode: number | null;
  errorCode: string | null;
  signal: string | null;
  cancelled: boolean;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
};

// Mechanics only: callers retain executable identity, environment, leases,
// authorization, redaction and output presentation. This does not use a shell.
export function executeProcess(file: string, args: string[], options: ProcessOptions): Promise<ProcessOutcome> {
  const start = performance.now();
  return new Promise(resolve => {
    execFile(file, args, {
      cwd: options.cwd, timeout: options.timeoutMs, signal: options.signal,
      maxBuffer: options.maxBuffer, env: options.env, windowsHide: true,
    }, (error, stdout, stderr) => {
      const cancelled = error?.code === "ABORT_ERR";
      const timedOut = Boolean(error?.killed && error.signal === "SIGTERM" && !cancelled);
      const errorCode = typeof error?.code === "string" ? error.code : null;
      resolve({
        ok: !error,
        completed: !error || (typeof error.code === "number" && !error.killed),
        termination: cancelled ? "cancelled" : timedOut ? "timed-out"
          : errorCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output-limit"
          : errorCode !== null && /^E[A-Z0-9]+$/.test(errorCode) ? "spawn-failed"
          : !error || typeof error.code === "number" ? "exited" : "failed",
        exitCode: !error ? 0 : typeof error.code === "number" ? error.code : null,
        errorCode,
        signal: error?.signal ?? null,
        cancelled, timedOut,
        stdout: String(stdout ?? ""), stderr: String(stderr ?? ""),
        durationMs: performance.now() - start,
      });
    });
  });
}
