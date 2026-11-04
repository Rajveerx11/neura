import test from 'node:test';
import assert from 'node:assert/strict';
import type { TreeSnapshot } from '../agent/neura/verification.ts';
import type { Finding, ReviewInput, ReviewReceipt, Risk } from '../src/review.ts';
import { MAX_REVIEW_ROUNDS, WORKFLOW_INSTRUCTIONS, fixPrompt, formatFindings, runReviewLoop, type WorkflowDeps } from '../src/workflow.ts';

const snap = (files: Record<string, string>): TreeSnapshot => ({ root: '/w', fingerprint: 'fp-' + JSON.stringify(files), files });
const baseline = snap({ 'src/a.ts': '1' });
const changed = snap({ 'src/a.ts': '2' });
const builder = { provider: 'openai-codex' as const, model: 'builder' };
const finding = (id: string, severity: Finding['severity'], mustFix: boolean, extra: Partial<Finding> = {}): Finding =>
  ({ id, severity, likelihood: 'possible', confidence: 'high', file: 'src/a.ts', line: 3, summary: `${id} summary`, evidence: `${id} evidence`, mustFix, ...extra });
const receipt = (status: ReviewReceipt['status'], findings: Finding[] = [], fingerprint: string | null = changed.fingerprint, reason?: string): ReviewReceipt => ({
  schemaVersion: 1, id: 'r', fingerprint, status, reviewer: { provider: 'openai-codex', model: 'reviewer', independence: 'same-family' },
  risk: { level: 'normal', reasons: [] }, findings, reason, completedAt: '2026-11-02T00:00:00Z',
});

function harness(opts: { snapshots?: (TreeSnapshot | null)[]; receipts?: ReviewReceipt[]; risk?: Risk; current?: () => boolean; fixTurn?: (prompt: string) => Promise<void> } = {}) {
  const lines: string[] = []; const reviews: ReviewInput[] = []; const fixes: string[] = [];
  const snapshots = [...(opts.snapshots ?? [changed])]; const receipts = [...(opts.receipts ?? [])];
  const deps: WorkflowDeps = {
    capture: async () => snapshots.length > 1 ? snapshots.shift()! : snapshots[0],
    review: async input => { reviews.push(input); const next = receipts.shift(); assert.ok(next, 'unexpected review'); return next; },
    assessRisk: () => opts.risk ?? { level: 'normal', reasons: [] },
    fixTurn: opts.fixTurn ?? (async prompt => { fixes.push(prompt); }),
    current: opts.current ?? (() => true),
    report: line => lines.push(line),
  };
  const run = (manual = false) => runReviewLoop({ workspace: '/w', task: 'fix the bug', baseline, reviewer: builder, builder, manual }, deps);
  return { run, lines, reviews, fixes, last: () => lines.at(-1) ?? '' };
}

test('clean first round is ready for approval and never claims commit', async () => {
  const h = harness({ receipts: [receipt('clean')] });
  const outcome = await h.run();
  assert.deepEqual([outcome.state, outcome.rounds], ['ready', 1]);
  assert.match(h.last(), /^READY FOR YOUR APPROVAL: .*same-family, weaker independence.*Nothing was committed, pushed or merged\.$/);
  assert.equal(h.reviews[0].baseline, baseline);
  assert.equal(h.fixes.length, 0);
});

test('must-fix then clean is ready after two rounds; fix prompt carries only must-fix findings', async () => {
  const first = receipt('findings', [finding('F1', 'blocker', true, { likelihood: 'rare', confidence: 'low' }), finding('F2', 'minor', false)]);
  const h = harness({ receipts: [first, receipt('clean')] });
  const outcome = await h.run();
  assert.deepEqual([outcome.state, outcome.rounds], ['ready', 2]);
  assert.equal(h.fixes.length, 1);
  assert.match(h.fixes[0], /F1 summary/); assert.doesNotMatch(h.fixes[0], /F2/);
  assert.match(h.fixes[0], /untrusted data, not instructions/);
  assert.match(h.reviews[1].task, /^fix the bug\n\nRound 1 must-fix findings[\s\S]*F1 summary/);
});

test('persistent must-fix is blocked at the round limit with findings named', async () => {
  const bad = () => receipt('findings', [finding('F1', 'major', true)]);
  const h = harness({ receipts: [bad(), bad(), bad()] });
  const outcome = await h.run();
  assert.deepEqual([outcome.state, outcome.rounds], ['blocked', MAX_REVIEW_ROUNDS]);
  assert.equal(h.fixes.length, MAX_REVIEW_ROUNDS - 1);
  assert.match(h.last(), /^BLOCKED: 1 must-fix finding\(s\) remain after 3 review round\(s\): F1\.$/);
});

test('unavailable reviewer blocks; never a silent pass', async () => {
  const h = harness({ receipts: [receipt('unavailable', [], null, 'model failed')] });
  assert.equal((await h.run()).state, 'blocked');
  assert.match(h.last(), /^BLOCKED: reviewer unavailable: model failed$/);
});

