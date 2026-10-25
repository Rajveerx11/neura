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
