import { repoRoot, assert, fs, path, healthLines, piRuntimeStatus, runtimeContract, loaded, state, extensionWithCommand, firstHandler, widgets, statuses, notices, editorFactory, ui, context, modeState, cockpitState, modes, stripAnsi, widthOf } from './harness.mjs';
const repairAction = `npm install -g @earendil-works/pi-coding-agent@${runtimeContract.piVersion}`;
for (const width of [24, 40, 56, 72, 92, 120]) {
  const lines = healthLines({
    state: "degraded",
    pi: piRuntimeStatus("9.9.9", runtimeContract.piVersion),
    identity: "neura 2.5.1 · source:0123456789ab · manifest abcdef012345",
    core: "git 2.53.0 · uvx 0.12.11",
    workflow: "modes ready",
    context: "persona ready",
    workspace: "main · clean",
    bridges: "unused in degraded layout",
    impact: "runtime drift",
    action: repairAction,
    capabilities: [],
  }, width).map(stripAnsi);
  const actionIndex = lines.findIndex((line) => line.startsWith("next "));
  assert.ok(lines.some((line) => line.includes("pi installed 9.9.9")), `installed Pi version hidden at ${width} columns`);
  assert.ok(lines.some((line) => line.includes(`pi required  ${runtimeContract.piVersion}`)), `required Pi version hidden at ${width} columns`);
  assert.notEqual(actionIndex, -1, `health repair action missing at ${width} columns`);
  assert.ok(lines.some((line) => line.startsWith("core")), `degraded health hid core diagnostics at ${width} columns`);
  assert.ok(lines.some((line) => line.startsWith("workflow")), `degraded health hid workflow diagnostics at ${width} columns`);
  if (width >= 40) assert.ok(lines.some((line) => line.startsWith("context")), `degraded health hid context diagnostics at ${width} columns`);
  if (width >= 72) assert.ok(lines.some((line) => line.startsWith("impact")), `degraded health hid impact diagnostics at ${width} columns`);
  if (width >= 56) assert.ok(lines.some((line) => line.startsWith("identity")), `health identity hidden at ${width} columns`);
  const renderedAction = lines.slice(actionIndex).map((line) => line.slice(5).trimEnd()).join("");
  assert.equal(renderedAction, repairAction, `health repair action truncated at ${width} columns`);
  assert.ok(lines.length <= 10, `degraded health exceeds Pi line cap at ${width} columns`);
}
const combinedGapLines = healthLines({
  state: "degraded",
  pi: piRuntimeStatus("9.9.9", runtimeContract.piVersion),
  identity: "neura 2.5.1 · source:0123456789ab · manifest abcdef012345",
  core: "git missing · uvx missing",
  workflow: "modes missing · sandbox missing · proof missing",
  context: "persona missing · memory missing · skills missing",
  workspace: "not a git workspace",
  bridges: "MCP config missing · local Qwen offline",
  impact: "Multiple capabilities unavailable.",
  action: `${repairAction}  ·  install uv  ·  sync extensions  ·  install mode keybindings  ·  restore persona  ·  configure skills  ·  restore mcp.json  ·  install WSL2 + bubblewrap`,
  capabilities: [],
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
const optionalGapLines = healthLines({
  state: "ready",
  pi: piRuntimeStatus(runtimeContract.piVersion, runtimeContract.piVersion),
  identity: "neura 2.5.1 · live:0123456789ab · manifest abcdef012345",
  core: "Pi ready · Git ready · workspace ready",
  workflow: "modes ready · sandbox ready · proof ready",
  context: "persona ready · memory disabled · skills missing",
  workspace: "main · clean",
  bridges: "MCP unhealthy · local Qwen missing",
  impact: "Core ready; optional capability gap does not block Neura.",
  action: "repair MCP credentials",
  capabilities: [],
}, 120).map(stripAnsi);
assert.match(optionalGapLines[0], /READY/, "optional capability gap falsely degraded health");
assert.ok(optionalGapLines.some((line) => line.includes("manifest abcdef012345")), "health omitted manifest hash");

const identityExtension = extensionWithCommand("dash");
await firstHandler(identityExtension, "session_start")({}, context);
assert.equal(typeof editorFactory, "function", "centred launch editor missing");
assert.equal(widgets.has("neura-launch"), false, "TUI launch unexpectedly used the fallback widget");
assert.equal(widgets.has("neura-logo"), false, "legacy logo widget still registered");
assert.equal(widgets.has("neura-dash"), false, "legacy dashboard widget still registered");
assert.match(state.title, /^Neura · /, "terminal title was not set");

const launchEditor = editorFactory(
  { terminal: { rows: 40, columns: 120 }, requestRender() {} },
  { borderColor: (value) => value, selectList: {} },
  { matches: () => false },
);
for (const width of [30, 40, 56, 72, 92, 120]) {
  const rawLines = launchEditor.render(width);
  const launchText = rawLines.map(stripAnsi).join("\n");
  const contentLines = rawLines.filter((line) => line.length > 0);
  const contentWidth = Math.min(84, width, Math.max(30, Math.floor(width * 0.58)));
  assert.equal(contentLines.length, contentWidth < 56 ? 9 : 10, `launch content height is wrong at ${width} columns`);
  assert.match(launchText, contentWidth < 56 ? /N   N EEEEE/ : /███╗   ██╗/, `ASCII wordmark missing at ${width} columns`);
  assert.match(launchText, /NEURA AGENT · TYPE YOUR TASK/, `Neura-only launch prompt missing at ${width} columns`);
  assert.ok(rawLines.findIndex((line) => line.length > 0) > 0, `launch surface is not vertically centred at ${width} columns`);
  assert.ok(rawLines.every((line) => widthOf(line) <= width), `launch surface overflows at ${width} columns`);
}
await firstHandler(identityExtension, "agent_start")({}, context);
assert.equal(editorFactory, undefined, "launch editor did not restore Pi's editor when work started");
await identityExtension.commands.get("dash").handler("", context);
assert.equal(typeof editorFactory, "function", "/dash did not restore the launch editor");
await identityExtension.commands.get("dash").handler("", context);

const fallbackContext = { ...context, mode: "rpc", ui: { ...ui, custom: undefined } };
await firstHandler(identityExtension, "session_start")({}, fallbackContext);
assert.ok(widgets.has("neura-launch"), "non-TUI logo fallback missing");
await firstHandler(identityExtension, "agent_start")({}, fallbackContext);
assert.equal(widgets.has("neura-launch"), false, "non-TUI logo fallback did not hide");
await identityExtension.commands.get("dash").handler("", context);

const theme = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "themes", "neura-dark.json"), "utf-8"));
assert.equal(theme.colors.accent, "#2979ff", "Neura logo-blue accent missing");
assert.equal(theme.colors.selectedBg, "#151c2d", "Neura raised surface missing");
assert.equal(theme.colors.borderAccent, theme.colors.border, "editor rails do not use Neura's quiet border");
assert.equal(theme.colors.mdHeading, theme.colors.accent, "theme introduces a second heading accent");
assert.equal(theme.colors.mdLink, "#7cc7ff", "answer links lack Neura's information blue");
assert.equal(theme.colors.syntaxFunction, "#7cc7ff", "code functions lack Neura's cyan accent");
assert.equal(theme.colors.dim, "#8894a8", "dim text token does not meet the approved contrast target");
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
  assert.ok(contrast(theme.colors[token], "#080a0f") >= 4.5, `${token} fails 4.5:1 contrast on the Neura canvas`);
}
const healthExtension = extensionWithCommand("health");
await healthExtension.commands.get("health").handler("close", context);
assert.equal(statuses.size, 0, "health status not cleared");
// Run the actual health command without ambient processes, provider calls, or live configuration.
const { registerHealth } = await import('../../agent/extensions/harness-health.ts');
let inspectHealth;
let inspectedHealth = 0;
let failHealth = false;
registerHealth({registerCommand(_name,command){inspectHealth=command.handler;}}, async ()=>{ inspectedHealth++; if (failHealth) throw new Error("Authorization: Bearer stale-widget-secret"); return {
  state:'degraded',pi:piRuntimeStatus('9.9.9',runtimeContract.piVersion),
  identity:'neura 2.5.1 · source:0123456789ab · manifest abcdef012345',
  core:'fixture',workflow:'fixture',context:'fixture',workspace:'fixture',bridges:'fixture',
  impact:'runtime drift',action:repairAction,capabilities:[],
}; });
for (const mode of ['work', 'learn']) {
  modeState.setMode(mode);
  await inspectHealth('', context);
  assert.equal(inspectedHealth, 0, `${mode} ran host health diagnostics`);
}
modeState.setMode('yolo');
await inspectHealth('',context);
assert.equal(inspectedHealth, 1, 'YOLO did not run the injected health inspection');
modeState.setMode('work');
assert.equal(statuses.size,0,'completed health inspection retained status');
assert.ok(widgets.has('neura-health'),'health inspection did not publish a widget');
failHealth = true;
modeState.setMode('yolo');
await inspectHealth('',context);
modeState.setMode('work');
assert.equal(widgets.has('neura-health'),false,'failed health inspection retained a stale widget');
assert.doesNotMatch(JSON.stringify(notices),/stale-widget-secret/,'failed health inspection leaked credentials');