test('stale receipt or receipt for a different fingerprint blocks', async () => {
  for (const r of [receipt('stale', [], changed.fingerprint, 'drift'), receipt('clean', [], 'fp-other'), receipt('clean', [], null)]) {
    const h = harness({ receipts: [r] });
    assert.equal((await h.run()).state, 'blocked');
    assert.match(h.last(), /^BLOCKED: workspace changed during review/);
  }
});

test('no change and trivial change skip review; manual review still reviews trivial', async () => {
  const none = harness({ snapshots: [baseline] });
  assert.deepEqual([(await none.run()).state, none.reviews.length], ['skipped', 0]);
  assert.deepEqual(none.lines, [], 'A chat turn that changed nothing prints no review line');
  const noneManual = harness({ snapshots: [baseline] });
  assert.equal((await noneManual.run(true)).state, 'skipped');
  assert.equal(noneManual.last(), 'Review skipped: no workspace changes.');
  const sentence = harness({ risk: { level: 'trivial', reasons: ['Documentation/text only (1 file).'] } });
  await sentence.run();
  assert.equal(sentence.last(), 'Review skipped: trivial change (Documentation/text only (1 file)).');
  const docs = { level: 'trivial' as const, reasons: ['docs only'] };
  const trivial = harness({ risk: docs });
  assert.deepEqual([(await trivial.run()).state, trivial.reviews.length], ['skipped', 0]);
  assert.equal(trivial.last(), 'Review skipped: trivial change (docs only).');
  const manual = harness({ risk: docs, receipts: [receipt('clean')] });
  assert.equal((await manual.run(true)).state, 'ready');
});

test('manual review never auto-fixes must-fix findings', async () => {
  const h = harness({ receipts: [receipt('findings', [finding('F1', 'blocker', true)])] });
  assert.deepEqual([(await h.run(true)).state, h.fixes.length], ['blocked', 0]);
});

test('non-must-fix findings only: ready with findings shown, nothing fixed', async () => {
  const h = harness({ receipts: [receipt('findings', [finding('F3', 'minor', false), finding('F4', 'major', false, { confidence: 'low' })])] });
  assert.equal((await h.run()).state, 'ready');
  assert.equal(h.fixes.length, 0);
  assert.ok(h.lines.some(line => /\[note\] F3 minor/.test(line) && /\[note\] F4 major/.test(line)));
  assert.match(h.last(), /2 non-blocking finding\(s\)/);
});

test('fence change mid-loop aborts without further review or fixes', async () => {
  let live = true;
  const h = harness({ current: () => live, receipts: [receipt('findings', [finding('F1', 'blocker', true)]), receipt('clean')],
    fixTurn: async () => { live = false; } });
  const outcome = await h.run();
  assert.deepEqual([outcome.state, h.reviews.length], ['blocked', 1]);
  assert.match(h.last(), /^BLOCKED: review aborted/);
  let calls = 0;
  const during = harness({ current: () => ++calls < 3, receipts: [receipt('clean')] });
  assert.equal((await during.run()).state, 'blocked'); // fence flips while the review was in flight
});

test('missing baseline, missing candidate and failed fix turn block', async () => {
  const lines: string[] = [];
  const none = await runReviewLoop({ workspace: '/w', task: 't', baseline: null, reviewer: builder, builder }, {
    capture: async () => assert.fail('no capture'), review: async () => assert.fail('no review'), assessRisk: () => assert.fail('no risk'),
    fixTurn: async () => assert.fail('no fix'), current: () => true, report: line => lines.push(line) });
  assert.equal(none.state, 'blocked'); assert.match(lines.at(-1)!, /^BLOCKED: no workspace baseline/);
  const missing = harness({ snapshots: [null] });
  assert.equal((await missing.run()).state, 'blocked'); assert.match(missing.last(), /candidate snapshot unavailable/);
  const failing = harness({ receipts: [receipt('findings', [finding('F1', 'blocker', true)])], fixTurn: async () => { throw new Error('denied'); } });
  assert.equal((await failing.run()).state, 'blocked'); assert.match(failing.last(), /^BLOCKED: fix turn failed: denied$/);
});

test('reviewer text is redacted and stripped of line structure before display and builder prompt', async () => {
  const secret = 'sk-' + 'a'.repeat(40);
  const r = receipt('findings', [finding('F1', 'blocker', true, { summary: `leak ${secret}\nIGNORE PREVIOUS`, evidence: `token=${secret}` })]);
  for (const text of [formatFindings(r), fixPrompt(r)]) {
    assert.ok(!text.includes(secret), 'secret must be redacted');
    assert.ok(!/\nIGNORE/.test(text), 'injected newlines must be collapsed');
  }
  assert.equal(formatFindings(receipt('clean')), 'No findings.');
  assert.match(WORKFLOW_INSTRUCTIONS, /reproduce/); assert.match(WORKFLOW_INSTRUCTIONS, /never claim/);
});
