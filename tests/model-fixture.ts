// Deterministic model used only in synthetic real-Agent regression tests.
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
export function fixture(steps: any[][]) {
  const requests: any[] = [];
  const next = (options: any) => {
    requests.push(options);
    const content = steps[Math.min(requests.length - 1, steps.length - 1)];
    return { content, finishReason: content.some((part) => part.type === "tool-call") ? "tool-calls" as const : "stop" as const, usage, warnings: [] };
  };
  const model = {
    specificationVersion: "v2" as const, provider: "neura-test", modelId: "deterministic", supportedUrls: {},
    doGenerate: async (options: any) => next(options),
    doStream: async (options: any) => {
      const result = next(options);
      const chunks: any[] = [{ type: "stream-start", warnings: [] }];
      for (const [index, part] of result.content.entries()) {
        if (part.type === "text") chunks.push({ type: "text-start", id: String(index) }, { type: "text-delta", id: String(index), delta: part.text }, { type: "text-end", id: String(index) });
        else chunks.push(part);
      }
      chunks.push({ type: "finish", finishReason: result.finishReason, usage });
      return { stream: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }) };
    },
  };
  return { model, requests };
}

/** Wire fixture shared by direct-provider and interactive-CLI tests. No network calls. */
export function codexSse(response: { output: any[]; [key: string]: any }, fragmented = false): Response {
  const first = response.output[0];
  const events: any[] = [{ type: "response.created", response: { ...response, output: [] } }];
  if (first) {
    const added = first.type === "function_call" ? { ...first, arguments: "" } : { ...first, content: [] };
    const delta = first.type === "function_call"
      ? { type: "response.function_call_arguments.delta", item_id: first.id, output_index: 0, delta: first.arguments }
      : { type: "response.output_text.delta", item_id: first.id, output_index: 0, content_index: 0, delta: first.content[0]?.text ?? "" };
    events.push({ type: "response.output_item.added", output_index: 0, item: added }, delta, { type: "response.output_item.done", output_index: 0, item: first });
  }
  events.push({ type: "response.completed", response });
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    if (fragmented) for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
