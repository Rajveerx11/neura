import { repoRoot, scratchRoot, assert, fs, path, HUMAN_AWAY_SANDBOX_TOOL, WORK_SANDBOX_TOOL, bubblewrapArguments, loaded, registeredToolNames, state, appendedEntries, firstHandler, widgets, ui, context, modeState, guard, modes, mcp, stripAnsi } from './harness.mjs';
// Mode spine: safe WORK startup, persisted transitions, exact tool boundaries, and Shift+Tab.

assert.ok(modes.commands.has("approvals"), "/approvals command missing");
assert.ok(modes.shortcuts.has("shift+tab"), "Shift+Tab mode shortcut missing");
let unexpectedStartupConfirmation = 0;
await firstHandler(modes, "session_start")({}, {
  ...context,
  ui: {
    ...ui,
    confirm: async () => { unexpectedStartupConfirmation++; return false; },
  },
});
assert.equal(unexpectedStartupConfirmation, 0, "fresh WORK startup requested approval");
assert.equal(modeState.getMode(), "work", "fresh session did not default to WORK");
assert.ok(state.activeTools.includes("read") && state.activeTools.includes("edit") && state.activeTools.includes(WORK_SANDBOX_TOOL),
  "WORK startup omitted structured workspace or sandbox tools");
assert.equal(state.activeTools.includes("publish_plan"), false, "WORK startup exposed the Plan publisher");
assert.equal(state.activeTools.includes("web_fetch"), false, "WORK startup exposed unrestricted network fetch");

assert.equal(loaded.extensions.filter((extension) => extension.commands.has("mcp")).length, 1, "MCP command registered more than once");
await firstHandler(mcp, "session_start")({}, context);
assert.equal(process.env.MY_PI_MCP_EAGER_CONNECT, "1", "MCP session startup did not restore eager-connect environment");
delete process.env.MY_PI_MCP_EAGER_CONNECT;
const mcpBeforeAgentStart = firstHandler(mcp, "before_agent_start");
const originalFetch = globalThis.fetch;
let mcpFetches = 0;
globalThis.fetch = () => {
  mcpFetches++;
  return new Promise(() => {});
};
for (const restricted of ["learn", "plan", "work", "human-away"]) {
  modeState.setMode(restricted);
  const completed = await Promise.race([
    Promise.resolve(mcpBeforeAgentStart({ systemPromptOptions: { selectedTools: ["read"] } }, context)).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  assert.equal(completed, true, `${restricted} awaited stalled MCP initialization`);
}
await mcp.commands.get("mcp").handler("connect fixture", context);
assert.equal(mcpFetches, 0, "restricted /mcp command started a connection");

modeState.setMode("yolo");
globalThis.fetch = async (_url, init) => {
  mcpFetches++;
  const request = JSON.parse(init.body);
  const result = request.method === "server/discover"
    ? { supportedVersions: ["2026-07-28"] }
    : request.method === "tools/list"
      ? { tools: [{ name: "ping", description: "fixture", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } }] }
      : {};
  return new Response(request.id === undefined ? null : JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
    status: request.id === undefined ? 204 : 200,
    headers: { "content-type": "application/json" },
  });
};
await mcp.commands.get("mcp").handler("connect fixture", context);
const fixtureTool = "mcp__fixture__ping";
assert.equal(mcp.tools.has(fixtureTool), true, "explicit YOLO connection did not discover its MCP tool");
assert.equal(state.activeTools.includes(fixtureTool), true, "explicit YOLO connection did not activate its MCP tool");
const fetchesAfterConnect = mcpFetches;
await mcpBeforeAgentStart({ systemPromptOptions: { selectedTools: [fixtureTool] } }, context);
assert.equal(mcpFetches, fetchesAfterConnect, "connected YOLO MCP tool reinitialized its server");
await firstHandler(mcp, "session_shutdown")({}, context);
await mcpBeforeAgentStart({ systemPromptOptions: { selectedTools: [fixtureTool] } }, context);
assert.ok(mcpFetches > fetchesAfterConnect, "selected YOLO MCP tool did not reconnect on demand");
modeState.setMode("work");
await firstHandler(modes, "before_agent_start")({ systemPrompt: "base" }, context);
assert.equal(state.activeTools.includes(fixtureTool), false, "late MCP tool leaked into restricted mode");
const restrictedMcpPayload = await firstHandler(modes, "before_provider_request")({ payload: {
  tools: [
    { type: "function", function: { name: "read", parameters: {} } },
    { type: "function", function: { name: fixtureTool, parameters: {} } },
  ],
} }, context);
assert.deepEqual(restrictedMcpPayload.tools.map((tool) => tool.function.name), ["read"],
  "late MCP tool leaked into restricted provider payload");
