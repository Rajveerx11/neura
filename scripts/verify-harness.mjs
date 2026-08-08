import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const extensionDir = path.join(repoRoot, "agent", "extensions");
const files = fs.readdirSync(extensionDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => path.join(extensionDir, name));
assert.equal(files.some((file) => file.endsWith(`${path.sep}autogit.ts`)), false, "retired autogit extension still loads");
const installerSource = fs.readFileSync(path.join(repoRoot, "install.ps1"), "utf-8");
assert.match(installerSource, /\$retiredExtensions\s*=\s*@\("autogit\.ts"\)/, "installer does not retire the old autogit hook");
assert.match(installerSource, /Remove-Item -LiteralPath \$retiredPath -Force/, "installer does not remove the retired autogit hook");
assert.match(installerSource, /is retired but remains installed/, "drift check does not detect the retired autogit hook");
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
assert.match(idleFooterText, /YOLO/, "idle footer lost the active mode");
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
modeState.setMode("yolo");
assert.equal(await gmailGuard({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: {} }, deniedGmailContext), undefined, "YOLO retained Gmail approval mediation");
assert.equal(await gmailGuard({ toolName: "mcp__gmail__GMAIL_DELETE_MESSAGE", input: {} }, { ...context, hasUI: false }), undefined, "headless YOLO blocked a Gmail mutation");
assert.equal(gmailPrompts, 1, "YOLO requested a Gmail confirmation");

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

// Mode spine: persisted default, direct /mode, exact Plan tool boundary, and Shift+Tab.
const modes = extensionWithCommand("mode");
assert.ok(modes.commands.has("approvals"), "/approvals command missing");
assert.ok(modes.shortcuts.has("shift+tab"), "Shift+Tab mode shortcut missing");
await firstHandler(modes, "session_start")({}, context);
assert.equal(activeTools.includes("publish_plan"), false, "Plan publisher remained active during YOLO startup");

process.env.NEURA_REDUCED_MOTION = "1";
await modes.commands.get("mode").handler("plan", context);
let reducedTransition = widgets.get("neura-mode-transition")(null, null).render(92).map(stripAnsi).join("\n");
assert.match(reducedTransition, /BOUNDARY APPLIED/, "reduced motion did not render the final policy frame immediately");
assert.doesNotMatch(reducedTransition, /APPLYING POLICY/, "reduced motion retained intermediate animation state");
await modes.commands.get("mode").handler("yolo", context);
reducedTransition = widgets.get("neura-mode-transition")(null, null).render(92).map(stripAnsi).join("\n");
assert.match(reducedTransition, /YOLO/, "latest rapid mode switch did not own the transition");
assert.match(reducedTransition, /FULL ACCESS/, "YOLO transition does not expose full access");
assert.match(reducedTransition, /no sandbox · no approvals/, "YOLO transition does not expose disabled safety boundaries");
delete process.env.NEURA_REDUCED_MOTION;

await modes.commands.get("mode").handler("plan", context);
assert.ok(widgets.has("neura-mode-transition"), "Plan transition animation missing");
assert.ok(activeTools.includes("publish_plan"), "Plan mode did not activate the bounded plan publisher");
assert.ok(activeTools.includes("web_search"), "Plan mode did not activate bounded web search");
assert.equal(activeTools.includes("web_fetch"), false, "Plan mode activated web_fetch without enforceable DNS and redirect validation");
assert.equal(activeTools.includes("edit") || activeTools.includes("write"), false, "Plan mode retained generic mutation tools");
assert.equal(await guard({ toolName: "bash", input: { command: "git status" } }, context), undefined);
assert.equal((await guard({ toolName: "bash", input: { command: "git status; Remove-Item file.txt" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "Get-Content env:OPENAI_API_KEY" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "rg --pre dangerous-helper pattern" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "git diff --output=review.patch" } }, context))?.block, true);
assert.equal((await guard({ toolName: "edit", input: { path: path.join(repoRoot, "README.md") } }, context))?.block, true);

const planBoundaryWorkspace = path.join(scratchRoot, "plan-boundary-workspace");
const planBoundaryOutside = path.join(scratchRoot, "plan-boundary-outside");
const planBoundaryLink = path.join(planBoundaryWorkspace, "linked-outside");
const planBoundaryFile = path.join(planBoundaryWorkspace, "inside.txt");
const planBoundaryOutsideFile = path.join(planBoundaryOutside, "outside.txt");
fs.mkdirSync(planBoundaryWorkspace, { recursive: true });
fs.mkdirSync(planBoundaryOutside, { recursive: true });
fs.writeFileSync(planBoundaryFile, "inside", "utf-8");
fs.writeFileSync(planBoundaryOutsideFile, "outside", "utf-8");
fs.symlinkSync(planBoundaryOutside, planBoundaryLink, process.platform === "win32" ? "junction" : "dir");
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

