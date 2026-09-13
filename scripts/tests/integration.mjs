import { repoRoot, assert, fs, os, path, spawnSync, loaded, extensionWithCommand, firstHandler, notices, ui, context, modeState, guardrail, guard } from './harness.mjs';
const mcpConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "mcp.json"), "utf-8"));
assert.equal(mcpConfig.mcpServers.gmail.headers["x-api-key"], "${COMPOSIO_API_KEY}", "Gmail MCP header lost its environment placeholder");
const launcher = fs.readFileSync(path.join(repoRoot, "launcher", "neura.cmd"), "utf-8");
assert.match(launcher, /\$names='COMPOSIO_API_KEY','MY_PI_MCP_ENV_ALLOWLIST'/, "launcher does not refresh both user-scoped MCP values");
assert.match(launcher, /GetEnvironmentVariable\(\$name,'User'\)/, "launcher does not refresh values from the user environment");
assert.equal(launcher.match(/powershell\s+-NoProfile/g)?.length, 1, "launcher starts more than one environment-refresh process");
assert.match(launcher, /if defined COMPOSIO_API_KEY if defined MY_PI_MCP_ENV_ALLOWLIST goto environment_ready/, "launcher does not skip refresh when inherited values exist");
assert.match(launcher, /MY_PI_MCP_ENV_ALLOWLIST=COMPOSIO_API_KEY,/, "launcher does not allowlist the Composio key for pi-mcp");
assert.match(launcher, /if defined NEURA_TERMINAL_PROFILE goto terminal_ready/, "launcher does not recognize the image-backed profile");
assert.match(launcher, /wt -w new nt -p Neura/, "launcher does not route ordinary shells into the Neura profile");
assert.match(launcher, /where pi >nul 2>&1[\s\S]+Neura requires Pi\./, "launcher does not clearly report missing Pi");
assert.doesNotMatch(`${JSON.stringify(mcpConfig)}\n${launcher}`, /\b(?:ak|sk)_[A-Za-z0-9_-]{12,}\b/, "Gmail MCP configuration contains a literal credential");

if (process.platform === "win32") {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "neura-launcher-"));
  const calls = path.join(bin, "refresh-calls.txt");
  const resultFile = path.join(bin, "result.txt");
  const env = { ...process.env, PATH: `${bin};${process.env.SystemRoot}\\System32`, LAUNCHER_CALLS: calls, LAUNCHER_RESULT: resultFile };
  delete env.Path;
  fs.writeFileSync(path.join(bin, "powershell.cmd"), [
    "@echo off",
    ">>\"%LAUNCHER_CALLS%\" echo refresh",
    "if not defined COMPOSIO_API_KEY echo COMPOSIO_API_KEY=user-key",
    "if not defined MY_PI_MCP_ENV_ALLOWLIST echo MY_PI_MCP_ENV_ALLOWLIST=BASE_TOKEN",
  ].join("\r\n"));
  fs.writeFileSync(path.join(bin, "pi.cmd"), [
    "@echo off",
    ">\"%LAUNCHER_RESULT%\" echo %COMPOSIO_API_KEY%^|%MY_PI_MCP_ENV_ALLOWLIST%^|%NEURA%",
    "exit /b 7",
  ].join("\r\n"));
  try {
    let run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env: { ...env, COMPOSIO_API_KEY: "inherited-key" }, encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 7, "launcher did not preserve Pi's exit code");
    assert.equal(fs.readFileSync(calls, "utf8").trim(), "refresh", "launcher did not perform exactly one cold refresh");
    assert.equal(fs.readFileSync(resultFile, "utf8").trim(), "inherited-key|COMPOSIO_API_KEY,BASE_TOKEN|1", "launcher overwrote inherited values or lost refreshed configuration");
    assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /inherited-key|user-key|BASE_TOKEN/, "launcher printed an environment value");

    fs.rmSync(calls);
    run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env: { ...env, COMPOSIO_API_KEY: "inherited-key", MY_PI_MCP_ENV_ALLOWLIST: "BASE_TOKEN" }, encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 7, "warm launcher did not preserve Pi's exit code");
    assert.equal(fs.existsSync(calls), false, "launcher refreshed despite complete inherited configuration");

    run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env: { ...env, PATH: `${process.env.SystemRoot}\\System32`, COMPOSIO_API_KEY: "inherited-key", MY_PI_MCP_ENV_ALLOWLIST: "BASE_TOKEN" },
      encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 1, "launcher did not fail when Pi was unavailable");
    assert.match(run.stderr, /Neura requires Pi\./, "launcher did not explain that Pi was unavailable");

    fs.rmSync(resultFile, { force: true });
    const terminalCalls = path.join(bin, "terminal-calls.txt");
    fs.writeFileSync(path.join(bin, "wt.cmd"), [
      "@echo off",
      ">\"%LAUNCHER_CALLS%\" echo %*",
      "exit /b 0",
    ].join("\r\n"));
    run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd"), "--print"], {
      env: { ...env, LAUNCHER_CALLS: terminalCalls, COMPOSIO_API_KEY: "inherited-key", MY_PI_MCP_ENV_ALLOWLIST: "BASE_TOKEN" },
      encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 0, "launcher did not hand off to Windows Terminal");
    assert.match(fs.readFileSync(terminalCalls, "utf8"), /-w new nt -p Neura[\s\S]*neura\.cmd[\s\S]*--print/i, "terminal handoff lost the profile, launcher, or arguments");
    assert.equal(fs.existsSync(resultFile), false, "outer launcher started Pi before terminal handoff");

    fs.rmSync(terminalCalls);
    run = spawnSync(process.env.ComSpec, ["/d", "/c", path.join(repoRoot, "launcher", "neura.cmd")], {
      env: { ...env, LAUNCHER_CALLS: terminalCalls, NEURA_TERMINAL_PROFILE: "1", COMPOSIO_API_KEY: "inherited-key", MY_PI_MCP_ENV_ALLOWLIST: "BASE_TOKEN" },
      encoding: "utf8", windowsHide: true,
    });
    assert.equal(run.status, 7, "Neura profile did not start Pi directly");
    assert.equal(fs.existsSync(terminalCalls), false, "Neura profile recursively relaunched Windows Terminal");
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


console.log('PASS integration');
