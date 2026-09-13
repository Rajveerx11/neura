import { repoRoot, scratchRoot, assert, fs, path, pathToFileURL, inspectAction, loaded, registeredToolNames, state, extensionWithCommand, firstHandler, notices, ui, context, modeState, cockpitState, guard, modes, stripAnsi, widthOf, loadExtensions, extensionDir, WORK_SANDBOX_TOOL } from './harness.mjs';
// Migrated verbatim in behavior from the pre-#27 Learn regression block; each
// assertion now runs with pinned local Pi and an isolated synthetic home.
const gmailGuardrail = loaded.extensions.find(extension => extension.resolvedPath.endsWith(path.sep + 'gmail-guardrail.ts'));
let footerFactory;
const cockpit = loaded.extensions.find(extension => extension.resolvedPath.endsWith(path.sep + 'cockpit.ts'));
await firstHandler(cockpit, 'session_start')({}, {
  ...context, getContextUsage: () => ({ percent: 10 }),
  ui: { ...ui, setFooter: value => { footerFactory = value; } },
});
cockpitState.resetCockpit();
const footer = footerFactory({ requestRender() {} }, null, {
  getGitBranch: () => 'synthetic-learn', getExtensionStatuses: () => new Map(), onBranchChange: () => () => {},
});
await firstHandler(modes, 'session_start')({}, context);
assert.equal(modeState.getMode(), 'work', 'Learn suite must start from upstream safe WORK default');
// Learn has its own provider/tool boundary, never the Plan publisher or a
// Human Away approval fallback. Exercise direct calls as well as hidden schemas.
const { LEARN_ONLY_TOOL_NAMES, LEARN_MODE_TOOL_NAMES } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "learn-policy.ts")).href,
);
assert.equal(modeState.nextMode("human-away"), "learn");
assert.equal(modeState.nextMode("learn"), "plan");
await modes.commands.get("mode").handler("learn", context);
assert.equal(modeState.getMode(), "learn");
assert.ok(state.activeTools.every((name) => LEARN_MODE_TOOL_NAMES.includes(name)), "Learn activated an unaudited tool");
for (const name of LEARN_ONLY_TOOL_NAMES.filter((name) => registeredToolNames.includes(name))) {
  assert.ok(state.activeTools.includes(name), `Learn did not activate ${name}`);
}
assert.equal(state.activeTools.includes("bash"), false);
assert.equal(state.activeTools.includes("publish_plan"), false);
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
assert.equal(await guard({ toolName: "ls", input: { path: "docs" } }, context), undefined);
assert.equal(await guard({ toolName: "web_search", input: { query: "database relationships", max_results: 3 } }, context), undefined);
for (const event of [
  { toolName: "write", input: { path: "example.txt", content: "blocked" } },
  { toolName: "edit", input: { path: "README.md" } },
  { toolName: "bash", input: { command: "echo example" } },
  { toolName: "human_away_exec", input: { command: "echo example" } },
  { toolName: WORK_SANDBOX_TOOL, input: { command: "echo example" } },
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
  { toolName: "grep", input: { path: "README.md", pattern: "Neura" } },
  { toolName: "find", input: { path: ".", pattern: "*.md" } },
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
fs.writeFileSync(path.join(learnWorkspace, "safe.txt"), "synthetic public reference");
fs.mkdirSync(path.join(learnWorkspace, "public"));
assert.equal(await guard({ toolName: "read", input: { path: "safe.txt" } }, { ...context, cwd: learnWorkspace }), undefined);
assert.equal(await guard({ toolName: "read", input: { path: path.join(learnWorkspace, "safe.txt") } }, { ...context, cwd: learnWorkspace }), undefined);
assert.equal(await guard({ toolName: "ls", input: { path: "public" } }, { ...context, cwd: learnWorkspace }), undefined);
assert.equal(await guard({ toolName: "ls", input: {} }, { ...context, cwd: path.join(learnWorkspace, "public") }), undefined);
assert.equal((await guard({ toolName: "read", input: { path: "safe.txt" } }, { ...context, cwd: "\\\\server\\share" }))?.block, true,
  "Learn attempted to resolve a network workspace");
assert.equal((await guard({ toolName: "ls", input: { path: "." } }, { ...context, cwd: learnWorkspace }))?.block, true,
  "Pi ls would stat an outside linked child");
for (const relative of [".aws/config", ".npmrc", "MEMORY.md", "sessions/example.jsonl", "approvals/example.json", "node_modules/example.txt", "auth.json", "models.json", "settings.json", "mcp.json", "keybindings.json", "tokens.json", "credentials.json", "secrets.json"]) {
  const filename = path.join(learnWorkspace, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, "synthetic protected reference");
  assert.equal((await guard({ toolName: "read", input: { path: relative } }, { ...context, cwd: learnWorkspace }))?.block, true,
    `Learn read protected source ${relative}`);
}
fs.linkSync(path.join(learnWorkspace, "MEMORY.md"), path.join(learnWorkspace, "public-memory.txt"));
assert.equal((await guard({ toolName: "read", input: { path: "public-memory.txt" } }, { ...context, cwd: learnWorkspace }))?.block, true,
  "Learn read protected memory through a hardlink");
for (const value of ["@safe.txt", "~/safe.txt", "file:///safe.txt", "safe.txt:reference", "C:safe.txt", "\\\\server\\share\\safe.txt", "\\\\?\\C:\\safe.txt", "safe\u0000.txt", "safe\u00a0.txt"]) {
  assert.equal((await guard({ toolName: "read", input: { path: value } }, { ...context, cwd: learnWorkspace }))?.block, true,
    `Learn accepted ambiguous path ${JSON.stringify(value)}`);
}
if (process.platform === "win32") {
  fs.writeFileSync(path.join(learnWorkspace, "auth.json:reference"), "synthetic alternate stream");
  assert.equal(fs.readFileSync(path.join(learnWorkspace, "auth.json:reference"), "utf-8"), "synthetic alternate stream", "ADS fixture was not created");
  assert.equal((await guard({ toolName: "read", input: { path: "auth.json:reference" } }, { ...context, cwd: learnWorkspace }))?.block, true,
    "Learn read protected authentication through ADS");
  for (const value of ["/c/safe.txt", "/mnt/c/safe.txt", "/cygdrive/c/safe.txt", "\\safe.txt"]) {
    assert.equal((await guard({ toolName: "read", input: { path: value } }, { ...context, cwd: learnWorkspace }))?.block, true,
      `Learn accepted shell-dependent Windows path ${value}`);
  }
}
const largeReference = fs.openSync(path.join(learnWorkspace, "large.txt"), "w");
fs.ftruncateSync(largeReference, 8 * 1024 * 1024 + 1); fs.closeSync(largeReference);
assert.equal((await guard({ toolName: "read", input: { path: "large.txt" } }, { ...context, cwd: learnWorkspace }))?.block, true,
  "Learn allowed an unbounded stock read");
const savedRipgrepConfig = process.env.RIPGREP_CONFIG_PATH;
const hostileSearchConfig = path.join(learnWorkspace, "search.conf");
fs.writeFileSync(hostileSearchConfig, `--pre\nsynthetic-never-executed\n${path.join(learnOutside, "reference.txt")}\n`);
process.env.RIPGREP_CONFIG_PATH = hostileSearchConfig;
try {
  for (const toolName of ["grep", "Grep", "find", "Find", "Read", "Bash"]) {
    assert.equal((await guard({ toolName, input: { path: "safe.txt", pattern: "reference" } }, { ...context, cwd: learnWorkspace }))?.block, true,
      `${toolName} bypassed Learn under hostile search configuration`);
  }
} finally {
  if (savedRipgrepConfig === undefined) delete process.env.RIPGREP_CONFIG_PATH;
  else process.env.RIPGREP_CONFIG_PATH = savedRipgrepConfig;
}
for (const relative of ["agent/neura/learn-materials-worker.mjs", "agent/neura/package.json", "agent/neura/package-lock.json"]) {
  const filename = path.join(learnWorkspace, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, "{}");
  assert.equal(inspectAction({ toolName: "write", input: { path: filename, content: "changed" } }, learnWorkspace).category, "protected-control",
    `Human Away did not protect learning runtime control ${relative}`);
}

state.activeTools.push("write", "bash", "grep", "find", "publish_plan", "mcp__late__execute");
const learnProvider = await firstHandler(modes, "before_provider_request")({ payload: { tools: [
  { name: "Read" }, { name: "Bash" }, { name: "Grep" }, { name: "find" }, { name: "write" }, { name: "publish_plan" },
  { function: { name: "learn_lesson" } }, { function: { name: "mcp__late__execute" } },
] } }, context);
assert.ok(learnProvider.tools.every((tool) => ["Read", "learn_lesson"].includes(tool.name ?? tool.function?.name)),
  "Late provider schema bypassed Learn");
assert.ok(state.activeTools.every((name) => LEARN_MODE_TOOL_NAMES.includes(name)));
const googleLearnProvider = await firstHandler(modes, "before_provider_request")({ payload: { config: { tools: [{ functionDeclarations: [
  { name: "Read" }, { name: WORK_SANDBOX_TOOL }, { name: "learn_lesson" }, { name: "Grep" },
] }] } } }, context);
assert.deepEqual(googleLearnProvider.config.tools[0].functionDeclarations.map(tool => tool.name), ["Read", "learn_lesson"],
  "Google provider leaked Work execution or stock search into Learn");
const bedrockLearnProvider = await firstHandler(modes, "before_provider_request")({ payload: { toolConfig: { tools: [
  { toolSpec: { name: "read" } }, { toolSpec: { name: WORK_SANDBOX_TOOL } }, { toolSpec: { name: "learn_lesson" } },
] } } }, context);
assert.deepEqual(bedrockLearnProvider.toolConfig.tools.map(tool => tool.toolSpec.name), ["read", "learn_lesson"],
  "Bedrock provider leaked Work execution into Learn");
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
await modes.commands.get("mode").handler("work", context);
assert.equal(modeState.getMode(), "work");
assert.ok(state.activeTools.includes(WORK_SANDBOX_TOOL), "Learn transition lost Work's sandbox executor");
assert.equal(state.activeTools.some(name => LEARN_ONLY_TOOL_NAMES.includes(name)), false, "Learn tools leaked into Work");
await modes.commands.get("mode").handler("learn", context);
await modes.commands.get("mode").handler("plan", context);
assert.equal(state.activeTools.some((name) => LEARN_ONLY_TOOL_NAMES.includes(name)), false, "Learning tools leaked into Plan");
assert.ok(state.activeTools.includes("publish_plan"), "Learn transition lost Plan publisher");
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

// A cancelled proof may still be draining when the new session restores modes.
// Exercise both extension event orderings against the real modes registration.
const { registerCheckGate, runModeProof } = await import('../../agent/extensions/check-gate.ts');
const { captureWorktree } = await import('../../agent/neura/verification.ts');
const { repository } = await import('./git-fixture.mjs');
const slowProofWorkspace = repository(scratchRoot, 'learn-session-proof');
for (const { order, restored } of [
  { order: 'proof-first', restored: 'work' },
  { order: 'modes-first', restored: 'work' },
  { order: 'modes-first', restored: 'learn' },
]) {
  const proofHandlers = new Map(), proofCommands = new Map(), staleReceipts = [];
  let finishProof, proofSignal;
  registerCheckGate({
    on: (name, handler) => proofHandlers.set(name, handler),
    registerCommand: (name, command) => proofCommands.set(name, command),
    appendEntry: (_type, receipt) => staleReceipts.push(receipt),
    sendUserMessage() {},
  }, {
    captureWorktree,
    runProof: async (_cwd, _quick, { signal }) => {
      proofSignal = signal;
      return new Promise(resolve => { finishProof = () => resolve({ status: 'passed', reasons: [] }); });
    },
  });
  await modes.commands.get('mode').handler('yolo', context);
  const proof = proofCommands.get('ship').handler('', { ...context, cwd: slowProofWorkspace });
  const deadline = Date.now() + 5000;
  while (!finishProof && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(typeof finishProof, 'function', 'Slow proof fixture did not start');
  assert.equal(modeState.isHostOperationActive(), true, 'Running proof has no host lease');
  const freshContext = {
    ...context,
    sessionManager: { getEntries: () => restored === 'work' ? [] : [{ type: 'custom', customType: 'neura-mode-state', data: { mode: restored } }], getBranch: () => [] },
    ui: { ...ui, confirm: async () => { assert.fail('Fresh session requested YOLO confirmation'); } },
  };
  try {
    if (order === 'proof-first') proofHandlers.get('session_start')();
    await firstHandler(modes, 'session_start')({}, freshContext);
    if (order === 'modes-first') proofHandlers.get('session_start')();
    assert.equal(proofSignal.aborted, true, `${order}: old proof was not cancelled`);
    assert.equal(modeState.getMode(), 'work', `${order}: fresh session inherited YOLO`);
    assert.deepEqual(state.activeTools, [], `${order}: pending restore exposed executable tool schemas`);
    assert.equal(modeState.isHostOperationActive(), true, `${order}: session reset unlocked undrained host work`);
    assert.equal(modeState.isModeRestorePending(), true, `${order}: old work is draining without the restore boundary`);
    assert.equal(modeState.acquireHostOperation(['work', 'yolo']), null, `${order}: pending restore admitted new host work`);
    assert.equal((await guard({ toolName: 'read', input: { path: 'README.md' } }, freshContext))?.block, true,
      `${order}: direct tool calls bypassed the pending restore boundary`);
    const shell = await firstHandler(modes, 'user_bash')({ command: 'echo blocked' }, freshContext);
    assert.equal(shell.result.exitCode, 1, `${order}: pending restore admitted a user shell`);
    assert.match(shell.result.output, /paused/);
    const workTool = loaded.extensions.flatMap(extension => [...extension.tools.values()])
      .find(tool => tool.definition.name === WORK_SANDBOX_TOOL);
    await assert.rejects(() => workTool.definition.execute('pending', { command: 'echo blocked' }, undefined, undefined, freshContext), /ready WORK/);
    let pendingExecutions = 0;
    const pendingExecutor = async () => { pendingExecutions++; throw new Error('Pending restore executed proof'); };
    assert.equal((await runModeProof(slowProofWorkspace, true, { execute: pendingExecutor }, pendingExecutor)).status, 'unavailable');
    assert.equal(pendingExecutions, 0, `${order}: pending restore executed direct proof`);
    const pendingProvider = await firstHandler(modes, 'before_provider_request')({ payload: { tools: [{ name: 'read' }, { name: WORK_SANDBOX_TOOL }] } }, freshContext);
    assert.deepEqual(pendingProvider.tools, [], `${order}: pending restore leaked provider tools`);
    const freshPrompt = await firstHandler(modes, 'before_agent_start')({ systemPrompt: 'base' }, freshContext);
    assert.match(freshPrompt.systemPrompt, /NEURA MODE: WORK/, `${order}: new prompt retained YOLO`);
    await modes.commands.get('mode').handler('learn', freshContext);
    assert.equal(modeState.getMode(), 'work', `${order}: interactive mode switch ignored undrained host work`);
  } finally {
    finishProof();
    await proof;
  }
  assert.equal(staleReceipts.length, 0, `${order}: cancelled old proof wrote into the new session`);
  const restoreDeadline = Date.now() + 5000;
  while (modeState.isModeRestorePending() && Date.now() < restoreDeadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(modeState.getMode(), restored, `${order}: drained proof did not restore the requested session mode`);
  assert.equal(modeState.isHostOperationActive(), false, `${order}: drained proof leaked its host lease`);
  assert.equal(modeState.isModeRestorePending(), false, `${order}: drained proof retained the pending boundary`);
  assert.ok(state.activeTools.includes('read'), `${order}: temporary tool suppression erased the user's research selection`);
  assert.ok(state.activeTools.includes(restored === 'work' ? WORK_SANDBOX_TOOL : 'learn_lesson'),
    `${order}: resumed session did not activate its dedicated tools`);
  await modes.commands.get('mode').handler('learn', context);
  assert.equal(modeState.getMode(), 'learn', `${order}: drained work still blocks normal mode switching`);
}

// Multiple old leases must all drain; a later restore supersedes the earlier
// destination without ever exposing its tools or permitting a new operation.
await modes.commands.get('mode').handler('yolo', context);
const releaseFirst = modeState.acquireHostOperation();
const releaseLast = modeState.acquireHostOperation();
const supersededRestore = modeState.restoreMode('plan');
const latestRestore = modeState.restoreMode('learn');
assert.equal(await supersededRestore, false);
releaseFirst();
releaseFirst();
assert.equal(modeState.getMode(), 'work');
assert.equal(modeState.isModeRestorePending(), true, 'First release prematurely completed session restoration');
assert.equal(modeState.isHostOperationActive(), true, 'Idempotent release consumed another operation lease');
assert.equal(modeState.acquireHostOperation(['work', 'yolo']), null);
releaseLast();
assert.equal(await latestRestore, true);
assert.equal(modeState.getMode(), 'learn', 'Superseded restore won over the current session');
assert.equal(modeState.isHostOperationActive(), false);
assert.equal(modeState.isModeRestorePending(), false);

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
const stockMcp = await loadExtensions([path.join(extensionDir, "mcp.ts")], repoRoot);
assert.deepEqual(stockMcp.errors, []);
assert.equal(stockMcp.extensions[0].commands.has("mcp"), true, "Plain Pi lost its configured MCP package");
process.env.NEURA = "1";

console.log('PASS learn: migrated mode, provider, private-read, background, and stock Pi regressions');
