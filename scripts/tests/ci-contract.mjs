// Focused text contracts for our four workflows, not a general YAML validator.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = ['verify', 'release', 'runtime-compatibility', 'codeql'];
const workflows = Object.fromEntries(files.map(name => [name, readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')]));
const metadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const harness = readFileSync(new URL('../verify-harness.mjs', import.meta.url), 'utf8');

function validateHarness(source) {
  assert.match(source, /const SUITE_TIMEOUT_MS = 300_000;/, 'Each suite needs a generous fixed deadline');
  assert.match(source, /timeout: SUITE_TIMEOUT_MS/, 'Subprocess deadline must be applied');
}

function validate(sources) {
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /^permissions:\r?\n  contents: read\b/m, `${name}: default token must be read-only`);
    assert.doesNotMatch(source, /pull_request_target|continue-on-error:\s*true/, `${name}: no privileged PR trigger or ignored gate failure`);
    for (const [, action] of source.matchAll(/^\s+(?:-\s+)?uses:\s+(\S+)/gm)) {
      assert.match(action, /^(?:actions\/[\w-]+|github\/codeql-action\/\w+)@[a-f0-9]{40}$/, `${name}: immutable GitHub-owned action required`);
    }
    if (name !== 'release') assert.doesNotMatch(source, /contents:\s*write/, `${name}: must not publish`);
  }
  for (const name of ['verify', 'release']) {
    assert.match(sources[name], /windowsArchiveSha256/, `${name}: archive integrity check required`);
    assert.match(sources[name], /\$version\.Trim\(\) -ne \$git\.windowsVersion/, `${name}: exact Git identity required`);
    assert.match(sources[name], /"NEURA_GIT_EXECUTABLE=\$executable" >> \$env:GITHUB_ENV/, `${name}: explicit Git selection required`);
    assert.match(sources[name], /\(Split-Path -Parent \$executable\) >> \$env:GITHUB_PATH/, `${name}: child PATH must select the same Git`);
  }
  assert.match(sources.verify, /required-ci:\r?\n[\s\S]*if: always\(\)[\s\S]*needs: \[harness, portable-proof, dependency-review\]/, 'Required CI must aggregate every gate even after failure');
  for (const result of ['HARNESS_RESULT', 'PORTABLE_RESULT', 'DEPENDENCY_RESULT']) {
    assert.ok(sources.verify.includes(`test "$${result}" = success`), `${result}: failure must block Required CI`);
  }
  assert.match(sources.verify, /verify-secrets\.ps1/);
  assert.match(sources.verify, /verify-secrets\.tests\.ps1/);
  assert.match(sources.verify, /npm run test:browser:learn/);
  assert.match(sources.release, /npm run verify:release/);
  assert.match(sources.release, /npm run test:v1:work-sandbox/);
  assert.ok(sources.release.indexOf('npm run verify:release') < sources.release.indexOf('npm run test:v1:work-sandbox'), 'License gate must precede host acceptance');
  assert.match(sources.release, /package:\r?\n[\s\S]*needs: release-gate/);
  assert.match(sources.release, /  release:\r?\n[\s\S]*needs: package/);
  assert.match(sources['runtime-compatibility'], /npm ci --prefix agent\/neura --ignore-scripts/, 'Scheduled audit must install the Learn graph');
  assert.match(sources['runtime-compatibility'], /npm run audit:all/, 'Scheduled audit must check both graphs and signatures');
  assert.match(sources.codeql, /languages: javascript-typescript/);
  assert.match(sources.codeql, /github\/codeql-action\/init@[a-f0-9]{40}/);
  assert.match(sources.codeql, /github\/codeql-action\/analyze@[a-f0-9]{40}/);
  assert.equal(metadata.scripts['verify:release'], 'node scripts/check-pi-free.mjs --distribution');
  assert.equal(metadata.scripts['audit:all'], 'npm run audit:dependencies && npm run audit:signatures');
  assert.equal(metadata.scripts['audit:signatures'], 'npm audit signatures && npm audit signatures --prefix agent/neura');
}

validate(workflows);
validateHarness(harness);
const codeqlPin = workflows.codeql.match(/github\/codeql-action\/init@[a-f0-9]{40}/)[0];
const mutations = [
  ['verify', 'contents: read', 'contents: write'],
  ['verify', 'needs: [harness, portable-proof, dependency-review]', 'needs: [harness]'],
  ['verify', 'test "$HARNESS_RESULT" = success', 'echo "$HARNESS_RESULT"'],
  ['verify', '(Split-Path -Parent $executable) >> $env:GITHUB_PATH', '# PATH publication removed'],
  ['release', '$version.Trim() -ne $git.windowsVersion', '$version.Length -lt 1'],
  ['release', 'npm run verify:release', 'npm run check:pi-free'],
  ['release', 'npm run test:v1:work-sandbox', 'echo host acceptance omitted'],
  ['runtime-compatibility', 'npm run audit:all', 'npm audit --audit-level=high'],
  ['runtime-compatibility', 'npm ci --prefix agent/neura --ignore-scripts', 'echo learning runtime omitted'],
  ['codeql', codeqlPin, 'github/codeql-action/init@main'],
];
for (const [name, before, after] of mutations) {
  assert.ok(workflows[name].includes(before), `Mutation target missing: ${name} ${before}`);
  assert.throws(() => validate({ ...workflows, [name]: workflows[name].replace(before, after) }), `Weakened contract escaped: ${name} ${before}`);
}
assert.throws(() => validateHarness(harness.replace('timeout: SUITE_TIMEOUT_MS', 'timeout: undefined')), 'Removing the suite deadline must fail');
const timeoutProbe = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import child from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
  child.spawnSync = () => ({ error: Object.assign(new Error('Synthetic suite timeout'), { code: 'ETIMEDOUT' }), status: null });
  syncBuiltinESMExports(); process.argv = [process.execPath, 'harness', '--suite', 'runtime'];
  await import('./scripts/verify-harness.mjs');
`], { cwd: root, encoding: 'utf8', timeout: 20000 });
assert.ifError(timeoutProbe.error);
assert.equal(timeoutProbe.status, 1);
assert.match(timeoutProbe.stderr, /runtime: FAILED \(timed out after 300000 ms\)/);
const distribution = spawnSync(process.execPath, ['scripts/check-pi-free.mjs', '--distribution'], { cwd: root, encoding: 'utf8', timeout: 20000 });
assert.ifError(distribution.error);
assert.equal(distribution.status, 1, 'Uncleared distribution must not succeed');
assert.match(distribution.stderr, /Distribution blocked: bundled Mastra EE license scope/);
console.log(`CI contracts: four workflows, ${mutations.length + 1} rejected mutations, suite timeout diagnostics and current distribution denial passed.`);
