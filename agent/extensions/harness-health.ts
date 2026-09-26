// harness-health — on-demand readiness console for the agentic engineering stack.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import {
  PALETTE,
  commandVersion,
  fg,
  getGitHealth,
  truncateText,
} from "../neura/core.ts";
import { addCockpitNotice, patchCockpit, removeCockpitNotice } from "../neura/cockpit-state.ts";
import { humanAwaySandboxAvailable, inspectProofSandboxRuntime } from "../neura/human-away-sandbox.ts";
import { acquireHostOperation, getMode } from "../neura/mode-state.ts";
import { resolveExecutable, scopedProcessEnvironment } from "../neura/process-security.ts";
import { redactSensitiveText } from "../neura/redaction.ts";
import { fitLine } from "../neura/ui-tokens.ts";

export type HealthState = "missing" | "disabled" | "unhealthy" | "degraded" | "ready";

export type HealthProblem = {
  code: "authentication" | "cancelled" | "configuration" | "response-limit" | "schema" | "startup" | "timeout";
  message: string;
};

export type CapabilityHealth = {
  name: string;
  required: boolean;
  state: HealthState;
  detail: string;
  action: string | null;
  problem?: HealthProblem;
};

export type HealthReport = {
  state: "ready" | "degraded" | "unhealthy";
  pi: PiRuntimeStatus;
  identity: string;
  core: string;
  workflow: string;
  context: string;
  workspace: string;
  bridges: string;
  impact: string;
  action: string;
  capabilities: CapabilityHealth[];
};

type RuntimeContract = {
  schemaVersion?: unknown;
  piVersion?: unknown;
  neuraVersion?: unknown;
};

type McpServerEntry = {
  command?: unknown;
  args?: unknown;
  disabled?: unknown;
  enabled?: unknown;
  headers?: unknown;
  type?: unknown;
  url?: unknown;
};

