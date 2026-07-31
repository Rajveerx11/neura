// presets — model hot-swap. Registers local Qwen (llama.cpp) as a provider + /preset command.
// Start the local server first with the local-coder launcher (http://127.0.0.1:8080).
// Delete file to unwire.

const PRESETS = {
  gpt: { provider: "openai-codex", model: "gpt-5.5", note: "default — ChatGPT subscription, no extra cost" },
  opus: { provider: "anthropic", model: "claude-opus-5", note: "hardest work — Claude extra usage, billed per token" },
  qwen: { provider: "local-qwen", model: "qwen3-coder-30b-a3b", note: "free local grunt work (start llama.cpp first)" },
};

// Catalog IDs carry date suffixes (claude-opus-5-2026xxxx). Exact hit first, else newest prefix match.
function resolveModel(registry, provider: string, model: string) {
  return (
    registry.find(provider, model) ??
    registry
      .getAll()
      .filter((m) => m.provider === provider && m.id.startsWith(model))
      .sort((a, b) => b.id.localeCompare(a.id))[0]
  );
}

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
    description: "Swap model preset: /preset gpt | opus | qwen",
    handler: async (args, ctx) => {
      const key = (args || "").trim().toLowerCase();
      const p = PRESETS[key];
      if (!p) {
        ctx.ui.notify(`Presets: ${Object.entries(PRESETS).map(([k, v]) => `${k} (${v.note})`).join(" · ")}`, "info");
        return;
      }
      const model = resolveModel(ctx.modelRegistry, p.provider, p.model);
      if (!model) {
        ctx.ui.notify(`${p.provider}/${p.model} not in registry — run /login ${p.provider} first`, "error");
        return;
      }
      // setModel rejects on a bad/expired credential — report it, never surface a raw command error
      const ok = await pi.setModel(model).catch(() => false);
      ctx.ui.notify(
        ok ? `Switched to ${model.id}` : `Could not switch to ${model.id} — no credential for ${p.provider} (/login ${p.provider})`,
        ok ? "info" : "error",
      );
    },
  });
}
