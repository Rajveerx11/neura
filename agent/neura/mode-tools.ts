// Exact mode tool selection remains policy, not an authority inferred from metadata.
import { HUMAN_AWAY_SANDBOX_TOOL, WORK_SANDBOX_TOOL, WORKSPACE_READ_TOOL_NAMES } from "./capabilities.ts";
import { PLAN_MODE_TOOL_NAMES, PLAN_REQUEST_TOOL, PUBLISH_PLAN_TOOL } from "./plan-policy.ts";
import { LEARN_MODE_TOOL_NAMES, LEARN_ONLY_TOOL_NAMES } from "./learn-policy.ts";

export const PLAN_TOOLS = new Set(PLAN_MODE_TOOL_NAMES);
export const PLAN_ONLY_TOOLS = new Set([PUBLISH_PLAN_TOOL, PLAN_REQUEST_TOOL]);
export const WORK_TOOLS = new Set([...WORKSPACE_READ_TOOL_NAMES, "bash", "edit", "write", WORK_SANDBOX_TOOL]);
export const LEARN_TOOLS = new Set(LEARN_MODE_TOOL_NAMES);
export const MODE_ONLY_TOOLS = new Set([PUBLISH_PLAN_TOOL, PLAN_REQUEST_TOOL, WORK_SANDBOX_TOOL, HUMAN_AWAY_SANDBOX_TOOL, ...LEARN_ONLY_TOOL_NAMES]);
export const PROVIDER_TOOL_ALIASES = new Map([
  ["Read", "read"],
  ["Bash", "bash"],
  ["Grep", "grep"],
  ["Edit", "edit"],
  ["Write", "write"],
  ["Find", "find"],
  ["Glob", "find"],
  ["Ls", "ls"],
]);

function providerToolName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const tool = value as { name?: unknown; function?: { name?: unknown }; toolSpec?: { name?: unknown } };
  if (typeof tool.name === "string") return tool.name;
  if (typeof tool.function?.name === "string") return tool.function.name;
  return typeof tool.toolSpec?.name === "string" ? tool.toolSpec.name : undefined;
}

function providerToolAllowed(value: unknown, enforcedRestrictedTools: readonly string[]): boolean {
  const name = providerToolName(value);
  return name !== undefined && enforcedRestrictedTools.includes(PROVIDER_TOOL_ALIASES.get(name) ?? name);
}

function filterProviderTools(value: unknown, enforcedRestrictedTools: readonly string[]): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return [];
    const record = tool as Record<string, unknown>;
    if ("functionDeclarations" in record) {
      const functionDeclarations = Array.isArray(record.functionDeclarations)
        ? record.functionDeclarations.filter((tool) => providerToolAllowed(tool, enforcedRestrictedTools))
        : [];
      return functionDeclarations.length ? [{ ...record, functionDeclarations }] : [];
    }
    return providerToolAllowed(record, enforcedRestrictedTools) ? [record] : [];
  });
}

export function filterRestrictedProviderPayload(payload: unknown, enforcedRestrictedTools: readonly string[]): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  let filtered = { ...record };
  if ("tools" in record) filtered = { ...filtered, tools: filterProviderTools(record.tools, enforcedRestrictedTools) };
  if (record.config && typeof record.config === "object" && !Array.isArray(record.config)) {
    const config = record.config as Record<string, unknown>;
    if ("tools" in config) filtered = { ...filtered, config: { ...config, tools: filterProviderTools(config.tools, enforcedRestrictedTools) } };
  }
  if (record.toolConfig && typeof record.toolConfig === "object" && !Array.isArray(record.toolConfig)) {
    const toolConfig = record.toolConfig as Record<string, unknown>;
    if ("tools" in toolConfig) filtered = { ...filtered, toolConfig: { ...toolConfig, tools: filterProviderTools(toolConfig.tools, enforcedRestrictedTools) } };
  }
  return filtered;
}
