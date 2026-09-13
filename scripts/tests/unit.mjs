import assert from "node:assert/strict";
import childProcess, { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { syncBuiltinESMExports } from 'node:module';
import { isolate } from './isolation.mjs';
const scratchRoot = isolate();
const repoRoot = path.resolve(import.meta.dirname, '../..');
const { mcpModuleSpecifier } = await import('../../agent/extensions/mcp.ts');
const {
  inspect,
  inspectMcpConfig,
  mergeMcpConfigs,
  parseRuntimeContract,
  piRuntimeStatus,
  probeHttpMcp,
  probeLocalProvider,
  probeStdioMcp,
  requiredHealthState,
  runtimeIdentity,
} = await import('../../agent/extensions/harness-health.ts');
const { redactSensitiveText } = await import('../../agent/neura/redaction.ts');
const runtimeContract = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "runtime-contract.json"), "utf-8"));
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const { selectSuites, suites } = await import('../test-suites.mjs');
assert.deepEqual(selectSuites(['agent/neura/verification.ts']),['integration','learn','proof']);
assert.deepEqual(selectSuites(['agent/extensions/check-gate.ts']),['integration','learn','proof']);
assert.deepEqual(selectSuites(['agent/neura/approval-store.ts']),['approval-storage','approvals']);
assert.deepEqual(selectSuites(['new/unknown-code.ts']),Object.keys(suites),'unknown impact skipped tests');
assert.deepEqual(selectSuites(['docs/DEVELOPMENT.md']),[]);
assert.deepEqual(selectSuites(['agent/neura/headmaster-policy.md']),Object.keys(suites),'runtime policy Markdown skipped tests');
assert.deepEqual(selectSuites(['scripts/tests/proof.mjs']),['proof']);
for (const name of ['learn', 'learn-materials', 'learn-workshop', 'learn-storage', 'learn-end-to-end']) {
  assert.equal(suites[name], `scripts/tests/${name}.mjs`, `${name} omitted from full verification`);
  assert.deepEqual(selectSuites([`scripts/tests/${name}.mjs`]), [name], `${name} direct change skipped`);
}
const { pinnedPi } = await import('./pinned-pi.mjs');
const syntheticRoot=path.join(scratchRoot,'pinned');
fs.mkdirSync(path.join(syntheticRoot,'agent/neura'),{recursive:true});
fs.writeFileSync(path.join(syntheticRoot,'package.json'),JSON.stringify(packageManifest));
fs.writeFileSync(path.join(syntheticRoot,'agent/neura/runtime-contract.json'),JSON.stringify(runtimeContract));
assert.throws(()=>pinnedPi(syntheticRoot),/ENOENT/,'missing local Pi fell back to ambient global');
fs.mkdirSync(path.join(syntheticRoot,'node_modules/@earendil-works/pi-coding-agent'),{recursive:true});
fs.writeFileSync(path.join(syntheticRoot,'node_modules/@earendil-works/pi-coding-agent/package.json'),'{"version":"0.0.0"}');
assert.throws(()=>pinnedPi(syntheticRoot),/run npm ci/,'wrong local Pi version accepted');
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
assert.equal(runtimeContract.neuraVersion, packageManifest.version, "runtime contract Neura version drifted from package version");
const identity = runtimeIdentity(JSON.stringify(runtimeContract), "C:/source/agent", "C:/live/agent");
assert.equal(identity.version, packageManifest.version, "health identity omitted Neura version");
assert.match(identity.manifestHash, /^[0-9a-f]{12}$/, "health identity omitted bounded manifest hash");
assert.match(identity.install, /^source:[0-9a-f]{12}$/, "health identity omitted source install identity");
assert.equal(requiredHealthState([
  { name: "core", required: true, state: "ready" },
  { name: "optional", required: false, state: "unhealthy" },
]), "ready", "optional failure falsely degraded core readiness");
assert.equal(requiredHealthState([
  { name: "core", required: true, state: "missing" },
]), "degraded", "missing required capability falsely reported ready");
assert.equal(requiredHealthState([
  { name: "core", required: true, state: "unhealthy" },
]), "unhealthy", "unhealthy required capability lost its state");

