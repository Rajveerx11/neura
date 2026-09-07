import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "neura-harness-verify-"));
process.env.NEURA_APPROVAL_DIR = path.join(scratchRoot, "approvals");
process.on("exit", () => {
  try { fs.rmSync(scratchRoot, { recursive: true, force: true }); } catch {}
});
const npmRoot = execFileSync(
  process.platform === "win32" ? "cmd" : "npm",
  process.platform === "win32" ? ["/d", "/s", "/c", "npm", "root", "-g"] : ["root", "-g"],
  { encoding: "utf-8", windowsHide: true },
).trim();
const loaderPath = path.join(
  npmRoot,
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "core",
  "extensions",
  "loader.js",
);
const tuiPath = path.join(
  npmRoot,
  "@earendil-works",
  "pi-coding-agent",
  "node_modules",
  "@earendil-works",
  "pi-tui",
  "dist",
  "index.js",
);

assert.ok(fs.existsSync(loaderPath), `pi extension loader missing: ${loaderPath}`);
assert.ok(fs.existsSync(tuiPath), `pi TUI module missing: ${tuiPath}`);

process.env.NEURA = "1";

const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
const { visibleWidth } = await import(pathToFileURL(tuiPath).href);
const { isSafeExternalUrl, isPlanToolInputAllowed } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "plan-policy.ts")).href
);
const { inspectAction, isApprovalRetryEligible } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "action-policy.ts")).href
);
const { GRANT_TTL_MS, consumeExactRetry, grantExactRetry, listPending } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "approval-store.ts")).href
);
const { redactSensitiveText } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "redaction.ts")).href
);
const { HUMAN_AWAY_SANDBOX_TOOL, assertWorkspaceHasNoLinks, bubblewrapArguments } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "human-away-sandbox.ts")).href
);
const { healthLines, parseRuntimeContract, piRuntimeStatus } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "extensions", "harness-health.ts")).href
);
const extensionDir = path.join(repoRoot, "agent", "extensions");
const files = fs.readdirSync(extensionDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => path.join(extensionDir, name));
assert.equal(files.some((file) => file.endsWith(`${path.sep}autogit.ts`)), false, "retired autogit extension still loads");
const installerSource = fs.readFileSync(path.join(repoRoot, "install.ps1"), "utf-8");
const runtimeContract = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "runtime-contract.json"), "utf-8"));
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
assert.match(installerSource, /\$retiredExtensions\s*=\s*@\("autogit\.ts"\)/, "installer does not retire the old autogit hook");
assert.match(installerSource, /Remove-Item -LiteralPath \$retiredPath -Force/, "installer does not remove the retired autogit hook");
assert.match(installerSource, /is retired but remains installed/, "drift check does not detect the retired autogit hook");
assert.match(installerSource, /function Get-PackageIdentity/, "installer cannot reconcile exact runtime package pins");
assert.match(installerSource, /runtime package is not exactly pinned/, "drift check ignores runtime package pins");
assert.match(installerSource, /runtime-contract\.json/, "installer does not consume the runtime contract");
assert.match(installerSource, /\$requiredPiVersion\s*=\s*\[string\]\$runtimeContract\.piVersion/, "installer does not enforce the runtime contract Pi version");
assert.match(installerSource, /\$schemaIsInteger\s*=\s*\(\$runtimeContract\.schemaVersion -is \[int\]\) -or \(\$runtimeContract\.schemaVersion -is \[long\]\)/, "installer allows a coercible non-integer runtime contract schema");
assert.equal(runtimeContract.schemaVersion, 1, "runtime contract schema version changed without migration");
assert.equal(runtimeContract.piVersion, packageManifest.devDependencies["@earendil-works/pi-coding-agent"], "runtime contract and development Pi pin disagree");
assert.equal(parseRuntimeContract(runtimeContract), runtimeContract.piVersion, "valid runtime contract was rejected");
assert.equal(parseRuntimeContract({ schemaVersion: "1", piVersion: runtimeContract.piVersion }), null, "string runtime contract schema was coerced");
assert.deepEqual(piRuntimeStatus(runtimeContract.piVersion, runtimeContract.piVersion), {
  valid: true,
  installed: runtimeContract.piVersion,
  required: runtimeContract.piVersion,
  label: `pi ${runtimeContract.piVersion} (required ${runtimeContract.piVersion})`,
  action: null,
}, "matching Pi runtime was not healthy");
assert.deepEqual(piRuntimeStatus("9.9.9", runtimeContract.piVersion), {
  valid: false,
  installed: "9.9.9",
  required: runtimeContract.piVersion,
  label: `pi 9.9.9 (requires ${runtimeContract.piVersion})`,
  action: `npm install -g @earendil-works/pi-coding-agent@${runtimeContract.piVersion}`,
}, "Pi runtime drift was not actionable");
assert.deepEqual(piRuntimeStatus(null, runtimeContract.piVersion), {
  valid: false,
  installed: null,
  required: runtimeContract.piVersion,
  label: `pi missing (requires ${runtimeContract.piVersion})`,
  action: `npm install -g @earendil-works/pi-coding-agent@${runtimeContract.piVersion}`,
}, "missing Pi runtime was not actionable");
assert.deepEqual(piRuntimeStatus(runtimeContract.piVersion, null), {
  valid: false,
  installed: runtimeContract.piVersion,
  required: null,
  label: `pi ${runtimeContract.piVersion} (runtime contract missing)`,
  action: "restore runtime-contract.json",
}, "missing runtime contract did not fail closed");
const loaded = await loadExtensions(files, repoRoot);

assert.deepEqual(loaded.errors, [], `extension load errors: ${JSON.stringify(loaded.errors)}`);
assert.equal(loaded.extensions.length, files.length, "not every extension loaded");

// loadExtensions deliberately leaves action methods unbound. Bind the small runtime
// surface exercised by this deterministic harness without constructing an AgentSession.
const registeredToolNames = loaded.extensions.flatMap((extension) => [...extension.tools.keys()]);
let activeTools = [...new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "web_search", "web_fetch", ...registeredToolNames])];
const appendedEntries = [];
const sentUserMessages = [];
loaded.runtime.getActiveTools = () => [...activeTools];
loaded.runtime.setActiveTools = (names) => { activeTools = [...names]; };
loaded.runtime.getAllTools = () => [...new Set([...activeTools, ...registeredToolNames, "web_search", "web_fetch"])]
  .map((name) => ({ name }));
loaded.runtime.appendEntry = (customType, data) => { appendedEntries.push({ customType, data }); };
loaded.runtime.sendUserMessage = (content, options) => { sentUserMessages.push({ content, options }); };

const extensionWithCommand = (name) => {
  const extension = loaded.extensions.find((candidate) => candidate.commands.has(name));
  assert.ok(extension, `/${name} command missing`);
  return extension;
};
const extensionWithTool = (name) => {
  const extension = loaded.extensions.find((candidate) => candidate.tools.has(name));
  assert.ok(extension, `${name} tool missing`);
  return extension;
};
const firstHandler = (extension, event) => {
  const handler = extension.handlers.get(event)?.[0];
  assert.equal(typeof handler, "function", `${event} handler missing`);
  return handler;
};
const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, "");
const widthOf = (value) => visibleWidth(value);
const repairAction = `npm install -g @earendil-works/pi-coding-agent@${runtimeContract.piVersion}`;
for (const width of [24, 40, 56, 72, 92, 120]) {
  const lines = healthLines({
    state: "degraded",
    pi: piRuntimeStatus("9.9.9", runtimeContract.piVersion),
    core: "git 2.53.0 · uvx 0.11.7",
    workflow: "modes ready",
    context: "persona ready",
    workspace: "main · clean",
    bridges: "unused in degraded layout",
    impact: "runtime drift",
    action: repairAction,
  }, width).map(stripAnsi);
  const actionIndex = lines.findIndex((line) => line.startsWith("next "));
  assert.ok(lines.some((line) => line.includes("pi installed 9.9.9")), `installed Pi version hidden at ${width} columns`);
  assert.ok(lines.some((line) => line.includes(`pi required  ${runtimeContract.piVersion}`)), `required Pi version hidden at ${width} columns`);
  assert.notEqual(actionIndex, -1, `health repair action missing at ${width} columns`);
  assert.ok(lines.some((line) => line.startsWith("core")), `degraded health hid core diagnostics at ${width} columns`);
  assert.ok(lines.some((line) => line.startsWith("workflow")), `degraded health hid workflow diagnostics at ${width} columns`);
  if (width >= 40) assert.ok(lines.some((line) => line.startsWith("context")), `degraded health hid context diagnostics at ${width} columns`);
  if (width >= 72) assert.ok(lines.some((line) => line.startsWith("impact")), `degraded health hid impact diagnostics at ${width} columns`);
  const renderedAction = lines.slice(actionIndex).map((line) => line.slice(5).trimEnd()).join("");
  assert.equal(renderedAction, repairAction, `health repair action truncated at ${width} columns`);
  assert.ok(lines.length <= 10, `degraded health exceeds Pi line cap at ${width} columns`);
}
const combinedGapLines = healthLines({
  state: "degraded",
  pi: piRuntimeStatus("9.9.9", runtimeContract.piVersion),
  core: "git missing · uvx missing",
  workflow: "modes missing · sandbox missing · proof missing",
  context: "persona missing · memory missing · skills missing",
  workspace: "not a git workspace",
  bridges: "MCP config missing · local Qwen offline",
  impact: "Multiple capabilities unavailable.",
  action: `${repairAction}  ·  install uv  ·  sync extensions  ·  install mode keybindings  ·  restore persona  ·  configure skills  ·  restore mcp.json  ·  install WSL2 + bubblewrap`,
}, 24).map(stripAnsi);
const combinedActionIndex = combinedGapLines.findIndex((line) => line.startsWith("next "));
assert.equal(combinedGapLines.length, 10, "combined degraded health did not use its exact ten-line budget");
assert.ok(combinedGapLines.some((line) => line.startsWith("workflow")), "combined degraded health hid workflow gaps");
assert.ok(combinedGapLines.some((line) => line.startsWith("context")), "combined degraded health hid context gaps");
assert.ok(combinedGapLines.some((line) => line.startsWith("bridges")), "combined degraded health hid bridge gaps");
assert.equal(
  combinedGapLines.slice(combinedActionIndex).map((line) => line.slice(5).trimEnd()).join(""),
  repairAction,
  "combined degraded health truncated or merged the primary repair command",
);

const widgets = new Map();
const statuses = new Map();
const notices = [];
let aborted = 0;
let title = "";
let workingMessage = "";
const ui = {
  getTheme: () => null,
  setTheme() {},
  setTitle(value) { title = value; },
  setHiddenThinkingLabel() {},
  setWorkingVisible() {},
  setWorkingIndicator() {},
  setWorkingMessage(value = "") { workingMessage = value; },
  notify(message, level) {
    notices.push({ message, level });
  },
  setWidget(id, value) {
    if (value === undefined) widgets.delete(id);
    else widgets.set(id, value);
  },
  setStatus(id, value) {
    if (value === undefined) statuses.delete(id);
    else statuses.set(id, value);
  },
  confirm: async () => true,
  select: async () => undefined,
};
const context = {
  cwd: repoRoot,
  mode: "tui",
  hasUI: true,
  ui,
  isIdle: () => true,
  abort: () => { aborted++; },
  model: { provider: "openai-codex", id: "gpt-5.5" },
  sessionManager: { getEntries: () => [], getBranch: () => [] },
};

const identityExtension = extensionWithCommand("dash");
await firstHandler(identityExtension, "session_start")({}, context);
assert.ok(widgets.has("neura-launch"), "logo widget missing");
assert.equal(widgets.has("neura-logo"), false, "legacy logo widget still registered");
assert.equal(widgets.has("neura-dash"), false, "legacy dashboard widget still registered");
assert.match(title, /^Neura · /, "terminal title was not set");

