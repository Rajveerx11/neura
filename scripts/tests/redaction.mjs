// Subprocess bounds keep synchronous failed-match regressions from hanging Plan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolate, nonGitFixture } from './isolation.mjs';
isolate();
const repo = path.resolve(import.meta.dirname, '../..');
function bounded(name, code, fixture) {
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, ...(fixture ? [fixture] : [])], {
      cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 4096,
    });
    // Never dump tokens/file content when a recognition or budget assertion fails.
    assert.equal(result.status, 0, `${name}: subprocess failed/exceeded 5s (status=${result.status}, error=${result.error?.code ?? 'none'})`);
    console.log(`PASS ${name}: subprocess bound 5s`);
  } finally {
    // Parent-owned fixture cleanup also runs when the bounded child is killed.
    if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
  }
}
bounded('JWT failed matches and neighboring synchronous redaction expressions', String.raw`
  import assert from 'node:assert/strict';
  import { redactSensitiveText } from './agent/neura/redaction.ts';
  for (const text of [
    'eyJaaaaaaaa-'.repeat(40_000),
    'eyJaaaaaaaa-'.repeat(40_000) + '.bbbbbbbb',
    'eyJaaaaaaaa-'.repeat(40_000) + '.bbbbbbbb.--------',
    'ATOKEN'.repeat(80_000),
    'Authorization' + ' '.repeat(480_000) + 'x',
    '"token": "' + '\\'.repeat(240_000),
    'sk-' + '-'.repeat(480_000),
    'xoxb-' + '-'.repeat(480_000),
    'ghp_' + 'a'.repeat(480_000) + '_',
    'https://example.test/?' + 'a'.repeat(480_000),
  ]) {
    const actual = redactSensitiveText(text);
    assert.equal(actual === text, true, 'Failed candidate changed unexpectedly');
  }
  const longHeader = 'eyJaaaaaaaa-'.repeat(40_000);
  assert.equal(redactSensitiveText(longHeader + '.bbbbbbbb.cccccccc'), '[REDACTED]');
  assert.equal(redactSensitiveText('_' + longHeader + '.bbbbbbbb.cccccccc'), '_eyJaaaaaaaa-[REDACTED]');
  const trailingHyphens = '-'.repeat(480_000);
  assert.equal(redactSensitiveText('eyJaaaaaaaa.bbbbbbbb.cccccccc' + trailingHyphens), '[REDACTED]' + trailingHyphens);
`);
bounded('JWT legacy recognition positives and boundary/minimum/overlap negatives', String.raw`
  import assert from 'node:assert/strict';
  import { redactSensitiveText } from './agent/neura/redaction.ts';
  const legacy = text => text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  let checks = 0;
  const compare = text => {
    // Low-entropy synthetic alphabets avoid unrelated provider/entropy redaction.
    assert.equal(redactSensitiveText(text) === legacy(text), true, 'JWT legacy recognition changed');
    checks++;
  };
  for (const prefix of ['', ' ', '.', '-', '_', 'a', 'a-', 'a_', '1-', 'é']) {
    for (const header of ['eyJ' + 'a'.repeat(7), 'eyJ' + 'a'.repeat(8), 'eyJ' + '-'.repeat(8), 'aaa-eyJaaaaaaaa', 'eyJaaaaaaa-eyJaaaaaaaa', 'EyJaaaaaaaa', 'eyjaaaaaaaa', 'EYJaaaaaaaa']) {
      for (const payload of ['bbbbbbb', 'bbbbbbbb', '--------', '_bbbbbbbb']) {
        for (const signature of ['ccccccc', 'cccccccc', 'cccccccc----', 'ccccccc---', '--------', '-------c', '--------_', '_cccccccc']) {
          for (const suffix of ['', '-', '_', '.', 'a', 'é']) compare(prefix + header + '.' + payload + '.' + signature + suffix);
        }
      }
    }
  }
  const jwt = 'eyJaaaaaaaa.bbbbbbbb.cccccccc';
  assert.equal(redactSensitiveText(jwt), '[REDACTED]');
  for (const text of [jwt + '.' + jwt, 'aaa.' + jwt, 'eyJaaaaaaa.a.' + jwt, jwt + '---' + jwt, jwt + '---.' + jwt, jwt + '\n' + jwt]) compare(text);
  // Deterministic small failed/overlapping runs; reference regex never sees hostile sizes.
  let seed = 0x1333;
  const tokens = ['eyJ', 'a', 'b', '_', '-', '.', ' ', 'aaaaaaaa', 'bbbbbbbb', 'cccccccc'];
  for (let sample = 0; sample < 2000; sample++) {
    let text = '';
    for (let part = 0; part < 24; part++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += tokens[seed % tokens.length];
    }
    compare(text);
  }
  assert.ok(checks > 10_000);
`);
bounded('Plan JWT preprocessing: bounded long-line failure, in-scan deadline/abort, timer cancellation', String.raw`
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  import path from 'node:path';
  import { inspectPlanFiles } from './agent/neura/plan-files.ts';
  import { findProjectRoot } from './agent/neura/plan-policy.ts';
  // Inherit the synthetic profile, but inspect outside its Git ancestry: this
  // bound measures preprocessing, not repeated Git ignore subprocess startup.
  const cwd = process.argv[1];
  assert.equal(findProjectRoot(cwd), cwd, 'Preprocessing fixture acquired a Git ancestor');
  const hostile = path.join(cwd, 'hostile.txt');
  fs.writeFileSync(hostile, 'eyJaaaaaaaa-'.repeat(40_000));
  // Preserve explicit size rejection, rather than returning a false no-match.
  await assert.rejects(() => inspectPlanFiles(cwd, 'grep', { pattern: 'absent', literal: true, path: 'hostile.txt' }), /line.*limit/i);
  const originalMatchAll = String.prototype.matchAll;
  const originalNow = Date.now;
  for (const kind of ['deadline', 'abort']) {
    const controller = new AbortController();
    const clock = originalNow();
    let jwtStarted = false;
    let jwtBudgetChecks = 0;
    String.prototype.matchAll = function(regex) {
      if (regex.source === '[A-Za-z0-9_-]+') jwtStarted = true;
      return originalMatchAll.call(this, regex);
    };
    Date.now = () => {
      if (jwtStarted && ++jwtBudgetChecks === 5 && kind === 'abort') controller.abort();
      return clock + (jwtBudgetChecks >= 5 && kind === 'deadline' ? 10_001 : 0);
    };
    try {
      await assert.rejects(() => inspectPlanFiles(cwd, 'grep', { pattern: 'absent', literal: true, path: 'hostile.txt' }, controller.signal), kind === 'abort' ? /aborted/ : /deadline/);
      assert.equal(jwtStarted, true);
      assert.ok(jwtBudgetChecks >= 5, 'Did not reach periodic checks within a maximal JWT run');
    } finally { String.prototype.matchAll = originalMatchAll; Date.now = originalNow; }
  }
  // Schedule the real timer only when JWT preprocessing begins; it must not
  // fire during setup/traversal and falsely certify preprocessing responsiveness.
  fs.writeFileSync(hostile, ('eyJaaaaaaaa-'.repeat(100) + '\n').repeat(6000));
  const controller = new AbortController();
  let timer;
  let timerFired = false;
  String.prototype.matchAll = function(regex) {
    if (regex.source === '[A-Za-z0-9_-]+' && !timer) timer = setTimeout(() => { timerFired = true; controller.abort(); }, 25);
    return originalMatchAll.call(this, regex);
  };
  try {
    await assert.rejects(() => inspectPlanFiles(cwd, 'grep', { pattern: 'absent', literal: true, path: 'hostile.txt' }, controller.signal), /aborted/);
    assert.equal(timerFired, true, 'Real abort timer was starved or inspection completed without observing it');
  } finally { clearTimeout(timer); String.prototype.matchAll = originalMatchAll; }
`, nonGitFixture());
