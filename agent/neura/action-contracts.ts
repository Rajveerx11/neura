import type { CapabilityMetadata } from "./capabilities.ts";

export type PolicyRoute = "allow" | "review" | "human" | "deny";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ActionCategory =
  | "read-only"
  | "workspace-change"
  | "bounded-delete"
  | "protected-data"
  | "protected-control"
  | "remote-mutation"
  | "broad-destruction"
  | "unclassified-shell"
  | "external-tool";

export type ActionFacts = {
  target?: string;
  insideWorkspace?: boolean;
  exists?: boolean;
  file?: boolean;
  directory?: boolean;
  tracked?: boolean;
  generated?: boolean;
  size?: number;
};

export type InspectedAction = {
  toolName: string;
  workspace: string;
  summary: string;
  category: ActionCategory;
  risk: RiskLevel;
  route: PolicyRoute;
  reason: string;
  saferPath: string;
  actionFingerprint: string;
  workspaceFingerprint: string;
  approvalBinding: ApprovalBinding;
  facts: ActionFacts;
  capability: CapabilityMetadata;
};

export type ApprovalBinding = {
  version: 2;
  canonicalTarget: string | null;
  targetStateFingerprint: string;
  head: string;
  indexFingerprint: string;
  worktreeFingerprint: string;
  inputFingerprint: string;
};

export type ToolEvent = { toolName?: unknown; input?: unknown };
