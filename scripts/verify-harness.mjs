// Active Mastra v1 verification. Historical Pi harness is retained separately, not claimed passing.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const SUITE_TIMEOUT_MS = 300_000;
const suites = {
  runtime: ['--test', 'tests/v1-runtime.test.ts'],
  auth: ['--test', 'tests/v1-auth.test.ts'],
  verification: ['--test', 'tests/v1-verification.test.ts'],
  learn: ['--test', 'tests/v1-learn.test.ts'],
  'agent-learn': ['--test', 'tests/v1-agent-learn.test.ts'],
  installer: ['--test', 'tests/v1-install.test.ts'],
  cli: ['--test', 'tests/v1-cli.test.ts'],
  'learn-materials': ['scripts/tests/learn-materials.mjs'],
  'learn-workshop': ['scripts/tests/learn-workshop.mjs'],
  'learn-storage': ['scripts/tests/learn-storage.mjs'],
  'learn-vault': ['scripts/tests/learn-vault.mjs'],
  sandbox: ['scripts/tests/sandbox.mjs'],
  'process-contract': ['scripts/tests/process-contract.mjs'],
  'workspace-read': ['scripts/tests/plan-traversal.mjs'],
  'ci-contract': ['scripts/tests/ci-contract.mjs'],
};
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--suite' || !Object.hasOwn(suites, args[1]))) {
  console.error('Use --suite ' + Object.keys(suites).join('|') + '. Legacy Pi suites are not active Mastra parity tests.');
  process.exit(2);
}
if (Number(process.versions.node.split('.')[0]) < 24) { console.error('Native Node 24.15+ required. WSL Node18 cannot run this harness.'); process.exit(1); }
const chosen = args.length ? [[args[1], suites[args[1]]]] : Object.entries(suites);
let failures = 0;
for (const [name, command] of chosen) {
  console.log(`\n=== ${name} ===`);
  // Cold hosted Windows PS5 starts cost ~23s each; installer cases intentionally use isolated processes.
  const timeout = name === 'installer' ? 600_000 : SUITE_TIMEOUT_MS;
  const result = spawnSync(process.execPath, command, { cwd: root, stdio: 'inherit', env: process.env, timeout });
  if (result.error || result.status !== 0) {
    failures++;
    const detail = result.error?.code === 'ETIMEDOUT' ? `timed out after ${timeout} ms` : `exit ${result.status ?? 'unavailable'}`;
    console.error(`${name}: FAILED (${detail})`);
  }
  else console.log(`${name}: PASS`);
}
console.log(`\nMastra v1 suites: ${chosen.length - failures}/${chosen.length} passed. This is not full legacy-feature/production parity.`);
process.exitCode = failures ? 1 : 0;