export type PiRuntimeStatus = {
  valid: boolean;
  installed: string | null;
  required: string | null;
  label: string;
  action: string | null;
};

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const RUNTIME_CONTRACT = fileURLToPath(new URL("../neura/runtime-contract.json", import.meta.url));
const SOURCE_AGENT_DIR = fileURLToPath(new URL("..", import.meta.url));
const PROBE_TIMEOUT_MS = 2_500;
const MAX_PROBE_BYTES = 64 * 1024;
const LEGACY_MCP_PROTOCOLS = new Set(["2024-10-07", "2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
const LOCAL_QWEN_MODEL = "qwen3-coder-30b-a3b";

function cleanProblem(code: HealthProblem["code"], value: unknown): HealthProblem {
  return { code, message: redactSensitiveText(value, 180) || code };
}

function probeProblem(error: unknown, signal: AbortSignal | undefined, fallback: HealthProblem["code"]): HealthProblem {
  const allowed = new Set<HealthProblem["code"]>(["authentication", "cancelled", "configuration", "response-limit", "schema", "startup", "timeout"]);
  const coded = error && typeof error === "object" && "code" in error && typeof error.code === "string" && allowed.has(error.code as HealthProblem["code"])
    ? error.code as HealthProblem["code"]
    : null;
  const name = error && typeof error === "object" && "name" in error ? error.name : null;
  const code = coded ?? (signal?.aborted ? "cancelled" : name === "TimeoutError" ? "timeout" : fallback);
  const message = error && typeof error === "object" && "message" in error ? error.message : error;
  return cleanProblem(code, message);
}

function capability(
  name: string,
  required: boolean,
  state: HealthState,
  detail: string,
  action: string | null,
  problem?: HealthProblem,
): CapabilityHealth {
  return {
    name: redactSensitiveText(name, 80),
    required,
    state,
    detail: redactSensitiveText(detail, 220),
    action: action ? redactSensitiveText(action, 220) : null,
    ...(problem ? { problem } : {}),
  };
}

function versionLabel(value: string | null): string {
  if (!value) return "missing";
  return value.replace(/^git version\s+/i, "").replace(/^uvx\s+/i, "").split(/\s+/, 2).join(" ");
}

export function parseRuntimeContract(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contract = value as RuntimeContract;
  if (contract.schemaVersion !== 1 || typeof contract.piVersion !== "string") return null;
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(contract.piVersion) ? contract.piVersion : null;
}

export function runtimeIdentity(
  rawContract: string,
  sourceAgentDir = SOURCE_AGENT_DIR,
  liveAgentDir = AGENT_DIR,
): { version: string | null; manifestHash: string; install: string; label: string } {
  let version: string | null = null;
  try {
    const contract = JSON.parse(rawContract) as RuntimeContract;
    if (contract.schemaVersion === 1 && typeof contract.neuraVersion === "string"
      && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(contract.neuraVersion)) {
      version = contract.neuraVersion;
    }
  } catch {}
  const manifestHash = createHash("sha256").update(rawContract).digest("hex").slice(0, 12);
  const source = path.resolve(sourceAgentDir);
  const live = path.resolve(liveAgentDir);
  const same = process.platform === "win32" ? source.toLowerCase() === live.toLowerCase() : source === live;
  const install = (same ? "live:" : "source:") + createHash("sha256").update(source).digest("hex").slice(0, 12);
  return {
    version,
    manifestHash,
    install,
    label: "neura " + (version ?? "unknown") + " · " + install + " · manifest " + manifestHash,
  };
}

function currentRuntimeIdentity(): ReturnType<typeof runtimeIdentity> {
  try { return runtimeIdentity(fs.readFileSync(RUNTIME_CONTRACT, "utf-8")); }
  catch { return runtimeIdentity(""); }
}

function requiredPiVersion(): string | null {
  try { return parseRuntimeContract(JSON.parse(fs.readFileSync(RUNTIME_CONTRACT, "utf-8"))); }
  catch { return null; }
}

export function piRuntimeStatus(installedVersion: string | null, requiredVersion: string | null): PiRuntimeStatus {
  const installed = installedVersion?.trim() || null;
  if (!requiredVersion) {
    return {
      valid: false,
      installed,
      required: null,
      label: `pi ${versionLabel(installed)} (runtime contract missing)`,
      action: "restore runtime-contract.json",
    };
  }
  if (!installed) {
    return {
      valid: false,
      installed: null,
      required: requiredVersion,
      label: `pi missing (requires ${requiredVersion})`,
      action: `npm install -g @earendil-works/pi-coding-agent@${requiredVersion}`,
    };
  }
  if (installed !== requiredVersion) {
    return {
      valid: false,
      installed,
      required: requiredVersion,
      label: `pi ${versionLabel(installed)} (requires ${requiredVersion})`,
      action: `npm install -g @earendil-works/pi-coding-agent@${requiredVersion}`,
    };
  }
  return {
    valid: true,
    installed,
    required: requiredVersion,
    label: `pi ${versionLabel(installed)} (required ${requiredVersion})`,
    action: null,
  };
}

function probeSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function boundedTextThenJson(response: Response, maximumBytes = MAX_PROBE_BYTES): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw cleanProblem("response-limit", "response exceeded " + maximumBytes + " bytes");
  }
  if (!response.body) throw cleanProblem("schema", "response body missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw cleanProblem("response-limit", "response exceeded " + maximumBytes + " bytes");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes).trim();
  const eventPayload = text.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
  try { return JSON.parse(eventPayload || text); }
  catch { throw cleanProblem("schema", "response was not valid JSON"); }
}

function mcpPayload(value: unknown): { protocolVersion: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw cleanProblem("schema", "MCP response was not an object");
  }
  const response = value as {
    jsonrpc?: unknown;
    id?: unknown;
    error?: { message?: unknown };
    result?: { protocolVersion?: unknown; capabilities?: unknown; serverInfo?: { name?: unknown; version?: unknown } };
  };
  if (response.jsonrpc !== "2.0" || response.id !== 1) {
    throw cleanProblem("schema", "MCP response had an incompatible JSON-RPC envelope");
  }
  if (response.error) {
    const message = redactSensitiveText(response.error.message, 180);
    throw cleanProblem(/auth|credential|forbidden|unauthorized/i.test(message) ? "authentication" : "schema", message);
  }
  if (typeof response.result?.protocolVersion !== "string"
    || !LEGACY_MCP_PROTOCOLS.has(response.result.protocolVersion)
    || !response.result.capabilities || typeof response.result.capabilities !== "object"
    || Array.isArray(response.result.capabilities)
    || typeof response.result.serverInfo?.name !== "string"
    || typeof response.result.serverInfo.version !== "string") {
    throw cleanProblem("schema", "MCP initialize response had incompatible schema");
  }
  return { protocolVersion: response.result.protocolVersion };
}