const launchFactory = widgets.get("neura-launch");
for (const width of [40, 56, 72, 92, 120]) {
  const rawLines = launchFactory(null, null).render(width);
  const launchText = rawLines.map(stripAnsi).join("\n");
  assert.equal(rawLines.length, width < 56 ? 5 : 6, `wordmark height is wrong at ${width} columns`);
  assert.match(launchText, width < 56 ? /N   N EEEEE/ : /███╗   ██╗/, `ASCII wordmark missing at ${width} columns`);
  assert.doesNotMatch(launchText, /READY|BOUNDARY|LAST|NEXT|[@#$%]/, `non-logo launch content remains at ${width} columns`);
  assert.doesNotMatch(rawLines.join("\n"), /\x1b\[48;2;/, "logo unexpectedly paints image backgrounds");
  assert.ok(rawLines.every((line) => widthOf(line) <= width), `wordmark overflows at ${width} columns`);
}
await firstHandler(identityExtension, "agent_start")({}, context);
assert.equal(widgets.has("neura-launch"), false, "logo did not hide when work started");
await identityExtension.commands.get("dash").handler("", context);
assert.ok(widgets.has("neura-launch"), "/dash did not restore the logo");

const theme = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "themes", "neura-dark.json"), "utf-8"));
assert.equal(theme.colors.accent, "#d97841", "Forged Tungsten copper accent missing");
assert.equal(theme.colors.selectedBg, "#1c2024", "Forged Tungsten raised surface missing");
assert.equal(theme.colors.borderAccent, theme.colors.border, "editor rails still use a full-width copper accent");
assert.equal(theme.colors.mdHeading, theme.colors.accent, "theme introduces a second heading accent");
assert.equal(theme.colors.mdLink, "#86a7d7", "answer links lack the cool information accent");
assert.equal(theme.colors.syntaxFunction, "#76b8c4", "code functions lack the Plan cyan accent");
assert.equal(theme.colors.dim, "#7a828b", "dim text token does not meet the approved contrast target");
const relativeLuminance = (hex) => {
  const channel = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const [red, green, blue] = [1, 3, 5].map((index) => channel(Number.parseInt(hex.slice(index, index + 2), 16) / 255));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrast = (foreground, background) => {
  const high = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const low = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (high + 0.05) / (low + 0.05);
};
for (const token of ["text", "muted", "dim", "accent", "success", "warning", "error", "mdLink", "syntaxFunction"]) {
  assert.ok(contrast(theme.colors[token], "#0b0c0e") >= 4.5, `${token} fails 4.5:1 contrast on the Neura canvas`);
}
const healthExtension = extensionWithCommand("health");
await healthExtension.commands.get("health").handler("", context);
assert.equal(statuses.size, 0, "health status not cleared");

for (const width of [24, 40, 56, 72, 92, 120]) {
  for (const [id, factory] of widgets) {
    const lines = factory(null, null).render(width);
    assert.ok(lines.length <= 10, `${id} exceeds pi 10-line widget limit`);
    assert.ok(lines.every((line) => widthOf(line) <= width), `${id} overflows at ${width} columns`);
  }
}

let footerFactory;
const cockpitContext = {
  model: { id: "gpt-5.5-engineering-preview" },
  getContextUsage: () => ({ percent: 71 }),
  sessionManager: { getBranch: () => [{ message: { usage: { cost: 3.14 } } }] },
  ui: { ...ui, setFooter: (value) => { footerFactory = value; } },
};
const cockpit = loaded.extensions.find((extension) => extension.resolvedPath.endsWith(`${path.sep}cockpit.ts`));
assert.ok(cockpit, "cockpit extension missing");
await firstHandler(cockpit, "session_start")({}, cockpitContext);
assert.ok(widgets.has("neura-cockpit"), "below-editor cockpit rail missing");
const cockpitState = await import(pathToFileURL(path.join(repoRoot, "agent", "neura", "cockpit-state.ts")).href);
const cockpitSamples = [
  { phase: "READY" },
  { phase: "BRIEF", task: "Rebuild the terminal interface", step: "1/3" },
  { phase: "WORK", task: "Terminal cockpit", step: "2/3", operation: { verb: "read", target: "docs/界面-contract-with-a-very-long-name.md", startedAt: Date.now() } },
  { phase: "REVIEW", approval: { id: "a1b2c3d4", agent: "Neura", task: "remote-mutation", exactAction: "git push origin main", boundary: "Remote mutation needs Rajveer.", fallback: "Keep the commit local.", risk: "high", approvable: true } },
  { phase: "VERIFY", proof: { scope: "full", status: "running" } },
  { phase: "VERIFY", proof: { scope: "full", status: "failed", detail: "Harness snapshot mismatch." } },
  { phase: "RECOVERY", checkpoint: "restoring", operation: { verb: "restore", target: "snapshot 19:42", startedAt: Date.now() } },
  { phase: "COMPLETE", copy: { available: true, codeBlocks: 2 } },
  { phase: "DEGRADED", degraded: "Gmail MCP authentication unavailable." },
];
for (const sample of cockpitSamples) {
  cockpitState.resetCockpit();
  cockpitState.patchCockpit(sample);
  for (const width of [40, 56, 72, 92, 120]) {
    const lines = widgets.get("neura-cockpit")(null, null).render(width);
    assert.ok(lines.length <= 2, `${sample.phase} cockpit exceeds two lines at ${width}`);
    assert.ok(lines.every((line) => widthOf(line) <= width), `${sample.phase} cockpit overflows at ${width}`);
    if (sample.phase === "READY") assert.equal(lines.length, 0, "idle cockpit duplicates footer mode and boundary");
  }
}
cockpitState.resetCockpit();
await firstHandler(cockpit, "agent_start")({}, cockpitContext);
assert.match(workingMessage, /Esc stops safely/, "working state lacks an interrupt hint");
await firstHandler(cockpit, "tool_execution_start")({ toolName: "read", input: { path: "agent/extensions/cockpit.ts" } }, cockpitContext);
assert.match(widgets.get("neura-cockpit")(null, null).render(92).map(stripAnsi).join("\n"), /read · agent\/extensions\/cockpit\.ts/, "current operation receipt missing");
await firstHandler(cockpit, "tool_execution_start")({ toolName: "bash", input: { command: "custom-cli --token cockpit-secret-value" } }, cockpitContext);
const redactedOperation = widgets.get("neura-cockpit")(null, null).render(120).map(stripAnsi).join("\n");
assert.doesNotMatch(redactedOperation, /cockpit-secret-value/, "cockpit operation leaked an inline secret");
assert.match(redactedOperation, /\[REDACTED\]/, "cockpit operation lost the secret redaction marker");
cockpitState.addCockpitNotice({
  id: "redaction-probe",
  message: "Provider warning",
  detail: "https://example.test/failure?token=notice-secret-value",
  tone: "warning",
});
assert.doesNotMatch(JSON.stringify(cockpitState.getCockpitState().notices), /notice-secret-value/,
  "cockpit notice bypassed central redaction");
await firstHandler(cockpit, "agent_end")({}, cockpitContext);
assert.equal(workingMessage, "", "working message was not restored after completion");
cockpitState.resetCockpit();
cockpitState.patchCockpit({
  phase: "REVIEW",
  approval: { id: "held", agent: "Neura", task: "remote-mutation", exactAction: "git push", boundary: "Remote locked.", fallback: "Keep local.", risk: "high", approvable: false },
});
await firstHandler(cockpit, "agent_end")({}, cockpitContext);
assert.match(widgets.get("neura-cockpit")(null, null).render(92).map(stripAnsi).join("\n"), /REVIEW[\s\S]*Neura paused/, "agent completion hid a pending action request");
cockpitState.resetCockpit();
const footer = footerFactory(
  { requestRender() {} },
  null,
  {
    getGitBranch: () => "feature/agentic-console-with-long-name",
    getExtensionStatuses: () => new Map([["neura-proof", "proof full"], ["mcp", "MCP 0/3 connected"], ["lsp", "typescript ready"]]),
    onBranchChange: () => () => {},
  },
);
for (const width of [24, 40, 56, 72, 92, 120]) {
  const lines = footer.render(width);
  assert.ok(lines.length <= 2, `footer exceeds two lines at ${width} columns`);
  assert.ok(lines.every((line) => widthOf(line) <= width), `footer overflows at ${width} columns`);
}
const launchFooterText = footer.render(120).map(stripAnsi).join("\n");
assert.match(launchFooterText, /gpt-5\.5-engineering-preview/, "launch footer lost model identity");
assert.doesNotMatch(launchFooterText, /YOLO|feature\/agentic/, "logo view does not keep the footer quiet");
await identityExtension.commands.get("dash").handler("", context);
const idleFooterText = footer.render(120).map(stripAnsi).join("\n");
assert.match(idleFooterText, /YOLO · DANGER/, "idle footer lost the persistent YOLO danger state");
assert.doesNotMatch(idleFooterText, /typescript ready|MCP 0\/3|proof full/, "idle footer still renders detached extension status rows");
cockpitState.patchCockpit({ launchVisible: false, phase: "WORK", operation: { verb: "working", startedAt: Date.now() } });
const workingFooterText = footer.render(120).map(stripAnsi).join("\n");
assert.match(workingFooterText, /typescript ready/, "live third-party status disappeared during work");
assert.doesNotMatch(workingFooterText, /MCP 0\/3|proof full/, "footer retained persistent MCP noise or duplicate proof state");
cockpitState.resetCockpit();

const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "settings.json"), "utf-8"));
assert.ok(settings.skills.includes("!skills/agent-reach"), "agent-reach collision exclusion missing");
assert.ok(settings.skills.includes("!skills/find-skills"), "find-skills collision exclusion missing");
assert.ok(settings.packages.includes("npm:@spences10/pi-mcp@0.0.58"), "verified pi-mcp version is not pinned");
assert.ok(settings.packages.every((entry) => /^npm:(?:@[^/]+\/[^@]+|[^@]+)@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(entry)), "runtime package is not exactly pinned");

const syntheticProviderToken = ["github", "pat", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join("_");
const syntheticJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "syntheticSignatureValue1234567890"].join(".");
const redactionProbe = redactSensitiveText(
  "Authorization: Bearer synthetic-bearer-secret\nhttps://example.test/path?token=secret&view=full\n" +
  "postgres://user:synthetic-password@db.test/app\n" +
  `${syntheticProviderToken}\n${syntheticJwt}\n` +
  "z9Y8x7W6v5U4t3S2r1Q0p9O8n7M6l5K4",
);
assert.doesNotMatch(redactionProbe, /synthetic-bearer-secret|secret&view|synthetic-password|github_pat_|eyJhbGci|z9Y8x7W6/,
  "central redaction missed a required secret shape");
assert.match(redactionProbe, /\[REDACTED\]/, "central redaction marker missing");

const mcpConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "mcp.json"), "utf-8"));
assert.equal(mcpConfig.mcpServers.gmail.headers["x-api-key"], "${COMPOSIO_API_KEY}", "Gmail MCP header lost its environment placeholder");
const launcher = fs.readFileSync(path.join(repoRoot, "launcher", "neura.cmd"), "utf-8");
assert.match(launcher, /GetEnvironmentVariable\('COMPOSIO_API_KEY','User'\)/, "launcher does not refresh the user-scoped Composio key");
assert.match(launcher, /MY_PI_MCP_ENV_ALLOWLIST=COMPOSIO_API_KEY,/, "launcher does not allowlist the Composio key for pi-mcp");
assert.doesNotMatch(`${JSON.stringify(mcpConfig)}\n${launcher}`, /\b(?:ak|sk)_[A-Za-z0-9_-]{12,}\b/, "Gmail MCP configuration contains a literal credential");

