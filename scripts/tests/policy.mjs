import { repoRoot, scratchRoot, assert, execFileSync, spawnSync, fs, path, pathToFileURL, isSafeExternalUrl, isPlanToolInputAllowed, files, state, widgets, context, guard, modes, modeState, WORK_SANDBOX_TOOL } from './harness.mjs';
await modes.commands.get("mode").handler("plan", context);
const { inspectAction } = await import('../../agent/neura/action-policy.ts');
for (const file of ['action-contracts', 'action-paths', 'capabilities', 'mode-tools', 'plan-shell-parser', 'process']) {
  const target = path.join(repoRoot, 'agent', 'neura', `${file}.ts`);
  assert.equal(await guard({ toolName: 'read', input: { path: target } }, context), undefined, `Plan blocked read-only inspection of extracted ${file}`);
  const edit = inspectAction({ toolName: 'edit', input: { path: target } }, repoRoot);
  assert.equal(edit.route, 'human', `extraction removed protected-control boundary from ${file}`);
  assert.equal(edit.category, 'protected-control');
  assert.equal(edit.capability.approvalClass, 'exception-boundary');
  assert.equal(inspectAction({ toolName: 'read', input: { path: target } }, repoRoot, { protectControlReads: true }).route, 'human');
  assert.equal(inspectAction({ toolName: 'human_away_exec', input: { command: `sed -i s/a/b/ agent/neura/${file}.ts` } }, repoRoot).route, 'human');
}
for (const file of ['agent/extensions/mcp.ts', 'agent/neura/process-security.ts', 'agent/extensions/skill-doctor.ts', 'agent/neura/runtime-install.mjs', 'agent/neura/skills-registry.mjs', 'agent/neura/skills-manifest.json']) {
  const target = path.join(repoRoot, file);
  assert.equal(await guard({ toolName: 'read', input: { path: target } }, context), undefined, `Plan blocked read-only inspection of ${file}`);
  for (const toolName of ['edit', 'write']) {
    const action = inspectAction({ toolName, input: { path: target, content: 'task' } }, repoRoot);
    assert.equal(action.route, 'human', `${toolName} bypassed protected-control boundary for ${file}`);
    assert.equal(action.category, 'protected-control');
    assert.equal(action.capability.approvalClass, 'exception-boundary');
  }
  assert.equal(inspectAction({ toolName: 'read', input: { path: target } }, repoRoot).route, 'allow');
  assert.equal(inspectAction({ toolName: 'read', input: { path: target } }, repoRoot, { protectControlReads: true }).route, 'human');
  assert.equal(inspectAction({ toolName: 'human_away_exec', input: { command: `sed -i s/a/b/ ${file}` } }, repoRoot).route, 'human');
}
for (const file of ['ordinary-task-file.txt', 'agent/extensions/mcp-helper.ts', 'agent/neura/process-security-notes.ts', 'agent/extensions/skill-doctor-notes.ts', 'agent/neura/runtime-install-notes.mjs', 'agent/neura/skills-registry-notes.mjs', 'agent/neura/skills-manifest-example.json']) {
  for (const toolName of ['edit', 'write']) {
    const action = inspectAction({ toolName, input: { path: path.join(repoRoot, file), content: 'task' } }, repoRoot);
    assert.equal(action.route, 'allow', `control-path protection widened to ordinary ${toolName} ${file}`);
    assert.equal(action.capability.approvalClass, 'task-scoped');
  }
}
// Supported skill validation is control-plane code, not a routine task edit.
// Exercise real headless Work mediation without executing or writing anything.
await modes.commands.get('mode').handler('work', context);
assert.equal(modeState.getMode(), 'work');
const headlessWork = { ...context, hasUI: false, ui: undefined };
for (const file of ['agent/extensions/skill-doctor.ts', 'agent/neura/runtime-install.mjs', 'agent/neura/skills-registry.mjs', 'agent/neura/skills-manifest.json']) {
  for (const toolName of ['read', 'edit', 'write']) {
    const event = { toolName, input: { path: file, content: 'synthetic' } };
    assert.equal((await guard(event, headlessWork))?.block, true, `headless Work allowed ${toolName} of ${file}`);
  }
  const event = { toolName: WORK_SANDBOX_TOOL, input: { command: `sed -i s/a/b/ ${file}` } };
  const action = inspectAction(event, repoRoot);
  assert.equal(action.route, 'human', `sandbox command bypassed ${file} approval`);
  assert.equal(action.category, 'protected-control');
  assert.equal(action.capability.approvalClass, 'exception-boundary');
  assert.equal((await guard(event, headlessWork))?.block, true, `headless sandbox command bypassed ${file}`);
}
for (const file of ['ordinary-task-file.txt', 'agent/extensions/skill-doctor-notes.ts', 'agent/neura/runtime-install-notes.mjs', 'agent/neura/skills-registry-notes.mjs', 'agent/neura/skills-manifest-example.json']) {
  for (const toolName of ['edit', 'write']) {
    assert.equal(await guard({ toolName, input: { path: file, content: 'synthetic' } }, headlessWork), undefined,
      `headless Work unnecessarily blocked ordinary ${toolName} ${file}`);
  }
}
assert.equal(await guard({ toolName: WORK_SANDBOX_TOOL, input: { command: 'npm test' } }, headlessWork), undefined,
  'skill control protection widened to ordinary sandbox verification');