// Plan publication: structured input, escaped browser output, collision-safe creation,
// one-artifact-per-request binding, session-owned revision, external-edit protection,
// and symlink fail-closed behavior.
const planArtifact = extensionWithTool("publish_plan");
await firstHandler(planArtifact, "session_start")({}, context);
sentUserMessages.length = 0;
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan this change" }, context);
await firstHandler(planArtifact, "agent_settled")({}, context);
assert.equal(sentUserMessages.length, 1, "Missing Plan artifact did not trigger one automatic retry");
assert.match(sentUserMessages[0].content, /call publish_plan/, "Plan retry did not name the required publisher");
await firstHandler(planArtifact, "agent_settled")({}, context);
assert.equal(sentUserMessages.length, 1, "Missing Plan artifact exceeded the one-retry cap");
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan this change again" }, context);
const publishPlan = planArtifact.tools.get("publish_plan").definition.execute;
const planWorkspace = path.join(scratchRoot, "plan-workspace");
fs.mkdirSync(path.join(planWorkspace, ".git"), { recursive: true });
fs.mkdirSync(path.join(planWorkspace, "plans"), { recursive: true });
const existingPlan = path.join(planWorkspace, "plans", "plan-mode-v1-plan.html");
fs.writeFileSync(existingPlan, "human-owned plan", "utf-8");
const publishContext = { ...context, cwd: planWorkspace };
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
await firstHandler(planArtifact, "agent_settled")({}, publishContext);
assert.equal(sentUserMessages.length, messagesAfterPublication, "Published Plan incorrectly triggered a retry");
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
assert.match(firstHtml, /class="future-preview"/, "Published plan lacks the future-state preview");
assert.match(firstHtml, /Proposed Plan review cockpit/, "Published plan lost the preview title");
assert.match(firstHtml, /&lt;img src=x onerror=alert\(1\)&gt;/, "Published plan did not escape preview content");
assert.doesNotMatch(firstHtml, /<img src=x/i, "Published plan rendered preview content as executable markup");
assert.match(firstHtml, /\.future-preview\{grid-template-columns:1fr\}/, "Published preview lacks compact layout rules");
assert.match(firstHtml, /visual-flow/, "Published plan lacks the required visual block");
assert.match(firstHtml, /flow-link/, "Published flow visual lacks connectors");
assert.match(firstHtml, /prefers-reduced-motion:reduce/, "Published plan lacks reduced-motion handling");

const revisedFixture = { ...planFixture, target: "Plan mode publishes a revised, validated local HTML artifact after research." };
const secondPublication = await publishPlan("plan-revise", revisedFixture, undefined, undefined, publishContext);
assert.equal(secondPublication.details.path, firstPublication.details.path, "Session-owned revision created a second file");
assert.equal(secondPublication.details.revision, true, "Session-owned update was not marked as a revision");
const rejectedSecondPlan = path.join(planWorkspace, "plans", "backend-only-plan-plan.html");
for (const streamingBehavior of ["steer", "followUp"]) {
  await firstHandler(planArtifact, "input")(
    { source: "interactive", streamingBehavior, text: "Also publish a separate backend plan" },
    publishContext,
  );
}
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

await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan a separate backend change" }, publishContext);
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
assert.equal(activeTools.includes("web_fetch"), true, "Leaving Plan for YOLO did not restore web_fetch");
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
assert.equal(activeTools.includes("web_fetch"), true, "Human Away did not retain the normal web_fetch tool set");
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

assert.equal(await guard({ toolName: "edit", input: { path: path.join(repoRoot, "README.md") } }, context), undefined);
const denied = await guard({ toolName: "bash", input: { command: "format C:" } }, context);
assert.equal(denied?.block, true, "Human Away broad destruction was not blocked");
assert.match(denied.reason, /Queued for Rajveer/, "Human Away denial did not queue for return");
const auditLines = fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8").trim().split(/\r?\n/);
const queuedId = JSON.parse(auditLines[0]).record.id;
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

await firstHandler(guardrail, "agent_start")({}, context);
const syntheticSecret = "neura-test-secret-value-should-never-be-logged";
assert.equal((await guard({ toolName: "bash", input: { command: `custom-cli --token ${syntheticSecret}` } }, protectedContext))?.block, true);
assert.doesNotMatch(
  fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8"),
  new RegExp(syntheticSecret),
  "approval audit stored a raw inline secret",
);
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

console.log(
  `Neura verify: ${loaded.extensions.length} extensions; logo-only launch, responsive cockpit, transcript actions, visual Plan publishing, modes, approvals, proof state, presets, and guardrails passed.`,
);
