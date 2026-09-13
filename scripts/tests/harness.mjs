import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { isolate } from './isolation.mjs';
import { pinnedPi } from './pinned-pi.mjs';
export const repoRoot = path.resolve(import.meta.dirname, '../..');
export const scratchRoot = isolate();
process.env.NEURA = '1';
process.env.NEURA_HEADMASTER = 'off';
process.env.MY_PI_MCP_EAGER_CONNECT = '1';
fs.writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'mcp.json'), JSON.stringify({
  mcpServers: { fixture: { url: 'https://mcp.fixture.test' } },
}));
const { loaderPath, tuiPath } = pinnedPi(repoRoot);
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
const { HUMAN_AWAY_SANDBOX_TOOL, WORK_SANDBOX_TOOL, assertWorkspaceHasNoLinks, bubblewrapArguments } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "human-away-sandbox.ts")).href
);
const { healthLines, parseRuntimeContract, piRuntimeStatus } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "extensions", "harness-health.ts")).href
);
const extensionDir = path.join(repoRoot, "agent", "extensions");
const files = fs.readdirSync(extensionDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => path.join(extensionDir, name));
const runtimeContract = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "runtime-contract.json"), "utf-8"));
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const loaded = await loadExtensions(files, repoRoot);

assert.deepEqual(loaded.errors, [], `extension load errors: ${JSON.stringify(loaded.errors)}`);
assert.equal(process.env.MY_PI_MCP_EAGER_CONNECT, '1', "MCP wrapper did not restore eager-connect environment");
assert.equal(loaded.extensions.length, files.length, "not every extension loaded");
assert.equal(loaded.extensions.length, 18, "expected Neura's 18 extensions including MCP gating");

// loadExtensions deliberately leaves action methods unbound. Bind the small runtime
// surface exercised by this deterministic harness without constructing an AgentSession.
const registeredToolNames = loaded.extensions.flatMap((extension) => [...extension.tools.keys()]);
const availableToolNames = [...new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "web_search", "web_fetch", ...registeredToolNames])];
const state = { activeTools: [...availableToolNames], aborted: 0, title: "", workingMessage: "" };
const appendedEntries = [];
const sentUserMessages = [];
loaded.runtime.getActiveTools = () => [...state.activeTools];
loaded.runtime.setActiveTools = (names) => { state.activeTools = [...names]; };
loaded.runtime.getAllTools = () => [...new Set([...state.activeTools, ...availableToolNames, ...registeredToolNames])]
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
const widgets = new Map();
const statuses = new Map();
const notices = [];
const customOverlays = [];

const testTheme = {
  fg: (_color, value) => value,
  bg: (_color, value) => value,
  bold: (value) => value,
};



const ui = {
  getTheme: () => null,
  setTheme() {},
  setTitle(value) { state.title = value; },
  setHiddenThinkingLabel() {},
  setWorkingVisible() {},
  setWorkingIndicator() {},
  setWorkingMessage(value = "") { state.workingMessage = value; },
  notify(message, level) {
    notices.push({ message, level });
  },
  setWidget(id, value) {
    if (value === undefined) widgets.delete(id);
    else widgets.set(id, value);
  },
  custom(factory, options = {}) {
    let resolve;
    const result = new Promise((done) => { resolve = done; });
    const handle = {
      hidden: false,
      hide() { this.hidden = true; },
      setHidden(value) { this.hidden = value; },
      isHidden() { return this.hidden; },
      focus() {},
      unfocus() {},
      isFocused() { return false; },
    };
    const component = factory({ requestRender() {} }, testTheme, {}, resolve);
    const overlay = { component, options, handle, finish: resolve };
    customOverlays.push(overlay);
    options.onHandle?.(handle);
    return result;
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
  abort: () => { state.aborted++; },
  model: { provider: "openai-codex", id: "gpt-5.5" },
  sessionManager: { getEntries: () => [], getBranch: () => [] },
};

const modeState = await import('../../agent/neura/mode-state.ts');
const cockpitState = await import('../../agent/neura/cockpit-state.ts');
const guardrail = loaded.extensions.find(e => e.resolvedPath.endsWith(path.sep + 'guardrail.ts'));
const guard = firstHandler(guardrail, 'tool_call');
const modes = extensionWithCommand('mode');
const mcp = extensionWithCommand('mcp');
const stripAnsi = value => value.replace(/\x1b\[[0-9;]*m/g, '');
const widthOf = visibleWidth;
export { assert, execFileSync, spawnSync, createHash, fs, os, path, pathToFileURL,
  isSafeExternalUrl, isPlanToolInputAllowed, inspectAction, isApprovalRetryEligible,
  GRANT_TTL_MS, consumeExactRetry, grantExactRetry, listPending, redactSensitiveText,
  HUMAN_AWAY_SANDBOX_TOOL, WORK_SANDBOX_TOOL, assertWorkspaceHasNoLinks, bubblewrapArguments,
  healthLines, parseRuntimeContract, piRuntimeStatus, files, runtimeContract, packageManifest,
  loaded, registeredToolNames, state, appendedEntries, sentUserMessages, extensionWithCommand,
  extensionWithTool, firstHandler, widgets, statuses, notices, customOverlays, ui, context, modeState,
  cockpitState, guardrail, guard, modes, mcp, stripAnsi, widthOf, loadExtensions, extensionDir };