// Real Pi native tools, mediated by the actual headless Work hook. Fixtures only.
const nativeTools = {};
for (const name of ['read', 'edit', 'write']) {
  const module = await import(pathToFileURL(path.join(repoRoot, `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/${name}.js`)).href);
  nativeTools[name] = module[`create${name[0].toUpperCase()}${name.slice(1)}Tool`];
}
const streamWorkspace = path.join(scratchRoot, 'stream-workspace');
fs.mkdirSync(streamWorkspace, { recursive: true });
const streamContext = { ...headlessWork, cwd: streamWorkspace, model: undefined };
let confirmations = 0;
const approvingContext = { ...streamContext, hasUI: true, ui: { confirm: async () => { confirmations++; return true; } } };
const toolInput = (toolName, raw) => {
  const input = { path: raw };
  if (toolName === 'write') input.content = 'replacement';
  else if (toolName === 'edit') input.edits = [{ oldText: 'original', newText: 'replacement' }];
  return input;
};
const executeMediated = async (toolName, raw, ctx = streamContext) => {
  const input = toolInput(toolName, raw);
  const blocked = await guard({ toolName, input }, ctx);
  if (!blocked?.block) await nativeTools[toolName](streamWorkspace).execute('synthetic', input, undefined, undefined, ctx);
  return blocked;
};
for (const name of ['agent/neura/skills-registry.mjs', 'agent/neura/skills-manifest.json', 'agent/neura/runtime-install.mjs', 'agent/extensions/skill-doctor.ts']) {
  const target = path.join(streamWorkspace, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'original');
  const ordinaryForms = [target, target.toUpperCase(), `@${target}`, pathToFileURL(target).href];
  const streamForms = ['::$DATA', ':$DATA', ':named', ':named:$DATA'].flatMap(suffix => [target + suffix, `@${target}${suffix}`, pathToFileURL(target + suffix).href]);
  for (const toolName of ['read', 'edit', 'write']) {
    for (const raw of ordinaryForms) {
      assert.equal((await executeMediated(toolName, raw))?.block, true, `Work allowed control ${toolName}: ${raw}`);
    }
    for (const raw of streamForms) {
      const action = inspectAction({ toolName, input: toolInput(toolName, raw) }, streamWorkspace);
      assert.equal(action.route, 'deny', `stream remained approvable: ${raw}`);
      assert.equal(action.facts.target, undefined, 'unsupported namespace acquired a filesystem identity');
      assert.equal((await executeMediated(toolName, raw, approvingContext))?.block, true);
    }
    assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  }
}
const ordinaryTarget = path.join(streamWorkspace, 'ordinary-task.txt');
for (const raw of [ordinaryTarget, `@${ordinaryTarget}`, pathToFileURL(ordinaryTarget).href]) {
  fs.writeFileSync(ordinaryTarget, 'original');
  assert.equal(await executeMediated('read', raw), undefined);
  assert.equal(await executeMediated('edit', raw), undefined);
  assert.equal(fs.readFileSync(ordinaryTarget, 'utf8'), 'replacement');
  assert.equal(await executeMediated('write', raw), undefined);
}
// Ordinary protected paths can still be approved; unsupported aliases cannot.
const approvedControl = path.join(streamWorkspace, 'agent/neura/skills-registry.mjs');
assert.equal(await executeMediated('write', approvedControl, approvingContext), undefined);
assert.equal(confirmations, 1);
assert.equal(fs.readFileSync(approvedControl, 'utf8'), 'replacement');
fs.writeFileSync(approvedControl, 'original');
const ambiguousForms = [
  'C:relative.txt', '\\\\server\\share\\file.txt', '\\\\?\\C:\\file.txt', '\\\\.\\C:\\file.txt', '\\??\\C:\\file.txt',
  'file://server/share/file.txt', 'file:///C:/file.txt%3A%3A%24DATA', 'file:///C:/bad%00.txt',
  ...(process.platform === 'win32' ? ['\\rooted.txt', '/rooted.txt'] : []),
];
for (const raw of ambiguousForms) {
  for (const toolName of ['read', 'edit', 'write']) {
    assert.equal(inspectAction({ toolName, input: toolInput(toolName, raw) }, streamWorkspace).route, 'deny', raw);
    assert.equal((await executeMediated(toolName, raw, approvingContext))?.block, true, raw);
  }
}
assert.equal(confirmations, 1, 'unsupported namespace reached interactive approval');
// Trap the actual filesystem boundary, not just the displayed policy summary.
const { default: probeFs } = await import('node:fs');
const { syncBuiltinESMExports } = await import('node:module');
const ioMethods = ['statSync', 'lstatSync', 'realpathSync', 'openSync', 'readFileSync'];
const originals = new Map(ioMethods.map(name => [name, probeFs[name]]));
let unsupportedIO = 0;
let filesystemIO = 0;
try {
  for (const name of ioMethods) {
    probeFs[name] = (...args) => {
      filesystemIO++;
      if (String(args[0]).includes('unsupported-io')) { unsupportedIO++; throw Error('unsupported target reached filesystem'); }
      return originals.get(name)(...args);
    };
  }
  syncBuiltinESMExports();
  for (const raw of [path.join(streamWorkspace, 'unsupported-io.txt::$DATA'), '\\\\unsupported-io\\share\\file.txt', 'unsupported-io:named']) {
    for (const toolName of ['read', 'edit', 'write']) {
      const before = filesystemIO;
      assert.equal((await executeMediated(toolName, raw, approvingContext))?.block, true);
      assert.equal(filesystemIO, before, 'unsupported native path performed filesystem I/O before denial');
    }
    assert.equal(inspectAction({ toolName: WORK_SANDBOX_TOOL, input: { command: `npm test -- "${raw}"` } }, streamWorkspace).route, 'deny');
  }
  assert.equal(unsupportedIO, 0, 'unsupported path performed filesystem I/O before denial');
} finally {
  for (const [name, original] of originals) probeFs[name] = original;
  syncBuiltinESMExports();
}
const controlAlias = path.join(streamWorkspace, 'control-alias');
fs.symlinkSync(path.join(streamWorkspace, 'agent/neura'), controlAlias, process.platform === 'win32' ? 'junction' : 'dir');
for (const toolName of ['read', 'edit', 'write']) {
  assert.equal((await executeMediated(toolName, path.join(controlAlias, 'skills-registry.mjs')))?.block, true);
}
for (const toolName of [WORK_SANDBOX_TOOL, 'human_away_exec']) {
  for (const raw of [path.join(controlAlias, 'skills-registry.mjs'), pathToFileURL(path.join(controlAlias, 'skills-registry.mjs')).href]) {
    const event = { toolName, input: { command: `npm test -- "${raw}"` } };
    assert.equal(inspectAction(event, streamWorkspace).route, 'human', 'development allowlist bypassed canonical control alias');
    assert.equal((await guard(event, streamContext))?.block, true);
  }
  for (const raw of [ordinaryTarget + '::$DATA', ...ambiguousForms]) {
    assert.equal(inspectAction({ toolName, input: { command: `npm test -- "${raw}"` } }, streamWorkspace).route, 'deny', raw);
  }
  for (const command of [
    'npm test', `npm test -- "${ordinaryTarget}"`, 'npm test -- --registry=https://registry.npmjs.org', 'npm run build',
    'npm run test:unit', 'npm test:unit',
    'dotnet test /p:CollectCoverage=true', 'dotnet build /p:Configuration=Release',
    'dotnet test -p:CollectCoverage=true', 'dotnet build -p:Configuration=Release',
    'dotnet build /property:Configuration=Release', 'dotnet build -property:Configuration=Release',
    `dotnet build /p:OutputPath="${ordinaryTarget}"`,
  ]) {
    assert.equal(inspectAction({ toolName, input: { command } }, streamWorkspace).route, 'allow', command);
  }
  for (const raw of ['README:named', 'README:$DATA', 'README:named:$DATA', 'README::$DATA']) {
    for (const command of [`npm test -- ${raw}`, `npm test -- --output=${raw}`]) {
      assert.equal(inspectAction({ toolName, input: { command } }, streamWorkspace).route, 'deny', command);
    }
  }
  for (const command of [
    'dotnet test /p:OutputPath=README:named', 'dotnet test -p:OutputPath=README:named',
    'dotnet build /p:OutputPath=C:relative',
    'dotnet build /p:OutputPath="\\\\?\\C:\\hostile"',
    'dotnet build -p:OutputPath="file://server/share/hostile"',
    'dotnet build /p:OutputPath=ordinary.txt:named',
    'dotnet test /p:CollectCoverage=true -- README:named',
    'dotnet test -- /p:CollectCoverage=true',
    'npm test -- /p:CollectCoverage=true', 'npm test -- -p:CollectCoverage=true',
    'dotnet test /pp:CollectCoverage=true', 'dotnet build /p:=Release', 'dotnet build /p:OutputPath=',
  ]) {
    assert.equal(inspectAction({ toolName, input: { command } }, streamWorkspace).route, 'deny', command);
  }
  for (const command of ['npm test -- README:named', 'npm test -- --output=README:named']) {
    const before = confirmations;
    assert.equal((await guard({ toolName, input: { command } }, approvingContext))?.block, true);
    assert.equal(confirmations, before, 'extensionless stream reached approval');
  }
  assert.equal(inspectAction({ toolName, input: { command: `dotnet build /p:OutputPath="${path.join(controlAlias, 'skills-registry.mjs')}"` } }, streamWorkspace).route,
    'human', 'MSBuild property syntax exempted a canonical control path');
  for (const raw of [approvedControl, path.join(controlAlias, 'skills-registry.mjs'), ordinaryTarget + '::$DATA']) {
    const action = inspectAction({ toolName, input: { command: `rm -rf "${raw}"` } }, streamWorkspace);
    assert.equal(action.route, 'deny', 'protected-control matching weakened hard denial');
    assert.equal(action.category, 'broad-destruction');
  }
}
console.log('PASS native Pi read/edit/write Work mediation: streams/namespaces denied, controls approved only by ordinary identity, drive/alias/fileURL positives');
await modes.commands.get('mode').handler('plan', context);
const ordinaryPatch = inspectAction({ toolName: 'write', input: { path: path.join(repoRoot, 'ordinary-task-file.txt'), content: 'task' } }, repoRoot);
assert.equal(ordinaryPatch.route, 'allow', 'metadata mandated blanket approval for ordinary workspace effects');
assert.equal(ordinaryPatch.capability.approvalClass, 'task-scoped');
assert.equal(inspectAction({ toolName: 'bash', input: { command: 'rm -rf .' } }, repoRoot).route, 'deny', 'metadata relaxed deterministic denial');
const workGit = "git --no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false -c format.pretty=medium";
const planGit = workGit;
const hookProbeRoot = path.join(scratchRoot, "git-hook-probe");
const hookProbeMarker = path.join(hookProbeRoot, "hook-ran.txt");
fs.mkdirSync(hookProbeRoot, { recursive: true });
execFileSync("git", ["init", "--quiet"], { cwd: hookProbeRoot, windowsHide: true });
const hookProbePath = path.join(hookProbeRoot, ".git", "hooks", "pre-commit");
fs.writeFileSync(hookProbePath, `#!/bin/sh\nprintf hook-ran > "${hookProbeMarker.replaceAll("\\", "/")}"\n`, "utf-8");
fs.chmodSync(hookProbePath, 0o755);
assert.equal(spawnSync("git", ["hook", "run", "pre-commit"], { cwd: hookProbeRoot, windowsHide: true }).status, 0, "safe hook probe did not establish the hostile-repository baseline");
assert.equal(fs.existsSync(hookProbeMarker), true, "safe hook probe did not create its baseline marker");
fs.rmSync(hookProbeMarker);
const hardenedHookProbe = spawnSync("git", [
  "--no-pager", "--no-optional-locks", "--no-lazy-fetch",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "log.showSignature=false",
  "-c", "log.mailmap=false",
  "-c", "format.pretty=medium",
  "hook", "run", "pre-commit",
], { cwd: hookProbeRoot, windowsHide: true });
assert.notEqual(hardenedHookProbe.status, 0, "Git found a repository hook beneath the /dev/null no-op hook path");
assert.equal(fs.existsSync(hookProbeMarker), false, "Git executed a repository hook despite the hardened hook path");
assert.ok(widgets.has("neura-mode-transition"), "Plan transition animation missing");
assert.ok(state.activeTools.includes("publish_plan"), "Plan mode did not activate the bounded plan publisher");
assert.ok(state.activeTools.includes("plan_request"), "Plan mode did not activate the deterministic request lifecycle tool");
assert.ok(state.activeTools.includes("web_search"), "Plan mode did not activate bounded web search");
assert.equal(state.activeTools.includes("web_fetch"), false, "Plan mode activated web_fetch without enforceable DNS and redirect validation");
assert.equal(state.activeTools.includes("edit") || state.activeTools.includes("write"), false, "Plan mode retained generic mutation tools");
assert.equal(await guard({ toolName: "bash", input: { command: `${planGit} branch --show-current` } }, context), undefined);
assert.equal((await guard({ toolName: "bash", input: { command: "git status; Remove-Item file.txt" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "Get-Content env:OPENAI_API_KEY" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "rg --pre dangerous-helper pattern" } }, context))?.block, true);
assert.equal((await guard({ toolName: "bash", input: { command: "git diff --output=review.patch" } }, context))?.block, true);
assert.equal((await guard({ toolName: "edit", input: { path: path.join(repoRoot, "README.md") } }, context))?.block, true);
assert.equal(await guard({ toolName: "read", input: { path: path.join(repoRoot, "agent", "neura", "action-policy.ts") } }, context), undefined,
  "WORK protected-read policy changed Plan's read-only research boundary");