// Exercise the real inventory with synthetic files and no ambient processes/network.
const originalExecFile = childProcess.execFile;
const originalFetch = globalThis.fetch;
const checkpointPath = path.join(process.env.PI_CODING_AGENT_DIR, 'extensions/checkpoint.ts');
fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
childProcess.execFile = (_file, _args, _options, callback) => callback(null, '', '');
syncBuiltinESMExports();
globalThis.fetch = async () => new Response('{}');
try {
  for (const present of [false, true]) {
    if (present) fs.writeFileSync(checkpointPath, '// synthetic checkpoint');
    const report = await inspect(scratchRoot);
    const checkpoint = report.capabilities.find((item) => item.name === 'checkpoint');
    assert.ok(checkpoint?.required, 'checkpoint omitted from required readiness');
    assert.equal(checkpoint.state, present ? 'ready' : 'missing');
    assert.equal(checkpoint.action, present ? null : 'sync checkpoint extension');
    assert.match(report.workflow, present ? /checkpoint ready/ : /checkpoint missing/);
    assert.match(report.context, /^persona /, 'checkpoint shifted context capability grouping');
    assert.equal(requiredHealthState(report.capabilities.map((item) =>
      item.name === 'checkpoint' ? item : { ...item, state: 'ready' })),
    present ? 'ready' : 'degraded', 'checkpoint loss did not block otherwise-ready inventory');
  }
} finally {
  childProcess.execFile = originalExecFile;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  fs.rmSync(checkpointPath, { force: true });
}

const disabledMcp = await inspectMcpConfig({ mcpServers: { example: { disabled: true } } });
assert.equal(disabledMcp.state, "disabled", "disabled MCP was reported missing or unhealthy");
const missingMcp = await inspectMcpConfig({});
assert.equal(missingMcp.state, "missing", "missing MCP configuration was not distinguished");
assert.deepEqual(
  mergeMcpConfigs(
    { mcpServers: { shared: { url: "https://global.test/mcp" }, global: { disabled: true } } },
    { mcpServers: { shared: { disabled: true }, project: { disabled: true } } },
  ).mcpServers,
  { shared: { disabled: true }, global: { disabled: true }, project: { disabled: true } },
  "project MCP configuration did not override and extend global configuration",
);
let projectProbeCalled = false;
const projectMcp = await inspectMcpConfig(
  { mcpServers: { project: { url: "https://attacker.test/mcp", headers: { authorization: "$" + "{HEALTH_TEST_TOKEN}" } } } },
  async () => { projectProbeCalled = true; return new Response("{}"); },
  undefined,
  new Set(["project"]),
);
assert.equal(projectMcp.state, "degraded", "untrusted project MCP was not reported as unprobeable");
assert.equal(projectProbeCalled, false, "untrusted project MCP reached the network");
const leakedActionMcp = await inspectMcpConfig({ mcpServers: { "Authorization: Bearer remediation-secret": {} } });
assert.doesNotMatch(leakedActionMcp.action, /remediation-secret/, "MCP server name leaked through remediation output");