const gmailGuardrail = loaded.extensions.find((extension) => extension.resolvedPath.endsWith(`${path.sep}gmail-guardrail.ts`));
assert.ok(gmailGuardrail, "Gmail guardrail extension missing");
const gmailGuard = firstHandler(gmailGuardrail, "tool_call");
const modeState = await import(pathToFileURL(path.join(repoRoot, "agent", "neura", "mode-state.ts")).href);
let gmailPrompts = 0;
const deniedGmailContext = {
  ...context,
  ui: { ...ui, confirm: async () => { gmailPrompts++; return false; } },
};
modeState.setMode("human-away");
assert.equal(await gmailGuard({ toolName: "mcp__gmail__GMAIL_GET_PROFILE", input: { user_id: "me" } }, deniedGmailContext), undefined, "harmless Gmail profile read was blocked");
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: { recipient_email: "test@example.com", subject: "Test" } }, deniedGmailContext))?.block, true, "denied Gmail send was not blocked");
assert.equal(gmailPrompts, 1, "Gmail send did not request exactly one human confirmation");
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: {} }, { ...context, hasUI: false }))?.block, true, "headless Gmail send did not fail closed");
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_NEW_UNCLASSIFIED_ACTION", input: {} }, deniedGmailContext))?.block, true, "unknown Gmail action did not require confirmation");
assert.equal(gmailPrompts, 2, "unknown Gmail action did not request exactly one confirmation");
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_NEW_UNCLASSIFIED_ACTION", input: {} }, { ...context, hasUI: false }))?.block, true, "headless unknown Gmail action did not fail closed");
modeState.setMode("yolo");
assert.equal(await gmailGuard({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: {} }, deniedGmailContext), undefined, "YOLO retained Gmail approval mediation");
assert.equal(await gmailGuard({ toolName: "mcp__gmail__GMAIL_DELETE_MESSAGE", input: {} }, { ...context, hasUI: false }), undefined, "headless YOLO blocked a Gmail mutation");
assert.equal(gmailPrompts, 2, "YOLO requested a Gmail confirmation");

const transcript = extensionWithCommand("clip");
assert.ok(transcript.shortcuts.has("ctrl+shift+x"), "Ctrl+Shift+X transcript chooser missing");
await firstHandler(transcript, "message_end")({
  message: { role: "assistant", content: [{ type: "text", text: "Use this.\n\n```ts\nconst ready = true;\n```" }] },
}, context);
const copyRail = widgets.get("neura-cockpit")(null, null).render(92).map(stripAnsi).join("\n");
assert.match(copyRail, /Ctrl\+X copy answer/, "answer copy affordance missing");
assert.match(copyRail, /1 code block/, "code-block copy affordance missing");
let copySelector;
await transcript.shortcuts.get("ctrl+shift+x").handler({
  ...context,
  ui: { ...ui, select: async (selectionTitle, options) => { copySelector = { selectionTitle, options }; return undefined; } },
});
assert.match(copySelector.selectionTitle, /Copy from latest Neura response/, "code copy selector title missing");
assert.ok(copySelector.options.some((option) => /Code 1 · ts/.test(option)), "code copy selector lacks language and block identity");
assert.ok(copySelector.options.every((option) => !/Answer ·/.test(option)), "Ctrl+Shift+X includes whole-answer copy instead of code blocks only");

// /preset must resolve dated catalog ids (claude-opus-5-2026xxxx) by prefix, newest first,
// and tell the user which provider to /login when the model is absent.
const presetExtension = extensionWithCommand("preset");
const runPreset = (name, models) => {
  notices.length = 0;
  return presetExtension.commands.get("preset").handler(name, {
    ui,
    modelRegistry: {
      find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
      getAll: () => models,
    },
  });
};
const opusCatalog = [
  { provider: "anthropic", id: "claude-opus-5-20260101" },
  { provider: "anthropic", id: "claude-opus-5-20260420" },
  { provider: "anthropic", id: "claude-sonnet-5" },
];
await runPreset("opus", opusCatalog);
assert.match(notices.at(-1).message, /claude-opus-5-20260420/, "/preset opus picked the wrong catalog entry");
await runPreset("opus", []);
assert.equal(notices.at(-1).level, "error", "/preset with no matching model should report an error");
assert.match(notices.at(-1).message, /\/login anthropic/, "/preset should point at the provider login");
await runPreset("", opusCatalog);
assert.match(notices.at(-1).message, /gpt.*opus.*qwen/s, "/preset listing lost a preset");

const guardrail = loaded.extensions.find((extension) => extension.resolvedPath.endsWith(`${path.sep}guardrail.ts`));
assert.ok(guardrail, "guardrail extension missing");
const guard = firstHandler(guardrail, "tool_call");
const headless = { hasUI: false, ui: { confirm: async () => true } };
let yoloPrompts = 0;
const deniedInYolo = { hasUI: true, ui: { confirm: async () => { yoloPrompts++; return false; } } };
assert.equal(await guard({ toolName: "bash", input: { command: "git status" } }, headless), undefined);
assert.equal(
  await guard({ toolName: "bash", input: { command: "git reset --hard HEAD" } }, headless),
  undefined,
);
assert.equal(
  await guard({ toolName: "edit", input: { path: "C:/project/.env.local" } }, headless),
  undefined,
);
assert.equal(await guard({ toolName: "bash", input: { command: "terraform destroy" } }, deniedInYolo), undefined);
assert.equal(yoloPrompts, 0, "YOLO requested approval for a sensitive action");

// Mode spine: confirmed startup, direct /mode, exact Plan tool boundary, and Shift+Tab.
const modes = extensionWithCommand("mode");
assert.ok(modes.commands.has("approvals"), "/approvals command missing");
assert.ok(modes.shortcuts.has("shift+tab"), "Shift+Tab mode shortcut missing");
let startupYoloConfirmation;
await firstHandler(modes, "session_start")({}, {
  ...context,
  ui: {
    ...ui,
    confirm: async (title, body) => {
      startupYoloConfirmation = { title, body };
      return false;
    },
  },
});
assert.match(startupYoloConfirmation.title, /YOLO · unsandboxed full access/, "fresh YOLO startup lacks explicit confirmation");
assert.equal(modeState.getMode(), "plan", "denied YOLO startup did not fail closed to Plan");
assert.ok(activeTools.includes("publish_plan"), "denied YOLO startup did not apply the Plan tool boundary");
await firstHandler(modes, "session_start")({}, context);
assert.equal(modeState.getMode(), "yolo", "confirmed YOLO startup did not activate YOLO");
assert.equal(activeTools.includes("publish_plan"), false, "Plan publisher remained active during YOLO startup");

process.env.NEURA_REDUCED_MOTION = "1";
await modes.commands.get("mode").handler("plan", context);
let reducedTransition = widgets.get("neura-mode-transition")(null, null).render(92).map(stripAnsi).join("\n");
assert.match(reducedTransition, /BOUNDARY APPLIED/, "reduced motion did not render the final policy frame immediately");
assert.doesNotMatch(reducedTransition, /APPLYING POLICY/, "reduced motion retained intermediate animation state");
let yoloConfirmation;
const modeEntriesBeforeDeniedYolo = appendedEntries.length;
await modes.shortcuts.get("shift+tab").handler({
  ...context,
  ui: {
    ...ui,
    confirm: async (title, body) => {
      yoloConfirmation = { title, body };
      return false;
    },
  },
});
assert.match(yoloConfirmation.title, /YOLO · unsandboxed full access/, "YOLO shortcut lacks an explicit danger confirmation");
assert.match(yoloConfirmation.body, /guardrails.*approval prompts.*disabled/i, "YOLO confirmation hides disabled safety boundaries");
assert.equal(modeState.getMode(), "plan", "denied YOLO shortcut changed the active mode");
assert.equal(appendedEntries.length, modeEntriesBeforeDeniedYolo, "denied YOLO shortcut persisted a mode change");
assert.ok(activeTools.includes("publish_plan"), "denied YOLO shortcut removed the Plan tool boundary");
await modes.commands.get("mode").handler("yolo", { ...context, hasUI: false });
assert.equal(modeState.getMode(), "plan", "headless YOLO activation bypassed interactive confirmation");
await modes.commands.get("mode").handler("yolo", context);
reducedTransition = widgets.get("neura-mode-transition")(null, null).render(92).map(stripAnsi).join("\n");
assert.match(reducedTransition, /YOLO/, "latest rapid mode switch did not own the transition");
assert.match(reducedTransition, /FULL ACCESS/, "YOLO transition does not expose full access");
assert.match(reducedTransition, /no sandbox · no approvals/, "YOLO transition does not expose disabled safety boundaries");
delete process.env.NEURA_REDUCED_MOTION;

await modes.commands.get("mode").handler("plan", context);
const planGit = "git --no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false -c format.pretty=medium";
const hookProbeRoot = path.join(scratchRoot, "git-hook-probe");
const hookProbeMarker = path.join(hookProbeRoot, "hook-ran.txt");
fs.mkdirSync(hookProbeRoot, { recursive: true });
execFileSync("git", ["init", "--quiet"], { cwd: hookProbeRoot, windowsHide: true });
const hookProbePath = path.join(hookProbeRoot, ".git", "hooks", "pre-commit");
fs.writeFileSync(hookProbePath, `#!/bin/sh\nprintf hook-ran > "${hookProbeMarker.replaceAll("\\", "/")}"\n`, "utf-8");
fs.chmodSync(hookProbePath, 0o755);
assert.equal(spawnSync("git", ["hook", "run", "pre-commit"], { cwd: hookProbeRoot, windowsHide: true }).status, 0, "safe hook probe did not establish the hostile-repository baseline");
assert.equal(fs.existsSync(hookProbeMarker), true, "safe hook probe did not create its baseline marker");
fs.rmSync(hookProbeMarker);
const hardenedHookProbe = spawnSync("git", [
  "--no-pager", "--no-optional-locks", "--no-lazy-fetch",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "log.showSignature=false",
  "-c", "log.mailmap=false",
  "-c", "format.pretty=medium",
  "hook", "run", "pre-commit",
], { cwd: hookProbeRoot, windowsHide: true });
assert.notEqual(hardenedHookProbe.status, 0, "Git found a repository hook beneath the /dev/null no-op hook path");
assert.equal(fs.existsSync(hookProbeMarker), false, "Git executed a repository hook despite the hardened hook path");
assert.ok(widgets.has("neura-mode-transition"), "Plan transition animation missing");
assert.ok(activeTools.includes("publish_plan"), "Plan mode did not activate the bounded plan publisher");
assert.ok(activeTools.includes("plan_request"), "Plan mode did not activate the deterministic request lifecycle tool");
assert.ok(activeTools.includes("web_search"), "Plan mode did not activate bounded web search");
assert.equal(activeTools.includes("web_fetch"), false, "Plan mode activated web_fetch without enforceable DNS and redirect validation");
assert.equal(activeTools.includes("edit") || activeTools.includes("write"), false, "Plan mode retained generic mutation tools");
assert.equal(await guard({ toolName: "bash", input: { command: `${planGit} branch --show-current` } }, context), undefined);
assert.equal((await guard({ toolName: "bash", input: { command: "git status; Remove-Item file.txt" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "Get-Content env:OPENAI_API_KEY" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "rg --pre dangerous-helper pattern" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "git diff --output=review.patch" } }, context))?.block, true);
assert.equal((await guard({ toolName: "edit", input: { path: path.join(repoRoot, "README.md") } }, context))?.block, true);

