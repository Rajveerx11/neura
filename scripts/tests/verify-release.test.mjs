import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyRelease } from "../verify-release.mjs";

const requiredSafety = `
Channel: prerelease

This release is experimental and not production-ready.
Human Away remains preview-only and is not approved for unattended high-impact work.
No npm package is published by this release.
`;

function fixture({ version = "3.0.0-rc.1", packageVersion = version, status = "Neura is not production-ready.", notes = requiredSafety } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neura-release-"));
  fs.mkdirSync(path.join(root, "agent/neura"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/releases"), { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), `${version}\n`);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: packageVersion, private: true }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ version: packageVersion, packages: { "": { version: packageVersion } } }));
  fs.writeFileSync(path.join(root, "agent/neura/package.json"), JSON.stringify({ version: "1.0.0", private: true }));
  fs.writeFileSync(path.join(root, "agent/neura/package-lock.json"), JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" } } }));
  fs.writeFileSync(path.join(root, "docs/STATUS.md"), status);
  fs.writeFileSync(path.join(root, `docs/releases/v${version}.md`), `# Neura v${version}\n${notes}`);
  return root;
}

function run(name, callback) {
  const roots = [];
  try {
    callback((options) => {
      const root = fixture(options);
      roots.push(root);
      return root;
    });
    console.log(`ok - ${name}`);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

run("accepts a correctly documented release candidate", (make) => {
  const root = make();
  assert.deepEqual(verifyRelease({ repoRoot: root, tag: "v3.0.0-rc.1" }), {
    version: "3.0.0-rc.1",
    prerelease: true,
    notesRelative: "docs/releases/v3.0.0-rc.1.md",
  });
});

run("rejects package version mismatch", (make) => {
  const root = make({ packageVersion: "3.0.0-rc.2" });
  assert.throws(() => verifyRelease({ repoRoot: root, tag: "v3.0.0-rc.1" }), /package\.json version does not match VERSION/);
});

run("blocks stable releases without an explicit stable-ready marker", (make) => {
  const root = make({ version: "3.0.0", status: "Production readiness blockers remain.", notes: "Channel: stable\n" });
  assert.throws(() => verifyRelease({ repoRoot: root, tag: "v3.0.0" }), /Release channel: stable-ready/);
});

run("blocks stable releases while status is not production-ready", (make) => {
  const root = make({ version: "3.0.0", status: "Release channel: stable-ready\nNeura is not production-ready.", notes: "Channel: stable\n" });
  assert.throws(() => verifyRelease({ repoRoot: root, tag: "v3.0.0" }), /stable releases are blocked/);
});

run("accepts stable only with an explicit clean marker", (make) => {
  const root = make({ version: "3.0.0", status: "Release channel: stable-ready\nAll stable gates passed.", notes: "Channel: stable\n" });
  assert.equal(verifyRelease({ repoRoot: root, tag: "v3.0.0" }).prerelease, false);
});

run("rejects invalid semantic versions with leading zeroes", (make) => {
  const root = make({ version: "01.0.0-rc.1" });
  assert.throws(() => verifyRelease({ repoRoot: root, tag: "v01.0.0-rc.1" }), /semantic version|invalid VERSION/);
  assert.throws(() => verifyRelease({ repoRoot: root, tag: "v1.0.0-01" }), /semantic version/);
});

run("rejects an RC missing required safety text", (make) => {
  const root = make({ notes: "Channel: prerelease\n\nThis release is experimental and not production-ready.\n" });
  assert.throws(() => verifyRelease({ repoRoot: root, tag: "v3.0.0-rc.1" }), /missing required safety text/);
});

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const releaseWorkflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
const verifyWorkflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/verify.yml"), "utf8");
const pinnedGitStep = (workflow) => workflow.match(/^      - name: Provision pinned Git runtime\r?\n        shell: pwsh\r?\n        run: \|\r?\n((?:          .+\r?\n)+)/m)?.[1]?.trim();
const gitProvision = pinnedGitStep(verifyWorkflow);
assert.ok(gitProvision, "CI omits pinned Git provisioning");
assert.equal(pinnedGitStep(releaseWorkflow), gitProvision, "release and CI Git provisioning diverged");
assert.match(gitProvision, /windowsArchiveSha256/, "Git archive is not hash-verified");
assert.ok(gitProvision.indexOf("Get-FileHash") < gitProvision.indexOf("Start-Process"), "Git archive executes before hash verification");
assert.match(verifyWorkflow, /if \[ "\$EVENT_NAME" = pull_request \]; then\s+test "\$DEPENDENCY_RESULT" = success\s+else\s+test "\$DEPENDENCY_RESULT" = skipped\s+fi/, "dependency review can be skipped on pull requests");
assert.match(verifyWorkflow, /\$requiredPi\s*=.*runtime-contract\.json.*\.piVersion/, "CI Pi version is not read from the pinned contract");
const packageManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
assert.equal(packageManifest.scripts["audit:all"], "npm run audit:dependencies && npm run audit:signatures");
for (const workflow of [verifyWorkflow, releaseWorkflow]) {
  assert.match(workflow, /name: Audit dependency vulnerabilities and registry signatures\r?\n        run: npm run audit:all\r?\n/, "audit failure can be overwritten by a later native command");
}
run("audits stop on dependency and signature failures and accept success", (make) => {
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  assert.ok(fs.existsSync(npmCli), "run this test with npm run test:release");
  for (const [dependencyExit, signatureExit] of [[0, 0], [17, 0], [0, 23]]) {
    const root = make();
    const marker = path.join(root, "signatures-ran");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: {
      "audit:all": packageManifest.scripts["audit:all"],
      "audit:dependencies": `node -e "process.exit(${dependencyExit})"`,
      "audit:signatures": `node -e "require('node:fs').writeFileSync('signatures-ran','ok');process.exit(${signatureExit})"`,
    } }));
    for (const name of ["user.npmrc", "global.npmrc"]) fs.writeFileSync(path.join(root, name), "");
    const result = spawnSync(process.execPath, [npmCli, "run", "audit:all", "--silent"], {
      cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true,
      env: { ...process.env, npm_config_userconfig: path.join(root, "user.npmrc"),
        npm_config_globalconfig: path.join(root, "global.npmrc"), npm_config_cache: path.join(root, "cache"),
        npm_config_offline: "true", npm_config_update_notifier: "false" },
    });
    assert.equal(result.status, dependencyExit || signatureExit, `audit result was masked: ${result.stderr}`);
    assert.equal(fs.existsSync(marker), dependencyExit === 0, "signature audit ran after dependency failure");
  }
});

// Extract actual workflow commands, rather than testing a parallel implementation.
function stepRun(workflow, name) {
  workflow = workflow.replace(/\r\n/g, "\n");
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split(/^      - /m)[0];
  assert.ok(step, `missing workflow step: ${name}`);
  const block = step.match(/        run: \|\r?\n((?:          [^\r\n]*(?:\r?\n|$))+)/);
  return block ? block[1].replace(/^          /gm, "").trim()
    : step.match(/        run: (.+)/)?.[1];
}
const releaseCommands = [
  ["Install locked development dependencies", "npm ci --ignore-scripts"],
  ["Install locked learning document runtime", "npm ci --prefix agent/neura --ignore-scripts"],
  ["Verify release policy", 'npm run verify:release -- --tag "$env:TAG"'],
  ["Audit dependency vulnerabilities and registry signatures", "npm run audit:all"],
  ["Verify repository", "npm run verify"],
];
for (const [name, command] of releaseCommands) assert.equal(stepRun(releaseWorkflow, name), command);

if (process.platform === "win32") {
  run("Windows workflow native failures cannot be masked by later success", (make) => {
    const shell = path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const guardedSteps = [
      [releaseWorkflow, "Verify annotated tag on main", "git", 4],
      [releaseWorkflow, "Verify complete history secret scan", "powershell", 2],
      [releaseWorkflow, "Verify installer on ephemeral runner", "powershell", 2],
      [verifyWorkflow, "Verify Windows installer and live drift check", "powershell", 2],
      ...releaseCommands.map(([name]) => [releaseWorkflow, name, "npm", 1]),
    ];
    for (const [workflow, name, native, count] of guardedSteps) {
      for (const failedCall of [0, ...Array.from({ length: count }, (_, i) => i + 1)]) {
        const root = make();
        fs.writeFileSync(path.join(root, "mock.cjs"), `
          const fs = require('node:fs');
          const calls = fs.existsSync('calls') ? Number(fs.readFileSync('calls', 'utf8')) + 1 : 1;
          fs.writeFileSync('calls', String(calls));
          console.log(calls === 2 ? 'tag' : 'fixture-head');
          process.exit(calls === Number(process.env.FAILED_CALL) ? 37 : 0);
        `);
        const mock = path.join(root, "native-fixture.cmd");
        fs.writeFileSync(mock, `@echo off\r\n"${process.execPath}" "${path.join(root, "mock.cjs")}"\r\nexit /b %errorlevel%\r\n`);
        const body = stepRun(workflow, name).replace(new RegExp(`\\b${native} `, "g"), `& '${mock}' `);
        const script = path.join(root, "step.ps1");
        fs.writeFileSync(script, `$ErrorActionPreference = 'Stop'\n${body}\nif (Test-Path variable:LASTEXITCODE) { exit $LASTEXITCODE }\n`);
        const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-File", script], {
          cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true,
          env: { ...process.env, TAG: "v3.0.0-rc.1", GITHUB_SHA: "fixture-head", FAILED_CALL: String(failedCall) },
        });
        const expectedExit = !failedCall ? 0 : native === "git" && failedCall === count ? 1 : 37;
        assert.equal(result.status, expectedExit, `${name}: native failure was masked: ${result.stderr}`);
        assert.equal(Number(fs.readFileSync(path.join(root, "calls"), "utf8")), failedCall || count,
          `${name}: a later native command ran after failure`);
      }
    }
  });
} else {
  console.log("skip - Windows native workflow execution (requires Windows PowerShell)");
}
assert.ok(releaseWorkflow.includes('name: release-assets-${{ github.run_attempt }}'), "artifact name is not scoped to the attempt");
assert.ok(releaseWorkflow.includes('actions/runs/${{ github.run_id }}/artifacts?per_page=100'), "release can select an artifact from another workflow run");
assert.ok(releaseWorkflow.includes('select(.expired == false and (.name | test("^release-assets-[0-9]+$")))'), "release can select unrelated or expired artifacts");
assert.ok(releaseWorkflow.includes('sort_by(.created_at) | last | .id // empty'), "release-only retries cannot reuse the last successful package artifact");
assert.match(releaseWorkflow, /permissions:\s*\n\s+actions: read\s*\n\s+contents: write/, "release job lacks isolated write permission");
assert.match(releaseWorkflow, /gh release create[\s\S]*?--draft[\s\S]*?--prerelease/, "release workflow can create a non-draft or stable release");
assert.doesNotMatch(releaseWorkflow, /npm\s+(?:publish|access|dist-tag)/, "release workflow can mutate npm packages");
console.log("ok - workflows fail closed on skipped PR reviews, share pinned Git provenance, and isolate release attempts");