const planBoundaryWorkspace = path.join(scratchRoot, "plan-boundary-workspace");
const planBoundaryOutside = path.join(scratchRoot, "plan-boundary-outside");
const planBoundaryLink = path.join(planBoundaryWorkspace, "linked-outside");
const planBoundaryQuotedAtLink = path.join(planBoundaryWorkspace, "@quoted-link");
const planBoundaryUnaliasedSibling = path.join(planBoundaryWorkspace, "quoted-link");
const planBoundaryFile = path.join(planBoundaryWorkspace, "inside.txt");
const planBoundaryQuotedAtFile = path.join(planBoundaryWorkspace, "@inside.txt");
const planBoundaryOutsideFile = path.join(planBoundaryOutside, "outside.txt");
fs.mkdirSync(planBoundaryWorkspace, { recursive: true });
fs.mkdirSync(planBoundaryOutside, { recursive: true });
fs.mkdirSync(planBoundaryUnaliasedSibling, { recursive: true });
fs.writeFileSync(planBoundaryFile, "inside", "utf-8");
fs.writeFileSync(planBoundaryQuotedAtFile, "inside", "utf-8");
fs.writeFileSync(path.join(planBoundaryUnaliasedSibling, "outside.txt"), "safe sibling", "utf-8");
fs.writeFileSync(planBoundaryOutsideFile, "outside", "utf-8");
fs.symlinkSync(planBoundaryOutside, planBoundaryLink, process.platform === "win32" ? "junction" : "dir");
fs.symlinkSync(planBoundaryOutside, planBoundaryQuotedAtLink, process.platform === "win32" ? "junction" : "dir");
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

