import { repoRoot, assert, fs, path, spawnSync, loaded, extensionWithCommand, firstHandler, notices, ui, context, modeState, guardrail, guard } from './harness.mjs';
import { createMcpExtension, DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
const mcpConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "mcp.json"), "utf-8"));
assert.equal(mcpConfig.mcpServers.gmail.disabled, true, "Gmail MCP must remain disabled in public defaults");
assert.equal(mcpConfig.mcpServers.gmail.headers["x-api-key"], "${COMPOSIO_API_KEY}", "Gmail MCP header lost its environment placeholder");
assert.match(mcpConfig.mcpServers.gmail.url, /YOUR_COMPOSIO_TOOL_ROUTER/, "Gmail MCP retained a concrete provider-specific route");
assert.equal(mcpConfig.mcpServers.context7.url, "https://mcp.context7.com/mcp", "Context7 did not use its reviewed remote endpoint");
assert.equal(Object.values(mcpConfig.mcpServers).some((server) => "command" in server), false, "MCP config retained an automatically executable local command");
assert.doesNotMatch(JSON.stringify(mcpConfig), /\b(?:npx|uvx|latest)\b|[A-Z]:\\Users\\|tool_router\/trs_/i, "MCP config retained a floating, user-local, or concrete provider route");
const launcher = fs.readFileSync(path.join(repoRoot, "launcher", "neura.cmd"), "utf-8");
assert.doesNotMatch(launcher, /COMPOSIO_API_KEY|MY_PI_MCP_ENV_ALLOWLIST|powershell\s+-NoProfile/i, "public launcher should not import provider credentials by default");
assert.doesNotMatch(launcher, /\bwt(?:\.exe)?\b/i, "terminal launcher still opens a second Windows Terminal window");
assert.match(launcher, /pi --no-mcp --tui-mode regular %\*/, "Neura launcher allows unmediated native MCP startup or changed TUI mode");
assert.match(launcher, /where pi >nul 2>&1[\s\S]+Neura requires Pi\./, "launcher does not clearly report missing Pi");

// Exercise the real resource loader: Neura's guarded /mcp replaces Pi's eager
// built-in integration; plain Pi still retains its stock built-in extension.
const resourceCwd = fs.mkdtempSync(path.join(process.env.TEMP || process.cwd(), 'neura-resource-loader-'));
const savedNeura = process.env.NEURA;
try {
  for (const neura of [true, false]) {
    if (neura) process.env.NEURA = '1';
    else delete process.env.NEURA;
    const loader = new DefaultResourceLoader({
      cwd: resourceCwd, agentDir: process.env.PI_CODING_AGENT_DIR,
      settingsManager: SettingsManager.inMemory({ packages: [], extensions: [] }),
      additionalExtensionPaths: [path.join(repoRoot, 'agent/extensions/mcp.ts')],
      extensionFactories: [{ name: 'mcp', builtin: true, replaceable: true, factory: createMcpExtension() }],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const extensions = loader.getExtensions();
    assert.deepEqual(extensions.errors, [], 'resource loader reported extension errors');
    const wrapper = extensions.extensions.find(extension => extension.resolvedPath === path.join(repoRoot, 'agent/extensions/mcp.ts'));
    assert.ok(wrapper, 'the same installed MCP wrapper was not loaded in both modes');
    if (!neura) {
      assert.equal(wrapper.commands.size, 0, 'plain Pi registered a Neura MCP command');
      assert.equal(wrapper.handlers.size, 0, 'plain Pi registered Neura MCP lifecycle hooks');
    }
    assert.equal(extensions.extensions.some(extension => extension.path === 'builtin:mcp'), !neura, 'built-in MCP replacement changed');
    const owners = extensions.extensions.filter(extension => extension.commands.has('mcp'));
    assert.equal(owners.length, 1, 'multiple MCP implementations survived resource loading');
    if (neura) assert.equal(owners[0].resolvedPath, path.join(repoRoot, 'agent/extensions/mcp.ts'), 'guarded MCP wrapper was not selected');
  }
} finally {
  if (savedNeura === undefined) delete process.env.NEURA;
  else process.env.NEURA = savedNeura;
  fs.rmSync(resourceCwd, { recursive: true, force: true });
}
assert.doesNotMatch(JSON.stringify(mcpConfig) + "\n" + launcher, /\b(?:ak|sk)_[A-Za-z0-9_-]{12,}\b/, "Gmail MCP configuration contains a literal credential");

if (process.platform === "win32") {
  const bin = fs.mkdtempSync(path.join(process.env.TEMP || process.cwd(), "neura-launcher-"));
  const resultFile = path.join(bin, "result.txt");
  const preflightCalls = path.join(bin, "preflight-calls.txt");
  const env = { ...process.env, PATH: bin + ";" + process.env.SystemRoot + "\\System32", LAUNCHER_RESULT: resultFile, NEURA_TEST_PREFLIGHT: preflightCalls };
  delete env.Path;
  fs.writeFileSync(path.join(bin, "node.cmd"), [
    "@echo off",
    ">>\"%NEURA_TEST_PREFLIGHT%\" echo check",
    "if defined NEURA_TEST_PREFLIGHT_FAIL exit /b 1",
    "exit /b 0",
  ].join("\r\n"));
  fs.writeFileSync(path.join(bin, "pi.cmd"), [
    "@echo off",
    ">\"%LAUNCHER_RESULT%\" echo %NEURA%",
    ">\"%LAUNCHER_RESULT%.args\" echo %*",
    "exit /b 7",
  ].join("\r\n"));
  try {
    let run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env, encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 7, "launcher did not preserve Pi's exit code");
    assert.equal(fs.readFileSync(preflightCalls, "utf8").trim(), "check", "launcher skipped release preflight");
    assert.equal(fs.readFileSync(resultFile, "utf8").trim(), "1", "launcher did not enforce Neura's native MCP startup barrier");
    assert.equal(fs.readFileSync(`${resultFile}.args`, "utf8").trim(), "--no-mcp --tui-mode regular");
    run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd"), "-e", "builtin:mcp", "--approve"], {
      env, encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 7);
    assert.equal(fs.readFileSync(`${resultFile}.args`, "utf8").trim(), "--no-mcp --tui-mode regular -e builtin:mcp --approve", "user args displaced native MCP disable");

    fs.rmSync(resultFile);
    run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env: { ...env, NEURA_TEST_PREFLIGHT_FAIL: "1" }, encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 1, "launcher ignored failed release preflight");
    assert.equal(fs.existsSync(resultFile), false, "launcher started Pi after failed preflight");
    fs.rmSync(path.join(bin, "pi.cmd"));
    run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env, encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 1, "launcher did not fail when Pi was unavailable");
    assert.match(run.stderr, /Neura requires Pi\./, "launcher did not explain that Pi was unavailable");
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

const gmailGuardrail = loaded.extensions.find((extension) => extension.resolvedPath.endsWith(`${path.sep}gmail-guardrail.ts`));
assert.ok(gmailGuardrail, "Gmail guardrail extension missing");
const gmailGuard = firstHandler(gmailGuardrail, "tool_call");

assert.deepEqual(modeState.MODES, ["plan", "work", "yolo", "human-away", "learn"], "WORK and Learn mode positions changed");
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


const piRuntime = spawnSync(process.execPath, [path.join(import.meta.dirname, 'pi-runtime.mjs')], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
assert.equal(piRuntime.status, 0, `Real Pi runtime regression failed: ${piRuntime.stdout}\n${piRuntime.stderr}`);
console.log(piRuntime.stdout.trim());
console.log('PASS integration');
