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

export type RunTurnOptions = {
  model: AgentConfig["model"];
  messages: any[];
  instructions: string;
  tools: ToolDefinition[];
  signal?: AbortSignal;
  onText?: (text: string) => void;
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
export function createTurnTools(definitions: ToolDefinition[], signal?: AbortSignal) {
  let queue = Promise.resolve();
  let terminated = false;
  let closed = false;
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
        if (result !== output) results.push(result);
        return { type: "content", value: result.content.map((part) => part.type === "image"
          ? { type: "media", mediaType: part.mimeType, data: part.data }
          : part) };
      },
      execute: (input) => {
        const pending = queue.then(async () => {
          signal?.throwIfAborted();
          if (closed || terminated) return feedback("Turn closed; no further actions allowed.");
          // Resume/direct execution can bypass framework validation; enforce it at the effect boundary.
          if (!validate(input)) return feedback("Invalid tool input; action rejected.");
          let result: ToolResult;
          try {
            result = await definition.execute(input, { signal });
          } catch {
            signal?.throwIfAborted();
            result = feedback("Tool callback rejected or failed. Check current state before retrying.");
          }
          if (result.terminate) terminated = true;
          results.push(result);
          return result;
        });
        queue = pending.then(() => undefined, () => undefined);
        return pending;
      },
    });
  }
  return { tools, results, isTerminated: () => terminated, close: () => { closed = true; } };
}

export async function runTurn({ model, messages, instructions, tools, signal, onText }: RunTurnOptions): Promise<{ text: string; messages: any[] }> {
  signal?.throwIfAborted();
  const turn = createTurnTools(tools, signal);
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
        }
      },
    });
    signal?.throwIfAborted();
    const toolText = turn.results.flatMap((result) => result.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
    const text = result.text || toolText || "Turn ended without assistant text.";
    if (!streamed) onText?.(text);
    return { text, messages: [...messages, ...(result.response.messages ?? [])] };
  } finally {
    turn.close();
  }
}