const planBoundaryOutsideRelative = path.join("..", path.basename(planBoundaryOutside), "outside.txt");
const planShellAllowed = [
  "pwd",
  "Get-Location",
  "Get-ChildItem .",
  "Get-Content .\\inside.txt",
  "Get-Content \"@inside.txt\"",
  "Get-Content \".\\inside,name.txt\"",
  "Get-Content \".\\@args\"",
  "Get-Content -TotalCount 1 -LiteralPath .\\inside.txt",
  `Get-Content "${planBoundaryFile}"`,
  `Get-Content "${pathToFileURL(planBoundaryFile).href}"`,
  "Get-Content .\\nested\\..\\inside.txt",
  "Select-String -SimpleMatch -Pattern inside -Path .\\inside.txt",
  "Resolve-Path .\\inside.txt",
  "Test-Path -Path .\\missing.txt -PathType Leaf",
  "Measure-Object",
  "rg inside .",
  "rg \"inside,outside\" .",
  "rg \"@args\" .",
  "rg --files ./",
  `${planGit} diff --no-ext-diff --no-textconv --cached -- inside.txt`,
  `${planGit} diff --no-ext-diff --no-textconv --cached --stat HEAD`,
  `${planGit} diff --no-ext-diff --no-textconv HEAD~1..HEAD --`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --oneline -- inside.txt`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --oneline HEAD~2..HEAD`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --oneline refs/heads/main`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD:inside.txt`,
  `${planGit} rev-parse --show-toplevel`,
  `${planGit} ls-files -- inside.txt`,
  `${planGit} ls-files --stage -- inside.txt`,
  `${planGit} branch --show-current`,
];
for (const command of planShellAllowed) {
  assert.equal(
    await guard({ toolName: "bash", input: { command } }, planBoundaryContext),
    undefined,
    `Plan blocked ordinary read-only shell command: ${command}`,
  );
}