function allowedMcpHeaders(value: unknown): { headers?: Record<string, string>; problem?: HealthProblem } {
  if (value === undefined) return { headers: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { problem: cleanProblem("configuration", "MCP headers must be an object") };
  }
  const allowlist = new Set((process.env.MY_PI_MCP_ENV_ALLOWLIST ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const headers: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "string") {
      return { problem: cleanProblem("configuration", "MCP header " + name + " must be a string") };
    }
    const marker = "$" + "{";
    const environmentName = raw.startsWith(marker) && raw.endsWith("}") ? raw.slice(marker.length, -1) : null;
    if (environmentName && /^[A-Z][A-Z0-9_]*$/.test(environmentName)) {
      const secret = allowlist.has(environmentName) ? process.env[environmentName] : undefined;
      if (!secret) {
        return { problem: cleanProblem("authentication", "MCP credential " + environmentName + " is unavailable") };
      }
      headers[name] = secret;
    } else {
      return { problem: cleanProblem("configuration", "MCP header " + name + " must use an allowlisted environment placeholder") };
    }
  }
  return { headers };
}

export async function probeHttpMcp(
  name: string,
  entry: McpServerEntry,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<CapabilityHealth> {
  if (typeof entry.url !== "string") {
    return capability(name, false, "unhealthy", "invalid HTTP MCP configuration", "fix MCP URL", cleanProblem("configuration", "MCP URL missing"));
  }
  let url: URL;
  try { url = new URL(entry.url); }
  catch {
    return capability(name, false, "unhealthy", "invalid HTTP MCP URL", "fix MCP URL", cleanProblem("configuration", "MCP URL invalid"));
  }
  if (url.username || url.password || url.search
    || !["http:", "https:"].includes(url.protocol)
    || (url.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname))) {
    return capability(name, false, "unhealthy", "unsafe HTTP MCP URL", "use credential-free HTTPS or loopback URL", cleanProblem("configuration", "MCP URL must use HTTPS or loopback HTTP without embedded credentials or query values"));
  }
  const resolved = allowedMcpHeaders(entry.headers);
  if (resolved.problem) {
    return capability(name, false, "unhealthy", resolved.problem.message, "configure MCP authentication", resolved.problem);
  }
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: probeSignal(signal, timeoutMs),
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...resolved.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "neura-health", version: "1" } },
      }),
    });
    if ([401, 403].includes(response.status)) {
      return capability(name, false, "unhealthy", "authentication rejected (HTTP " + response.status + ")", "repair MCP credentials", cleanProblem("authentication", "HTTP " + response.status));
    }
    if (!response.ok) {
      return capability(name, false, "unhealthy", "startup failed (HTTP " + response.status + ")", "inspect MCP service", cleanProblem("startup", "HTTP " + response.status));
    }
    const result = mcpPayload(await boundedTextThenJson(response));
    return capability(name, false, "ready", "protocol " + result.protocolVersion, null);
  } catch (error) {
    const problem = probeProblem(error, signal, "startup");
    return capability(name, false, "unhealthy", problem.message, problem.code === "timeout" ? "retry MCP health check" : "inspect MCP service", problem);
  }
}

function healthEnvironment(): NodeJS.ProcessEnv {
  return scopedProcessEnvironment();
}

function jsonRpcFromOutput(output: string): unknown | null {
  for (const line of output.split(/\r?\n/)) {
    const candidate = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.id === 1) return parsed;
    } catch {}
  }
  const framed = /Content-Length:\s*(\d+)\r?\n\r?\n([\s\S]*)/i.exec(output);
  if (!framed) return null;
  try { return JSON.parse(framed[2].slice(0, Number(framed[1]))); }
  catch { return null; }
}

