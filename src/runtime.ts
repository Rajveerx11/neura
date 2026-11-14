import { types as utilTypes } from "node:util";
import { randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import type { TSchema } from "typebox";

/**
 * Neura's own agent loop. It talks to a model through the AI SDK provider contract (specification v4)
 * and depends on no agent framework. Only the fields this loop reads are typed here.
 */
export type TurnModel = {
  doGenerate(options: { prompt: any[]; tools?: any[]; toolChoice?: { type: "auto" }; abortSignal?: AbortSignal }): PromiseLike<{
    content: any[];
    finishReason?: { unified?: string };
    usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
  }>;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }>;
  terminate?: boolean;
  /** Learner-facing text, shown even when the model also wrote a preamble. Never sent to the model. */
  display?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (input: any, context: { signal?: AbortSignal }) => Promise<ToolResult>;
};

export type ToolEvent = { toolName: string; phase: "requested" | "started" | "returned" | "failed" | "blocked" | "cancelled" };
export type TurnUsage = { inputTokens: number; outputTokens: number };

export type RunTurnOptions = {
  model: TurnModel;
  messages: any[];
  instructions: string;
  tools: ToolDefinition[];
  signal?: AbortSignal;
  onText?: (text: string) => void;
  /** Provider-exposed summary text only; never signatures, encrypted content or inferred thoughts. */
  onReasoning?: (summary: string) => void;
  /** Synchronous, payload-free sink. Thenables are rejected without permitting hidden effects. */
  onToolEvent?: (event: ToolEvent, invocationId?: string) => void;
  /** Tool text is unredacted in YOLO, so an empty answer must not print it. */
  hideToolText?: boolean;
  maxSteps?: number;
};

export const DEFAULT_TURN_STEPS = 8;
// ponytail: a step adds at least two messages, so 60 keeps one turn inside MAX_SESSION_MESSAGES. Retune from real runs.
export const WORK_TURN_STEPS = 60;

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

/** A tool's own refusal. Its message reaches the model; any other thrown error stays generic. */
export class ToolFeedbackError extends Error {}

