import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { InspectedAction, RiskLevel } from "./action-policy.ts";

export type ReviewDecision = "approve_once" | "defer" | "deny";
export type ReviewVerdict = {
  decision: ReviewDecision;
  reason: string;
  saferPath: string;
  reviewer: "headmaster" | "policy" | "headmaster+policy";
};

export type ApprovalStatus = "pending" | "executed" | "approved" | "denied" | "dismissed";

export type ApprovalRecord = {
  id: string;
  createdAt: string;
  workspace: string;
  actionFingerprint: string;
  workspaceFingerprint: string;
  toolName: string;
  summary: string;
  category: string;
  risk: RiskLevel;
  verdict: ReviewVerdict;
  approvable: boolean;
  status: ApprovalStatus;
};

type DecisionEvent = {
  kind: "decision";
  at: string;
  record: Omit<ApprovalRecord, "status">;
  status: "pending" | "executed";
  prevHash: string;
  hash: string;
};

type ResolutionEvent = {
  kind: "resolution";
  at: string;
  id: string;
  resolution: "approved" | "denied" | "dismissed";
  prevHash: string;
  hash: string;
};

type AuditEvent = DecisionEvent | ResolutionEvent;
type Grant = { id: string; actionFingerprint: string; workspaceFingerprint: string; expiresAt: number };

const GRANTS_KEY = Symbol.for("neura.approval-grants.v1");
const globalRegistry = globalThis as typeof globalThis & { [GRANTS_KEY]?: Map<string, Grant> };
const grants = globalRegistry[GRANTS_KEY] ??= new Map<string, Grant>();
export const GRANT_TTL_MS = 120_000;

function approvalDirectory(): string {
  return process.env.NEURA_APPROVAL_DIR || path.join(os.homedir(), ".pi", "agent", "neura", "approvals");
}

function auditFile(): string {
  return path.join(approvalDirectory(), "audit.jsonl");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function withoutHash<T extends AuditEvent>(event: T): Omit<T, "hash"> {
  const { hash: _hash, ...rest } = event;
  return rest;
}

function sanitize(value: string, limit = 500): string {
  return value
    .replace(/\b(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, "$1[REDACTED]")
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/g, "$1[REDACTED]")
    .replace(/(--?(?:password|token|api-key|secret)\s+)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, "$1[REDACTED]")
    .slice(0, limit);
}

function readEvents(): AuditEvent[] {
  let raw = "";
  try { raw = fs.readFileSync(auditFile(), "utf-8"); } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const events: AuditEvent[] = [];
  let previous = "GENESIS";
  for (const [index, line] of raw.split(/\r?\n/).filter(Boolean).entries()) {
    let event: AuditEvent;
    try { event = JSON.parse(line) as AuditEvent; } catch {
      throw new Error(`approval audit is invalid JSON at line ${index + 1}`);
    }
    if (event.prevHash !== previous || digest(withoutHash(event)) !== event.hash) {
      throw new Error(`approval audit hash-chain failed at line ${index + 1}`);
    }
    events.push(event);
    previous = event.hash;
  }
  return events;
}

function appendEvent(event: Omit<DecisionEvent, "prevHash" | "hash"> | Omit<ResolutionEvent, "prevHash" | "hash">): void {
  const events = readEvents();
  const prevHash = events.at(-1)?.hash ?? "GENESIS";
  const unsigned = { ...event, prevHash } as Omit<AuditEvent, "hash">;
  const signed = { ...unsigned, hash: digest(unsigned) } as AuditEvent;
  fs.mkdirSync(approvalDirectory(), { recursive: true });
  fs.appendFileSync(auditFile(), JSON.stringify(signed) + "\n", { encoding: "utf-8", flag: "a" });
}

function materialize(events = readEvents()): ApprovalRecord[] {
  const records = new Map<string, ApprovalRecord>();
  for (const event of events) {
    if (event.kind === "decision") {
      records.set(event.record.id, { ...event.record, status: event.status });
    } else {
      const record = records.get(event.id);
      if (record) record.status = event.resolution;
    }
  }
  return [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function recordDecision(
  action: InspectedAction,
  verdict: ReviewVerdict,
  status: "pending" | "executed",
  approvable: boolean,
): ApprovalRecord {
  if (status === "pending") {
    const duplicate = listPending(action.workspace).find((record) =>
      record.actionFingerprint === action.actionFingerprint &&
      record.workspaceFingerprint === action.workspaceFingerprint,
    );
    if (duplicate) return duplicate;
  }

  const recordWithoutStatus: Omit<ApprovalRecord, "status"> = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    workspace: action.workspace,
    actionFingerprint: action.actionFingerprint,
    workspaceFingerprint: action.workspaceFingerprint,
    toolName: action.toolName,
    summary: sanitize(action.summary, 300),
    category: action.category,
    risk: action.risk,
    verdict: {
      decision: verdict.decision,
      reason: sanitize(verdict.reason),
      saferPath: sanitize(verdict.saferPath),
      reviewer: verdict.reviewer,
    },
    approvable,
  };
  appendEvent({ kind: "decision", at: new Date().toISOString(), record: recordWithoutStatus, status });
  return { ...recordWithoutStatus, status };
}

export function listPending(workspace?: string): ApprovalRecord[] {
  return materialize().filter((record) => record.status === "pending" && (!workspace || record.workspace === workspace));
}

export function listRecent(workspace?: string, limit = 20): ApprovalRecord[] {
  return materialize().filter((record) => !workspace || record.workspace === workspace).slice(0, limit);
}

export function findPending(id: string, workspace?: string): ApprovalRecord | undefined {
  const normalized = id.trim().toLowerCase();
  return listPending(workspace).find((record) => record.id.toLowerCase().startsWith(normalized));
}

export function resolveApproval(id: string, resolution: "approved" | "denied" | "dismissed"): void {
  const record = findPending(id);
  if (!record) throw new Error(`pending approval not found: ${id}`);
  appendEvent({ kind: "resolution", at: new Date().toISOString(), id: record.id, resolution });
}

export function grantExactRetry(record: ApprovalRecord, now = Date.now()): Grant {
  if (!record.approvable || record.status !== "pending") throw new Error("approval is not eligible for exact retry");
  const grant = {
    id: record.id,
    actionFingerprint: record.actionFingerprint,
    workspaceFingerprint: record.workspaceFingerprint,
    expiresAt: now + GRANT_TTL_MS,
  };
  grants.set(record.actionFingerprint, grant);
  return grant;
}

export function consumeExactRetry(action: InspectedAction, now = Date.now()): boolean {
  const grant = grants.get(action.actionFingerprint);
  if (!grant) return false;
  grants.delete(action.actionFingerprint);
  return grant.expiresAt >= now && grant.workspaceFingerprint === action.workspaceFingerprint;
}

export function verifyApprovalAudit(): { valid: true; events: number } {
  return { valid: true, events: readEvents().length };
}