export function probeStdioMcp(
  name: string,
  entry: McpServerEntry,
  signal?: AbortSignal,
  timeoutMs = PROBE_TIMEOUT_MS,
  workspace = process.cwd(),
): Promise<CapabilityHealth> {
  const executable = typeof entry.command === "string" && path.isAbsolute(entry.command)
    ? resolveExecutable(entry.command, workspace) : null;
  if (!executable) {
    return Promise.resolve(capability(name, false, "degraded", "startup not safely probeable", "configure an absolute MCP executable", cleanProblem("configuration", "MCP command must be an existing absolute executable")));
  }
  if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((argument) => typeof argument !== "string"))) {
    return Promise.resolve(capability(name, false, "unhealthy", "invalid MCP arguments", "fix MCP arguments", cleanProblem("configuration", "MCP arguments must be strings")));
  }
  return new Promise((resolve) => {
    const combined = probeSignal(signal, timeoutMs);
    const child = spawn(executable, (entry.args as string[] | undefined) ?? [], {
      env: healthEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let errors = "";
    let finished = false;
    const finish = (result: CapabilityHealth) => {
      if (finished) return;
      finished = true;
      combined.removeEventListener("abort", abort);
      child.kill();
      resolve(result);
    };
    const abort = () => {
      const code = signal?.aborted ? "cancelled" : "timeout";
      finish(capability(name, false, "unhealthy", code, "retry MCP health check", cleanProblem(code, code)));
    };
    combined.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      finish(capability(name, false, "unhealthy", "process failed to start", "repair MCP executable", cleanProblem("startup", error)));
    });
    child.stdin.on("error", (error) => {
      finish(capability(name, false, "unhealthy", "process input failed", "inspect MCP service", cleanProblem("startup", error)));
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk.toString("utf8");
      if (Buffer.byteLength(errors) > MAX_PROBE_BYTES) {
        finish(capability(name, false, "unhealthy", "error output exceeded limit", "inspect MCP service", cleanProblem("response-limit", "MCP stderr exceeded limit")));
      }
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > MAX_PROBE_BYTES) {
        finish(capability(name, false, "unhealthy", "response exceeded limit", "inspect MCP service", cleanProblem("response-limit", "MCP stdout exceeded limit")));
        return;
      }
      const message = jsonRpcFromOutput(output);
      if (!message) return;
      try {
        const result = mcpPayload(message);
        finish(capability(name, false, "ready", "protocol " + result.protocolVersion, null));
      } catch (problem) {
        const structured = problem as HealthProblem;
        finish(capability(name, false, "unhealthy", structured.message, "inspect MCP service", structured));
      }
    });
    child.on("exit", (code) => {
      if (!finished) {
        finish(capability(name, false, "unhealthy", "process exited before initialization (" + (code ?? "signal") + ")", "inspect MCP service", cleanProblem("startup", errors || "MCP process exited")));
      }
    });
    if (combined.aborted) {
      abort();
      return;
    }
    child.stdin.end(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "neura-health", version: "1" } },
    }) + "\n");
  });
}

