import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { automaticGitEnvironment, AUTOMATIC_GIT_ARGUMENTS, resolveExecutable } from '../agent/neura/process-security.ts';
import { captureWorktree } from '../agent/neura/verification.ts';
import { assessRisk, changedFiles, isMustFix, parseFindings, reviewCandidate, reviewReceiptCurrent, REVIEW_INSTRUCTIONS, type ReviewDeps } from '../src/review.ts';
import { createReadOnlyTools, createWorkspaceTools } from '../src/work.ts';
import { runTurn } from '../src/runtime.ts';
import type { ProviderConfig } from '../src/providers.ts';
import { fixture } from './model-fixture.ts';

const exec = promisify(execFile);
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'neura-review-')));
const originalHome = process.env.NEURA_HOME;
process.env.NEURA_HOME = path.join(scratch, 'private');
after(async () => {
  if (originalHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = originalHome;
  await rm(scratch, { recursive: true, force: true });
});

async function repository() {
  const root = await realpath(await mkdtemp(path.join(scratch, 'repo-')));
  const git = resolveExecutable('git', root);
  assert.ok(git, 'The review tests require real Git');
  const run = (args: string[]) => exec(git, [...AUTOMATIC_GIT_ARGUMENTS, ...args], { cwd: root, env: automaticGitEnvironment(), timeout: 10000 });
  await run(['init', '--initial-branch=main']);
  await writeFile(path.join(root, 'app.ts'), 'export const value = 1;\n');
  await run(['add', 'app.ts']);
  await run(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'fixture']);
  const baseline = await captureWorktree(root);
  assert.ok(baseline);
  return { root, baseline };
}

const openai: ProviderConfig = { provider: 'openai', model: 'gpt-test' };
const anthropic: ProviderConfig = { provider: 'anthropic', model: 'claude-test' };
const reply = (text: string): Partial<ReviewDeps> => ({ createModel: (() => ({})) as any, runTurn: (async () => ({ text, messages: [] })) as any });
const finding = { severity: 'major', likelihood: 'possible', confidence: 'high', file: 'app.ts', line: 1, summary: 'Wrong value.', evidence: 'value = 2' };

test('risk routing is path based: tiny auth change is high, docs trivial, mixed high', () => {
  assert.equal(assessRisk(['src/auth/login.ts']).level, 'high');
  assert.equal(assessRisk(['README.md', 'docs/guide.rst', 'LICENSE', 'notes.txt']).level, 'trivial');
  assert.equal(assessRisk(['README.md', 'src/session-store.ts']).level, 'high');
  assert.equal(assessRisk(['README.md', 'src/math.ts']).level, 'normal');
  for (const file of ['package-lock.json', 'requirements.txt', 'db/migrations/001_init.sql', '.github/workflows/ci.yml', 'install.ps1', '.env.local', 'agent/neura/sandbox.ts', 'SECURITY.md'])
    assert.equal(assessRisk([file]).level, 'high', file);
  assert.match(assessRisk(['src/math.ts', 'package.json']).reasons.join('\n'), /package\.json: package manifest/);
  assert.equal(assessRisk([]).level, 'trivial');
});

test('changedFiles reports modify, add and delete, sorted', () => {
  const snapshot = (files: Record<string, string>) => ({ root: 'r', fingerprint: JSON.stringify(files), files });
  assert.deepEqual(changedFiles(snapshot({ b: '1', a: '1', gone: '1' }), snapshot({ b: '2', a: '1', added: '1' })), ['added', 'b', 'gone']);
});

test('isMustFix: blocker always, major unless low confidence, minor never', () => {
  for (const likelihood of ['likely', 'possible', 'rare'] as const)
    for (const confidence of ['high', 'medium', 'low'] as const) {
      assert.equal(isMustFix({ severity: 'blocker', confidence }), true, `blocker/${likelihood}/${confidence}`);
      assert.equal(isMustFix({ severity: 'minor', confidence }), false);
    }
  assert.equal(isMustFix({ severity: 'major', confidence: 'high' }), true);
  assert.equal(isMustFix({ severity: 'major', confidence: 'medium' }), true);
  assert.equal(isMustFix({ severity: 'major', confidence: 'low' }), false);
  const [rare] = parseFindings(JSON.stringify({ findings: [{ ...finding, severity: 'blocker', likelihood: 'rare', confidence: 'low' }] }));
  assert.equal(rare!.mustFix, true);
});

