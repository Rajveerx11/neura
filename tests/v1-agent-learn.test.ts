import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createLearnWorkshop } from '../src/learn.ts';
import { runTurn } from '../src/runtime.ts';
import { fixture } from './model-fixture.ts';
import { pdf } from '../scripts/learn-material-fixtures.mjs';
import { workshopFixture } from '../scripts/learn-workshop-fixture.mjs';
import { lockSession } from '../src/session-lock.ts';
import { readLearnVaultContext } from '../agent/neura/learn-vault.ts';
import { windowsShortPath } from './windows-short-path.ts';
const call = (toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: toolName, toolName, input: JSON.stringify(input) });

test('real Mastra Learn: material -> cited board -> learner attempt -> explicit save/resume', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-agent-learn-')));
  const oldHome = process.env.NEURA_HOME; const oldVault = process.env.NEURA_LEARN_VAULT;
  process.env.NEURA_HOME = path.join(scratch, 'private'); delete process.env.NEURA_LEARN_VAULT;
  try {
    const bytes = pdf(['Customers make bookings']);
    await fs.writeFile(path.join(scratch, 'lesson.pdf'), bytes);
    const lesson = structuredClone(workshopFixture);
    lesson.references = [{ sourceId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, filename: 'lesson.pdf', unit: 'page', number: 1, excerpt: 'Customers make bookings' }];
    const workshop = createLearnWorkshop(scratch, () => true);
    const first = fixture([[call('learn_material', { path: 'lesson.pdf', ocr: false })], [call('learn_lesson', lesson)], [{ type: 'text', text: 'Must never continue past learner boundary' }]]);
    workshop.input('Teach me database relationships using lesson.pdf');
    const turn = await runTurn({ model: first.model, instructions: await workshop.instructions(), messages: [{ role: 'user', content: 'Teach me database relationships using lesson.pdf' }], tools: workshop.tools() });
    assert.equal(first.requests.length, 2);
    assert.match(turn.text, /Open this local HTML file/);
    const status = JSON.parse((await workshop.command('status')).text);
    assert.ok((await fs.readFile(status.board, 'utf8')).includes('Content-Security-Policy'));
    const answer = lesson.exercise.kind === 'choice' ? String(lesson.exercise.answer + 1) : 'actual synthetic answer';
    workshop.input(answer);
    const second = fixture([[call('learn_exercise', { answer })], [{ type: 'text', text: 'Must not continue' }]]);
    const attempt = await runTurn({ model: second.model, instructions: await workshop.instructions(), messages: [...turn.messages, { role: 'user', content: answer }], tools: workshop.tools() });
    assert.equal(second.requests.length, 1);
    assert.match(attempt.text, /Practice attempt/);
    const saved = await workshop.command('save');
    const filename = /Resume: \/learn resume (\S+)/.exec(saved.text)![1];
    const fresh = createLearnWorkshop(scratch, () => true);
    assert.match((await fresh.command(`resume ${filename}`)).text, /historical/);
    const progress = JSON.parse((await fresh.command('status')).text);
    assert.equal(progress.attempts.length, 1);
    assert.equal(progress.sources[0].verifiedThisSession, false);
    assert.equal(progress.lesson, lesson.title);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    if (oldVault === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = oldVault;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('Learn accepts genuine short homes/workspaces but rejects canonical Pi and linked config ancestors', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-learn-short-')));
  const oldHome = process.env.NEURA_HOME; const oldVault = process.env.NEURA_LEARN_VAULT;
  delete process.env.NEURA_LEARN_VAULT;
  try {
    const home = path.join(scratch, 'home'); const workspace = path.join(scratch, 'project'); const vault = path.join(scratch, 'vault');
    await fs.mkdir(home); await fs.mkdir(workspace); await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
    await fs.writeFile(path.join(home, 'learn-vault.json'), JSON.stringify({ version: 1, vault }));
    const short = await windowsShortPath(scratch);
    assert.notEqual(path.relative(short, scratch), '');
    process.env.NEURA_HOME = path.join(short, 'home');
    assert.equal((await readLearnVaultContext()).enabled, true);
    const workshop = createLearnWorkshop(path.join(short, 'project'), () => true);
    const lesson = structuredClone(workshopFixture); lesson.references = [];
    const published = await workshop.tools().find(tool => tool.name === 'learn_lesson')!.execute(lesson, {});
    assert.equal(published.terminate, true);
    const status = JSON.parse((await workshop.command('status')).text);
    assert.match(await fs.readFile(status.board, 'utf8'), /Content-Security-Policy/);
    const pi = path.join(scratch, '.pi'); await fs.mkdir(pi);
    await fs.writeFile(path.join(pi, 'learn-vault.json'), 'must not be parsed');
    process.env.NEURA_HOME = await windowsShortPath(pi);
    await assert.rejects(readLearnVaultContext(), /outside Pi/);
    await fs.mkdir(path.join(home, 'existing'));
    await fs.writeFile(path.join(home, 'existing', 'learn-vault.json'), 'must not be parsed');
    const linked = path.join(scratch, 'linked-home'); await fs.symlink(home, linked, 'junction');
    process.env.NEURA_HOME = path.join(linked, 'existing');
    await assert.rejects(readLearnVaultContext(), /link|junction/i);
    const linkedWorkspace = path.join(scratch, 'linked-project'); await fs.symlink(workspace, linkedWorkspace, 'junction');
    process.env.NEURA_HOME = home;
    await assert.rejects(createLearnWorkshop(linkedWorkspace, () => true).tools().find(tool => tool.name === 'learn_lesson')!.execute(lesson, {}), /link|junction/i);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    if (oldVault === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = oldVault;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('session lease rejects concurrent and unreconciled writers; only its owner releases it', async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-session-lock-')));
  try {
    const id = '12345678-1234-4234-8234-123456789abc';
    const release = await lockSession(scratch, id);
    await assert.rejects(lockSession(scratch, id), /in use|unreconciled/);
    await release(); await release();
    const next = await lockSession(scratch, id);
    await fs.writeFile(path.join(scratch, `${id}.lock`), 'different owner');
    await assert.rejects(next(), /changed/);
    assert.equal(await fs.readFile(path.join(scratch, `${id}.lock`), 'utf8'), 'different owner');
    const directory = path.join(scratch, 'lease-root'); await fs.mkdir(directory);
    const releaseReplaced = await lockSession(directory, id);
    const retained = path.join(scratch, 'retained'); await fs.rename(directory, retained);
    await fs.symlink(retained, directory, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(releaseReplaced(), /Linked session|changed/);
    assert.ok(await fs.stat(path.join(retained, `${id}.lock`)), 'changed directory retains its lock for reconciliation');
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});