export async function inspectMcpConfig(
  value: unknown,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  untrustedServers = new Set<string>(),
  workspace = process.cwd(),
): Promise<CapabilityHealth> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return capability("MCP", false, "unhealthy", "configuration invalid", "repair mcp.json", cleanProblem("configuration", "MCP configuration must be an object"));
  }
  const servers = (value as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return capability("MCP", false, "missing", "no servers configured", "configure MCP only if needed");
  }
  const entries = Object.entries(servers as Record<string, McpServerEntry>);
  if (!entries.length) return capability("MCP", false, "disabled", "no servers enabled", null);
  const disabled = entries.filter(([, entry]) => entry?.disabled === true || entry?.enabled === false);
  const enabled = entries.filter(([, entry]) => entry?.disabled !== true && entry?.enabled !== false);
  if (!enabled.length) return capability("MCP", false, "disabled", disabled.length + " disabled", null);
  const results = await Promise.all(enabled.map(([name, entry]) => {
    if (untrustedServers.has(name)) {
      return capability(name, false, "degraded", "project-defined server not probed", "review project MCP config", cleanProblem("configuration", "project MCP servers require explicit trust before probing"));
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return capability(name, false, "unhealthy", "configuration invalid", "repair MCP server entry", cleanProblem("configuration", "MCP server entry must be an object"));
    }
    return typeof entry.url === "string"
      ? probeHttpMcp(name, entry, fetchImpl, signal)
      : probeStdioMcp(name, entry, signal, PROBE_TIMEOUT_MS, workspace);
  }));
  const ready = results.filter((result) => result.state === "ready").length;
  const firstFailure = results.find((result) => result.state !== "ready");
  const state: HealthState = ready === results.length ? "ready" : ready ? "degraded"
    : results.every((result) => result.state === "degraded") ? "degraded" : "unhealthy";
  const parts = [ready + "/" + enabled.length + " ready", disabled.length ? disabled.length + " disabled" : ""].filter(Boolean);
  return capability(
    "MCP",
    false,
    state,
    parts.join(" · "),
    firstFailure ? firstFailure.name + ": " + (firstFailure.action ?? "inspect service") : null,
    firstFailure?.problem,
  );
}

export function mergeMcpConfigs(globalValue: unknown, projectValue?: unknown): { mcpServers: Record<string, McpServerEntry> } {
  const servers = (value: unknown, source: string): Record<string, McpServerEntry> => {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(source + " MCP configuration must be an object");
    const configured = (value as { mcpServers?: unknown }).mcpServers;
    if (configured === undefined) return {};
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error(source + " mcpServers must be an object");
    return configured as Record<string, McpServerEntry>;
  };
  return { mcpServers: { ...servers(globalValue, "global"), ...servers(projectValue, "project") } };
}

export async function probeLocalProvider(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  timeoutMs = 700,
): Promise<CapabilityHealth> {
  try {
    const response = await fetchImpl("http://127.0.0.1:8080/v1/models", {
      redirect: "error",
      signal: probeSignal(signal, timeoutMs),
    });
    if (!response.ok) {
      return capability("local Qwen", false, "unhealthy", "HTTP " + response.status, "start a compatible local model", cleanProblem("startup", "HTTP " + response.status));
    }
    const payload = await boundedTextThenJson(response) as { data?: unknown };
    if (!Array.isArray(payload?.data)
      || !payload.data.some((model) => model && typeof model === "object" && (model as { id?: unknown }).id === LOCAL_QWEN_MODEL)) {
      return capability("local Qwen", false, "unhealthy", "required model unavailable", "load " + LOCAL_QWEN_MODEL, cleanProblem("schema", "models response missing required model"));
    }
    return capability("local Qwen", false, "ready", LOCAL_QWEN_MODEL + " available", null);
  } catch (error) {
    const problem = probeProblem(error, signal, "startup");
    const missing = problem.code === "startup";
    return capability("local Qwen", false, missing ? "missing" : "unhealthy", missing ? "not running" : problem.message, "start local Qwen only if needed", problem);
  }
}

function countSkills(): number {
  const skillDir = path.join(os.homedir(), ".claude", "skills");
  try {
    return fs.readdirSync(skillDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function mcpHealth(cwd: string, signal?: AbortSignal): Promise<CapabilityHealth> {
  const globalPath = path.join(AGENT_DIR, "mcp.json");
  const projectPath = [path.join(cwd, "mcp.json"), path.join(cwd, ".mcp.json")]
    .find((candidate) => fs.existsSync(candidate));
  if (!fs.existsSync(globalPath) && !projectPath) {
    return capability("MCP", false, "missing", "configuration missing", "configure MCP only if needed");
  }
  try {
    const globalValue = fs.existsSync(globalPath) ? JSON.parse(fs.readFileSync(globalPath, "utf-8")) : undefined;
    const projectValue = projectPath ? JSON.parse(fs.readFileSync(projectPath, "utf-8")) : undefined;
    const projectServers = projectValue && typeof projectValue === "object" && !Array.isArray(projectValue)
      ? (projectValue as { mcpServers?: unknown }).mcpServers
      : undefined;
    const untrustedServers = projectServers && typeof projectServers === "object" && !Array.isArray(projectServers)
      ? new Set(Object.keys(projectServers))
      : new Set<string>();
    return inspectMcpConfig(mergeMcpConfigs(globalValue, projectValue), fetch, signal, untrustedServers, cwd);
  } catch (error) {
    return capability(
      "MCP",
      false,
      "unhealthy",
      "configuration invalid",
      "repair mcp.json",
      cleanProblem("configuration", error),
    );
  }
}

function modeShortcutReady(): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, "keybindings.json"), "utf-8"));
    const thinking = config?.["app.thinking.cycle"];
    const keys = Array.isArray(thinking) ? thinking : [thinking];
    return !keys.includes("shift+tab");
  } catch {
    return false;
  }
}

