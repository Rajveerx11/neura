import { Type } from "typebox";
import { getMode } from "../neura/mode-state.ts";
import { HUMAN_AWAY_SANDBOX_TOOL, WORK_SANDBOX_TOOL, runInHumanAwaySandbox } from "../neura/human-away-sandbox.ts";

export default function (pi): void {
  if (!process.env.NEURA) return;

  pi.registerTool({
    name: WORK_SANDBOX_TOOL,
    label: "WORK sandbox",
    description:
      "Run one local engineering command inside Neura's WSL2 bubblewrap boundary. Only the active workspace is writable; " +
      "Windows drives, WSL home, host environment variables, and network access are unavailable.",
    promptSnippet: "Run a test, build, or bounded workspace command in WORK mode",
    promptGuidelines: [
      "Use only while WORK mode is active. Prefer this tool over native bash for tests, builds, and workspace-changing commands.",
      "Use one auditable command. Network access, host credentials, linked workspace entries, and paths outside the workspace are unavailable.",
      "If policy blocks a command, use the stated safer path; enter YOLO deliberately only when the user authorizes a broader boundary.",
    ],
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 16_000, description: "shell command executed from /workspace" }),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (getMode() !== "work") throw new Error("work_exec is available only in WORK mode.");
      const result = await runInHumanAwaySandbox(
        ctx.cwd,
        params.command,
        (params.timeoutSeconds ?? 120) * 1_000,
        signal,
      );
      const output = [
        `exit: ${result.code}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: output }] };
    },
  });

  pi.registerTool({
    name: HUMAN_AWAY_SANDBOX_TOOL,
    label: "Human Away sandbox",
    description:
      "Run one command inside Neura's WSL2 bubblewrap boundary. Only the active workspace is writable; " +
      "Windows drives, WSL home, host environment variables, and network access are unavailable.",
    promptSnippet: "Run a bounded workspace command in Human Away Preview",
    promptGuidelines: [
      "Use only while Human Away Preview is active.",
      "Prefer one auditable command. Never probe hidden host paths, credentials, or network access.",
      "If policy blocks a command, use the stated safer path and do not disguise or split it.",
    ],
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 16_000, description: "shell command executed from /workspace" }),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (getMode() !== "human-away") throw new Error("human_away_exec is available only in Human Away Preview.");
      const result = await runInHumanAwaySandbox(
        ctx.cwd,
        params.command,
        (params.timeoutSeconds ?? 120) * 1_000,
        signal,
      );
      const output = [
        `exit: ${result.code}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: output }] };
    },
  });
}
