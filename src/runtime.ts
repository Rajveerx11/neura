import { types as utilTypes } from "node:util";
import { Check } from "typebox/value";
import type { TSchema } from "typebox";
import type { AgentConfig } from "@mastra/core/agent";
import type { StandardSchemaWithJSON } from "@mastra/core/schema";

// Static Mastra imports would run before this opt-out.
process.env.MASTRA_TELEMETRY_DISABLED = "1";
const { Agent } = await import("@mastra/core/agent");
const { createTool } = await import("@mastra/core/tools");
const { noopLogger } = await import("@mastra/core/logger");

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }>;
  terminate?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (input: any, context: { signal?: AbortSignal }) => Promise<ToolResult>;
};

export type ToolEvent = { toolName: string; phase: "requested" | "started" | "returned" | "failed" | "blocked" | "cancelled" };

export type RunTurnOptions = {
  model: AgentConfig["model"];
  messages: any[];
  instructions: string;
  tools: ToolDefinition[];
  signal?: AbortSignal;
  onText?: (text: string) => void;
  /** Synchronous, payload-free sink. Thenables are rejected without permitting hidden effects. */
  onToolEvent?: (event: ToolEvent) => void;
};

export const MAX_TURN_STEPS = 8;

function closedSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const result = { ...schema };
  if (schema.type === "object" && schema.additionalProperties === undefined) result.additionalProperties = false;
  for (const key of ["properties", "patternProperties", "$defs", "definitions"]) {
    if (schema[key]) result[key] = Object.fromEntries(Object.entries(schema[key]).map(([name, child]) => [name, closedSchema(child)]));
  }
  for (const key of ["items", "additionalProperties", "not", "if", "then", "else", "contains"]) {
    if (schema[key] !== undefined) result[key] = Array.isArray(schema[key]) ? schema[key].map(closedSchema) : closedSchema(schema[key]);
  }
  for (const key of ["anyOf", "allOf", "oneOf", "prefixItems"]) {
    if (schema[key]) result[key] = schema[key].map(closedSchema);
  }
  return result;
}

const feedback = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

/** One invocation owns its queue and authority; never persist or reuse this object. */
export function createTurnTools(definitions: ToolDefinition[], signal?: AbortSignal, onToolEvent?: (event: ToolEvent) => void) {
  let queue = Promise.resolve();
  let terminated = false;
  let closed = false;
  let reportingFailed = false;
  const report = (event: ToolEvent): boolean => {
    try {
      const observed: unknown = onToolEvent?.(event);
      if (observed && (typeof observed === "object" || typeof observed === "function") && "then" in observed) {
        if (utilTypes.isPromise(observed)) void Promise.prototype.then.call(observed, () => undefined, () => undefined);
        throw new Error("Tool observers must be synchronous");
      }
      return true;
    }
    catch { reportingFailed = true; terminated = true; closed = true; return false; }
  };
  const results: ToolResult[] = [];
  const tools: Record<string, ReturnType<typeof createTool>> = Object.create(null);
  for (const definition of definitions) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(definition.name) || Object.hasOwn(tools, definition.name)) {
      throw new Error("Invalid or duplicate tool name");
    }
    const schema: Record<string, unknown> = closedSchema(JSON.parse(JSON.stringify(definition.parameters)));
    const validate = (input: unknown) => Check(schema as TSchema, input);
    const inputSchema: StandardSchemaWithJSON = {
      "~standard": {
        version: 1,
        vendor: "neura-typebox",
        validate: (input) => validate(input) ? { value: input } : { issues: [{ message: "Invalid tool input" }] },
        jsonSchema: { input: () => schema, output: () => schema },
      },
    };
    tools[definition.name] = createTool({
      id: definition.name,
      description: definition.description,
      inputSchema,
      toModelOutput: (output: unknown) => {
        const result = (output as ToolResult).content ? output as ToolResult : feedback("Invalid tool input; action rejected.");
        if (result !== output) { results.push(result); report({ toolName: definition.name, phase: "blocked" }); }
        return { type: "content", value: result.content.map((part) => part.type === "image"
          ? { type: "media", mediaType: part.mimeType, data: part.data }
          : part) };
      },
      execute: (input) => {
        const pending = queue.then(async () => {
          const emit = (phase: ToolEvent["phase"]) => report({ toolName: definition.name, phase });
          if (signal?.aborted) { emit("cancelled"); signal.throwIfAborted(); }
          if (closed || terminated) { emit("blocked"); return feedback("Turn closed; no further actions allowed."); }
          // Resume/direct execution can bypass framework validation; enforce it at the effect boundary.
          if (!validate(input)) { emit("blocked"); return feedback("Invalid tool input; action rejected."); }
          if (!emit("started")) {
            const blocked = feedback("Tool not run: status output was unavailable.");
            results.push(blocked);
            return blocked;
          }
          let result: ToolResult;
          let failed = false;
          try {
            signal?.throwIfAborted();
            result = await definition.execute(input, { signal });
          } catch {
            if (signal?.aborted) { emit("cancelled"); signal.throwIfAborted(); }
            failed = true;
            result = feedback("Tool callback rejected or failed. Check current state before retrying.");
          }
          // Record effect/termination state before any fallible post-action notification.
          if (result.terminate) terminated = true;
          results.push(result);
          emit(failed ? "failed" : "returned");
          return result;
        });
        queue = pending.then(() => undefined, () => undefined);
        return pending;
      },
    });
  }
  return { tools, results, report, reportingFailed: () => reportingFailed, isTerminated: () => terminated, close: () => { closed = true; } };
}

export async function runTurn({ model, messages, instructions, tools, signal, onText, onToolEvent }: RunTurnOptions): Promise<{ text: string; messages: any[] }> {
  signal?.throwIfAborted();
  const names = new Set(tools.map(tool => tool.name));
  const turn = createTurnTools(tools, signal, onToolEvent);
  const agent = new Agent({ id: "neura", name: "Neura", instructions, model, tools: turn.tools });
  agent.__setLogger(noopLogger);
  let streamed = "";
  try {
    const result = await agent.generate(messages, {
      maxSteps: MAX_TURN_STEPS,
      toolCallConcurrency: 1,
      abortSignal: signal,
      modelSettings: { maxRetries: 0 },
      stopWhen: () => turn.isTerminated(),
      onChunk: (chunk) => {
        if (chunk.type === "text-delta") {
          streamed += chunk.payload.text;
          onText?.(chunk.payload.text);
        } else if (chunk.type === "tool-call" || chunk.type === "tool-error") {
          turn.report({ toolName: names.has(chunk.payload.toolName) ? chunk.payload.toolName : "unknown", phase: chunk.type === "tool-call" ? "requested" : "failed" });
        }
      },
    });
    signal?.throwIfAborted();
    if (turn.reportingFailed()) throw new Error("Tool status output failed. Some actions may already have completed; inspect current state before retrying.");
    const toolText = turn.results.flatMap((result) => result.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
    const text = result.text || toolText || "Turn ended without assistant text.";
    if (!streamed) onText?.(text);
    return { text, messages: [...messages, ...(result.response.messages ?? [])] };
  } finally {
    turn.close();
  }
}