const planBoundaryWorkspace = path.join(scratchRoot, "plan-boundary-workspace");
const planBoundaryOutside = path.join(scratchRoot, "plan-boundary-outside");
const planBoundaryLink = path.join(planBoundaryWorkspace, "linked-outside");
const planBoundaryQuotedAtLink = path.join(planBoundaryWorkspace, "@quoted-link");
const planBoundaryUnaliasedSibling = path.join(planBoundaryWorkspace, "quoted-link");
const planBoundaryFile = path.join(planBoundaryWorkspace, "inside.txt");
const planBoundaryQuotedAtFile = path.join(planBoundaryWorkspace, "@inside.txt");
const planBoundaryOutsideFile = path.join(planBoundaryOutside, "outside.txt");
fs.mkdirSync(planBoundaryWorkspace, { recursive: true });
fs.mkdirSync(planBoundaryOutside, { recursive: true });
fs.mkdirSync(planBoundaryUnaliasedSibling, { recursive: true });
fs.writeFileSync(planBoundaryFile, "inside", "utf-8");
fs.writeFileSync(planBoundaryQuotedAtFile, "inside", "utf-8");
fs.writeFileSync(path.join(planBoundaryUnaliasedSibling, "outside.txt"), "safe sibling", "utf-8");
fs.writeFileSync(planBoundaryOutsideFile, "outside", "utf-8");
fs.symlinkSync(planBoundaryOutside, planBoundaryLink, process.platform === "win32" ? "junction" : "dir");
fs.symlinkSync(planBoundaryOutside, planBoundaryQuotedAtLink, process.platform === "win32" ? "junction" : "dir");
const planBoundaryContext = { ...context, cwd: planBoundaryWorkspace };
const filesystemCases = [
  { toolName: "read", inside: { path: planBoundaryFile }, outside: { path: planBoundaryOutsideFile }, linked: { path: path.join(planBoundaryLink, "outside.txt") }, linkedMissing: { path: path.join(planBoundaryLink, "missing.txt") } },
  { toolName: "grep", inside: { pattern: "inside", path: planBoundaryWorkspace }, outside: { pattern: "outside", path: planBoundaryOutside }, linked: { pattern: "outside", path: planBoundaryLink }, linkedMissing: { pattern: "outside", path: path.join(planBoundaryLink, "missing") } },
  { toolName: "find", inside: { pattern: "*.txt", path: planBoundaryWorkspace }, outside: { pattern: "*.txt", path: planBoundaryOutside }, linked: { pattern: "*.txt", path: planBoundaryLink }, linkedMissing: { pattern: "*.txt", path: path.join(planBoundaryLink, "missing") } },
  { toolName: "ls", inside: { path: planBoundaryWorkspace }, outside: { path: planBoundaryOutside }, linked: { path: planBoundaryLink }, linkedMissing: { path: path.join(planBoundaryLink, "missing") } },
];
for (const testCase of filesystemCases) {
  assert.equal(await guard({ toolName: testCase.toolName, input: testCase.inside }, planBoundaryContext), undefined, `Plan blocked in-workspace ${testCase.toolName}`);
  assert.equal((await guard({ toolName: testCase.toolName, input: testCase.outside }, planBoundaryContext))?.block, true, `Plan allowed outside-workspace ${testCase.toolName}`);
  assert.equal((await guard({ toolName: testCase.toolName, input: testCase.linked }, planBoundaryContext))?.block, true, `Plan followed outside-workspace junction with ${testCase.toolName}`);
  assert.equal((await guard({ toolName: testCase.toolName, input: testCase.linkedMissing }, planBoundaryContext))?.block, true, `Plan allowed a missing path beneath an outside-workspace junction with ${testCase.toolName}`);
  for (const aliasedPath of [`@${testCase.outside.path}`, pathToFileURL(testCase.outside.path).href, "~"]) {
    assert.equal(
      (await guard({ toolName: testCase.toolName, input: { ...testCase.outside, path: aliasedPath } }, planBoundaryContext))?.block,
      true,
      `Plan allowed aliased outside-workspace ${testCase.toolName}: ${aliasedPath}`,
    );
  }
}

const planBoundaryOutsideRelative = path.join("..", path.basename(planBoundaryOutside), "outside.txt");
const planShellAllowed = [
  "pwd",
  "Get-Location",
  "Get-ChildItem .",
  "Get-Content .\\inside.txt",
  "Get-Content \"@inside.txt\"",
  "Get-Content \".\\inside,name.txt\"",
  "Get-Content \".\\@args\"",
  "Get-Content -TotalCount 1 -LiteralPath .\\inside.txt",
  `Get-Content "${planBoundaryFile}"`,
  `Get-Content "${pathToFileURL(planBoundaryFile).href}"`,
  "Get-Content .\\nested\\..\\inside.txt",
  "Select-String -SimpleMatch -Pattern inside -Path .\\inside.txt",
  "Resolve-Path .\\inside.txt",
  "Test-Path -Path .\\missing.txt -PathType Leaf",
  "Measure-Object",
  "rg inside .",
  "rg \"inside,outside\" .",
  "rg \"@args\" .",
  "rg --files ./",
  `${planGit} diff --no-ext-diff --no-textconv --cached -- inside.txt`,
  `${planGit} diff --no-ext-diff --no-textconv --cached --stat HEAD`,
  `${planGit} diff --no-ext-diff --no-textconv HEAD~1..HEAD --`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --oneline -- inside.txt`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --oneline HEAD~2..HEAD`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --oneline refs/heads/main`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD:inside.txt`,
  `${planGit} rev-parse --show-toplevel`,
  `${planGit} ls-files -- inside.txt`,
  `${planGit} ls-files --stage -- inside.txt`,
  `${planGit} branch --show-current`,
];
for (const command of planShellAllowed) {
  assert.equal(
    await guard({ toolName: "bash", input: { command } }, planBoundaryContext),
    undefined,
    `Plan blocked ordinary read-only shell command: ${command}`,
  );
}

const planShellDenied = [
  `Get-Content .\\${planBoundaryOutsideRelative}`,
  `Get-Content .\\nested\\..\\..\\${path.basename(planBoundaryOutside)}\\outside.txt`,
  `rg outside ${planBoundaryOutsideRelative.replaceAll("\\", "/")}`,
  `Get-Content "${planBoundaryOutsideFile}"`,
  `Get-Content "${pathToFileURL(planBoundaryOutsideFile).href}"`,
  `Get-Content "@${planBoundaryOutsideFile}"`,
  "Get-Content ~",
  "Get-Content .\\linked-outside\\outside.txt",
  "Get-Content .\\linked-outside\\missing.txt",
  "Get-Content \"@quoted-link\\outside.txt\"",
  "Get-Content \"@quoted-link\\missing.txt\"",
  "Select-String outside -Path .\\linked-outside\\outside.txt",
  "rg outside .\\linked-outside",
  "rg --follow outside .",
  `${planGit} diff --no-ext-diff --no-textconv HEAD~1..HEAD -- "${planBoundaryOutsideFile}"`,
  `${planGit} status "${planBoundaryOutside}"`,
  `${planGit} ls-files -- "${planBoundaryOutsideFile}"`,
  `${planGit} rev-parse --resolve-git-dir "${planBoundaryOutside}"`,
  "git status --short",
  "git diff --ext-diff",
  "git diff --textconv",
  "git --paginate log --oneline",
  "git -p log --oneline",
  "git -c core.fsmonitor=malicious-helper status",
  "git --no-pager --no-optional-locks -c core.fsmonitor=false status",
  "git -c diff.external=malicious-helper diff --ext-diff",
  "git -c diff.binary.textconv=malicious-helper show --textconv HEAD",
  "git -c core.pager=malicious-helper log --oneline",
  `${planGit} -c diff.external=malicious-helper diff --no-ext-diff --no-textconv`,
  `${planGit} --paginate status`,
  `${planGit} -c log.showSignature=true show --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} -c log.mailmap=true log --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} -c format.pretty=%G? log --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} -c core.hooksPath=.git/hooks status`,
  `${planGit} -c filter.hostile.process=malicious-helper ls-files --modified`,
  "git --exec-path=malicious-helper status",
  `${planGit} diff --no-textconv --ext-diff`,
  `${planGit} diff --no-ext-diff --textconv`,
  `${planGit} diff --no-ext-diff --no-textconv -O ..\\outside-order`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --show-signature`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --format=%G?`,
  `${planGit} log --no-ext-diff --no-textconv HEAD`,
  `${planGit} log --no-ext-diff --no-textconv --use-mailmap HEAD`,
  `${planGit} rev-parse --parseopt`,
  `${planGit} status --short`,
  `${planGit} diff --no-ext-diff --no-textconv`,
  `${planGit} diff --no-ext-diff --no-textconv HEAD`,
  `${planGit} diff --no-ext-diff --no-textconv dead beef`,
  `${planGit} diff --no-ext-diff --no-textconv HEAD~1..HEAD`,
  `${planGit} diff --no-ext-diff --no-textconv dead..beef`,
  `${planGit} diff --no-ext-diff --no-textconv inside.txt`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap main`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap ..\\outside`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD:../outside.txt`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD:.env`,
  `${planGit} ls-files --modified`,
  `${planGit} ls-files --deleted`,
  `${planGit} ls-files --others`,
  `${planGit} ls-files --ignored`,
  `${planGit} ls-files --killed`,
  `${planGit} ls-files --eol`,
  `Get-Content "${path.join(repoRoot, "README.md")}"`,
  "Get-Content -Pa:C:/Windows/win.ini",
  "Get-Content -DefinitelyNotAParameter .\\inside.txt",
  "Get-Content -LiteralPath FileSystem::C:/Windows/win.ini",
  "Get-Content -LiteralPath Microsoft.PowerShell.Core\\FileSystem::C:/Windows/win.ini",
  "Get-Content -LiteralPath CustomProvider::outside",
  "Get-Content CustomDrive:\\outside",
  "Get-Content C:outside.txt",
  "Get-Content README.md,C:/Windows/win.ini",
  "Get-Content '..'+'/outside.txt'",
  "Get-Content .\\inside.txt & whoami",
  "Measure-Object -InputObject (& whoami)",
  "rg @args",
  "rg outside @paths",
  "git status @paths",
  `rg outside . ,${planBoundaryOutsideRelative}`,
  `git status inside.txt,${planBoundaryOutsideRelative}`,
  "rg outside CustomDrive:/outside",
  "git status CustomDrive:/outside",
];
for (const command of planShellDenied) {
  assert.equal(
    (await guard({ toolName: "bash", input: { command } }, planBoundaryContext))?.block,
    true,
    `Plan allowed unsafe shell command: ${command}`,
  );
}

assert.equal(await guard({ toolName: "web_search", input: { query: "official pi extension documentation", max_results: 3 } }, context), undefined);
assert.equal((await guard({ toolName: "web_search", input: { query: "x", max_results: 100 } }, context))?.block, true, "Plan web search accepted an unbounded query");
assert.equal(isSafeExternalUrl("http://localhost./admin"), false, "Plan source URL normalization allowed trailing-dot localhost");
assert.equal(isSafeExternalUrl("https://example.com./docs"), true, "Plan source URL normalization rejected a public trailing-dot host");
assert.equal(isPlanToolInputAllowed("web_fetch", { url: "https://example.com" }), false, "Plan input policy allowed web_fetch");
const deniedPlanFetchUrls = [
  "https://github.com/earendil-works/pi",
  "http://127.0.0.1/admin",
  "http://[::1]/admin",
  "http://[fe80::1]/admin",
  "http://localhost./admin",
  "http://127.0.0.1.nip.io/admin",
  "https://mixed-address.example/admin",
  "https://example.com/redirect-to-private",
];
for (const url of deniedPlanFetchUrls) {
  assert.equal(
    (await guard({ toolName: "web_fetch", input: { url } }, context))?.block,
    true,
    `Plan web fetch reached an executor-owned DNS/redirect boundary: ${url}`,
  );
}
assert.equal(await guard({ toolName: "publish_plan", input: { slug: "plan-mode-v1" } }, context), undefined);
assert.equal((await guard({ toolName: "publish_plan", input: { slug: "../escape" } }, context))?.block, true, "Plan publisher accepted path traversal");
assert.equal(await guard({ toolName: "plan_request", input: { action: "wait_for_input" } }, context), undefined);
assert.equal((await guard({ toolName: "plan_request", input: { action: "guess_from_text" } }, context))?.block, true, "Plan lifecycle accepted an unknown semantic transition");