process.env.MY_PI_MCP_ENV_ALLOWLIST = "HEALTH_TEST_TOKEN";
process.env.HEALTH_TEST_TOKEN = "synthetic-health-secret";
let observedHeader;
const readyMcp = await probeHttpMcp("fixture", {
  url: "https://example.test/mcp",
  headers: { authorization: "$" + "{HEALTH_TEST_TOKEN}", "x-access-key": "$" + "{HEALTH_TEST_TOKEN}" },
}, async (_url, options) => {
  observedHeader = options.headers.authorization;
  assert.equal(options.headers['x-access-key'], 'synthetic-health-secret', 'allowlisted custom credential not supplied');
  assert.equal(options.headers.Accept, 'application/json, text/event-stream');
  assert.equal(options.headers['Content-Type'], 'application/json');
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fixture", version: "1" } },
  }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(readyMcp.state, "ready", "valid HTTP MCP initialize failed");
assert.equal(observedHeader, "synthetic-health-secret", "allowlisted MCP credential was not supplied to probe");
for (const name of ['authorization', 'x-access-key', 'x-master-key', 'x-auth', 'X-Custom-Credential', 'Accept']) {
  let called = false;
  const result = await probeHttpMcp('fixture', {
    url: 'https://example.test/mcp', headers: { [name]: 'synthetic-literal-secret' },
  }, async () => { called = true; return new Response('{}'); });
  assert.equal(result.problem?.code, 'configuration', name + ' accepted a literal value');
  assert.equal(called, false, name + ' literal value reached the network');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-literal-secret/);
}
for (const placeholder of ['HEALTH_UNLISTED_TOKEN', 'HEALTH_MISSING_TOKEN']) {
  process.env.HEALTH_UNLISTED_TOKEN = 'synthetic-unlisted-secret';
  process.env.MY_PI_MCP_ENV_ALLOWLIST = 'HEALTH_TEST_TOKEN,HEALTH_MISSING_TOKEN';
  let called = false;
  const result = await probeHttpMcp('fixture', {
    url: 'https://example.test/mcp', headers: { 'x-auth': '$' + '{' + placeholder + '}' },
  }, async () => { called = true; return new Response('{}'); });
  assert.equal(result.problem?.code, 'authentication');
  assert.equal(called, false, 'unavailable or unapproved credential reached the network');
}
delete process.env.HEALTH_UNLISTED_TOKEN;
process.env.MY_PI_MCP_ENV_ALLOWLIST = 'HEALTH_TEST_TOKEN';
const rejectedMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => new Response("", { status: 401 }));
assert.equal(rejectedMcp.problem.code, "authentication", "MCP authentication failure was misclassified");
const timedOutHttpMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => { throw new DOMException("timed out", "TimeoutError"); });
assert.equal(timedOutHttpMcp.problem.code, "timeout", "HTTP MCP DOMException timeout was misclassified");
const cancelledHttp = new AbortController();
cancelledHttp.abort();
const cancelledHttpMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => { throw new DOMException("aborted", "AbortError"); }, cancelledHttp.signal);
assert.equal(cancelledHttpMcp.problem.code, "cancelled", "HTTP MCP cancellation was misclassified");
const incompatibleMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "unknown", capabilities: {}, serverInfo: { name: "fixture", version: "1" } },
  }), { status: 200 }));
assert.equal(incompatibleMcp.problem.code, "schema", "invalid MCP protocol version was accepted");
const missingServerInfoMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "2025-11-25", capabilities: {} },
  }), { status: 200 }));
assert.equal(missingServerInfoMcp.problem.code, "schema", "MCP response without server identity was accepted");
const wrongEnvelopeMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => new Response(JSON.stringify({
    jsonrpc: "1.0",
    id: 2,
    result: { protocolVersion: "2025-11-25", capabilities: {} },
  }), { status: 200 }));
assert.equal(wrongEnvelopeMcp.problem.code, "schema", "invalid MCP JSON-RPC envelope was accepted");
const oversizedMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => new Response("{}", { status: 200, headers: { "content-length": "70000" } }));
assert.equal(oversizedMcp.problem.code, "response-limit", "oversized MCP response was accepted");
let unsafeUrlCalled = false;
const unsafeUrlMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp?token=stored" },
  async () => { unsafeUrlCalled = true; return new Response("{}"); });
assert.equal(unsafeUrlMcp.problem.code, "configuration", "credential-bearing MCP URL was accepted");
assert.equal(unsafeUrlCalled, false, "unsafe MCP URL reached the network");
const redactedMcp = await probeHttpMcp("fixture", { url: "https://example.test/mcp" },
  async () => { throw new Error("Authorization: Bearer synthetic-health-secret"); });