await firstHandler(mcp, "session_shutdown")({}, context);
globalThis.fetch = originalFetch;

const workProviderPayload = await firstHandler(modes, "before_provider_request")({ payload: {
  tools: [
    { type: "function", function: { name: "read", parameters: {} } },
    { type: "function", function: { name: "Edit", parameters: {} } },
    { type: "function", function: { name: WORK_SANDBOX_TOOL, parameters: {} } },
    { type: "function", function: { name: "mcp__unknown__mutate", parameters: {} } },
    { type: "unknown-provider-tool" },
  ],
} }, context);
assert.deepEqual(workProviderPayload.tools.map((tool) => tool.function.name), ["read", "Edit", WORK_SANDBOX_TOOL],
  "WORK provider payload exposed an unknown or inactive tool");
const googleWorkPayload = await firstHandler(modes, "before_provider_request")({ payload: {
  config: {
    tools: [{ functionDeclarations: [
      { name: "Read", parametersJsonSchema: {} },
      { name: "Edit", parametersJsonSchema: {} },
      { name: "mcp__unknown__mutate", parametersJsonSchema: {} },
      { description: "missing name" },
    ] }],
  },
} }, context);
assert.deepEqual(
  googleWorkPayload.config.tools[0].functionDeclarations.map((tool) => tool.name),
  ["Read", "Edit"],
  "WORK Google payload exposed an inactive or malformed function declaration",
);
const bedrockWorkPayload = await firstHandler(modes, "before_provider_request")({ payload: {
  toolConfig: { tools: [
    { toolSpec: { name: "read", inputSchema: { json: {} } } },
    { toolSpec: { name: "mcp__unknown__mutate", inputSchema: { json: {} } } },
    { unexpectedToolShape: {} },
  ] },
} }, context);
assert.deepEqual(
  bedrockWorkPayload.toolConfig.tools.map((tool) => tool.toolSpec.name),
  ["read"],
  "WORK Bedrock payload exposed an inactive or malformed tool specification",
);

const workWorkspace = path.join(scratchRoot, "work-boundary");
fs.mkdirSync(path.join(workWorkspace, "src"), { recursive: true });
fs.mkdirSync(path.join(workWorkspace, "agent", "neura"), { recursive: true });
const workSource = path.join(workWorkspace, "src", "feature.ts");
const workSecret = path.join(workWorkspace, ".env.production");
fs.writeFileSync(workSource, "export const ready = true;\n");
fs.writeFileSync(workSecret, "synthetic test fixture\n");
fs.writeFileSync(path.join(workWorkspace, "agent", "neura", "action-policy.ts"), "// protected\n");
fs.mkdirSync(path.join(workWorkspace, ".kube"), { recursive: true });
fs.writeFileSync(path.join(workWorkspace, ".kube", "config"), "synthetic: masked\n");
const benignCredentialAlias = path.join(workWorkspace, "safe-cloud-config");
fs.symlinkSync(path.join(workWorkspace, ".kube"), benignCredentialAlias, process.platform === "win32" ? "junction" : "dir");
const workContext = { ...context, cwd: workWorkspace };
assert.equal(await guard({ toolName: "read", input: { path: workSource } }, workContext), undefined,
  "WORK blocked a structured workspace read");
assert.equal(await guard({ toolName: "edit", input: { path: workSource } }, workContext), undefined,
  "WORK blocked a structured workspace patch");
const workGit = "git --no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false -c format.pretty=medium";
assert.equal(await guard({ toolName: "bash", input: { command: `${workGit} branch --show-current` } }, workContext), undefined,
  "WORK blocked hardened Git inspection");