function stateText(item: CapabilityHealth): string {
  return item.name + " " + item.state;
}

export function requiredHealthState(capabilities: CapabilityHealth[]): HealthReport["state"] {
  const required = capabilities.filter((item) => item.required);
  if (required.some((item) => item.state === "unhealthy")) return "unhealthy";
  if (required.some((item) => item.state !== "ready")) return "degraded";
  return "ready";
}

export async function inspect(cwd: string, signal?: AbortSignal): Promise<HealthReport> {
  const [gitVersion, git, qwen, sandbox, proof, mcp] = await Promise.all([
    commandVersion("git", ["--version"], cwd),
    getGitHealth(cwd),
    probeLocalProvider(fetch, signal),
    humanAwaySandboxAvailable(),
    inspectProofSandboxRuntime(signal, cwd),
    mcpHealth(cwd, signal),
  ]);
  const pi = piRuntimeStatus(PI_VERSION, requiredPiVersion());
  const identity = currentRuntimeIdentity();
  const releasePath = path.join(AGENT_DIR, 'neura', 'release-manifest.json');
  // Source identity is not evidence that the live Pi files match the release.
  const releaseValid = fs.existsSync(releasePath) &&
    spawnSync(process.execPath, [path.join(AGENT_DIR, 'neura', 'runtime-install.mjs'), 'check'],
      { timeout: 5_000, windowsHide: true, stdio: 'ignore' }).status === 0;

  const checkpoint = fs.existsSync(path.join(AGENT_DIR, "extensions", "checkpoint.ts"));
  const gate = fs.existsSync(path.join(AGENT_DIR, "extensions", "check-gate.ts"));
  const modes = fs.existsSync(path.join(AGENT_DIR, "extensions", "modes.ts"));
  const modeKeys = modeShortcutReady();
  const persona = fs.existsSync(path.join(AGENT_DIR, "neura", "NEURA.md"));
  const memory = fs.existsSync(path.join(AGENT_DIR, "neura", "MEMORY.md"));
  const skills = countSkills();
  const capabilities = [
    capability("Pi", true, pi.valid ? "ready" : pi.installed ? "unhealthy" : "missing", pi.label, pi.action),
    capability("identity", true, identity.version && releaseValid ? "ready" : "degraded", identity.label + (releaseValid ? '' : ` · release manifest missing or drifted (${releasePath})`), identity.version && releaseValid ? null : "restore or verify release manifest"),
    capability("Git", true, gitVersion ? "ready" : "missing", versionLabel(gitVersion), gitVersion ? null : "install Git"),
    capability("workspace", true, git.isRepo ? "ready" : "degraded", git.isRepo ? git.branch : "not a Git workspace", git.isRepo ? null : "open a Git workspace"),
    capability("modes", true, modes && modeKeys ? "ready" : "degraded", modes && modeKeys ? "extension and keybinding ready" : "extension or keybinding missing", modes && modeKeys ? null : "sync extensions and keybindings"),
    capability("sandbox", true, sandbox ? "ready" : "degraded", sandbox ? "WSL2 and bubblewrap ready" : "unavailable", sandbox ? null : "install WSL2 + bubblewrap"),
    capability("proof", true, gate && sandbox && proof.ready ? "ready" : "degraded",
      gate ? proof.detail : "gate missing", gate && sandbox && proof.ready ? null : proof.action || "sync proof gate and sandbox"),
    capability("checkpoint", true, checkpoint ? "ready" : "missing", checkpoint ? "undo available" : "extension missing", checkpoint ? null : "sync checkpoint extension"),
    capability("persona", true, persona ? "ready" : "missing", persona ? "loaded" : "missing", persona ? null : "restore persona"),
    capability("memory", false, memory ? "ready" : "disabled", memory ? "configured" : "not configured", null),
    capability("skills", false, skills ? "ready" : "missing", skills ? skills + " found" : "none found", skills ? null : "configure skills only if needed"),
    mcp,
    qwen,
  ];
  const state = requiredHealthState(capabilities);
  const requiredFailure = capabilities.find((item) => item.required && item.state !== "ready");
  const optionalFailure = capabilities.find((item) => !item.required && !["ready", "disabled"].includes(item.state));
  const sync = [git.ahead ? "↑" + git.ahead : "", git.behind ? "↓" + git.behind : ""].filter(Boolean).join(" ");
  const changes = git.changed ? git.changed + " changes" : "clean";

  return {
    state,
    pi,
    identity: identity.label,
    core: capabilities.slice(0, 4).map(stateText).join(" · "),
    workflow: capabilities.slice(4, 8).map(stateText).join(" · "),
    context: capabilities.slice(8, 11).map(stateText).join(" · "),
    workspace: git.isRepo ? git.branch + " · " + changes + (sync ? " · " + sync : "") : "not a Git workspace",
    bridges: [mcp, qwen].map(stateText).join(" · "),
    impact: state === "ready"
      ? optionalFailure ? "Core ready; optional capability gap does not block Neura." : "No core capability loss."
      : "Required capability gap blocks a truthful ready state.",
    action: requiredFailure?.action ?? optionalFailure?.action ?? "agentic harness core is ready",
    capabilities,
  };
}

