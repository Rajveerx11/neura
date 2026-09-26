#!/usr/bin/env node
/**
 * Herdr usage reporter. It reads only the current access token written by each
 * supported CLI, never refreshes credentials, and caches only rendered usage.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import https from "node:https";

const SOURCE = "neura.usage";
const TTL_MS = 120_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || join(process.env.TEMP || process.env.TMP || homedir(), "neura-usage");
const CACHE_PATH = join(STATE_DIR, "usage-cache.json");
const force = process.argv.includes("--force");

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return undefined;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch { return undefined; }
}

function credentialCandidates(provider, env = process.env) {
  const home = homedir();
  const config = env.XDG_CONFIG_HOME || (platform() === "win32" ? env.APPDATA : undefined) || join(home, ".config");
  if (provider === "claude") return [join(home, ".claude", ".credentials.json")];
  if (provider === "codex") return [join(env.CODEX_HOME || join(home, ".codex"), "auth.json")];
  return [join(config, "cursor", "auth.json"), join(home, ".config", "cursor", "auth.json")];
}

export function credentialsFor(provider, env = process.env, load = readJson, candidates = credentialCandidates) {
  const file = candidates(provider, env).find(existsSync);
  const data = file && load(file);
  if (!data) return undefined;
  if (provider === "claude") {
    const oauth = data.claudeAiOauth;
    const token = firstString(oauth?.accessToken);
    return token ? { token, plan: firstString(oauth?.subscriptionType) } : undefined;
  }
  if (provider === "codex") {
    const token = firstString(data.tokens?.access_token);
    if (!token) return undefined; // API-key authentication has no account quota window.
    const claims = decodeJwtPayload(firstString(data.tokens?.id_token) || "") || {};
    const auth = claims["https://api.openai.com/auth"] || {};
    return {
      token,
      accountId: firstString(auth.account_id, auth.chatgpt_account_id, data.tokens?.account_id),
      plan: firstString(auth.chatgpt_plan_type),
    };
  }
  const token = firstString(data.accessToken, data.access_token);
  if (!token) return undefined;
  const subject = decodeJwtPayload(token)?.sub;
  const userId = typeof subject === "string" ? subject.split("|").at(-1) : undefined;
  return userId ? { token, cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}` } : undefined;
}

function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, timeout: 15_000 }, (response) => {
      let size = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) request.destroy(new Error("response too large"));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("invalid JSON")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
  });
}

function percentRemaining(used) {
  return Number.isFinite(used) ? Math.max(0, Math.min(100, Math.round(100 - used))) : undefined;
}

function isoToSeconds(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

export function normalizeClaude(raw, plan) {
  return { plan, windows: [
    { label: "5h", remaining: percentRemaining(raw?.five_hour?.utilization), reset: isoToSeconds(raw?.five_hour?.resets_at) },
    { label: "Wk", remaining: percentRemaining(raw?.seven_day?.utilization), reset: isoToSeconds(raw?.seven_day?.resets_at) },
  ] };
}

export function normalizeCodex(raw, plan) {
  const window = (item, fallback) => {
    const seconds = item?.limit_window_seconds;
    const hours = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 3600) : undefined;
    const label = hours === 168 ? "Wk" : hours ? `${hours}h` : fallback;
    const reset = Number.isFinite(item?.reset_at) ? item.reset_at : Number.isFinite(item?.reset_after_seconds) ? Math.floor(Date.now() / 1000) + item.reset_after_seconds : undefined;
    return { label, remaining: percentRemaining(item?.used_percent), reset };
  };
  return { plan: plan || firstString(raw?.plan_type), windows: [window(raw?.rate_limit?.primary_window, "5h"), window(raw?.rate_limit?.secondary_window, "Wk")] };
}

export function normalizeCursor(raw) {
  const plan = raw?.individualUsage?.plan || raw?.individual_usage?.plan || raw?.planUsage || raw?.plan_usage;
  const used = Number(plan?.totalPercentUsed ?? plan?.total_percent_used);
  return { windows: [{ label: "Plan", remaining: percentRemaining(used), reset: isoToSeconds(raw?.billingCycleEnd || raw?.billing_cycle_end) }] };
}

async function fetchUsage(provider, credentials) {
  if (provider === "claude") {
    return normalizeClaude(await requestJson("https://api.anthropic.com/api/oauth/usage", { authorization: `Bearer ${credentials.token}`, "anthropic-beta": "oauth-2025-04-20", "user-agent": "neura-herdr-usage" }), credentials.plan);
  }
  if (provider === "codex") {
    const headers = { authorization: `Bearer ${credentials.token}`, accept: "application/json", "user-agent": "neura-herdr-usage" };
    if (credentials.accountId) headers["ChatGPT-Account-Id"] = credentials.accountId;
    return normalizeCodex(await requestJson("https://chatgpt.com/backend-api/wham/usage", headers), credentials.plan);
  }
  return normalizeCursor(await requestJson("https://cursor.com/api/usage-summary", { cookie: credentials.cookie, accept: "application/json", "user-agent": "Mozilla/5.0" }));
}

export function renderUsage(usage) {
  const parts = usage.windows.flatMap(({ label, remaining }) => Number.isFinite(remaining) ? [`${label} ${remaining}%`] : []);
  return parts.length ? parts.join(" · ") : "usage unavailable";
}

function loadCache() { return readJson(CACHE_PATH) || { providers: {}, panes: [] }; }
function saveCache(cache) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
}

function listAgentPanes() {
  const result = JSON.parse(execFileSync(HERDR, ["agent", "list"], { encoding: "utf8", windowsHide: true }));
  return result?.result?.agents || [];
}

function providerForAgent(agent) {
  const value = String(agent || "").toLowerCase();
  if (["claude", "claude-code", "anthropic"].includes(value)) return "claude";
  if (value === "codex") return "codex";
  if (value === "cursor") return "cursor";
  return undefined;
}

function isSupportedProvider(value) {
  return ["claude", "codex", "cursor"].includes(value) ? value : undefined;
}

function providerForPane(pane) {
  const direct = providerForAgent(pane.agent);
  if (direct || String(pane.agent).toLowerCase() !== "pi") return direct;
  try {
    const result = JSON.parse(execFileSync(HERDR, ["pane", "get", pane.pane_id], { encoding: "utf8", windowsHide: true }));
    return isSupportedProvider(result?.result?.pane?.tokens?.usage_provider);
  } catch { return undefined; }
}

function reportToken(paneId, token) {
  const args = ["pane", "report-metadata", paneId, "--source", SOURCE];
  args.push(...(token ? ["--token", `usage=${token}`] : ["--clear-token", "usage"]));
  try {
    execFileSync(HERDR, args, { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    // A cached pane may have closed between list and report; keep refresh best-effort.
    return false;
  }
}

async function main() {
  const panes = listAgentPanes();
  const providerPanes = panes.map((pane) => ({ ...pane, provider: providerForPane(pane) })).filter((pane) => pane.provider);
  const cache = loadCache();
  const now = Date.now();
  const providers = [...new Set(providerPanes.map((pane) => pane.provider))];
  for (const provider of providers) {
    const cached = cache.providers[provider];
    if (!force && cached?.fetchedAt && now - cached.fetchedAt <= TTL_MS) continue;
    const credentials = credentialsFor(provider);
    if (!credentials) { delete cache.providers[provider]; continue; }
    try { cache.providers[provider] = { fetchedAt: now, token: renderUsage(await fetchUsage(provider, credentials)) }; }
    catch {
      // Failed or expired credentials must remove stale quota instead of republishing it.
      delete cache.providers[provider];
    }
  }
  for (const paneId of cache.panes) reportToken(paneId, undefined);
  for (const pane of providerPanes) reportToken(pane.pane_id, cache.providers[pane.provider]?.token);
  cache.panes = panes.map((pane) => pane.pane_id);
  saveCache(cache);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => process.exitCode = 0);
}