assert.match(
  (await guard({ toolName: "bash", input: { command: "npm run typecheck" } }, workContext))?.reason ?? "",
  /through work_exec/,
  "WORK allowed a build or test to escape its OS sandbox",
);
for (const command of [
  "npm run typecheck",
  "npm run test:accessibility",
  "npm run verify:sandbox",
  "node scripts/verify-harness.mjs",
  "node scripts/check-docs.mjs",
  "git status --short",
]) {
  assert.equal(await guard({ toolName: WORK_SANDBOX_TOOL, input: { command } }, workContext), undefined,
    `WORK blocked a supported test, build, or inspection command inside its sandbox: ${command}`);
}

for (const relativeSecret of [
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".git-credentials",
  ".envrc",
  ".env::$DATA",
  ".aws/credentials",
  ".azure/accessTokens.json",
  ".config/gcloud/application_default_credentials.json",
  ".kube/config",
  ".docker/config.json",
]) {
  assert.equal((await guard(
    { toolName: "read", input: { path: path.join(workWorkspace, ...relativeSecret.split("/")) } },
    { ...workContext, hasUI: false },
  ))?.block, true, `WORK allowed credential path without approval: ${relativeSecret}`);
}
for (const toolName of ["read", "edit"]) {
  assert.equal((await guard(
    { toolName, input: { path: path.join(benignCredentialAlias, "config") } },
    { ...workContext, hasUI: false },
  ))?.block, true, `WORK ${toolName} followed a benign alias to a canonical credential path`);
}

let workApprovalPrompts = 0;
const deniedWorkContext = {
  ...workContext,
  ui: { ...ui, confirm: async () => { workApprovalPrompts++; return false; } },
};
assert.equal((await guard({ toolName: "read", input: { path: workSecret } }, deniedWorkContext))?.block, true,
  "WORK read a protected secret path without approval");
assert.equal((await guard({ toolName: "edit", input: { path: path.join(workWorkspace, "agent", "neura", "action-policy.ts") } }, deniedWorkContext))?.block, true,
  "WORK changed a protected control file without approval");
assert.equal((await guard({ toolName: "read", input: { path: path.join(workWorkspace, "agent", "neura", "action-policy.ts") } }, deniedWorkContext))?.block, true,
  "WORK read a protected control file without approval");
assert.equal((await guard({ toolName: "bash", input: { command: "git push origin main" } }, deniedWorkContext))?.block, true,
  "WORK performed remote mutation without approval");
assert.equal((await guard({ toolName: WORK_SANDBOX_TOOL, input: { command: "git commit -m generated" } }, deniedWorkContext))?.block, true,
  "WORK mutated Git history without approval");
assert.equal((await guard({ toolName: "unclassified_tool", input: {} }, deniedWorkContext))?.block, true,
  "WORK executed an unknown tool without approval");
assert.equal(workApprovalPrompts, 6, "WORK sensitive actions did not request one explicit confirmation each");
assert.equal((await guard({ toolName: "read", input: { path: workSecret } }, { ...workContext, hasUI: false }))?.block, true,
  "headless WORK did not fail closed on protected data");
const promptsBeforeDestruction = workApprovalPrompts;
assert.equal((await guard({ toolName: WORK_SANDBOX_TOOL, input: { command: "rm -rf ." } }, deniedWorkContext))?.block, true,
  "WORK allowed broad workspace destruction");
assert.equal(workApprovalPrompts, promptsBeforeDestruction, "WORK offered approval for policy-denied broad destruction");
let approvedWorkPrompt = 0;
assert.equal(await guard(
  { toolName: "read", input: { path: workSecret } },
  { ...workContext, ui: { ...ui, confirm: async () => { approvedWorkPrompt++; return true; } } },
), undefined, "WORK ignored explicit approval for one protected read");
assert.equal(approvedWorkPrompt, 1, "WORK protected read did not request exactly one approval");