export function healthLines(report: HealthReport, width: number): string[] {
  const ok = report.state === "ready";
  const stateColor = ok ? PALETTE.success : report.state === "unhealthy" ? PALETTE.error : PALETTE.warning;
  const line = (label: string, value: string, color: string = PALETTE.text) =>
    `${fg(PALETTE.dim, label.padEnd(10))}${fg(color, truncateText(value, Math.max(12, width - 10)))}`;

  const wrapPlain = (value: string, color: string): string[] => {
    const characters = Array.from(value);
    const lines: string[] = [];
    for (let offset = 0; offset < characters.length; offset += Math.max(1, width)) {
      lines.push(fg(color, characters.slice(offset, offset + Math.max(1, width)).join("")));
    }
    return lines.length ? lines : [""];
  };
  const piLines = [
    ...wrapPlain(`pi installed ${report.pi.installed ?? "missing"}`, report.pi.valid ? PALETTE.text : PALETTE.warning),
    ...wrapPlain(`pi required  ${report.pi.required ?? "missing"}`, report.pi.valid ? PALETTE.muted : PALETTE.warning),
  ];
  const header = `${fg(PALETTE.accent, "NEURA / HARNESS HEALTH")}  ${fg(stateColor, report.state.toUpperCase())}`;
  const runtimeRows = [header, ...piLines, ...(width >= 56 ? [line("identity", report.identity, PALETTE.muted)] : [])];

  if (!ok) {
    const [primaryAction = "inspect degraded harness state"] = report.action.split("  ·  ").filter(Boolean);
    const prefix = "next ";
    const continuation = " ".repeat(prefix.length);
    const chunkWidth = Math.max(1, width - prefix.length);
    const characters = Array.from(primaryAction);
    const actionLines: string[] = [];
    for (let offset = 0; offset < characters.length; offset += chunkWidth) {
      const chunk = characters.slice(offset, offset + chunkWidth).join("");
      actionLines.push(`${fg(PALETTE.dim, offset === 0 ? prefix : continuation)}${fg(stateColor, chunk)}`);
    }
    const diagnostics = [
      { id: "core", line: line("core", report.core) },
      { id: "workflow", line: line("workflow", report.workflow) },
      { id: "context", line: line("context", report.context) },
      { id: "workspace", line: line("workspace", report.workspace, PALETTE.muted) },
      { id: "bridges", line: line("bridges", report.bridges, PALETTE.muted) },
      { id: "impact", line: line("impact", report.impact, PALETTE.warning) },
    ];
    const priorities = [
      /uv|extension|mode|sandbox|keybinding|proof/i.test(report.action) ? "workflow" : "",
      /skills|persona|memory/i.test(report.action) ? "context" : "",
      /mcp|qwen/i.test(report.action) ? "bridges" : "",
      /git|workspace/i.test(report.action) ? "workspace" : "",
      "core", "workflow", "context", "impact", "workspace", "bridges",
    ].filter(Boolean);
    const orderedDiagnostics = [...new Set(priorities)]
      .map((id) => diagnostics.find((item) => item.id === id)!)
      .filter(Boolean);
    const diagnosticBudget = Math.max(0, 10 - runtimeRows.length - actionLines.length);
    return [
      ...runtimeRows,
      ...orderedDiagnostics.slice(0, diagnosticBudget).map((item) => item.line),
      ...actionLines,
    ].map((value) => fitLine(value, width));
  }

  return [
    header,
    ...piLines,
    line("identity", report.identity, PALETTE.muted),
    line("core", report.core),
    line("workflow", report.workflow),
    line("context", report.context),
    line("workspace", report.workspace, PALETTE.muted),
    line("bridges", report.bridges, PALETTE.muted),
    line(ok ? "status" : "next", report.action, ok ? PALETTE.success : PALETTE.warning),
  ].map((value) => fitLine(value, width));
}