// Plan publication: structured input, escaped browser output, collision-safe creation,
// explicit clarification/new/revision lifecycle, one-artifact-per-request binding,
// session-owned revision, external-edit protection, and symlink fail-closed behavior.
const planArtifact = extensionWithTool("publish_plan");
const headlessPlanContext = { ...context, mode: "json", hasUI: false };
const planContractEntries = () => appendedEntries.filter((entry) => entry.customType === "neura-plan-contract");
const completedPlanRun = { messages: [{ role: "assistant", stopReason: "stop" }] };
const failedPlanRun = { messages: [{ role: "assistant", stopReason: "error" }] };
const abortedPlanRun = { messages: [{ role: "assistant", stopReason: "aborted" }] };
await firstHandler(planArtifact, "session_start")({}, headlessPlanContext);
sentUserMessages.length = 0;
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan this change" }, headlessPlanContext);
const planRequest = planArtifact.tools.get("plan_request").definition.execute;
await planRequest("plan-wait-steer", { action: "wait_for_input" }, undefined, undefined, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, 0, "Material clarification triggered a publication retry before the user could answer");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, 0, "Waiting headless Plan request reported a contract failure");
await firstHandler(planArtifact, "input")({ source: "interactive", streamingBehavior: "steer", text: "Questionnaire answer: keep compatibility" }, headlessPlanContext);
const retriesBeforeNativeRecovery = sentUserMessages.length;
for (const incompleteRun of [failedPlanRun, abortedPlanRun]) {
  await firstHandler(planArtifact, "agent_end")(incompleteRun, headlessPlanContext);
}
assert.equal(sentUserMessages.length, retriesBeforeNativeRecovery, "Provider recovery consumed the Plan publication retry");
await planRequest("plan-wait-follow-up", { action: "wait_for_input" }, undefined, undefined, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, 0, "Steered clarification answer did not preserve a deliberate second wait");
await firstHandler(planArtifact, "input")({ source: "interactive", streamingBehavior: "followUp", text: "Follow-up answer: preserve the current API" }, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
assert.equal(sentUserMessages.length, 1, "Headless clarification answer did not resume the request's one-retry publication contract");
assert.match(sentUserMessages[0].content, /call publish_plan/, "Plan retry did not name the required publisher");
await firstHandler(planArtifact, "session_start")({}, {
  ...headlessPlanContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
await planRequest("plan-wait-after-retry", { action: "wait_for_input" }, undefined, undefined, headlessPlanContext);
await firstHandler(planArtifact, "input")({ source: "interactive", streamingBehavior: "followUp", text: "Final clarification answer" }, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, 1, "Session restart allowed a second publication retry for one request");
const missingPlanFailures = planContractEntries().filter((entry) => entry.data?.status === "failed");
assert.equal(missingPlanFailures.length, 1, "Headless missing publication did not emit exactly one machine-readable failure");
assert.deepEqual(
  missingPlanFailures[0].data,
  {
    version: 1,
    status: "failed",
    code: "PLAN_ARTIFACT_MISSING",
    attempts: 2,
    retries: 1,
    maxRetries: 1,
    message: "Plan mode ended without an HTML artifact. No source changes were allowed.",
  },
  "Headless missing-publication contract changed",
);
await firstHandler(planArtifact, "session_start")({}, {
  ...headlessPlanContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, 1, "Session restart duplicated a terminal Plan contract failure");
const rpcPlanContext = { ...context, mode: "rpc", hasUI: true };
const retriesBeforeRpcWait = sentUserMessages.length;
const failuresBeforeRpcWait = planContractEntries().filter((entry) => entry.data?.status === "failed").length;
await firstHandler(planArtifact, "session_start")({}, rpcPlanContext);
await firstHandler(planArtifact, "input")({ source: "rpc", text: "Plan an RPC change" }, rpcPlanContext);
await planRequest("plan-rpc-wait", { action: "wait_for_input" }, undefined, undefined, rpcPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, rpcPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, rpcPlanContext);
assert.equal(sentUserMessages.length, retriesBeforeRpcWait, "Waiting RPC Plan request triggered a publication retry");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, failuresBeforeRpcWait, "Waiting RPC Plan request reported a contract failure");
await firstHandler(planArtifact, "session_start")({}, headlessPlanContext);
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan after provider recovery" }, headlessPlanContext);
const retriesBeforeTerminalFailure = sentUserMessages.length;
const failuresBeforeTerminalFailure = planContractEntries().filter((entry) => entry.data?.status === "failed").length;
await firstHandler(planArtifact, "agent_end")(failedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
const terminalFailure = planContractEntries().at(-1);
assert.equal(sentUserMessages.length, retriesBeforeTerminalFailure, "Terminal provider failure consumed the Plan retry");
assert.equal(terminalFailure?.data?.status, "failed", "Terminal provider failure did not emit a machine-readable Plan failure");
assert.equal(terminalFailure?.data?.retries, 0, "Terminal provider failure reported an unused Plan retry as consumed");
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Continue after the terminal failure" }, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, retriesBeforeTerminalFailure, "Later input reopened a terminal Plan retry without an explicit request reset");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, failuresBeforeTerminalFailure + 1, "Later input duplicated a terminal Plan failure");
assert.equal(planContractEntries().at(-1), terminalFailure, "Later input replaced terminal failure with a nonterminal contract state");
const publishPlan = planArtifact.tools.get("publish_plan").definition.execute;
const planWorkspace = path.join(scratchRoot, "plan-workspace");
fs.mkdirSync(path.join(planWorkspace, ".git"), { recursive: true });
fs.mkdirSync(path.join(planWorkspace, "plans"), { recursive: true });
const existingPlan = path.join(planWorkspace, "plans", "plan-mode-v1-plan.html");
fs.writeFileSync(existingPlan, "human-owned plan", "utf-8");
const publishContext = { ...headlessPlanContext, mode: "print", cwd: planWorkspace };
await firstHandler(planArtifact, "session_start")({}, publishContext);
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Publish a headless Plan artifact" }, publishContext);
const messagesBeforeRecoveredPublication = sentUserMessages.length;
await firstHandler(planArtifact, "agent_end")(failedPlanRun, publishContext);
assert.equal(sentUserMessages.length, messagesBeforeRecoveredPublication, "Provider error queued a stale retry before successful publication");
const planFixture = {
  slug: "plan-mode-v1",
  title: "Plan mode visual publishing",
  brief: "Create one researched visual HTML plan while keeping every normal source mutation blocked.",
  current: "Plan mode researches safely but returns only a numbered chat response.",
  target: "Plan mode publishes one validated local HTML artifact after an evidence pass.",
  done: "A reviewer can open the plan, understand the work, and approve it without reading chat history.",
  evidence: [
    { source: "agent/extensions/modes.ts", finding: "Current prompt requests a numbered plan and stops before implementation." },
    { source: "<script>alert(1)</script>", finding: "Untrusted plan text must be escaped before browser rendering." },
  ],
  preview: {
    title: "Proposed Plan review cockpit",
    caption: "Directional preview for review before implementation.",
    regions: [
      { title: "Evidence", tone: "neutral", items: ["Files and primary sources", "Current constraints"] },
      { title: "Future state", tone: "accent", detail: "What the completed surface may look like.", items: ["Visible hierarchy", "<img src=x onerror=alert(1)>"] },
      { title: "Approval", tone: "success", items: ["Proof checklist", "Approve or refine"] },
    ],
  },
  visuals: [{
    kind: "flow",
    title: "Planning workflow",
    caption: "Research precedes publication and approval.",
    groups: [
      { title: "Research", tone: "neutral", items: ["Read code", "Check primary sources"] },
      { title: "Publish", tone: "accent", items: ["Render safe HTML", "Write only inside plans/"] },
      { title: "Review", tone: "success", items: ["Open artifact", "Approve or refine"] },
    ],
  }],
  steps: [
    { title: "Add publisher", what: "Register a structured Plan-only publication tool.", why: "Generic write access would weaken the boundary.", files: ["agent/extensions/plan-artifact.ts"], proof: "Only publish_plan can create a file in Plan mode." },
    { title: "Verify safety", what: "Exercise path, overwrite, escaping, and mode boundaries.", why: "The exception must fail closed under hostile input.", files: ["scripts/verify-harness.mjs"], proof: "Negative tests pass and normal writes stay blocked." },
  ],
  included: ["Structured local HTML plans", "Research and approval workflow"],
  deferred: ["Hosted plans", "Interactive browser comments"],
  risks: [{ risk: "A plan could overwrite human work.", mitigation: "Use collision-safe creation and session hash ownership." }],
  verification: ["Run node scripts/verify-harness.mjs.", "Open the generated plan at desktop and compact widths."],
  decisions: [{ decision: "Write boundary", direction: "Use publish_plan instead of generic write or edit." }],
  openQuestions: ["Should implementation begin after this plan is approved?"],
  sources: [
    { label: "Official Pi extensions", note: "Confirms custom tools and active-tool filtering.", url: "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md" },
    { label: "Unsafe URL example", note: "Must render as text, never a clickable link.", url: "javascript:alert(1)" },
  ],
};
await assert.rejects(
  publishPlan("plan-invalid-comparison", {
    ...planFixture,
    slug: "invalid-comparison-plan",
    visuals: [{ ...planFixture.visuals[0], kind: "comparison", groups: [...planFixture.visuals[0].groups] }],
  }, undefined, undefined, publishContext),
  /Comparison visuals require exactly two groups/,
  "Plan renderer accepted a comparison visual that the tool schema rejects",
);
const firstPublication = await publishPlan("plan-create", planFixture, undefined, undefined, publishContext);
const messagesAfterPublication = sentUserMessages.length;
const failuresBeforePublishedSettlement = planContractEntries().filter((entry) => entry.data?.status === "failed").length;
await firstHandler(planArtifact, "agent_end")(completedPlanRun, publishContext);
await firstHandler(planArtifact, "agent_settled")({}, publishContext);
assert.equal(sentUserMessages.length, messagesAfterPublication, "Published Plan incorrectly triggered a retry");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, failuresBeforePublishedSettlement, "Published headless Plan reported a contract failure");
const publishedContract = planContractEntries().at(-1)?.data;
assert.equal(publishedContract?.status, "published", "Headless Plan publication did not emit a machine-readable success state");
assert.equal(publishedContract?.path, firstPublication.details.path, "Published contract path disagrees with tool details");
for (const text of ["Approved", "What is the status?", "Hand this plan off for implementation"]) {
  await firstHandler(planArtifact, "input")({ source: "interactive", text }, publishContext);
  await firstHandler(planArtifact, "agent_settled")({}, publishContext);
}
assert.equal(sentUserMessages.length, messagesAfterPublication, "Approval, status, or handoff reply restarted the publication contract");
assert.equal(firstPublication.details.revision, false, "First Plan publication was marked as a revision");
assert.equal(path.basename(firstPublication.details.path), "plan-mode-v1-plan-2.html", "Publisher overwrote or ignored an existing human plan");
assert.equal(fs.readFileSync(existingPlan, "utf-8"), "human-owned plan", "Existing human plan was overwritten");
const firstHtml = fs.readFileSync(firstPublication.details.path, "utf-8");
assert.match(firstHtml, /Content-Security-Policy/, "Published plan lacks a restrictive CSP");
assert.match(firstHtml, /name="viewport"/, "Published plan lacks responsive viewport metadata");
assert.match(firstHtml, /@media\(max-width:620px\)/, "Published plan lacks compact layout rules");
assert.match(firstHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, "Published plan did not escape untrusted HTML text");
assert.doesNotMatch(firstHtml, /<script\b/i, "Published plan contains executable script markup");
assert.doesNotMatch(firstHtml, /href="javascript:/i, "Published plan rendered an unsafe source URL");
assert.match(firstHtml, /href="#preview"/, "Published plan lacks preview navigation");
const navHtml = firstHtml.match(/<nav aria-label="Plan sections">([\s\S]*?)<\/nav>/)?.[1] ?? "";
const navigationTargets = [...navHtml.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
const renderedSectionIds = [...firstHtml.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(navigationTargets, renderedSectionIds, "Plan navigation does not include every rendered section in order");
const sectionNumbers = [...firstHtml.matchAll(/<section id="[^"]+"[^>]*>\s*<header><span>(\d{2}) \/ [^<]+<\/span>/g)]
  .map((match) => Number(match[1]));
assert.deepEqual(sectionNumbers, renderedSectionIds.map((_, index) => index + 1), "Plan section numbering is not continuous");
assert.match(firstHtml, /<table class="evidence"><caption>[^<]+<\/caption><thead><tr><th scope="col">Source<\/th><th scope="col">Finding<\/th>/, "Evidence table lacks captioned, scoped column headers");
assert.match(firstHtml, /a:focus-visible\{outline:3px solid var\(--focus\)/, "Plan links lack a visible keyboard-focus treatment");
assert.match(firstHtml, /nav a\{[^}]*min-height:44px/, "Plan navigation lacks practical touch targets");
assert.match(firstHtml, new RegExp(`--dim:${theme.colors.dim}`), "Plan HTML does not consume the shared dim token");
assert.match(firstHtml, new RegExp(`--error:${theme.colors.error}`), "Plan HTML does not consume the shared danger token");
assert.doesNotMatch(firstHtml, /#74787b/i, "Plan HTML retained the low-contrast legacy dim token");
assert.match(firstHtml, /class="future-preview"/, "Published plan lacks the future-state preview");
assert.match(firstHtml, /Proposed Plan review cockpit/, "Published plan lost the preview title");
assert.match(firstHtml, /&lt;img src=x onerror=alert\(1\)&gt;/, "Published plan did not escape preview content");
assert.doesNotMatch(firstHtml, /<img src=x/i, "Published plan rendered preview content as executable markup");
assert.match(firstHtml, /\.future-preview\{grid-template-columns:1fr\}/, "Published preview lacks compact layout rules");
assert.match(firstHtml, /visual-flow/, "Published plan lacks the required visual block");
assert.match(firstHtml, /flow-link/, "Published flow visual lacks connectors");
assert.match(firstHtml, /prefers-reduced-motion:reduce/, "Published plan lacks reduced-motion handling");

const revisedFixture = { ...planFixture, target: "Plan mode publishes a revised, validated local HTML artifact after research." };
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Revise the target wording" }, publishContext);
await planRequest("plan-revision", { action: "revise_published" }, undefined, undefined, publishContext);
const secondPublication = await publishPlan("plan-revise", revisedFixture, undefined, undefined, publishContext);
assert.equal(secondPublication.details.path, firstPublication.details.path, "Session-owned revision created a second file");
assert.equal(secondPublication.details.revision, true, "Session-owned update was not marked as a revision");
const rejectedSecondPlan = path.join(planWorkspace, "plans", "backend-only-plan-plan.html");
for (const streamingBehavior of ["steer", "followUp"]) {
  await firstHandler(planArtifact, "input")(
    { source: "interactive", streamingBehavior, text: "Also publish a separate backend plan" },
    publishContext,
  );
  await firstHandler(planArtifact, "agent_settled")({}, publishContext);
}
assert.equal(sentUserMessages.length, messagesAfterPublication, "Steered or queued reply restarted a published Plan request");
await planRequest("plan-revision-binding", { action: "revise_published" }, undefined, undefined, publishContext);
await assert.rejects(
  publishPlan(
    "plan-second-slug",
    { ...planFixture, slug: "backend-only-plan", preview: undefined },
    undefined,
    undefined,
    publishContext,
  ),
  /already published slug "plan-mode-v1"/,
  "Publisher accepted a second slug for one interactive planning request",
);
assert.equal(fs.existsSync(rejectedSecondPlan), false, "Rejected second slug created a plan file");
await firstHandler(planArtifact, "session_start")({}, {
  ...publishContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
await assert.rejects(
  publishPlan(
    "plan-second-slug-after-restart",
    { ...planFixture, slug: "backend-only-plan", preview: undefined },
    undefined,
    undefined,
    publishContext,
  ),
  /already published slug "plan-mode-v1"/,
  "Session reload lost the active planning request's artifact binding",
);
const restartedRevision = await publishPlan("plan-revise-after-restart", revisedFixture, undefined, undefined, publishContext);
assert.equal(restartedRevision.details.path, firstPublication.details.path, "Session reload changed the same-slug revision path");
assert.equal(restartedRevision.details.revision, true, "Session reload lost same-slug revision ownership");
fs.writeFileSync(secondPublication.details.path, "external human edit", "utf-8");
await planRequest("plan-conflict-revision", { action: "revise_published" }, undefined, undefined, publishContext);
await assert.rejects(
  publishPlan("plan-conflict", revisedFixture, undefined, undefined, publishContext),
  /changed outside this session/,
  "Publisher overwrote an external edit",
);
await assert.rejects(
  publishPlan("plan-traversal", { ...planFixture, slug: "../escape" }, undefined, undefined, publishContext),
  /slug must use/,
  "Publisher accepted a traversal slug",
);

const originalArtifactPath = restartedRevision.details.path;
const originalArtifactContent = fs.readFileSync(originalArtifactPath, "utf-8");
await planRequest("plan-new-reused-slug", { action: "start_new" }, undefined, undefined, publishContext);
const reusedSlugPublication = await publishPlan(
  "plan-reused-slug",
  { ...revisedFixture, target: "A separate request may reuse a slug without overwriting the earlier artifact." },
  undefined,
  undefined,
  publishContext,
);
assert.equal(reusedSlugPublication.details.revision, false, "Separate request with a reused slug was treated as a revision");
assert.notEqual(reusedSlugPublication.details.path, originalArtifactPath, "Separate request reused the previous artifact path");
assert.equal(fs.readFileSync(originalArtifactPath, "utf-8"), originalArtifactContent, "Separate request overwrote the previous artifact");

await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan a separate backend change" }, publishContext);
await planRequest("plan-new-request", { action: "start_new" }, undefined, undefined, publishContext);
const messagesBeforeNewRequestRetry = sentUserMessages.length;
await firstHandler(planArtifact, "agent_end")(completedPlanRun, publishContext);
assert.equal(sentUserMessages.length, messagesBeforeNewRequestRetry + 1, "Separate Plan request lost the one-retry publication contract");
await firstHandler(planArtifact, "agent_end")(completedPlanRun, publishContext);
await firstHandler(planArtifact, "agent_settled")({}, publishContext);
assert.equal(sentUserMessages.length, messagesBeforeNewRequestRetry + 1, "Separate Plan request exceeded the one-retry cap");
await firstHandler(planArtifact, "session_start")({}, {
  ...publishContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
const noPreviewPublication = await publishPlan(
  "plan-no-preview",
  { ...planFixture, slug: "backend-only-plan", preview: undefined },
  undefined,
  undefined,
  publishContext,
);
const noPreviewHtml = fs.readFileSync(noPreviewPublication.details.path, "utf-8");
assert.doesNotMatch(noPreviewHtml, /href="#preview"|class="future-preview"/, "Backend-only plan rendered an omitted preview");
assert.doesNotMatch(noPreviewHtml, /preview above/, "Backend-only plan refers to a missing preview");

await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan the symlink boundary" }, publishContext);
await planRequest("plan-new-symlink-request", { action: "start_new" }, undefined, undefined, publishContext);
const symlinkWorkspace = path.join(scratchRoot, "plan-symlink-workspace");
const externalPlans = path.join(scratchRoot, "external-plans");
fs.mkdirSync(path.join(symlinkWorkspace, ".git"), { recursive: true });
fs.mkdirSync(externalPlans, { recursive: true });
fs.symlinkSync(externalPlans, path.join(symlinkWorkspace, "plans"), process.platform === "win32" ? "junction" : "dir");
await assert.rejects(
  publishPlan("plan-symlink", { ...planFixture, slug: "symlink-test" }, undefined, undefined, { ...context, cwd: symlinkWorkspace }),
  /symbolic link or junction/,
  "Publisher followed a symlinked plans directory",
);

await modes.commands.get("mode").handler("yolo", context);
assert.equal(activeTools.includes("publish_plan"), false, "Plan publisher remained active outside Plan mode");
assert.equal(activeTools.includes("plan_request"), false, "Plan lifecycle tool remained active outside Plan mode");
assert.equal(activeTools.includes("web_fetch"), true, "Leaving Plan for YOLO did not restore web_fetch");

// Late MCP registration may refresh and activate tools after Plan has already
// applied its boundary. Preserve that live non-Plan selection while keeping the
// tool unavailable in Plan, and do not resurrect user-disabled tools on exit.
activeTools = activeTools.filter((name) => name !== "write");
await modes.commands.get("mode").handler("plan", context);
const lateMcpTool = "mcp__late__mutate";
const enabledMcpTool = "mcp__enabled__read";
registeredToolNames.push(lateMcpTool, enabledMcpTool);
activeTools = [...activeTools, lateMcpTool, enabledMcpTool];
await firstHandler(modes, "before_agent_start")({ systemPrompt: "base" }, context);
activeTools = [...activeTools, lateMcpTool, enabledMcpTool];
const lateProviderPayload = await firstHandler(modes, "before_provider_request")({
  payload: {
    model: "gpt-5.5",
    tools: [
      { type: "function", name: "read", parameters: {} },
      { type: "function", name: lateMcpTool, parameters: {} },
      { type: "function", name: enabledMcpTool, parameters: {} },
      { type: "unknown-provider-tool" },
    ],
  },
}, context);
assert.equal(activeTools.includes(lateMcpTool), false, "Late MCP activation escaped the Plan tool boundary");
assert.equal(activeTools.includes(enabledMcpTool), false, "Second late MCP activation escaped the Plan tool boundary");
assert.equal(activeTools.includes("write"), false, "Plan re-enabled a user-disabled tool");
assert.deepEqual(
  lateProviderPayload.tools.map((tool) => tool.name),
  ["read"],
  "Plan provider payload exposed a late or unrecognized tool schema",
);
const anthropicPlanPayload = await firstHandler(modes, "before_provider_request")({
  payload: {
    model: "claude-sonnet",
    tools: [
      { name: "Read", input_schema: {} },
      { name: "Bash", input_schema: {} },
      { name: "Grep", input_schema: {} },
      { name: "Edit", input_schema: {} },
    ],
  },
}, context);
assert.deepEqual(
  anthropicPlanPayload.tools.map((tool) => tool.name),
  ["Read", "Bash", "Grep"],
  "Plan payload filtering rejected Anthropic canonical names or retained Edit",
);
const openAiCompletionsPayload = await firstHandler(modes, "before_provider_request")({
  payload: {
    model: "gpt-5.5",
    tools: [
      { type: "function", function: { name: "read", parameters: {} } },
      { type: "function", function: { name: lateMcpTool, parameters: {} } },
    ],
  },
}, context);
assert.deepEqual(
  openAiCompletionsPayload.tools.map((tool) => tool.function.name),
  ["read"],
  "Plan payload filtering exposed a forbidden OpenAI Completions function",
);
const lateMcpWorkspace = path.join(scratchRoot, "late-mcp-workspace");
fs.mkdirSync(lateMcpWorkspace, { recursive: true });
fs.writeFileSync(path.join(lateMcpWorkspace, "mcp.json"), JSON.stringify({
  mcpServers: { late: { url: "https://example.com/mcp", disabled: true } },
}));
await modes.commands.get("mode").handler("yolo", { ...context, cwd: lateMcpWorkspace });
assert.equal(activeTools.includes(lateMcpTool), false, "Leaving Plan restored an MCP server disabled while hidden");
assert.equal(activeTools.includes(enabledMcpTool), true, "Leaving Plan lost an enabled late MCP activation");
assert.equal(activeTools.includes("write"), false, "Leaving Plan restored a stale tool selection");

assert.equal(await guard({ toolName: "edit", input: { path: path.join(repoRoot, "README.md") } }, context), undefined);
assert.equal(
  await guard(
    { toolName: "edit", input: { path: path.join(repoRoot, "agent", "extensions", "plan-artifact.ts") } },
    { ...context, hasUI: false },
  ),
  undefined,
  "YOLO blocked a protected control-plane file",
);
const yoloPrompt = await firstHandler(modes, "before_agent_start")({ systemPrompt: "base" }, context);
assert.match(yoloPrompt.systemPrompt, /no OS sandbox/i, "YOLO system contract omits sandbox bypass");
assert.match(yoloPrompt.systemPrompt, /do not block tool calls or ask for approval/i, "YOLO system contract omits approval bypass");
assert.match(yoloPrompt.systemPrompt, /changes execution permissions, not task scope/i, "YOLO system contract expands task scope");

const generatedDir = path.join(scratchRoot, "workspace", "dist");
fs.mkdirSync(generatedDir, { recursive: true });
const generatedFile = path.join(generatedDir, "cache.tmp");
fs.writeFileSync(generatedFile, "generated");
const headlessSensitive = {
  ...context,
  cwd: path.dirname(generatedDir),
  hasUI: false,
  ui: { confirm: async () => true, setStatus() {}, notify() {} },
};
assert.equal(
  await guard({ toolName: "bash", input: { command: `Remove-Item -LiteralPath \"${generatedFile}\"` } }, headlessSensitive),
  undefined,
  "headless YOLO blocked a sensitive action",
);

await modes.commands.get("mode").handler("human-away", context);
assert.deepEqual(activeTools, [HUMAN_AWAY_SANDBOX_TOOL], "Human Away exposed tools outside its WSL2 sandbox boundary");
const humanProviderPayload = await firstHandler(modes, "before_provider_request")({ payload: {
  tools: [
    { type: "function", function: { name: "read", parameters: {} } },
    { type: "function", function: { name: HUMAN_AWAY_SANDBOX_TOOL, parameters: {} } },
    { type: "function", function: { name: "mcp__gmail__GMAIL_GET_PROFILE", parameters: {} } },
  ],
} }, context);
assert.deepEqual(humanProviderPayload.tools.map((tool) => tool.function.name), [HUMAN_AWAY_SANDBOX_TOOL],
  "Human Away provider payload leaked a non-sandbox tool");
const sandboxArgs = bubblewrapArguments("/mnt/c/Neura", "node --version");
assert.ok(sandboxArgs.includes("--unshare-all"), "Human Away sandbox does not unshare host namespaces");
assert.ok(sandboxArgs.includes("--clearenv"), "Human Away sandbox does not clear host environment variables");
assert.deepEqual(sandboxArgs.slice(-3), ["sh", "-lc", "node --version"], "Human Away sandbox command boundary changed");
assert.equal(sandboxArgs.includes("/mnt/c"), false, "Human Away sandbox mounted the broad Windows drive");
const linkedWorkspace = path.join(scratchRoot, "linked-workspace");
const linkedOutside = path.join(scratchRoot, "linked-outside");
fs.mkdirSync(linkedWorkspace, { recursive: true });
fs.mkdirSync(linkedOutside, { recursive: true });
fs.symlinkSync(linkedOutside, path.join(linkedWorkspace, "escape"), "junction");
assert.throws(() => assertWorkspaceHasNoLinks(linkedWorkspace), /refused linked workspace entry/,
  "Human Away sandbox accepted a junction escape");
const transitionFactory = widgets.get("neura-mode-transition");
assert.equal(typeof transitionFactory, "function", "Human Away transition is not animated");
const transition = transitionFactory({ requestRender() {} }, null);
for (const width of [24, 40, 80, 120]) {
  const lines = transition.render(width);
  const text = lines.map(stripAnsi).join("\n");
  assert.ok(lines.length <= 10, `Human Away animation exceeds widget cap at ${width}`);
  assert.ok(lines.every((line) => widthOf(line) <= width), `Human Away animation overflows at ${width}`);
  assert.match(text, /HUMAN AWAY.*PREVIEW|HEADMASTER/, `Human Away Preview animation identity missing at ${width}`);
  assert.doesNotMatch(text, /────/, `decorative rail remains in mode animation at ${width}`);
}
transition.dispose?.();

process.env.NEURA_HEADMASTER = "off";
assert.equal(await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "node --test" } }, context), undefined,
  "Human Away blocked a known development command inside the sandbox");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "printf updated > src/generated.txt" } }, context))?.block, true,
  "Human Away auto-allowed an opaque workspace edit command");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "shred README.md" } }, context))?.block, true,
  "Human Away auto-allowed opaque file destruction with shred");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "truncate -s 0 README.md" } }, context))?.block, true,
  "Human Away auto-allowed opaque file destruction with truncate");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "git push origin main" } }, context))?.block, true,
  "Human Away sandbox bypassed remote-mutation policy");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "sed -i s/a/b/ agent/neura/action-policy.ts" } }, context))?.block, true,
  "Human Away sandbox bypassed protected-control policy");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "rm -r ." } }, context))?.block, true,
  "Human Away sandbox allowed recursive workspace deletion");
