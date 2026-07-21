// presets — registers local Qwen (llama.cpp) as a provider + /preset command to hot-swap models.
// Start the local server first with the local-coder launcher (http://127.0.0.1:8080).
// Delete file to unwire.

const PRESETS = {
  gpt: { provider: "openai-codex", model: "gpt-5.5", note: "default — big-model work" },
  qwen: { provider: "local-qwen", model: "qwen3-coder-30b-a3b", note: "free local grunt work (start llama.cpp first)" },
};

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  pi.registerProvider("local-qwen", {
    name: "Local Qwen (llama.cpp)",
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "sk-local", // llama-server ignores auth; registry wants a value
    api: "openai-completions",
    models: [
      {
        id: "qwen3-coder-30b-a3b",
        name: "Qwen3-Coder-30B-A3B (local)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
      },
    ],
  });

  pi.registerCommand("preset", {
    description: "Swap model preset: /preset gpt | qwen",
    handler: async (args, ctx) => {
      const key = (args || "").trim().toLowerCase();
      const p = PRESETS[key];
      if (!p) {
        ctx.ui.notify(`Presets: ${Object.entries(PRESETS).map(([k, v]) => `${k} (${v.note})`).join(" · ")}`, "info");
        return;
      }
      const model = ctx.modelRegistry.find(p.provider, p.model);
      if (!model) return ctx.ui.notify(`Model ${p.provider}/${p.model} not in registry`, "error");
      const ok = await pi.setModel(model);
      ctx.ui.notify(ok ? `Switched to ${p.model}` : `Failed — no API key / server down for ${p.provider}`, ok ? "info" : "error");
    },
  });
}
