import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { InspectedAction } from "./action-policy.ts";
import type { ReviewVerdict } from "./approval-store.ts";
import { redactSensitiveValue } from "./redaction.ts";

type RawVerdict = {
  decision: "approve_once" | "defer" | "deny";
  reason: string;
  saferPath: string;
};

type HeadmasterOptions = {
  provider?: string;
  modelId?: string;
  timeoutMs?: number;
};

function policyText(): string {
  try {
    return fs.readFileSync(fileURLToPath(new URL("./headmaster-policy.md", import.meta.url)), "utf-8");
  } catch {
    return "Review one sanitized action. Return strict JSON with decision approve_once, defer, or deny; reason; and saferPath. Default to defer.";
  }
}

function piEntry(): string | null {
  const current = process.argv[1];
  if (current && fs.existsSync(current) && /pi-coding-agent|[\\/]pi(?:\.js)?$/i.test(current)) return current;
  if (process.platform === "win32" && process.env.APPDATA) {
    const candidate = path.join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseVerdict(output: string): RawVerdict | null {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1)) as Partial<RawVerdict>;
    if (!value || !["approve_once", "defer", "deny"].includes(String(value.decision))) return null;
    if (typeof value.reason !== "string" || typeof value.saferPath !== "string") return null;
    return {
      decision: value.decision as RawVerdict["decision"],
      reason: value.reason.trim().slice(0, 500),
      saferPath: value.saferPath.trim().slice(0, 500),
    };
  } catch {
    return null;
  }
}

export function clampHeadmasterVerdict(action: InspectedAction, raw: RawVerdict | null): ReviewVerdict {
  if (action.route === "deny") {
    return { decision: "deny", reason: action.reason, saferPath: action.saferPath, reviewer: "policy" };
  }
  if (!raw) {
    return {
      decision: "defer",
      reason: "Headmaster did not return a valid bounded verdict; fail-closed policy deferred the action.",
      saferPath: action.saferPath,
      reviewer: "headmaster+policy",
    };
  }
  if (action.route === "human") {
    return {
      decision: "defer",
      reason: raw.reason || action.reason,
      saferPath: raw.saferPath || action.saferPath,
      reviewer: "headmaster+policy",
    };
  }
  if (action.route === "review" && raw.decision === "approve_once") {
    const bounded = action.category === "bounded-delete" && action.facts.insideWorkspace === true &&
      action.facts.file === true && action.facts.tracked === false && action.facts.generated === true;
    if (bounded) {
      return {
        decision: "approve_once",
        reason: raw.reason || action.reason,
        saferPath: raw.saferPath || action.saferPath,
        reviewer: "headmaster+policy",
      };
    }
  }
  return {
    decision: raw.decision === "deny" ? "deny" : "defer",
    reason: raw.reason || action.reason,
    saferPath: raw.saferPath || action.saferPath,
    reviewer: "headmaster+policy",
  };
}

function runHeadmaster(action: InspectedAction, options: HeadmasterOptions): Promise<RawVerdict | null> {
  if (String(process.env.NEURA_HEADMASTER ?? "").toLowerCase() === "off") return Promise.resolve(null);
  const entry = piEntry();
  if (!entry) return Promise.resolve(null);

  const dossier = JSON.stringify(redactSensitiveValue({
    version: 1,
    tool: action.toolName,
    summary: action.summary,
    category: action.category,
    risk: action.risk,
    policyRoute: action.route,
    deterministicReason: action.reason,
    saferPath: action.saferPath,
    facts: action.facts,
    workspaceFingerprint: action.workspaceFingerprint,
    actionFingerprint: action.actionFingerprint,
  }));
  const args = [
    entry,
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-tools",
    "--mode", "text",
    "--thinking", "low",
    "--system-prompt", policyText(),
  ];
  const provider = options.provider?.trim();
  const modelId = options.modelId?.trim();
  if (provider && modelId && /^[\w.-]+$/.test(provider) && /^[\w.*-]+$/.test(modelId)) {
    args.push("--model", `${provider}/${modelId}`);
  }
  args.push(dossier);

  const env: NodeJS.ProcessEnv = { ...process.env, NEURA_HEADMASTER: "1" };
  delete env.NEURA;
  return new Promise((resolve) => {
    execFile(process.execPath, args, {
      cwd: action.workspace,
      env,
      windowsHide: true,
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: 512 * 1024,
    }, (error, stdout) => resolve(error ? null : parseVerdict(String(stdout ?? ""))));
  });
}

export async function reviewWithHeadmaster(action: InspectedAction, options: HeadmasterOptions = {}): Promise<ReviewVerdict> {
  if (action.route === "deny") return clampHeadmasterVerdict(action, null);
  const raw = await runHeadmaster(action, options);
  return clampHeadmasterVerdict(action, raw);
}
