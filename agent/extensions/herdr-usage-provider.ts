// Reports Pi's active subscription-backed provider to the global Herdr Usage plugin.
// The bridge never resolves or handles provider credentials.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCockpitState, onCockpitChange } from "../neura/cockpit-state.ts";
import { getMode, onModeChange } from "../neura/mode-state.ts";

const run = promisify(execFile);
const SOURCE = "neura.pi-usage";
const USAGE_PLUGIN = "neura.usage";

function usageProvider(provider: unknown): string | undefined {
  switch (String(provider ?? "").toLowerCase()) {
    case "openai-codex": return "codex";
    case "anthropic": return "claude";
    case "cursor": return "cursor";
    default: return undefined;
  }
}

export function herdrMetadata(provider: unknown): { provider?: string; mode: string; phase: string } {
  return {
    provider: usageProvider(provider),
    mode: getMode().toUpperCase(),
    phase: getCockpitState().phase,
  };
}

async function report(provider: unknown, refreshUsage = false): Promise<void> {
  if (!process.env.NEURA || process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) return;
  const herdr = process.env.HERDR_BIN_PATH;
  if (!herdr || !isAbsolute(herdr) || !existsSync(herdr)) return;
  const pane = process.env.HERDR_PANE_ID;
  const metadata = herdrMetadata(provider);
  const args = ["pane", "report-metadata", pane, "--source", SOURCE,
    "--token", `mode=${metadata.mode}`,
    "--token", `phase=${metadata.phase}`,
  ];
  args.push(...(metadata.provider ? ["--token", `usage_provider=${metadata.provider}`] : ["--clear-token", "usage_provider"]));
  try {
    await run(herdr, args, { windowsHide: true, timeout: 5_000 });
    if (refreshUsage) await run(herdr, ["plugin", "action", "invoke", "refresh", "--plugin", USAGE_PLUGIN], { windowsHide: true, timeout: 5_000 });
  } catch {
    // Herdr or the optional plugin may be absent. Pi must remain unaffected.
  }
}

export { usageProvider };

export default function (pi: ExtensionAPI) {
  // This is a Herdr integration, not a Neura UI/policy feature. Outside Herdr
  // it registers nothing, preserving stock Pi behavior.
  if (!process.env.NEURA || process.env.HERDR_ENV !== "1") return;

  let provider: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingUsageRefresh = false;
  let unsubscribeMode = () => {};
  let unsubscribeCockpit = () => {};
  const schedule = (refreshUsage = false) => {
    pendingUsageRefresh ||= refreshUsage;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const shouldRefreshUsage = pendingUsageRefresh;
      pendingUsageRefresh = false;
      void report(provider, shouldRefreshUsage);
    }, 120);
  };

  pi.on("session_start", (_event, ctx) => {
    provider = ctx.model?.provider;
    unsubscribeMode();
    unsubscribeCockpit();
    unsubscribeMode = onModeChange(() => schedule());
    unsubscribeCockpit = onCockpitChange(() => schedule());
    schedule(true);
  });
  pi.on("model_select", (event) => { provider = event.model.provider; schedule(true); });
  pi.on("session_shutdown", () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pendingUsageRefresh = false;
    unsubscribeMode();
    unsubscribeCockpit();
  });
}
