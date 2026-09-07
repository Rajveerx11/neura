import { isBoundedResearchReadAllowed } from "./action-policy.ts";
import { isPlanToolInputAllowed } from "./plan-policy.ts";

export const LEARN_ONLY_TOOL_NAMES = Object.freeze([
  "learn_material", "learn_lesson", "learn_exercise", "learn_progress",
]);

export const LEARN_MODE_TOOL_NAMES = Object.freeze([
  "read", "ls", "questionnaire", "web_search", ...LEARN_ONLY_TOOL_NAMES,
]);

const dedicated = new Set(LEARN_ONLY_TOOL_NAMES);
const allowed = new Set(LEARN_MODE_TOOL_NAMES);

// Dedicated tools enforce their bounded schemas and canonical storage at execute
// time. Stock grep/find inherit executable search configuration and are never
// exposed here. Unknown/custom/MCP tools fail closed.
export function isLearnActionAllowed(event: { toolName?: unknown; input?: unknown }, cwd: string): boolean {
  const name = typeof event.toolName === "string" ? event.toolName : "";
  if (!allowed.has(name)) return false;
  if (dedicated.has(name)) return !!event.input && typeof event.input === "object" && !Array.isArray(event.input);
  if (name === "web_search" || name === "questionnaire") return isPlanToolInputAllowed(name, event.input);
  return isBoundedResearchReadAllowed(event, cwd);
}