/** One invocation owns its queue and authority; never persist or reuse this object. */
export function createTurnTools(definitions: ToolDefinition[], signal?: AbortSignal, onToolEvent?: (event: ToolEvent, invocationId?: string) => void) {
  let queue = Promise.resolve();
  let terminated = false;
  let closed = false;
  let reportingFailed = false;
  const report = (event: ToolEvent, invocationId?: string): boolean => {
    try {
      const observed: unknown = onToolEvent?.(event, invocationId);
      if (observed && (typeof observed === "object" || typeof observed === "function") && "then" in observed) {
        if (utilTypes.isPromise(observed)) void Promise.prototype.then.call(observed, () => undefined, () => undefined);
        throw new Error("Tool observers must be synchronous");
      }
      return true;
    }
    catch { reportingFailed = true; terminated = true; closed = true; return false; }
  };
  const results: ToolResult[] = [];
  const tools: Record<string, { execute: (input: unknown, context?: unknown) => Promise<ToolResult> }> = Object.create(null);
  /** Function-tool declarations sent to the model, with every object schema closed. */
  const declarations: { type: "function"; name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
  for (const definition of definitions) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(definition.name) || Object.hasOwn(tools, definition.name)) {
      throw new Error("Invalid or duplicate tool name");
    }
    const schema: Record<string, unknown> = closedSchema(JSON.parse(JSON.stringify(definition.parameters)));
    const validate = (input: unknown) => Check(schema as TSchema, input);
    declarations.push({ type: "function", name: definition.name, description: definition.description, inputSchema: schema });
    tools[definition.name] = {
      execute: (input) => {
        const invocationId = randomUUID(); // Runtime-owned identity; never a model-provided payload.
        const pending = queue.then(async () => {
          const emit = (phase: ToolEvent["phase"]) => report({ toolName: definition.name, phase }, invocationId);
          if (signal?.aborted) { emit("cancelled"); signal.throwIfAborted(); }
          if (closed || terminated) { emit("blocked"); return feedback("Turn closed; no further actions allowed."); }
          // The effect boundary validates every input itself; nothing upstream is trusted to have done it.
          if (!validate(input)) {
            emit("blocked");
            const blocked = feedback("Invalid tool input; action rejected.");
            results.push(blocked);
            return blocked;
          }
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
          } catch (error) {
            if (signal?.aborted) { emit("cancelled"); signal.throwIfAborted(); }
            failed = true;
            result = feedback(error instanceof ToolFeedbackError ? error.message : "Tool callback rejected or failed. Check current state before retrying.");
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
    };
  }
  return { tools, declarations, results, report, reportingFailed: () => reportingFailed, isTerminated: () => terminated, close: () => { closed = true; } };
}

/** Provider options travel with a history part. The retired framework's private namespace is dropped. */
function partOptions(part: any): { providerOptions?: Record<string, unknown> } {
  const { mastra: _legacy, ...options } = (part?.providerOptions ?? part?.providerMetadata ?? {}) as Record<string, unknown>;
  return Object.keys(options).length ? { providerOptions: options } : {};
}

function imageFile(part: any) {
  const image = String(part.image);
  const inline = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(image);
  const data = inline ? { type: "data", data: inline[2] } : /^https?:\/\//i.test(image) ? { type: "url", url: new URL(image) } : { type: "data", data: image };
  return { type: "file", mediaType: part.mediaType ?? inline?.[1] ?? "image/*", data, ...partOptions(part) };
}

/** Saved history keeps images as plain `media` parts; the provider contract wants `file` parts. */
function toolOutput(part: any) {
  // Sessions saved before 2026-11-14 hold the model-facing output under the retired framework's namespace.
  const output = part.providerOptions?.mastra?.modelOutput ?? part.output;
  if (output?.type !== "content" || !Array.isArray(output.value)) return output;
  return { type: "content", value: output.value.map((item: any) => item?.type === "media"
    ? { type: "file", mediaType: item.mediaType, data: { type: "data", data: item.data } } : item) };
}

/** Neura history (the shape `src/session.ts` validates) to a provider prompt. Never mutates history. */
export function modelPrompt(instructions: string, messages: any[]): any[] {
  const parts = (content: any): any[] => typeof content === "string" ? [{ type: "text", text: content }] : content;
  return [{ role: "system", content: instructions }, ...messages.map((message) => ({
    role: message.role,
    content: parts(message.content).map((part: any) => {
      if (part.type === "image") return imageFile(part);
      if (part.type === "tool-call") return { type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, ...partOptions(part) };
      if (part.type === "tool-result") return { type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output: toolOutput(part), ...partOptions(part) };
      return { type: part.type, text: part.text, ...partOptions(part) };
    }),
  }))];
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export async function runTurn({ model, messages, instructions, tools, signal, onText, onReasoning, onToolEvent, hideToolText, maxSteps = DEFAULT_TURN_STEPS }: RunTurnOptions): Promise<{ text: string; messages: any[]; stopReason: "finished" | "step-limit"; usage?: TurnUsage }> {
  signal?.throwIfAborted();
  const turn = createTurnTools(tools, signal, onToolEvent);
  const history: any[] = [];
  let streamed = "";
  let answer = "";
  let reasoningFailed = false;
  let stopReason: "finished" | "step-limit" = "finished";
  // Missing provider counts make the total unknown; zero is a valid reported count.
  let usage: TurnUsage | undefined = { inputTokens: 0, outputTokens: 0 };
  const showReasoning = (text: string) => {
    const summary = text.slice(0, 32000).trim();
    if (!summary) return;
    try {
      const observed: unknown = onReasoning?.(summary);
      if (observed && (typeof observed === "object" || typeof observed === "function") && "then" in observed) {
        if (utilTypes.isPromise(observed)) void Promise.prototype.then.call(observed, () => undefined, () => undefined);
        throw new Error("Reasoning observers must be synchronous");
      }
    } catch { reasoningFailed = true; turn.close(); }
  };
  try {
    for (let step = 0; step < maxSteps; step++) {
      signal?.throwIfAborted();
      let reply: Awaited<ReturnType<TurnModel["doGenerate"]>>;
      // ponytail: one request per step, no automatic retry. A retry policy belongs here when it is added.
      try { reply = await model.doGenerate({ prompt: modelPrompt(instructions, [...messages, ...history]), tools: turn.declarations, toolChoice: { type: "auto" }, abortSignal: signal }); }
      catch (error) { signal?.throwIfAborted(); throw error; }
      signal?.throwIfAborted();
      const input = reply.usage?.inputTokens?.total, output = reply.usage?.outputTokens?.total;
      usage = usage && count(input) && count(output) ? { inputTokens: usage.inputTokens + input, outputTokens: usage.outputTokens + output } : undefined;
      const said: any[] = [];
      const calls: any[] = [];
      answer = "";
      for (const part of Array.isArray(reply.content) ? reply.content : []) {
        if (reasoningFailed) break;
        if (part?.type === "reasoning" && typeof part.text === "string") {
          showReasoning(part.text);
          said.push({ type: "reasoning", text: part.text, ...partOptions(part) });
        } else if (part?.type === "text" && typeof part.text === "string") {
          answer += part.text;
          said.push({ type: "text", text: part.text, ...partOptions(part) });
        } else if (part?.type === "tool-call" && typeof part.toolCallId === "string" && typeof part.toolName === "string") {
          let args: unknown = part.input;
          if (typeof args === "string") { try { args = args.trim() ? JSON.parse(args) : {}; } catch { args = undefined; } }
          const known = Object.hasOwn(turn.tools, part.toolName);
          calls.push({ part, args, known });
          said.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: args ?? {}, ...partOptions(part) });
          // A model-chosen name is untrusted text, so an unknown one is never shown.
          turn.report({ toolName: known ? part.toolName : "unknown", phase: "requested" });
        }
      }
      if (reasoningFailed) break;
      if (answer) {
        // Text from separate steps must not run together on one line.
        const chunk = (streamed && !streamed.endsWith("\n") ? "\n" : "") + answer;
        streamed += chunk;
        onText?.(chunk);
      }
      if (said.length) history.push({ role: "assistant", content: said });
      if (!calls.length) break;
      const outputs: any[] = [];
      for (const { part, args, known } of calls) {
        let result: ToolResult;
        if (known) result = await turn.tools[part.toolName].execute(args);
        else { turn.report({ toolName: "unknown", phase: "failed" }); result = feedback("Unknown tool; action rejected."); }
        outputs.push({ type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output: { type: "content", value: result.content.map((item) =>
          item.type === "image" ? { type: "media", mediaType: item.mimeType, data: item.data } : item) } });
      }
      history.push({ role: "tool", content: outputs });
      if (turn.reportingFailed() || turn.isTerminated()) break;
      // Still asking for tools on the last allowed step means the budget ran out, not that the work finished.
      if (step === maxSteps - 1) stopReason = "step-limit";
    }
    signal?.throwIfAborted();
    if (reasoningFailed) throw new Error("Reasoning display failed. Some actions may already have completed; inspect current state before retrying.");
    if (turn.reportingFailed()) throw new Error("Tool status output failed. Some actions may already have completed; inspect current state before retrying.");
    const toolText = turn.results.flatMap((result) => result.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
    const display = turn.results.flatMap((result) => result.display ? [result.display] : []).join("\n");
    const fallback = stopReason === "finished" ? display || (hideToolText ? "" : toolText) || "Turn ended without assistant text." : "";
    const text = answer && display ? `${answer}\n${display}` : answer || fallback;
    if (!streamed && text) onText?.(text);
    else if (streamed && display) onText?.(`\n${display}`);
    return { text, messages: [...messages, ...history], stopReason, ...(usage ? { usage } : {}) };
  } finally {
    turn.close();
  }
}
