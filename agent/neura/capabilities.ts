// Descriptive ordinary-task effects and unknown exception bounds, NOT grants.
// Mode/argument policy, canonical paths,
// task authority and exact approval bindings remain authoritative at each sink.
export type CapabilityMetadata = Readonly<{
  effects: readonly ("read" | "write" | "execute" | "delete" | "remote-mutation" | "unknown")[];
  scope: "workspace" | "plans" | "mailbox" | "external" | "session" | "unknown";
  reversibility: "not-applicable" | "recoverable" | "irreversible" | "unknown";
  network: "none" | "required" | "unknown";
  secrets: "blocked" | "possible" | "unknown";
  // null means the provider/caller owns the bound, not unlimited execution.
  timeout: Readonly<{ defaultMs: number; maxMs: number }> | null;
  approvalClass: "task-scoped" | "exception-boundary" | "unclassified";
}>;

export const HUMAN_AWAY_SANDBOX_TOOL = "human_away_exec";
export const WORK_SANDBOX_TOOL = "work_exec";
export const SANDBOX_TIMEOUT = Object.freeze({ defaultMs: 120_000, maxMs: 600_000 });

export function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp__");
}

export const WORKSPACE_READ_TOOL_NAMES = Object.freeze(["read", "grep", "find", "ls"]);
const READ_TOOLS = new Set(WORKSPACE_READ_TOOL_NAMES);
const GMAIL_READ_ONLY = new Set([
  "GMAIL_GET_PROFILE", "GMAIL_GET_MESSAGE", "GMAIL_GET_THREAD", "GMAIL_GET_DRAFT",
  "GMAIL_GET_LABEL", "GMAIL_GET_FILTER", "GMAIL_GET_SEND_AS", "GMAIL_GET_IMAP_SETTINGS",
  "GMAIL_GET_POP_SETTINGS", "GMAIL_GET_VACATION_SETTINGS", "GMAIL_GET_AUTO_FORWARDING",
  "GMAIL_GET_FORWARDING_ADDRESS", "GMAIL_LIST_MESSAGES", "GMAIL_LIST_THREADS", "GMAIL_LIST_DRAFTS",
  "GMAIL_LIST_LABELS", "GMAIL_LIST_FILTERS", "GMAIL_LIST_SEND_AS", "GMAIL_LIST_FORWARDING_ADDRESSES",
  "GMAIL_SEARCH_EMAILS", "GMAIL_SEARCH_MESSAGES", "GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
]);

const UNKNOWN: CapabilityMetadata = Object.freeze({
  effects: Object.freeze(["unknown"] as const), scope: "unknown", reversibility: "unknown",
  network: "unknown", secrets: "unknown", timeout: null, approvalClass: "unclassified",
});

export function describeCapability(toolName: string): CapabilityMetadata {
  if (toolName.startsWith("mcp__gmail__")) {
    const readOnly = GMAIL_READ_ONLY.has(toolName.slice("mcp__gmail__".length).toUpperCase());
    return { ...UNKNOWN, effects: readOnly ? ["read"] : ["remote-mutation", "unknown"], scope: "mailbox",
      network: "required", secrets: "possible", reversibility: readOnly ? "not-applicable" : "unknown",
      approvalClass: readOnly ? "task-scoped" : "exception-boundary" };
  }
  if (isMcpToolName(toolName)) return { ...UNKNOWN, scope: "external", approvalClass: "exception-boundary" };
  if (READ_TOOLS.has(toolName)) return { ...UNKNOWN, effects: ["read"], scope: "workspace",
    reversibility: "not-applicable", network: "none", secrets: "possible", approvalClass: "task-scoped" };
  if (toolName === "edit" || toolName === "write") return { ...UNKNOWN, effects: ["write"], scope: "workspace",
    network: "none", secrets: "possible", approvalClass: "task-scoped" };
  if (toolName === WORK_SANDBOX_TOOL || toolName === HUMAN_AWAY_SANDBOX_TOOL) return {
    ...UNKNOWN, effects: ["read", "write", "execute", "delete"], scope: "workspace", network: "none",
    // Host credentials are hidden, but mounted workspace scripts/data can contain secrets.
    secrets: "possible", timeout: SANDBOX_TIMEOUT, approvalClass: "task-scoped",
  };
  if (toolName === "publish_plan") return { ...UNKNOWN, effects: ["write"], scope: "plans",
    network: "none", secrets: "possible", approvalClass: "task-scoped" };
  if (toolName === "plan_request" || toolName === "questionnaire") return { ...UNKNOWN, effects: ["write"],
    scope: "session", network: "none", secrets: "possible", approvalClass: "task-scoped" };
  if (toolName === "web_search") return { ...UNKNOWN, effects: ["read"], scope: "external",
    reversibility: "not-applicable", network: "required", secrets: "possible", approvalClass: "task-scoped" };
  if (toolName === "bash") return { ...UNKNOWN, effects: ["execute", "unknown"], secrets: "possible" };
  if (["learn_material", "learn_lesson", "learn_exercise", "learn_progress"].includes(toolName)) return {
    ...UNKNOWN, effects: toolName === "learn_progress" ? ["read", "write"] : ["read", "write", "execute"],
    // Dedicated Learn state and optional machine-local vault writes are not workspace-only.
    network: "none", secrets: "possible", approvalClass: "task-scoped",
  };
  // Optional/custom tools intentionally retain unknown bounds.
  return UNKNOWN;
}
