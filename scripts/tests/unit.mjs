import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { isolate } from './isolation.mjs';
const scratchRoot = isolate();
const repoRoot = path.resolve(import.meta.dirname, '../..');
const { parseRuntimeContract, piRuntimeStatus } = await import('../../agent/extensions/harness-health.ts');
const { redactSensitiveText } = await import('../../agent/neura/redaction.ts');
const runtimeContract = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "runtime-contract.json"), "utf-8"));
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const { selectSuites, suites } = await import('../test-suites.mjs');
assert.deepEqual(selectSuites(['agent/neura/verification.ts']),['integration','proof']);
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
const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "settings.json"), "utf-8"));
assert.ok(settings.skills.includes("!skills/agent-reach"), "agent-reach collision exclusion missing");
assert.ok(settings.skills.includes("!skills/find-skills"), "find-skills collision exclusion missing");
assert.ok(settings.packages.includes("npm:@spences10/pi-mcp@0.0.58"), "verified pi-mcp version is not pinned");
assert.ok(settings.packages.every((entry) => /^npm:(?:@[^/]+\/[^@]+|[^@]+)@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(entry)), "runtime package is not exactly pinned");

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
