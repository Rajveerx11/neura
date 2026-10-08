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
const { default: herdrUsageBridge, herdrMetadata, usageProvider } = await import('../../agent/extensions/herdr-usage-provider.ts');
const { automaticGitEnvironment, resolveExecutable, scopedProcessEnvironment } = await import('../../agent/neura/process-security.ts');
const { runProcess } = await import('../../agent/neura/core.ts');
const { execute } = await import('../../agent/neura/verification.ts');
await import('./process-contract.mjs');
// Characterize the two public adapters before extracting shared process mechanics.
const outputScript = 'process.stdout.write("  out\\n"); process.stderr.write("  err\\n")';
const trimmedProcess = await runProcess(process.execPath, ['-e', outputScript]);
assert.deepEqual(trimmedProcess, { ok: true, stdout: 'out', stderr: 'err' });
const rawProcess = await execute(process.execPath, ['-e', outputScript], { cwd: repoRoot, timeoutMs: 5000 });
assert.deepEqual(rawProcess, { ok: true, completed: true, stdout: '  out\n' });
const failedProcess = await execute(process.execPath, ['-e', 'process.stdout.write("verdict\\n"); process.exit(7)'], { cwd: repoRoot, timeoutMs: 5000 });
assert.deepEqual(failedProcess, { ok: false, completed: true, stdout: 'verdict\n' });
const missingProcess = await execute(path.join(scratchRoot, 'missing-executable'), [], { cwd: repoRoot, timeoutMs: 5000 });
assert.deepEqual(missingProcess, { ok: false, completed: false, stdout: '' });
const { executeProcess } = await import('../../agent/neura/process.ts');
const processOptions = { cwd: repoRoot, timeoutMs: 5000, maxBuffer: 1024 * 1024 };
const rawOutcome = await executeProcess(process.execPath, ['-e', outputScript], processOptions);
assert.equal(rawOutcome.termination, 'exited');
assert.equal(rawOutcome.exitCode, 0);
assert.equal(rawOutcome.completed, true);
assert.equal(rawOutcome.stdout, '  out\n');
assert.equal(rawOutcome.stderr, '  err\n');
assert.equal(rawOutcome.cancelled || rawOutcome.timedOut, false);
assert.ok(rawOutcome.durationMs >= 0 && rawOutcome.durationMs < 5000);
const nonzeroOutcome = await executeProcess(process.execPath, ['-e', 'process.exit(7)'], processOptions);
assert.equal(nonzeroOutcome.termination, 'exited');
assert.equal(nonzeroOutcome.exitCode, 7);
assert.equal(nonzeroOutcome.ok, false);
assert.equal(nonzeroOutcome.completed, true);
const spawnOutcome = await executeProcess(path.join(scratchRoot, 'missing-executable'), [], processOptions);
assert.equal(spawnOutcome.termination, 'spawn-failed');
assert.equal(spawnOutcome.exitCode, null);
assert.equal(spawnOutcome.completed, false);
assert.equal(spawnOutcome.errorCode, 'ENOENT');
const directoryOutcome = await executeProcess(scratchRoot, [], processOptions);
assert.equal(directoryOutcome.termination, 'spawn-failed');
assert.equal(directoryOutcome.completed, false);
await assert.rejects(executeProcess('', [], processOptions), /file/);
const timeoutOutcome = await executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...processOptions, timeoutMs: 100 });
assert.equal(timeoutOutcome.termination, 'timed-out');
assert.equal(timeoutOutcome.timedOut, true);
assert.equal(timeoutOutcome.cancelled, false);
assert.equal(timeoutOutcome.completed, false);
assert.ok(timeoutOutcome.durationMs >= 75 && timeoutOutcome.durationMs < 5000);
const abortController = new AbortController();
const abortPromise = executeProcess(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'], { ...processOptions, signal: abortController.signal });
setTimeout(() => abortController.abort(), 200);
const abortOutcome = await abortPromise;
assert.equal(abortOutcome.termination, 'cancelled');
assert.equal(abortOutcome.cancelled, true);
assert.equal(abortOutcome.timedOut, false);
assert.equal(abortOutcome.completed, false);
assert.ok(abortOutcome.durationMs < 5000);
const preAbort = await executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...processOptions, signal: AbortSignal.abort() });
assert.equal(preAbort.termination, 'cancelled');
assert.equal(preAbort.completed, false);
const outputOutcome = await executeProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(8192))'], { ...processOptions, maxBuffer: 32 });
assert.equal(outputOutcome.termination, 'output-limit');
assert.equal(outputOutcome.completed, false);
assert.equal(outputOutcome.stdout.length, 32);
assert.equal(await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: AbortSignal.abort() }).then(result => result.ok), false);
const { describeCapability, SANDBOX_TIMEOUT, WORKSPACE_READ_TOOL_NAMES } = await import('../../agent/neura/capabilities.ts');
for (const toolName of [...WORKSPACE_READ_TOOL_NAMES, 'edit', 'write', 'bash', 'work_exec', 'human_away_exec', 'publish_plan', 'plan_request', 'web_search', 'mcp__fixture__unknown', 'unknown']) {
  const capability = describeCapability(toolName);
  assert.deepEqual(Object.keys(capability).sort(), ['approvalClass', 'effects', 'network', 'reversibility', 'scope', 'secrets', 'timeout'].sort());
  assert.ok(capability.effects.length > 0);
}
assert.equal(describeCapability('work_exec').network, 'none');
assert.equal(describeCapability('human_away_exec').secrets, 'possible', 'workspace script indirection was mislabeled secret isolation');
assert.equal(describeCapability('human_away_exec').timeout, SANDBOX_TIMEOUT);
assert.equal(describeCapability('publish_plan').scope, 'plans');
assert.equal(describeCapability('write').approvalClass, 'task-scoped', 'ordinary effects became blanket per-tool approval');
assert.deepEqual(describeCapability('mcp__gmail__gmail_get_profile').effects, ['read']);
assert.equal(describeCapability('mcp__gmail__GMAIL_NEW_UNCLASSIFIED_ACTION').approvalClass, 'exception-boundary');
assert.equal(describeCapability('mcp__fixture__unknown').scope, 'external');
assert.equal(describeCapability('unknown').approvalClass, 'unclassified');
for (const toolName of ['learn_lesson', 'learn_material', 'learn_exercise']) {
  assert.deepEqual(describeCapability(toolName).effects, ['read', 'write', 'execute']);
}
assert.deepEqual(describeCapability('learn_progress').effects, ['read', 'write']);
assert.deepEqual(describeCapability('unknown').effects, ['unknown']);
const { filterRestrictedProviderPayload } = await import('../../agent/neura/mode-tools.ts');
const mixedProviderPayload = {
  tools: [{ name: 'Read' }, { function: { name: 'Bash' } }, { toolSpec: { name: 'mcp__fixture__unknown' } }],
  config: { tools: [{ functionDeclarations: [{ name: 'write' }, { name: 'read' }] }] },
  toolConfig: { tools: [{ name: 'human_away_exec' }] },
};
assert.deepEqual(filterRestrictedProviderPayload(mixedProviderPayload, ['read']), {
  tools: [{ name: 'Read' }], config: { tools: [{ functionDeclarations: [{ name: 'read' }] }] }, toolConfig: { tools: [] },
});
assert.equal(mixedProviderPayload.tools.length, 3, 'provider filter mutated the snapshot');
const { acquireHostOperation, getMode, setMode, restoreMode, isModeRestorePending, isHostOperationActive } = await import('../../agent/neura/mode-state.ts');
assert.equal(acquireHostOperation(), null, 'Work acquired a YOLO-only lease');
setMode('yolo');
const firstLease = acquireHostOperation();
const secondLease = acquireHostOperation();
assert.ok(firstLease && secondLease);
assert.throws(() => setMode('plan'), /host operation/);
const restorePromise = restoreMode('plan');
assert.equal(getMode(), 'work', 'restoration did not use restricted holding mode');
assert.equal(isModeRestorePending(), true);
assert.equal(acquireHostOperation(['work', 'yolo']), null, 'pending restoration acquired another lease');
firstLease();
firstLease();
assert.equal(isHostOperationActive(), true, 'double release drained another operation');
assert.equal(isModeRestorePending(), true);
secondLease();
assert.equal(await restorePromise, true);
assert.equal(getMode(), 'plan');
assert.equal(isModeRestorePending() || isHostOperationActive(), false);
setMode('work');
const runtimeContract = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "runtime-contract.json"), "utf-8"));
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const verifyWorkflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "verify.yml"), "utf-8");
const windowsGitContract = runtimeContract.automaticExecutables.git;
assert.match(windowsGitContract.windowsArchive, /^PortableGit-[\w.-]+\.7z\.exe$/, "pinned Git archive name is invalid");
assert.match(windowsGitContract.windowsArchiveUrl, /^https:\/\/github\.com\/git-for-windows\/git\/releases\/download\//, "pinned Git archive source is not the official release repository");
assert.match(windowsGitContract.windowsArchiveSha256, /^[a-f0-9]{64}$/, "pinned Git archive hash is invalid");
for (const field of ["windowsArchive", "windowsArchiveUrl", "windowsArchiveSha256"]) {
  assert.match(verifyWorkflow, new RegExp(`\\$git\\.${field}\\b`), `CI does not source ${field} from the runtime contract`);
}
const { selectSuites, suites } = await import('../test-suites.mjs');
process.env.NEURA_PROCESS_TEST_SECRET = "must-not-leak";
assert.equal(scopedProcessEnvironment().NEURA_PROCESS_TEST_SECRET, undefined, "automatic process inherited an unrelated secret");
assert.equal(automaticGitEnvironment().GIT_TERMINAL_PROMPT, "0", "automatic Git can prompt for credentials");
assert.equal(usageProvider("openai-codex"), "codex", "Pi's ChatGPT subscription provider was not mapped to Codex usage");
assert.equal(usageProvider("anthropic"), "claude", "Pi's Anthropic provider was not mapped to Claude usage");
assert.equal(usageProvider("openai"), undefined, "API-key OpenAI must not be claimed as a subscription usage provider");
assert.deepEqual(herdrMetadata("openai-codex"), { provider: "codex", mode: "WORK", phase: "READY" }, "Herdr sidebar metadata omitted Neura state");
const savedHerdr = process.env.HERDR_ENV;
const savedNeura = process.env.NEURA;
const bridgeEvents = [];
try {
  process.env.HERDR_ENV = "1";
  delete process.env.NEURA;
  herdrUsageBridge({ on: (name) => bridgeEvents.push(name) });
  assert.deepEqual(bridgeEvents, [], "plain Pi inside Herdr registered Neura usage callbacks");
  process.env.NEURA = "1";
  herdrUsageBridge({ on: (name) => bridgeEvents.push(name) });
  assert.deepEqual(bridgeEvents, ["session_start", "model_select", "session_shutdown"], "Neura in Herdr omitted usage callbacks");
} finally {
  if (savedHerdr === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = savedHerdr;
  if (savedNeura === undefined) delete process.env.NEURA; else process.env.NEURA = savedNeura;
}
delete process.env.NEURA_PROCESS_TEST_SECRET;
assert.deepEqual(selectSuites(['agent/neura/verification.ts']),['integration','learn','proof']);
assert.deepEqual(selectSuites(['agent/extensions/check-gate.ts']),['integration','learn','proof']);
assert.deepEqual(selectSuites(['agent/neura/approval-store.ts']),['approval-storage','approvals']);
assert.deepEqual(selectSuites(['new/unknown-code.ts']),Object.keys(suites),'unknown impact skipped tests');
assert.deepEqual(selectSuites(['docs/DEVELOPMENT.md']),[]);
assert.deepEqual(selectSuites(['agent/neura/headmaster-policy.md']),Object.keys(suites),'runtime policy Markdown skipped tests');
assert.deepEqual(selectSuites(['scripts/tests/proof.mjs']),['proof']);
for (const name of ['learn', 'learn-materials', 'learn-workshop', 'learn-storage', 'learn-vault', 'learn-end-to-end']) {
  assert.equal(suites[name], `scripts/tests/${name}.mjs`, `${name} omitted from full verification`);
  assert.deepEqual(selectSuites([`scripts/tests/${name}.mjs`]), [name], `${name} direct change skipped`);
}
const { pinnedPi } = await import('./pinned-pi.mjs');
const syntheticRoot=path.join(scratchRoot,'pinned');
fs.mkdirSync(path.join(syntheticRoot,'agent/neura'),{recursive:true});
fs.writeFileSync(path.join(syntheticRoot,'package.json'),JSON.stringify(packageManifest));
fs.writeFileSync(path.join(syntheticRoot,'agent/neura/runtime-contract.json'),JSON.stringify(runtimeContract));
const hostileGit = path.join(syntheticRoot, process.platform === 'win32' ? 'git.cmd' : 'git');
fs.writeFileSync(hostileGit, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const originalPath = process.env.PATH;
process.env.PATH = `${syntheticRoot}${path.delimiter}${originalPath ?? ''}`;
assert.notEqual(resolveExecutable('git', syntheticRoot), fs.realpathSync(hostileGit), "repository-controlled Git executable was selected");
process.env.PATH = originalPath;
if (process.platform === 'win32') {
  const trustedGit = resolveExecutable('git', syntheticRoot);
  assert.ok(trustedGit, 'pinned Git fixture unavailable');
  const alternateGit = path.join(path.dirname(path.dirname(trustedGit)), 'bin', 'git.exe');
  process.env.NEURA_GIT_EXECUTABLE = alternateGit;
  assert.equal(resolveExecutable('git', syntheticRoot), fs.realpathSync(alternateGit), 'verified Git override was ignored');

  const workspaceGit = path.join(syntheticRoot, 'trusted-copy', 'git.exe');
  fs.mkdirSync(path.dirname(workspaceGit));
  fs.copyFileSync(trustedGit, workspaceGit);
  process.env.NEURA_GIT_EXECUTABLE = workspaceGit;
  assert.notEqual(resolveExecutable('git', syntheticRoot), fs.realpathSync(workspaceGit), 'byte-identical workspace Git override was trusted');

  const trustedGitRoot = path.dirname(path.dirname(trustedGit));
  const alternateGitRelative = path.relative(trustedGitRoot, alternateGit);
  const workspaceJunction = path.join(syntheticRoot, 'outside-git-link');
  fs.symlinkSync(trustedGitRoot, workspaceJunction, 'junction');
  process.env.NEURA_GIT_EXECUTABLE = path.join(workspaceJunction, alternateGitRelative);
  assert.notEqual(resolveExecutable('git', syntheticRoot), fs.realpathSync(path.join(workspaceJunction, alternateGitRelative)), 'workspace junction bypassed lexical executable containment');

  const outsideJunction = path.join(scratchRoot, 'workspace-git-link');
  fs.symlinkSync(path.dirname(workspaceGit), outsideJunction, 'junction');
  process.env.NEURA_GIT_EXECUTABLE = path.join(outsideJunction, 'git.exe');
  assert.notEqual(resolveExecutable('git', syntheticRoot), fs.realpathSync(path.join(outsideJunction, 'git.exe')), 'outside junction bypassed canonical executable containment');

  process.env.NEURA_GIT_EXECUTABLE = hostileGit;
  assert.notEqual(resolveExecutable('git', syntheticRoot), fs.realpathSync(hostileGit), 'workspace Git override was trusted');
  delete process.env.NEURA_GIT_EXECUTABLE;
}
const workspaceMcp = await probeStdioMcp('workspace-fixture', { command: hostileGit, args: [] }, undefined, 100, syntheticRoot);
assert.equal(workspaceMcp.state, 'degraded', 'workspace-controlled absolute MCP executable was probed');
assert.match(workspaceMcp.problem?.message ?? '', /existing absolute executable/, 'workspace MCP rejection was not containment failure');
const outsideMcp = path.join(scratchRoot, 'outside-mcp');
fs.mkdirSync(outsideMcp);
fs.writeFileSync(path.join(outsideMcp, path.basename(hostileGit)), '', { mode: 0o755 });
const linkedMcp = path.join(syntheticRoot, 'linked-mcp');
fs.symlinkSync(outsideMcp, linkedMcp, process.platform === 'win32' ? 'junction' : 'dir');
const linkedWorkspaceMcp = await probeStdioMcp('linked-workspace-fixture', {
  command: path.join(linkedMcp, path.basename(hostileGit)), args: [],
}, undefined, 100, syntheticRoot);
assert.match(linkedWorkspaceMcp.problem?.message ?? '', /existing absolute executable/, 'workspace symlink path escaped MCP containment');
assert.throws(()=>pinnedPi(syntheticRoot),/ENOENT/,'missing local Pi fell back to ambient global');
const piPackages = ['pi-coding-agent', 'pi-tui', 'pi-ai'];
for (const name of piPackages) {
  const root = path.join(syntheticRoot, 'node_modules/@earendil-works', name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: runtimeContract.piVersion }));
}
const expectedPiPaths = {
  loaderPath: path.join(syntheticRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'),
  tuiPath: path.join(syntheticRoot, 'node_modules/@earendil-works/pi-tui/dist/index.js'),
};
assert.deepEqual(pinnedPi(syntheticRoot), expectedPiPaths, 'matching local Pi packages rejected or return API changed');
for (const name of piPackages) {
  const root = path.join(syntheticRoot, 'node_modules/@earendil-works', name);
  const manifestPath = path.join(root, 'package.json');
  fs.rmSync(manifestPath);
  assert.throws(() => pinnedPi(syntheticRoot), { code: 'ENOENT' }, `${name}: missing root package fell back to ambient Pi`);
  fs.writeFileSync(manifestPath, '{"version":"0.0.0"}');
  assert.throws(() => pinnedPi(syntheticRoot), {
    code: 'ERR_ASSERTION', message: new RegExp(`^${name}: run npm ci --ignore-scripts`),
  }, `${name}: wrong root package version accepted`);

  const driftedManifest = structuredClone(packageManifest);
  driftedManifest.devDependencies[`@earendil-works/${name}`] = '0.0.0';
  fs.writeFileSync(path.join(syntheticRoot, 'package.json'), JSON.stringify(driftedManifest));
  assert.throws(() => pinnedPi(syntheticRoot), {
    code: 'ERR_ASSERTION', message: new RegExp(`^${name}: runtime contract mismatch`),
  }, `${name}: package pin matching installed version bypassed runtime contract`);
  fs.writeFileSync(path.join(syntheticRoot, 'package.json'), JSON.stringify(packageManifest));
  fs.writeFileSync(manifestPath, JSON.stringify({ version: runtimeContract.piVersion }));

  const linkedRoot = path.join(scratchRoot, `${name}-linked`);
  fs.renameSync(root, linkedRoot);
  fs.symlinkSync(linkedRoot, root, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => pinnedPi(syntheticRoot), {
    code: 'ERR_ASSERTION', message: new RegExp(`^${name}: ambient package link refused`),
  }, `${name}: linked package with matching version accepted`);
  fs.rmSync(root);
  fs.renameSync(linkedRoot, root);
}
assert.deepEqual(pinnedPi(syntheticRoot), expectedPiPaths, 'restored local Pi fixtures rejected');
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
  action: "update Neura for installed Pi 9.9.9; do not downgrade Pi",
}, "Pi runtime drift was not actionable");
assert.match(piRuntimeStatus("0.99.2", runtimeContract.piVersion).action, /npm install -g .*@1\.0\.4$/, "older Pi did not get an upgrade action");
for (const version of ["1.0.5", "1.0.4-beta.1", "invalid"]) {
  assert.match(piRuntimeStatus(version, runtimeContract.piVersion).action, /update Neura.*do not downgrade Pi/, "mismatch recommended a Pi downgrade");
}
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
  const releaseDirectory = path.join(process.env.PI_CODING_AGENT_DIR, 'neura');
  fs.mkdirSync(releaseDirectory, { recursive: true });
  const releaseManifest = path.join(releaseDirectory, 'release-manifest.json');
  const releaseHelper = path.join(releaseDirectory, 'runtime-install.mjs');
  fs.writeFileSync(releaseManifest, '{}');
  fs.writeFileSync(releaseHelper, 'process.exit(0)');
  try {
    const cancelled = new AbortController();
    cancelled.abort();
    const report = await inspect(scratchRoot, cancelled.signal);
    assert.match(report.capabilities.find((item) => item.name === 'identity')?.detail ?? '', /release check cancelled/, 'cancelled health check was reported as release drift');
  } finally {
    fs.rmSync(releaseManifest, { force: true });
    fs.rmSync(releaseHelper, { force: true });
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
assert.equal(settings.skills.some((entry) => String(entry).startsWith("~")), false, "public defaults must not load personal skill directories");
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
