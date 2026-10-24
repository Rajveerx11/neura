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
assert.match(launcher, /node "%NEURA_AGENT_DIR%\\neura\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli\.js" --no-mcp --tui-mode regular %\*/, "Neura launcher did not select its owned regular unbundled CLI");
assert.match(launcher, /node "%NEURA_AGENT_DIR%\\neura\\runtime-install\.mjs" launch-check %\*\r?\nif not errorlevel 0 exit \/b 1\r?\nif errorlevel 3 exit \/b 1\r?\nif errorlevel 2 goto update_extensions\r?\nif errorlevel 1 exit \/b 1/, "launcher lost complete preflight and signed-exit refusal");
assert.doesNotMatch(launcher, /call node.*%\*/i, "launcher reparses prompt arguments through CALL");
assert.doesNotMatch(launcher, /where pi|--quick|dist[\\/]bundle|^pi /m, "launcher retained global/bundled fallback or quick-only preflight");

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
  const agent = path.join(bin, "agent");
  const runtime = path.join(agent, "neura");
  const cli = path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  const env = { ...process.env, PATH: bin + ";" + process.env.SystemRoot + "\\System32", PI_CODING_AGENT_DIR: agent, LAUNCHER_RESULT: resultFile, NEURA_TEST_PREFLIGHT: preflightCalls };
  delete env.Path;
  // Exercise an executable Node, not a batch shim that replaces its caller without CALL.
  fs.copyFileSync(process.execPath, path.join(bin, "node.exe"));
  fs.writeFileSync(path.join(runtime, "runtime-install.mjs"), `
    import fs from 'node:fs';
    fs.appendFileSync(process.env.NEURA_TEST_PREFLIGHT, process.argv[2] + '\\n');
    process.exitCode = process.env.NEURA_TEST_PREFLIGHT_FAIL ? 1 : 0;
  `);
  fs.writeFileSync(cli, `
    const fs = require('node:fs');
    fs.writeFileSync(process.env.LAUNCHER_RESULT, process.env.NEURA);
    fs.writeFileSync(process.env.LAUNCHER_RESULT + '.args', process.argv.slice(2).join(' '));
    process.exitCode = 7;
  `);
  fs.writeFileSync(path.join(bin, "pi.cmd"), '@echo off\r\nexit /b 99\r\n');
  try {
    let run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env, encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 7, "launcher did not preserve Pi's exit code");
    assert.equal(fs.readFileSync(preflightCalls, "utf8").trim(), "launch-check", "launcher skipped release preflight");
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
    assert.equal(run.status, 7, "launcher still requires an ambient/global Pi");
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
const gmailReads = [
  'GMAIL_GET_PROFILE', 'GMAIL_GET_MESSAGE', 'GMAIL_GET_THREAD', 'GMAIL_GET_DRAFT',
  'GMAIL_GET_LABEL', 'GMAIL_GET_FILTER', 'GMAIL_GET_SEND_AS', 'GMAIL_GET_IMAP_SETTINGS',
  'GMAIL_GET_POP_SETTINGS', 'GMAIL_GET_VACATION_SETTINGS', 'GMAIL_GET_AUTO_FORWARDING',
  'GMAIL_GET_FORWARDING_ADDRESS', 'GMAIL_LIST_MESSAGES', 'GMAIL_LIST_THREADS', 'GMAIL_LIST_DRAFTS',
  'GMAIL_LIST_LABELS', 'GMAIL_LIST_FILTERS', 'GMAIL_LIST_SEND_AS', 'GMAIL_LIST_FORWARDING_ADDRESSES',
  'GMAIL_SEARCH_EMAILS', 'GMAIL_SEARCH_MESSAGES', 'GMAIL_FETCH_EMAILS', 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
];
assert.equal(gmailReads.length, 23);
for (const mode of ['work', 'human-away']) {
  modeState.setMode(mode);
  for (const action of gmailReads.flatMap(name => [name, name.toLowerCase()])) {
    assert.equal(await gmailGuard({ toolName: `mcp__gmail__${action}`, input: {} }, deniedGmailContext), undefined,
      `${mode} prompted for known Gmail read ${action}`);
    assert.equal(await gmailGuard({ toolName: `mcp__gmail__${action}`, input: {} }, { ...context, hasUI: false }), undefined,
      `${mode} blocked headless known Gmail read ${action}`);
  }
}
assert.equal(gmailPrompts, 0);
for (const mode of ['plan', 'learn']) {
  modeState.setMode(mode);
  for (const action of [...gmailReads, 'GMAIL_SEND_EMAIL', 'GMAIL_GET_FUTURE_UNCLASSIFIED']) {
    assert.equal((await gmailGuard({ toolName: `mcp__gmail__${action}`, input: {} }, deniedGmailContext))?.block, true,
      `${mode} allowed Gmail ${action}`);
  }
}
assert.equal(gmailPrompts, 0, 'unavailable modes requested Gmail approval');
modeState.setMode('human-away');
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: { recipient_email: "test@example.com", subject: "Test" } }, deniedGmailContext))?.block, true, "denied Gmail send was not blocked");
assert.equal(gmailPrompts, 1, "Gmail send did not request exactly one human confirmation");
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: {} }, { ...context, hasUI: false }))?.block, true, "headless Gmail send did not fail closed");
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_NEW_UNCLASSIFIED_ACTION", input: {} }, deniedGmailContext))?.block, true, "unknown Gmail action did not require confirmation");
assert.equal(gmailPrompts, 2, "unknown Gmail action did not request exactly one confirmation");
assert.equal((await gmailGuard({ toolName: "mcp__gmail__GMAIL_NEW_UNCLASSIFIED_ACTION", input: {} }, { ...context, hasUI: false }))?.block, true, "headless unknown Gmail action did not fail closed");
for (const mode of ['work', 'human-away']) {
  modeState.setMode(mode);
  for (const action of ['GMAIL_GET_FUTURE_UNCLASSIFIED', 'GMAIL_LIST_FUTURE_UNCLASSIFIED', 'GMAIL_SEND_EMAIL', 'GMAIL_DELETE_MESSAGE']) {
    const event = { toolName: `mcp__gmail__${action}`, input: {} };
    const before = gmailPrompts;
    assert.equal((await gmailGuard(event, deniedGmailContext))?.block, true);
    assert.equal(gmailPrompts, before + 1, `${mode} unknown/mutation did not confirm exactly once`);
    assert.equal((await gmailGuard(event, { ...context, hasUI: false }))?.block, true);
    let approvedPrompts = 0;
    assert.equal(await gmailGuard(event, { ...context, ui: { ...ui, confirm: async () => { approvedPrompts++; return true; } } }), undefined);
    assert.equal(approvedPrompts, 1);
  }
}
const promptsBeforeYolo = gmailPrompts;
modeState.setMode("yolo");
for (const action of [...gmailReads, 'GMAIL_GET_FUTURE_UNCLASSIFIED']) {
  assert.equal(await gmailGuard({ toolName: `mcp__gmail__${action}`, input: {} }, deniedGmailContext), undefined);
}
assert.equal(await gmailGuard({ toolName: "mcp__gmail__GMAIL_SEND_EMAIL", input: {} }, deniedGmailContext), undefined, "YOLO retained Gmail approval mediation");
assert.equal(await gmailGuard({ toolName: "mcp__gmail__GMAIL_DELETE_MESSAGE", input: {} }, { ...context, hasUI: false }), undefined, "headless YOLO blocked a Gmail mutation");
assert.equal(gmailPrompts, promptsBeforeYolo, "YOLO requested a Gmail confirmation");

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


const undici = spawnSync(process.execPath, [path.join(import.meta.dirname, 'undici.mjs')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
assert.equal(undici.status, 0, `npm Undici regression failed: ${undici.stdout}\n${undici.stderr}`);
console.log(undici.stdout.trim());
const piRuntime = spawnSync(process.execPath, [path.join(import.meta.dirname, 'pi-runtime.mjs')], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
assert.equal(piRuntime.status, 0, `Real Pi runtime regression failed: ${piRuntime.stdout}\n${piRuntime.stderr}`);
console.log(piRuntime.stdout.trim());
console.log('PASS integration');