await firstHandler(guardrail, "agent_start")({}, context);
assert.equal(await guard({ toolName: "edit", input: { path: path.join(repoRoot, "README.md") } }, context), undefined);
const denied = await guard({ toolName: "bash", input: { command: "format C:" } }, context);
assert.equal(denied?.block, true, "Human Away broad destruction was not blocked");
assert.match(denied.reason, /Queued for Rajveer/, "Human Away denial did not queue for return");
const auditLines = fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8").trim().split(/\r?\n/);
const queuedId = auditLines.map((line) => JSON.parse(line)).filter((event) => event.kind === "decision").at(-1).record.id;
await modes.commands.get("approvals").handler("audit", context);
assert.ok(widgets.has("neura-approvals"), "/approvals audit widget missing");
await firstHandler(modes, "input")({ source: "interactive", text: "I am back" }, context);
const approvalText = widgets.get("neura-approvals")(null, null).render(100).map(stripAnsi).join("\n");
assert.match(approvalText, new RegExp(queuedId));
assert.match(approvalText, /Neura paused at a policy boundary/, "approval request is not agent-focused");
assert.match(approvalText, /INTENT/, "approval intent missing");
assert.match(approvalText, /ACTION/, "approval exact action missing");
assert.match(approvalText, /BOUNDARY/, "approval policy boundary missing");
assert.match(approvalText, /FALLBACK/, "approval safe fallback missing");
assert.match(approvalText, /GRANT/, "approval grant scope missing");
const approvalSelections = [];
const approvalContext = {
  ...context,
  ui: {
    ...ui,
    select: async (selectionTitle, options) => {
      approvalSelections.push({ selectionTitle, options });
      return approvalSelections.length === 1 ? options[0] : undefined;
    },
  },
};
await modes.commands.get("approvals").handler("", approvalContext);
assert.equal(approvalSelections[1].options[0], "Keep denied", "approval default focus is not denial");