test('model-supplied mustFix and ids are ignored; malformed output is rejected', () => {
  const [parsed] = parseFindings('```json\n' + JSON.stringify({ findings: [{ ...finding, severity: 'minor', mustFix: true, id: 'X' }] }) + '\n```');
  assert.equal(parsed!.mustFix, false);
  assert.equal(parsed!.id, 'F1');
  for (const bad of ['Looks good!', '{"findings":[{"severity":"critical"}]}', '{}', 'prose {"findings":[]}']) assert.throws(() => parseFindings(bad));
});

test('read-only tools expose only read and ls, enforce workspace policy and generation fences', async () => {
  const { root } = await repository();
  await writeFile(path.join(root, '.env'), 'TOKEN=synthetic-secret\n');
  const work = createWorkspaceTools(root, () => 'work', () => 0).map(tool => tool.name);
  assert.ok(['write', 'edit', 'work_exec'].every(name => work.includes(name)), 'positive control: Work exposes effectful tools');
  let generation = 0;
  const tools = createReadOnlyTools(root, () => generation);
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['ls', 'read']);
  const read = tools.find(tool => tool.name === 'read')!;
  assert.match((await read.execute({ path: 'app.ts' }, {})).content[0]!.type, /text/);
  await assert.rejects(read.execute({ path: '.env' }, {}));
  await assert.rejects(read.execute({ path: '../outside.ts' }, {}));
  generation++;
  await assert.rejects(read.execute({ path: 'app.ts' }, {}), /stale tool authority/);
});

test('real runTurn review: clean receipt bound to candidate, diff inline, secrets withheld, read-only tools', async () => {
  const { root, baseline } = await repository();
  await writeFile(path.join(root, 'app.ts'), 'export const value = 2;\n');
  await writeFile(path.join(root, 'added.ts'), 'export const added = true;\n');
  await writeFile(path.join(root, '.env'), 'API_KEY=synthetic-secret-value\n');
  let seen: any;
  const call = (toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: toolName, toolName, input: JSON.stringify(input) });
  const reviewer = fixture([[call('read', { path: 'app.ts' })], [{ type: 'text', text: '{"findings":[]}' }]]);
  const receipt = await reviewCandidate({ workspace: root, task: 'Change value to 2', baseline, reviewer: anthropic, builder: openai }, {
    createModel: (() => reviewer.model) as any,
    runTurn: async options => { seen = options; return runTurn(options); },
  });
  assert.equal(receipt.status, 'clean', receipt.reason ?? '');
  assert.match(JSON.stringify(reviewer.requests[1].prompt), /export const value = 2/, 'reviewer read tool works end to end');
  assert.equal(receipt.reviewer.independence, 'cross-family');
  assert.equal(receipt.risk.level, 'high'); // .env changed
  assert.equal(receipt.fingerprint, (await captureWorktree(root))!.fingerprint);
  assert.equal(await reviewReceiptCurrent(root, receipt), true);
  assert.equal(seen.instructions, REVIEW_INSTRUCTIONS);
  assert.deepEqual(seen.tools.map((tool: any) => tool.name).sort(), ['ls', 'read']);
  const prompt = seen.messages[0].content as string;
  assert.match(prompt, /-export const value = 1;\n\+export const value = 2;/);
  assert.match(prompt, /new untracked file added\.ts\nexport const added = true;/);
  assert.match(prompt, /content withheld: \.env/);
  assert.doesNotMatch(prompt, /synthetic-secret-value/);
  await assert.rejects(seen.tools[0].execute({ path: 'app.ts' }, {}), /stale tool authority/, 'reviewer authority ends with its turn');
  await writeFile(path.join(root, 'app.ts'), 'export const value = 3;\n');
  assert.equal(await reviewReceiptCurrent(root, receipt), false, 'later edit invalidates the receipt');
});