assert.doesNotMatch(redactedMcp.problem.message, /synthetic-health-secret/, "MCP error leaked credential material");

const stdioScript = "process.stdin.once('data',()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:process.env.HEALTH_TEST_TOKEN||'2025-11-25',capabilities:{},serverInfo:{name:'fixture',version:'1'}}})+'\\n'))";
const readyStdio = await probeStdioMcp("fixture", { command: process.execPath, args: ["-e", stdioScript] });
assert.equal(readyStdio.state, "ready", "valid stdio MCP initialize failed");
assert.doesNotMatch(readyStdio.detail, /synthetic-health-secret/, "stdio MCP probe received an unrelated provider credential");
const timedOutStdio = await probeStdioMcp(
  "fixture",
  { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
  undefined,
  50,
);
assert.equal(timedOutStdio.problem.code, "timeout", "stalled MCP probe did not time out");
const cancelled = new AbortController();
cancelled.abort();
const cancelledStdio = await probeStdioMcp("fixture", { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] }, cancelled.signal);
assert.equal(cancelledStdio.problem.code, "cancelled", "cancelled MCP probe was not terminated");

const readyProvider = await probeLocalProvider(async () => new Response(JSON.stringify({ data: [{ id: "qwen3-coder-30b-a3b" }] }), { status: 200 }));
assert.equal(readyProvider.state, "ready", "compatible local provider failed health");
const timedOutProvider = await probeLocalProvider(async () => { throw new DOMException("timed out", "TimeoutError"); });
assert.equal(timedOutProvider.problem.code, "timeout", "provider DOMException timeout was misclassified");
const cancelledProviderSignal = new AbortController();
cancelledProviderSignal.abort();
const cancelledProvider = await probeLocalProvider(async () => { throw new DOMException("aborted", "AbortError"); }, cancelledProviderSignal.signal);
assert.equal(cancelledProvider.problem.code, "cancelled", "provider cancellation was misclassified");
for (const data of [[], [{ id: "wrong-model" }]]) {
  const unavailableProvider = await probeLocalProvider(async () => new Response(JSON.stringify({ data }), { status: 200 }));
  assert.equal(unavailableProvider.state, "unhealthy", "missing required local model falsely reported ready");
}
const invalidProvider = await probeLocalProvider(async () => new Response("{}", { status: 200 }));
assert.equal(invalidProvider.problem.code, "schema", "provider schema mismatch was accepted");
delete process.env.HEALTH_TEST_TOKEN;
delete process.env.MY_PI_MCP_ENV_ALLOWLIST;
const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "settings.json"), "utf-8"));
const syntheticAgentDir = path.join(scratchRoot, "agent");
const installedMcpPath = path.join(syntheticAgentDir, "npm", "node_modules", "@spences10", "pi-mcp", "dist", "index.js");
assert.equal(mcpModuleSpecifier(syntheticAgentDir, () => false), "@spences10/pi-mcp", "development MCP fallback changed");
assert.equal(mcpModuleSpecifier(syntheticAgentDir, () => true), pathToFileURL(installedMcpPath).href, "installed MCP path changed");
assert.ok(settings.skills.includes("!skills/**"), "auto-discovered duplicate skill exclusion missing");
const packageSources = settings.packages.map((entry) => typeof entry === "string" ? entry : entry.source);
const mcpPackage = settings.packages.find((entry) => typeof entry === "object" && entry.source === "npm:@spences10/pi-mcp@0.0.58");
assert.deepEqual(mcpPackage?.extensions, [], "pi-mcp upstream extension autoload was not disabled");
assert.ok(packageSources.every((entry) => /^npm:(?:@[^/]+\/[^@]+|[^@]+)@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(entry)), "runtime package is not exactly pinned");

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


console.log('PASS unit');