const planShellDenied = [
  `Get-Content .\\${planBoundaryOutsideRelative}`,
  `Get-Content .\\nested\\..\\..\\${path.basename(planBoundaryOutside)}\\outside.txt`,
  `rg outside ${planBoundaryOutsideRelative.replaceAll("\\", "/")}`,
  `Get-Content "${planBoundaryOutsideFile}"`,
  `Get-Content "${pathToFileURL(planBoundaryOutsideFile).href}"`,
  `Get-Content "@${planBoundaryOutsideFile}"`,
  "Get-Content ~",
  "Get-Content .\\linked-outside\\outside.txt",
  "Get-Content .\\linked-outside\\missing.txt",
  "Get-Content \"@quoted-link\\outside.txt\"",
  "Get-Content \"@quoted-link\\missing.txt\"",
  "Select-String outside -Path .\\linked-outside\\outside.txt",
  "rg outside .\\linked-outside",
  "rg --follow outside .",
  `${planGit} diff --no-ext-diff --no-textconv HEAD~1..HEAD -- "${planBoundaryOutsideFile}"`,
  `${planGit} status "${planBoundaryOutside}"`,
  `${planGit} ls-files -- "${planBoundaryOutsideFile}"`,
  `${planGit} rev-parse --resolve-git-dir "${planBoundaryOutside}"`,
  "git status --short",
  "git diff --ext-diff",
  "git diff --textconv",
  "git --paginate log --oneline",
  "git -p log --oneline",
  "git -c core.fsmonitor=malicious-helper status",
  "git --no-pager --no-optional-locks -c core.fsmonitor=false status",
  "git -c diff.external=malicious-helper diff --ext-diff",
  "git -c diff.binary.textconv=malicious-helper show --textconv HEAD",
  "git -c core.pager=malicious-helper log --oneline",
  `${planGit} -c diff.external=malicious-helper diff --no-ext-diff --no-textconv`,
  `${planGit} --paginate status`,
  `${planGit} -c log.showSignature=true show --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} -c log.mailmap=true log --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} -c format.pretty=%G? log --no-ext-diff --no-textconv --no-use-mailmap HEAD`,
  `${planGit} -c core.hooksPath=.git/hooks status`,
  `${planGit} -c filter.hostile.process=malicious-helper ls-files --modified`,
  "git --exec-path=malicious-helper status",
  `${planGit} diff --no-textconv --ext-diff`,
  `${planGit} diff --no-ext-diff --textconv`,
  `${planGit} diff --no-ext-diff --no-textconv -O ..\\outside-order`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --show-signature`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap --format=%G?`,
  `${planGit} log --no-ext-diff --no-textconv HEAD`,
  `${planGit} log --no-ext-diff --no-textconv --use-mailmap HEAD`,
  `${planGit} rev-parse --parseopt`,
  `${planGit} status --short`,
  `${planGit} diff --no-ext-diff --no-textconv`,
  `${planGit} diff --no-ext-diff --no-textconv HEAD`,
  `${planGit} diff --no-ext-diff --no-textconv dead beef`,
  `${planGit} diff --no-ext-diff --no-textconv HEAD~1..HEAD`,
  `${planGit} diff --no-ext-diff --no-textconv dead..beef`,
  `${planGit} diff --no-ext-diff --no-textconv inside.txt`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap main`,
  `${planGit} log --no-ext-diff --no-textconv --no-use-mailmap ..\\outside`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD:../outside.txt`,
  `${planGit} show --no-ext-diff --no-textconv --no-use-mailmap HEAD:.env`,
  `${planGit} ls-files --modified`,
  `${planGit} ls-files --deleted`,
  `${planGit} ls-files --others`,
  `${planGit} ls-files --ignored`,
  `${planGit} ls-files --killed`,
  `${planGit} ls-files --eol`,
  `Get-Content "${path.join(repoRoot, "README.md")}"`,
  "Get-Content -Pa:C:/Windows/win.ini",
  "Get-Content -DefinitelyNotAParameter .\\inside.txt",
  "Get-Content -LiteralPath FileSystem::C:/Windows/win.ini",
  "Get-Content -LiteralPath Microsoft.PowerShell.Core\\FileSystem::C:/Windows/win.ini",
  "Get-Content -LiteralPath CustomProvider::outside",
  "Get-Content CustomDrive:\\outside",
  "Get-Content C:outside.txt",
  "Get-Content README.md,C:/Windows/win.ini",
  "Get-Content '..'+'/outside.txt'",
  "Get-Content .\\inside.txt & whoami",
  "Measure-Object -InputObject (& whoami)",
  "rg @args",
  "rg outside @paths",
  "git status @paths",
  `rg outside . ,${planBoundaryOutsideRelative}`,
  `git status inside.txt,${planBoundaryOutsideRelative}`,
  "rg outside CustomDrive:/outside",
  "git status CustomDrive:/outside",
];
for (const command of planShellDenied) {
  assert.equal(
    (await guard({ toolName: "bash", input: { command } }, planBoundaryContext))?.block,
    true,
    `Plan allowed unsafe shell command: ${command}`,
  );
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
assert.equal(await guard({ toolName: "plan_request", input: { action: "wait_for_input" } }, context), undefined);
assert.equal((await guard({ toolName: "plan_request", input: { action: "guess_from_text" } }, context))?.block, true, "Plan lifecycle accepted an unknown semantic transition");


console.log('PASS policy');
