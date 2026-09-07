import { repoRoot, scratchRoot, assert, execFileSync, spawnSync, fs, path, pathToFileURL, isSafeExternalUrl, isPlanToolInputAllowed, files, state, widgets, context, guard, modes } from './harness.mjs';
await modes.commands.get("mode").handler("plan", context);
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