// A cancelled probe may return READY or reject; neither may publish a result.
for (const outcome of ['ready', 'reject', 'pre-aborted']) {
  const controller = new AbortController();
  let calls = 0;
  let started;
  let finish;
  const pending = new Promise((resolve, reject) => { finish = outcome === 'reject' ? reject : resolve; });
  const running = new Promise((resolve) => { started = resolve; });
  let handler;
  registerHealth({ registerCommand(_name, command) { handler = command.handler; } }, async (_cwd, signal) => {
    calls++;
    assert.equal(signal, controller.signal);
    started();
    await pending;
    return { state: 'ready' };
  });
  modeState.setMode('yolo');
  cockpitState.patchCockpit({ phase: 'DEGRADED', degraded: 'previous finding' });
  const previousNotices = [...cockpitState.getCockpitState().notices];
  const noticeCount = notices.length;
  widgets.set('neura-health', () => ({ render: () => ['stale READY'] }));
  if (outcome === 'pre-aborted') controller.abort();
  const completed = handler('', { ...context, abortSignal: controller.signal });
  if (outcome !== 'pre-aborted') {
    await running;
    controller.abort();
    finish(outcome === 'reject' ? new DOMException('cancelled', 'AbortError') : undefined);
  }
  await completed;
  assert.equal(calls, outcome === 'pre-aborted' ? 0 : 1);
  assert.equal(widgets.has('neura-health'), false, 'cancelled health published a widget');
  assert.equal(statuses.has('neura-health'), false, 'cancelled health retained status');
  assert.equal(modeState.isHostOperationActive(), false, 'cancelled health retained its lease');
  const cockpit = cockpitState.getCockpitState();
  assert.equal(cockpit.operation, undefined, 'cancelled health retained its operation');
  assert.equal(cockpit.phase, 'DEGRADED', 'cancelled health published readiness');
  assert.equal(cockpit.degraded, 'previous finding');
  assert.deepEqual(cockpit.notices, previousNotices, 'cancelled health changed existing findings');
  assert.equal(notices.length, noticeCount, 'cancellation reported an inspection error');
}
modeState.setMode('work');

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
assert.match(state.workingMessage, /Esc stops safely/, "working state lacks an interrupt hint");
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
assert.equal(state.workingMessage, "", "working message was not restored after completion");
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
assert.equal(launchFooterText, "", "launch footer competes with the centred editor");
await identityExtension.commands.get("dash").handler("", context);
const idleFooterText = footer.render(120).map(stripAnsi).join("\n");
assert.match(idleFooterText, /WORK/, "idle footer lost the safe default WORK state");
assert.doesNotMatch(idleFooterText, /YOLO · DANGER/, "idle footer incorrectly reports YOLO in the safe default mode");
assert.doesNotMatch(idleFooterText, /typescript ready|MCP 0\/3|proof full/, "idle footer still renders detached extension status rows");
cockpitState.patchCockpit({ launchVisible: false, phase: "WORK", operation: { verb: "working", startedAt: Date.now() } });
const workingFooterText = footer.render(120).map(stripAnsi).join("\n");
assert.match(workingFooterText, /typescript ready/, "live third-party status disappeared during work");
assert.doesNotMatch(workingFooterText, /MCP 0\/3|proof full/, "footer retained persistent MCP noise or duplicate proof state");
cockpitState.resetCockpit();

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


modeState.setMode("human-away");
const keybindings = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "keybindings.json"), "utf-8"));
assert.notEqual(keybindings["app.thinking.cycle"], "shift+tab", "Pi thinking binding still owns Shift+Tab");
assert.equal(keybindings["app.thinking.cycle"], "ctrl+shift+t", "thinking cycle did not move to Ctrl+Shift+T");

const humanAwayFooter = footer.render(120).map(stripAnsi).join("\n");
assert.match(humanAwayFooter, /HUMAN AWAY/, "cockpit footer did not update its mode badge");
assert.match(humanAwayFooter, /PREVIEW/, "Human Away preview label missing from footer");

console.log('PASS ui');
