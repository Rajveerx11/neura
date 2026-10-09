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
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let settled = false;
    const timeout = options.timeoutMs;
    const child = execFile(file, args, {
      // Keep invalid-timeout validation in Node; valid deadlines are owned here
      // because a cooperative SIGTERM exit can erase the callback's error/signal.
      cwd: options.cwd, timeout: timeout === null || timeout === undefined || (Number.isInteger(timeout) && timeout >= 0) ? 0 : timeout, signal: options.signal,
      maxBuffer: options.maxBuffer, env: options.env, windowsHide: true,
    }, (error, stdout, stderr) => {
      settled = true;
      clearTimeout(deadline);
      const cancelled = error?.code === "ABORT_ERR";
      const timedOut = expired;
      const errorCode = typeof error?.code === "string" ? error.code : null;
      let termination: ProcessOutcome["termination"] = "failed";
      if (cancelled) termination = "cancelled";
      else if (timedOut) termination = "timed-out";
      else if (errorCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") termination = "output-limit";
      else if (errorCode !== null && /^E[A-Z0-9]+$/.test(errorCode)) termination = "spawn-failed";
      else if (!error || typeof error.code === "number") termination = "exited";
      let exitCode: number | null = null;
      if (!error) exitCode = 0;
      else if (typeof error.code === "number") exitCode = error.code;
      resolve({
        ok: !error && !timedOut,
        completed: !timedOut && (!error || (typeof error.code === "number" && !error.killed)),
        termination,
        exitCode,
        errorCode,
        signal: error?.signal ?? null,
        cancelled, timedOut,
        stdout: String(stdout ?? ""), stderr: String(stderr ?? ""),
        durationMs: performance.now() - start,
      });
    });
    if (timeout > 0 && !settled) deadline = setTimeout(() => {
      // Abort/buffer failure may already have initiated termination. Do not
      // relabel those races as deadline expiry while their callback is pending.
      if (settled || child.killed) return;
      expired = true;
      // Match execFile's timeout stream cleanup; this is not tree termination
      // or a hard completion deadline for a child that ignores SIGTERM.
      child.stdout?.destroy();
      child.stderr?.destroy();
      try { child.kill("SIGTERM"); }
      catch (error) { child.emit("error", error); }
    }, timeout);
  });
}