// Human approval creates a one-use fingerprint grant shared across isolated extensions.
process.env.NEURA_HEADMASTER = "off";
await firstHandler(guardrail, "agent_start")({}, context);
const protectedFile = path.join(path.dirname(generatedDir), ".env.production");
fs.writeFileSync(protectedFile, "PLACEHOLDER=masked\n");
const protectedContext = { ...context, cwd: path.dirname(generatedDir) };
const protectedEvent = { toolName: "read", input: { path: protectedFile } };
assert.equal((await guard(protectedEvent, protectedContext))?.block, true);
const approvalEvents = fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8")
  .trim().split(/\r?\n/).map((line) => JSON.parse(line));
const protectedDecision = [...approvalEvents].reverse().find((event) => event.kind === "decision" && event.record.approvable);
assert.ok(protectedDecision, "approvable protected action was not queued");
await modes.commands.get("approvals").handler(`approve ${protectedDecision.record.id}`, protectedContext);
assert.equal(await guard(protectedEvent, protectedContext), undefined, "exact retry grant was not consumed across extensions");
assert.equal((await guard(protectedEvent, protectedContext))?.block, true, "exact retry grant was reusable");

const protectedAction = inspectAction(protectedEvent, protectedContext.cwd);
const stateBoundDecision = listPending(protectedContext.cwd)
  .find((record) => record.actionFingerprint === protectedAction.actionFingerprint);
assert.ok(stateBoundDecision?.approvalBindingFingerprint, "approval audit omitted state binding evidence");
const messagesBeforeStateGrant = sentUserMessages.length;
await modes.commands.get("approvals").handler(`approve ${stateBoundDecision.id}`, protectedContext);
assert.equal(sentUserMessages.length, messagesBeforeStateGrant + 1, "fresh state-bound grant was not created");
fs.appendFileSync(protectedFile, "CHANGED_AFTER_APPROVAL=1\n");
assert.equal((await guard(protectedEvent, protectedContext))?.block, true,
  "approval grant survived a relevant target content change");

const bindingWorkspace = path.join(scratchRoot, "binding-workspace");
fs.mkdirSync(path.join(bindingWorkspace, "agent"), { recursive: true });
fs.writeFileSync(path.join(bindingWorkspace, "agent", "settings.json"), "{}\n");
fs.writeFileSync(path.join(bindingWorkspace, "tracked.txt"), "one\n");
fs.writeFileSync(path.join(bindingWorkspace, ".gitignore"), "ignored.txt\n");
execFileSync("git", ["init", "--initial-branch=main"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["config", "user.email", "neura-test@example.invalid"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["config", "user.name", "Neura Test"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["add", "."], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["commit", "-m", "initial"], { cwd: bindingWorkspace, windowsHide: true });
fs.writeFileSync(path.join(bindingWorkspace, "ignored.txt"), "one\n");
const opaqueEvent = { toolName: "bash", input: { command: "custom-cli --config ignored.txt" } };
const opaqueAction = inspectAction(opaqueEvent, bindingWorkspace);
assert.equal(isApprovalRetryEligible(opaqueAction), false,
  "opaque command without a canonical target remained approval-retry eligible");
await firstHandler(guardrail, "agent_start")({}, context);
assert.equal((await guard(opaqueEvent, { ...context, cwd: bindingWorkspace }))?.block, true,
  "opaque command without a canonical target was not denied");
const opaqueDecision = listPending(bindingWorkspace)
  .find((record) => record.actionFingerprint === opaqueAction.actionFingerprint);
assert.equal(opaqueDecision?.approvable, false,
  "opaque command without a canonical target was queued as approvable");
const messagesBeforeOpaqueApproval = sentUserMessages.length;
await modes.commands.get("approvals").handler(`approve ${opaqueDecision.id}`, { ...context, cwd: bindingWorkspace });
assert.equal(sentUserMessages.length, messagesBeforeOpaqueApproval,
  "policy-denied opaque command received an exact retry grant");
fs.writeFileSync(path.join(bindingWorkspace, "ignored.txt"), "two\n");
assert.equal((await guard(opaqueEvent, { ...context, cwd: bindingWorkspace }))?.block, true,
  "opaque command bypassed denial after ignored workspace content changed");
const bindingEvent = { toolName: "edit", input: { path: path.join(bindingWorkspace, "agent", "settings.json") } };
const initialBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
fs.writeFileSync(path.join(bindingWorkspace, "tracked.txt"), "two\n");
execFileSync("git", ["add", "tracked.txt"], { cwd: bindingWorkspace, windowsHide: true });
const indexedBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
assert.notEqual(indexedBinding.indexFingerprint, initialBinding.indexFingerprint, "approval binding ignored index changes");
execFileSync("git", ["commit", "-m", "index change"], { cwd: bindingWorkspace, windowsHide: true });
const headBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
assert.notEqual(headBinding.head, initialBinding.head, "approval binding ignored HEAD changes");
fs.writeFileSync(path.join(bindingWorkspace, "agent", "settings.json"), "{\"changed\":true}\n");
const targetBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
assert.notEqual(targetBinding.targetStateFingerprint, headBinding.targetStateFingerprint,
  "approval binding ignored target content changes");
const expiringAction = inspectAction(bindingEvent, bindingWorkspace);
grantExactRetry({
  id: "expiry-test",
  createdAt: new Date(0).toISOString(),
  workspace: expiringAction.workspace,
  actionFingerprint: expiringAction.actionFingerprint,
  workspaceFingerprint: expiringAction.workspaceFingerprint,
  approvalBindingFingerprint: createHash("sha256").update(JSON.stringify(Object.fromEntries(
    Object.entries(expiringAction.approvalBinding).sort(([left], [right]) => left.localeCompare(right)),
  ))).digest("hex"),
  toolName: expiringAction.toolName,
  summary: expiringAction.summary,
  category: expiringAction.category,
  risk: expiringAction.risk,
  verdict: { decision: "defer", reason: "expiry test", saferPath: "wait", reviewer: "policy" },
  approvable: true,
  status: "pending",
}, 1_000);
assert.equal(consumeExactRetry(expiringAction, 1_000 + GRANT_TTL_MS + 1), false,
  "approval grant survived its expiry");

await firstHandler(guardrail, "agent_start")({}, context);
const syntheticSecret = "neura-test-secret-value-should-never-be-logged";
assert.equal((await guard({ toolName: "bash", input: { command: `custom-cli --token ${syntheticSecret}` } }, protectedContext))?.block, true);
assert.doesNotMatch(
  fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8"),
  new RegExp(syntheticSecret),
  "approval audit stored a raw inline secret",
);
const approvalDirectory = process.env.NEURA_APPROVAL_DIR;
const corruptApprovalDirectory = path.join(scratchRoot, "corrupt-approvals");
fs.mkdirSync(corruptApprovalDirectory, { recursive: true });
fs.writeFileSync(path.join(corruptApprovalDirectory, "audit.jsonl"), "{}\n");
process.env.NEURA_APPROVAL_DIR = corruptApprovalDirectory;
const auditFailure = await guard({ toolName: "bash", input: { command: "custom-cli inspect" } }, protectedContext);
assert.equal(auditFailure?.block, true, "Human Away approval audit failure did not fail closed");
assert.equal(cockpitState.getCockpitState().phase, "DEGRADED", "approval audit failure was not surfaced as degraded");
process.env.NEURA_APPROVAL_DIR = approvalDirectory;
delete process.env.NEURA_HEADMASTER;

await firstHandler(guardrail, "agent_start")({}, context);
await guard({ toolName: "bash", input: { command: "format C:" } }, context);
await guard({ toolName: "bash", input: { command: "format C:" } }, context);
await guard({ toolName: "bash", input: { command: "format C:" } }, context);
assert.ok(aborted >= 1, "Human Away repeated-denial circuit breaker did not abort the turn");

const keybindings = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "keybindings.json"), "utf-8"));
assert.notEqual(keybindings["app.thinking.cycle"], "shift+tab", "Pi thinking binding still owns Shift+Tab");
assert.equal(keybindings["app.thinking.cycle"], "ctrl+shift+t", "thinking cycle did not move to Ctrl+Shift+T");