let startupYoloConfirmation;
const persistedYoloContext = {
  ...context,
  sessionManager: { getEntries: () => [{ type: "custom", customType: "neura-mode-state", data: { mode: "yolo" } }], getBranch: () => [] },
  ui: {
    ...ui,
    confirm: async (title, body) => {
      startupYoloConfirmation = { title, body };
      return false;
    },
  },
};
await firstHandler(modes, "session_start")({}, persistedYoloContext);
assert.match(startupYoloConfirmation.title, /YOLO · unsandboxed full access/, "persisted YOLO startup lacks explicit confirmation");
assert.equal(modeState.getMode(), "work", "denied persisted YOLO startup did not fail closed to WORK");
assert.ok(state.activeTools.includes(WORK_SANDBOX_TOOL), "denied persisted YOLO startup did not apply WORK boundary");
await firstHandler(modes, "session_start")({}, { ...persistedYoloContext, ui });
assert.equal(modeState.getMode(), "yolo", "confirmed persisted YOLO startup did not activate YOLO");
assert.equal(state.activeTools.includes(WORK_SANDBOX_TOOL), false, "WORK-only executor remained active during YOLO startup");

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
assert.equal(yoloConfirmation, undefined, "Plan-to-WORK shortcut unexpectedly requested YOLO confirmation");
assert.equal(modeState.getMode(), "work", "Plan-to-WORK shortcut did not activate WORK");
assert.equal(appendedEntries.length, modeEntriesBeforeDeniedYolo + 1, "WORK shortcut did not persist its mode change");
assert.ok(state.activeTools.includes(WORK_SANDBOX_TOOL), "WORK shortcut omitted sandbox execution");
const entriesBeforeDeniedYolo = appendedEntries.length;
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
assert.equal(modeState.getMode(), "work", "denied YOLO shortcut changed the active mode");
assert.equal(appendedEntries.length, entriesBeforeDeniedYolo, "denied YOLO shortcut persisted a mode change");
assert.ok(state.activeTools.includes(WORK_SANDBOX_TOOL), "denied YOLO shortcut removed WORK boundary");
await modes.commands.get("mode").handler("yolo", { ...context, hasUI: false });
assert.equal(modeState.getMode(), "work", "headless YOLO activation bypassed interactive confirmation");
await modes.commands.get("mode").handler("yolo", context);
reducedTransition = widgets.get("neura-mode-transition")(null, null).render(92).map(stripAnsi).join("\n");
assert.match(reducedTransition, /YOLO/, "latest rapid mode switch did not own the transition");
assert.match(reducedTransition, /FULL ACCESS/, "YOLO transition does not expose full access");
assert.match(reducedTransition, /no sandbox · no approvals/, "YOLO transition does not expose disabled safety boundaries");
delete process.env.NEURA_REDUCED_MOTION;

await modes.commands.get("mode").handler("plan", context);

await modes.commands.get("mode").handler("yolo", context);
assert.equal(state.activeTools.includes("publish_plan"), false, "Plan publisher remained active outside Plan mode");
assert.equal(state.activeTools.includes("plan_request"), false, "Plan lifecycle tool remained active outside Plan mode");
assert.equal(state.activeTools.includes("web_fetch"), true, "Leaving Plan for YOLO did not restore web_fetch");

// Late MCP registration may refresh and activate tools after Plan has already
// applied its boundary. Preserve that live non-Plan selection while keeping the
// tool unavailable in Plan, and do not resurrect user-disabled tools on exit.
state.activeTools = state.activeTools.filter((name) => name !== "write");
await modes.commands.get("mode").handler("plan", context);
const lateMcpTool = "mcp__late__mutate";
const enabledMcpTool = "mcp__enabled__read";
registeredToolNames.push(lateMcpTool, enabledMcpTool);
state.activeTools = [...state.activeTools, lateMcpTool, enabledMcpTool];
await firstHandler(modes, "before_agent_start")({ systemPrompt: "base" }, context);
state.activeTools = [...state.activeTools, lateMcpTool, enabledMcpTool];
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
assert.equal(state.activeTools.includes(lateMcpTool), false, "Late MCP activation escaped the Plan tool boundary");
assert.equal(state.activeTools.includes(enabledMcpTool), false, "Second late MCP activation escaped the Plan tool boundary");
assert.equal(state.activeTools.includes("write"), false, "Plan re-enabled a user-disabled tool");
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
assert.equal(state.activeTools.includes(lateMcpTool), false, "Leaving Plan restored an MCP server disabled while hidden");
assert.equal(state.activeTools.includes(enabledMcpTool), true, "Leaving Plan lost an enabled late MCP activation");
assert.equal(state.activeTools.includes("write"), false, "Leaving Plan restored a stale tool selection");

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
assert.deepEqual(state.activeTools, [HUMAN_AWAY_SANDBOX_TOOL], "Human Away exposed tools outside its WSL2 sandbox boundary");
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

console.log('PASS state-machine');