export function registerHealth(pi, inspectHealth = inspect) {
  if (!process.env.NEURA) return;

  pi.registerCommand("health", {
    description: "Inspect Neura runtime, verification, context, workspace, and bridges",
    handler: async (args, ctx) => {
      if ((args ?? "").trim().toLowerCase() === "close") {
        ctx.ui.setWidget("neura-health", undefined);
        ctx.ui.setStatus("neura-health", undefined);
        return;
      }
      if (getMode() !== "yolo") return void ctx.ui.notify("/health requires YOLO because it executes host diagnostics and probes integrations.", "warning");

      ctx.ui.setWidget("neura-health", undefined);
      ctx.ui.setStatus("neura-health", "health check");
      patchCockpit({ operation: { verb: "health", target: "inspecting capabilities", startedAt: Date.now() } });
      const release = acquireHostOperation();
      if (!release) {
        ctx.ui.setStatus("neura-health", undefined);
        patchCockpit({ operation: undefined });
        return void ctx.ui.notify("Another host operation is still running.", "warning");
      }
      let report: Awaited<ReturnType<typeof inspect>>;
      try {
        ctx.abortSignal?.throwIfAborted();
        report = await inspectHealth(ctx.cwd, ctx.abortSignal);
        ctx.abortSignal?.throwIfAborted();
      } catch (error) {
        if (ctx.abortSignal?.aborted) return;
        const message = redactSensitiveText(error, 180) || "health inspection failed";
        patchCockpit({ phase: "DEGRADED", degraded: message });
        addCockpitNotice({ id: "health", message: "Health inspection failed", detail: message, tone: "warning", persistent: true });
        return void ctx.ui.notify(message, "error");
      } finally {
        release();
        ctx.ui.setStatus("neura-health", undefined);
        patchCockpit({ operation: undefined });
      }
      const ready = report.state === "ready";
      patchCockpit({ phase: ready ? "READY" : "DEGRADED", degraded: ready ? undefined : report.action });
      if (!ready) {
        addCockpitNotice({ id: "health", message: report.state === "unhealthy" ? "Harness unhealthy" : "Harness degraded", detail: report.action, tone: "warning", persistent: true });
      } else {
        removeCockpitNotice("health");
      }
      ctx.ui.setWidget("neura-health", () => ({
        render: (width: number) => healthLines(report, width),
        invalidate() {},
      }));
    },
  });
}

export default function (pi) { registerHealth(pi); }