const humanAwayFooter = footer.render(120).map(stripAnsi).join("\n");
assert.match(humanAwayFooter, /HUMAN AWAY/, "cockpit footer did not update its mode badge");
assert.match(humanAwayFooter, /PREVIEW/, "Human Away preview label missing from footer");

const modePrompt = await firstHandler(modes, "before_agent_start")({ systemPrompt: "base" }, context);
assert.match(modePrompt.systemPrompt, /HUMAN AWAY/, "Human Away system contract missing");

// Learn has its own provider/tool boundary, never the Plan publisher or a
// Human Away approval fallback. Exercise direct calls as well as hidden schemas.
const { LEARN_ONLY_TOOL_NAMES, LEARN_MODE_TOOL_NAMES } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "learn-policy.ts")).href,
);
assert.equal(modeState.nextMode("human-away"), "learn");
assert.equal(modeState.nextMode("learn"), "plan");
await modes.commands.get("mode").handler("learn", context);
assert.equal(modeState.getMode(), "learn");
assert.ok(activeTools.every((name) => LEARN_MODE_TOOL_NAMES.includes(name)), "Learn activated an unaudited tool");
for (const name of LEARN_ONLY_TOOL_NAMES.filter((name) => registeredToolNames.includes(name))) {
  assert.ok(activeTools.includes(name), `Learn did not activate ${name}`);
}
assert.equal(activeTools.includes("bash"), false);
assert.equal(activeTools.includes("publish_plan"), false);
const learnPrompt = await firstHandler(modes, "before_agent_start")({ systemPrompt: "base" }, context);
assert.match(learnPrompt.systemPrompt, /NEURA MODE: LEARN/);
assert.match(learnPrompt.systemPrompt, /3-5 short key bullets/);
assert.match(learnPrompt.systemPrompt, /untrusted reference data/);
for (const name of LEARN_ONLY_TOOL_NAMES) {
  assert.equal(await guard({ toolName: name, input: {} }, context), undefined, `${name} denied`);
  assert.equal((await guard({ toolName: name, input: null }, context))?.block, true, `${name} accepted malformed input`);
}
assert.equal(await guard({ toolName: "questionnaire", input: {} }, context), undefined);
assert.equal(await guard({ toolName: "read", input: { path: "README.md" } }, context), undefined);
assert.equal(await guard({ toolName: "grep", input: { path: "README.md", pattern: "Neura" } }, context), undefined);
assert.equal(await guard({ toolName: "web_search", input: { query: "database relationships", max_results: 3 } }, context), undefined);
for (const event of [
  { toolName: "write", input: { path: "example.txt", content: "blocked" } },
  { toolName: "edit", input: { path: "README.md" } },
  { toolName: "bash", input: { command: "echo example" } },
  { toolName: "human_away_exec", input: { command: "echo example" } },
  { toolName: "publish_plan", input: { slug: "learning-plan" } },
  { toolName: "plan_request", input: { action: "start_new" } },
  { toolName: "message_peer", input: {} },
  { toolName: "mcp__gmail__GMAIL_GET_PROFILE", input: {} },
  { toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: {} },
  { toolName: "web_fetch", input: { url: "https://example.com" } },
  { toolName: "web_search", input: { query: "x" } },
  { toolName: "read", input: { path: "../outside.txt" } },
  { toolName: "read", input: { path: ".env.local" } },
  { toolName: "read", input: { path: ".neura-learning/progress.json" } },
  { toolName: "read", input: { path: ".git/config" } },
  { toolName: "grep", input: { path: ".", pattern: "." } },
  { toolName: "find", input: { path: ".", pattern: ".env*" } },
  { toolName: "unknown_tool", input: {} },
]) assert.equal((await guard(event, context))?.block, true, `Learn allowed ${event.toolName}: ${JSON.stringify(event.input)}`);
assert.equal((await firstHandler(gmailGuardrail, "tool_call")({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: {} }, context))?.block, true,
  "Gmail approval bypassed Learn");
const learnWorkspace = path.join(scratchRoot, "learn-policy-workspace");
const learnOutside = path.join(scratchRoot, "learn-policy-outside");
fs.mkdirSync(learnWorkspace);
fs.mkdirSync(learnOutside);
fs.writeFileSync(path.join(learnOutside, "reference.txt"), "synthetic outside reference");
fs.symlinkSync(learnOutside, path.join(learnWorkspace, "linked"), process.platform === "win32" ? "junction" : "dir");
assert.equal((await guard({ toolName: "read", input: { path: "linked/reference.txt" } }, { ...context, cwd: learnWorkspace }))?.block, true,
  "Learn allowed junction escape");
fs.mkdirSync(path.join(learnWorkspace, ".neura-learning"));
fs.writeFileSync(path.join(learnWorkspace, ".neura-learning", "progress.json"), "{}");
fs.symlinkSync(path.join(learnWorkspace, ".neura-learning"), path.join(learnWorkspace, "notes"), process.platform === "win32" ? "junction" : "dir");
assert.equal((await guard({ toolName: "read", input: { path: "notes/progress.json" } }, { ...context, cwd: learnWorkspace }))?.block, true,
  "Learn read progress through an alias");

activeTools.push("write", "bash", "publish_plan", "mcp__late__execute");
const learnProvider = await firstHandler(modes, "before_provider_request")({ payload: { tools: [
  { name: "Read" }, { name: "Bash" }, { name: "write" }, { name: "publish_plan" },
  { function: { name: "learn_lesson" } }, { function: { name: "mcp__late__execute" } },
] } }, context);
assert.ok(learnProvider.tools.every((tool) => ["Read", "learn_lesson"].includes(tool.name ?? tool.function?.name)),
  "Late provider schema bypassed Learn");
assert.ok(activeTools.every((name) => LEARN_MODE_TOOL_NAMES.includes(name)));
await firstHandler(modes, "session_start")({}, {
  ...context,
  sessionManager: { getEntries: () => [{ type: "custom", customType: "neura-mode-state", data: { mode: "learn" } }] },
});
assert.equal(modeState.getMode(), "learn", "Learn did not restore");
for (const width of [24, 40, 56, 72, 92, 120]) {
  const lines = footer.render(width);
  assert.ok(lines.every((line) => widthOf(line) <= width), `Learn footer overflow at ${width}`);
  assert.match(lines.map(stripAnsi).join("\n"), /LEARN/);
}
for (const [filename, event] of [["checkpoint.ts", "agent_start"], ["check-gate.ts", "agent_start"], ["check-gate.ts", "agent_settled"], ["neura-memory.ts", "before_agent_start"]]) {
  const extension = loaded.extensions.find((item) => item.resolvedPath.endsWith(`${path.sep}${filename}`));
  assert.equal(await firstHandler(extension, event)({}, {}), undefined, `${filename} accessed context in Learn`);
}
for (const command of ["undo", "ship", "remember", "memory", "skill-doctor", "health", "approvals"]) {
  const beforeNotices = notices.length;
  await extensionWithCommand(command).commands.get(command).handler("example", { ui });
  assert.equal(notices.length, beforeNotices + 1, `${command} was not blocked before accessing the workspace`);
}
assert.throws(() => modeState.setMode("future-mode"), /Unknown Neura mode/);
assert.equal(modeState.getMode(), "learn");
const modeRegistry = globalThis[Symbol.for("neura.mode-state.v1")];
modeRegistry.current = "future-mode";
assert.equal((await guard({ toolName: "read", input: { path: "README.md" } }, context))?.block, true, "Unknown mode fell through to Human Away");
const unknownProvider = await firstHandler(modes, "before_provider_request")({ payload: { tools: [{ name: "read" }] } }, context);
assert.deepEqual(unknownProvider.tools, [], "Unknown mode exposed provider tools");
modeState.setMode("learn");
await modes.commands.get("mode").handler("plan", context);
assert.equal(activeTools.some((name) => LEARN_ONLY_TOOL_NAMES.includes(name)), false, "Learning tools leaked into Plan");
assert.ok(activeTools.includes("publish_plan"), "Learn transition lost Plan publisher");
await modes.commands.get("mode").handler("yolo", context);
const releaseHostOperation = modeState.acquireHostOperation();
assert.equal(typeof releaseHostOperation, "function");
assert.throws(() => modeState.setMode("learn"), /host operation/);
await modes.commands.get("mode").handler("learn", context);
assert.equal(modeState.getMode(), "yolo", "Mode changed while background host work was running");
releaseHostOperation();
releaseHostOperation();
assert.equal(modeState.isHostOperationActive(), false, "Host operation release was not idempotent");
await modes.commands.get("mode").handler("learn", context);
assert.equal(modeState.getMode(), "learn");
assert.equal(modeState.acquireHostOperation(), null, "Learn acquired a host operation lease");

const savedOctober = Object.fromEntries(["OCTOBER_BUS_PORT", "OCTOBER_BUS_CANVAS", "OCTOBER_BUS_NODE", "CAMPFIRE_SESSION_ROLE"]
  .map((key) => [key, process.env[key]]));
Object.assign(process.env, { OCTOBER_BUS_PORT: "1", OCTOBER_BUS_CANVAS: "synthetic", OCTOBER_BUS_NODE: "synthetic", CAMPFIRE_SESSION_ROLE: "host" });
const savedFetch = globalThis.fetch;
let learnNetworkCalls = 0;
globalThis.fetch = async () => { learnNetworkCalls++; throw new Error("Network forbidden in this test"); };
try {
  const october = await loadExtensions([path.join(extensionDir, "october-bus.ts")], repoRoot);
  assert.deepEqual(october.errors, []);
  const bus = october.extensions[0];
  for (const event of ["session_start", "session_shutdown", "before_agent_start", "agent_end"]) {
    assert.equal(await firstHandler(bus, event)({}, {}), undefined, `October ${event} did not stop in Learn`);
  }
  assert.ok(bus.tools.size > 0, "October test did not register tools");
  for (const tool of bus.tools.values()) await assert.rejects(() => tool.definition.execute("test", {}), /require YOLO/);
  assert.equal(learnNetworkCalls, 0, "October accessed the network from Learn");
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(savedOctober)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// Plain Pi must not acquire Neura's mode boundaries or integration hooks.
delete process.env.NEURA;
const stockNames = ["modes.ts", "guardrail.ts", "checkpoint.ts", "check-gate.ts", "neura-memory.ts", "october-bus.ts"];
const stock = await loadExtensions(stockNames.map((name) => path.join(extensionDir, name)), repoRoot);
assert.deepEqual(stock.errors, []);
for (const extension of stock.extensions) {
  assert.equal(extension.commands.size + extension.tools.size + extension.handlers.size, 0, `Plain Pi acquired ${extension.resolvedPath}`);
}
process.env.NEURA = "1";

console.log(
  `Neura verify: ${loaded.extensions.length} extensions; logo-only launch, responsive cockpit, transcript actions, visual Plan publishing, modes, approvals, proof state, presets, and guardrails passed.`,
);