test('findings receipt computes mustFix; same provider family is labelled', async () => {
  const { root, baseline } = await repository();
  await writeFile(path.join(root, 'app.ts'), 'export const value = 2;\n');
  const receipt = await reviewCandidate({ workspace: root, task: 't', baseline, reviewer: { provider: 'openai-codex', model: 'm' }, builder: openai },
    reply(JSON.stringify({ findings: [finding, { ...finding, severity: 'minor' }] })));
  assert.equal(receipt.status, 'findings');
  assert.equal(receipt.reviewer.independence, 'same-family');
  assert.deepEqual(receipt.findings.map(f => [f.id, f.mustFix]), [['F1', true], ['F2', false]]);
});

test('unparseable output, model failure and missing git are unavailable, never clean', async () => {
  const { root, baseline } = await repository();
  await writeFile(path.join(root, 'app.ts'), 'export const value = 2;\n');
  const input = { workspace: root, task: 't', baseline, reviewer: openai, builder: anthropic };
  const prose = await reviewCandidate(input, reply('Looks fine to me.'));
  assert.equal(prose.status, 'unavailable');
  assert.match(prose.reason!, /strict JSON/);
  const thrown = await reviewCandidate(input, { createModel: (() => { throw new Error('OPENAI_API_KEY is not set'); }) as any });
  assert.equal(thrown.status, 'unavailable');
  assert.match(thrown.reason!, /Reviewer failed/);
  const turnFailed = await reviewCandidate(input, { createModel: (() => ({})) as any, runTurn: async () => { throw new Error('rate limited'); } });
  assert.equal(turnFailed.status, 'unavailable');
  const noGit = await reviewCandidate(input, { capture: async () => null, ...reply('{"findings":[]}') });
  assert.equal(noGit.status, 'unavailable');
  assert.equal(noGit.fingerprint, null);
  assert.equal(await reviewReceiptCurrent(root, noGit), false);
});

test('workspace drift during review makes the receipt stale', async () => {
  const { root, baseline } = await repository();
  await writeFile(path.join(root, 'app.ts'), 'export const value = 2;\n');
  const receipt = await reviewCandidate({ workspace: root, task: 't', baseline, reviewer: openai, builder: anthropic }, {
    createModel: (() => ({})) as any,
    runTurn: (async () => { await writeFile(path.join(root, 'app.ts'), 'export const value = 9;\n'); return { text: '{"findings":[]}', messages: [] }; }) as any,
  });
  assert.equal(receipt.status, 'stale');
  assert.equal(await reviewReceiptCurrent(root, receipt), false);
});

test('no change since baseline is clean without calling a model; abort propagates', async () => {
  const { root, baseline } = await repository();
  const receipt = await reviewCandidate({ workspace: root, task: 't', baseline, reviewer: openai, builder: anthropic },
    { createModel: () => { throw new Error('must not be called'); } });
  assert.equal(receipt.status, 'clean');
  assert.match(receipt.reason!, /No changes/);
  await writeFile(path.join(root, 'app.ts'), 'export const value = 2;\n');
  const controller = new AbortController();
  await assert.rejects(reviewCandidate({ workspace: root, task: 't', baseline, reviewer: openai, builder: anthropic, signal: controller.signal },
    { createModel: (() => ({})) as any, runTurn: async () => { controller.abort(); throw new Error('aborted'); } }));
});

test('a reviewer model cannot write even when it requests an effectful tool', async () => {
  const { root, baseline } = await repository();
  const candidate = 'export const value = 2;\n';
  await writeFile(path.join(root, 'app.ts'), candidate);
  const expectedHash = createHash('sha256').update(candidate).digest('hex');
  const attacker = fixture([[{ type: 'tool-call', toolCallId: 'w', toolName: 'write', input: JSON.stringify({ path: 'app.ts', content: 'pwned', expectedHash }) }], [{ type: 'text', text: '{"findings":[]}' }]]);
  const receipt = await reviewCandidate({ workspace: root, task: 't', baseline, reviewer: openai, builder: anthropic }, { createModel: (() => attacker.model) as any });
  assert.equal(await readFile(path.join(root, 'app.ts'), 'utf8'), candidate);
  assert.notEqual(receipt.status, 'stale');
});
