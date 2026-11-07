import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { canonicalLearnPath, learnPathLayers, learnPathRevision, renderLearnPathText, type LearnPath } from '../agent/neura/learn-path.ts';
import { assertLearnLesson, learnBoardRevision, renderLearnHtml, renderLearnPathHtml, type LearnLesson } from '../agent/neura/learn-renderer.ts';
import { LearnLessonSchema } from '../agent/neura/learn-schema.ts';
import { appendLearnVaultEvent, learnPropositionId, type LearnVaultInput } from '../agent/neura/learn-vault.ts';
import { emptyState, evidenceIdentity, currentAttempts, snapshot, restoreSnapshot, proposePath, acceptPlan, advanceLearn, guardLesson } from '../src/learn-state.ts';
import { createLearnWorkshop } from '../src/learn.ts';
import { runTurn } from '../src/runtime.ts';
import { fixture } from './model-fixture.ts';

const curriculum: LearnPath = { goal: 'Use joins to report bookings', targetConceptId: 'joins',
  concepts: [{ id: 'joins', title: 'Join tables' }, { id: 'keys', title: 'Keys' }, { id: 'rows', title: 'Rows' }],
  edges: [{ from: 'keys', to: 'joins' }, { from: 'rows', to: 'keys' }] };
const card: LearnLesson = { id: 'atomic-card', title: 'One question', goal: 'Understand keys', steps: ['Explain a key'], currentStep: 0,
  bullets: [], references: [], exercise: { kind: 'short', prompt: 'What identifies a row?', acceptedAnswers: ['primary key'], hints: ['Think of identity.'], explanation: 'A primary key identifies a row.' } };
const call = (toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: toolName, toolName, input: JSON.stringify(input) });

test('curriculum: bounded, goal-relevant acyclic DAG; canonical layers and revision ignore input order', () => {
  assert.deepEqual(learnPathLayers(curriculum), [['rows'], ['keys'], ['joins']]);
  const reordered = { ...curriculum, concepts: [...curriculum.concepts].reverse(), edges: [...curriculum.edges].reverse() };
  assert.deepEqual(canonicalLearnPath(reordered), canonicalLearnPath(curriculum));
  assert.equal(learnPathRevision(curriculum), learnPathRevision(reordered));
  const fork: LearnPath = { goal: 'Combine concepts', targetConceptId: 'target', concepts: ['z', 'a', 'target'].map(id => ({ id, title: id })), edges: [{ from: 'z', to: 'target' }, { from: 'a', to: 'target' }] };
  assert.deepEqual(learnPathLayers(fork), [['a', 'z'], ['target']]);
  const maximum: LearnPath = { goal: 'Bounded route', targetConceptId: 'n23', concepts: Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, title: `Concept ${i}` })), edges: Array.from({ length: 23 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) };
  for (let from = 0; maximum.edges.length < 48; from++) for (let to = from + 2; to < 24 && maximum.edges.length < 48; to++) maximum.edges.push({ from: `n${from}`, to: `n${to}` });
  assert.equal(learnPathLayers(maximum).flat().length, 24);
  for (const invalid of [
    { ...curriculum, edges: [...curriculum.edges, { from: 'joins', to: 'rows' }] },
    { ...curriculum, edges: [...curriculum.edges, curriculum.edges[0]] },
    { ...curriculum, edges: [{ from: 'missing', to: 'joins' }] },
    { ...curriculum, edges: [{ from: 'rows', to: 'rows' }] },
    { ...curriculum, concepts: [...curriculum.concepts, curriculum.concepts[0]] },
    { ...curriculum, concepts: [...curriculum.concepts, { id: 'unrelated', title: 'Unrelated' }] },
    { ...maximum, concepts: [...maximum.concepts, { id: 'n24', title: 'Too many' }] },
    { ...maximum, edges: [...maximum.edges, { from: 'n0', to: 'n23' }] },
    { ...curriculum, targetConceptId: 'missing' },
  ]) assert.throws(() => learnPathLayers(invalid));
  for (const columns of [12, 20, 40, 80]) {
    const text = renderLearnPathText(curriculum, 'keys', ['rows'], columns);
    assert.ok(text.split('\n').every(line => Array.from(line).length <= columns));
    assert.doesNotMatch(text, /\x1b/);
  }
  const unicode = renderLearnPathText({ ...curriculum, goal: '界'.repeat(70) }, 'rows', [], 20);
  assert.ok(unicode.split('\n').every(line => Array.from(line).reduce((cells, character) => cells + (character === '界' ? 2 : 1), 0) <= 20));
});

test('atomic/probe cards omit diagram and example; path board contains layers, status and keyboard links', () => {
  assert.doesNotThrow(() => z.fromJSONSchema(JSON.parse(JSON.stringify(LearnLessonSchema))).parse(card));
  assertLearnLesson(card);
  const html = renderLearnHtml(card, { curriculum: { path: curriculum, current: 'keys', completed: [], accepted: true } });
  assert.match(html, /Layer 1/); assert.match(html, /Prerequisite/); assert.match(html, /Current concept/); assert.match(html, /Upcoming/);
  assert.match(html, /href="#path-keys" aria-current="step"/);
  assert.doesNotMatch(html, /<svg|id="show-example"/);
  assert.match(html, new RegExp(learnBoardRevision(card, curriculum)));
  assert.notEqual(learnBoardRevision(card, curriculum), learnBoardRevision(card, { ...curriculum, goal: 'A different goal' }));
  const hostile = { ...curriculum, goal: '<script>bad()</script>', concepts: curriculum.concepts.map(node => ({ ...node, title: '<img onerror=bad()>' })) };
  const board = renderLearnPathHtml({ path: hostile, current: 'rows', completed: [], accepted: false });
  assert.doesNotMatch(board, /<script|<img/); assert.match(board, /&lt;script/);
  assert.match(board, /default-src 'none'/);
});

test('evidence identity isolates path, concept, step, exercise, lesson and instructional check', () => {
  const state = emptyState(); state.lesson = structuredClone(card);
  const identity = evidenceIdentity(state)!;
  state.attempts.push({ lessonId: card.id, identity, answer: 'primary key', correct: true, feedback: 'Correct', assisted: false, revealed: false, at: new Date().toISOString() });
  assert.equal(currentAttempts(state).length, 1);
  for (const modified of [
    { ...card, id: 'another-lesson' }, { ...card, conceptId: 'other-concept' }, { ...card, stepId: 'another-step' },
    { ...card, goal: 'Another goal' }, { ...card, exercise: { ...card.exercise, prompt: 'Different question' } },
    { ...card, phase: 'check' as const },
  ]) { state.lesson = modified; assert.equal(currentAttempts(state).length, 0); }
  state.lesson = card; state.path = curriculum; assert.equal(currentAttempts(state).length, 0);
  state.path = undefined; state.attempts[0].identity = undefined;
  assert.equal(currentAttempts(state).length, 0, 'legacy lessonId-only evidence never unlocks a check');
});

test('snapshot v1 migration quarantines evidence; v2 preserves transitions and rejects impossible progress', () => {
  const state = emptyState(); state.lesson = structuredClone(card);
  state.attempts = [{ lessonId: card.id, answer: 'primary key', correct: true, feedback: 'Correct', assisted: false, revealed: false, at: new Date().toISOString() }];
  const legacy = { ...snapshot(state), version: 1 };
  const migrated = restoreSnapshot(legacy);
  assert.equal(migrated.phase, 'probe'); assert.equal(migrated.wait, 'awaiting-answer');
  assert.equal(currentAttempts(migrated).length, 0); assert.equal(migrated.attempts.length, 1);
  assert.throws(() => advanceLearn(migrated), /Answer/);
  assert.deepEqual(snapshot(restoreSnapshot(snapshot(migrated))), snapshot(migrated));
  const planned = emptyState(); proposePath(planned, curriculum); acceptPlan(planned);
  assert.deepEqual(snapshot(restoreSnapshot(snapshot(planned))), snapshot(planned));
  for (const invalid of [
    { ...snapshot(planned), phase: 'practice', conceptId: 'joins' },
    { ...snapshot(planned), completed: ['joins'] },
    { ...snapshot(planned), completed: ['rows', 'rows'] },
    { ...snapshot(planned), wait: 'awaiting-answer' },
    { ...snapshot(planned), conceptId: undefined },
    { ...snapshot(planned), phase: 'probe' },
    { ...snapshot(planned), path: { ...curriculum, edges: [...curriculum.edges, { from: 'joins', to: 'rows' }] } },
  ]) assert.throws(() => restoreSnapshot(invalid));
  assert.throws(() => guardLesson(planned, { ...card, conceptId: 'joins' }), /prerequisites/);
});

test('active Mastra pedagogy: probe, plan acceptance, explicit next, failed-check remediation, DAG completion and recovery', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-pedagogy-')));
  const oldHome = process.env.NEURA_HOME; const oldVault = process.env.NEURA_LEARN_VAULT;
  process.env.NEURA_HOME = path.join(scratch, 'home'); delete process.env.NEURA_LEARN_VAULT;
  try {
    const learn = createLearnWorkshop(scratch, () => true);
    const invoke = (name: string, input: unknown) => learn.tools().find(tool => tool.name === name)!.execute(input, {});
    const status = async () => JSON.parse((await learn.command('status')).text);
    await assert.rejects(invoke('learn_lesson', { ...card, phase: 'practice' }), /Expected probe/);
    await assert.rejects(learn.command('accept-plan'), /No proposed/);
    await invoke('learn_lesson', { ...card, phase: 'probe' });
    await assert.rejects(learn.command('next'), /Answer/);
    await assert.rejects(invoke('learn_path', { path: curriculum }), /diagnostic/);
    await learn.command('answer primary key');
    assert.equal((await status()).phase, 'probe'); assert.equal((await status()).wait, 'awaiting-continuation');
    await assert.rejects(invoke('learn_lesson', card), /learn next/);
    await assert.rejects(learn.command('answer primary key'), /learn next/);
    await learn.command('next');
    const model = fixture([[call('learn_path', { path: curriculum })], [{ type: 'text', text: 'Must stop' }]]);
    const proposal = await runTurn({ model: model.model, instructions: await learn.instructions(), messages: [{ role: 'user', content: 'Plan the route' }], tools: learn.tools() });
    assert.equal(model.requests.length, 1); assert.match(proposal.text, /accept-plan/);
    await assert.rejects(invoke('learn_lesson', { ...card, phase: 'teach', conceptId: 'rows' }), /accept-plan/);
    assert.match((await learn.command('path')).text, /Proposed path/);
    const saved = /Resume: \/learn resume (\S+)/.exec((await learn.command('save')).text)![1];
    const resumed = createLearnWorkshop(scratch, () => true); await resumed.command(`resume ${saved}`);
    assert.equal(JSON.parse((await resumed.command('status')).text).phase, 'plan');
    await learn.command('accept-plan');
    await assert.rejects(invoke('learn_lesson', { ...card, phase: 'teach', conceptId: 'joins' }), /prerequisites/);
    const lesson = (phase: 'teach' | 'check' | 'practice' | 'review', conceptId = 'rows') => ({ ...card, phase, conceptId });
    await invoke('learn_lesson', lesson('teach'));
    await assert.rejects(learn.command(`answer-for ${learnBoardRevision(lesson('teach'))} primary key`), /Stale board/);
    await learn.command('answer primary key'); await learn.command('next');
    await invoke('learn_lesson', lesson('check')); await learn.command('answer wrong');
    const feedbackSave = /Resume: \/learn resume (\S+)/.exec((await learn.command('save')).text)![1];
    await resumed.command(`resume ${feedbackSave}`);
    assert.equal(JSON.parse((await resumed.command('status')).text).wait, 'awaiting-continuation');
    await resumed.command('next'); assert.equal(JSON.parse((await resumed.command('status')).text).phase, 'teach');
    await assert.rejects(invoke('learn_lesson', lesson('practice')), /learn next/);
    await learn.command('next'); assert.equal((await status()).phase, 'teach');
    await assert.rejects(invoke('learn_lesson', lesson('check')), /Expected teach/);
    for (const conceptId of ['rows', 'keys', 'joins']) {
      for (const phase of ['teach', 'check', 'practice', 'review'] as const) {
        assert.equal((await status()).phase, phase); assert.equal((await status()).conceptId, conceptId);
        await invoke('learn_lesson', lesson(phase, conceptId));
        assert.equal((await status()).attempts.length, phase === 'teach' && conceptId === 'rows' ? 1 : phase === 'check' && conceptId === 'rows' ? 1 : 0);
        await learn.command('answer primary key');
        await assert.rejects(invoke('learn_lesson', lesson(phase, conceptId)), /learn next/);
        await learn.command('next');
      }
    }
    assert.deepEqual((await status()).completed, ['rows', 'keys', 'joins']);
    assert.equal((await status()).conceptId, null);
    await assert.rejects(invoke('learn_lesson', lesson('review', 'joins')), /prerequisites/);
    assert.match((await learn.command('path')).text, /Done: joins/);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    if (oldVault === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = oldVault;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('vault knowledge: concept-scoped content identities, stable notes, typed links and superseding corrections', async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-knowledge-')));
  const oldVault = process.env.NEURA_LEARN_VAULT; process.env.NEURA_LEARN_VAULT = scratch;
  try {
    await fs.mkdir(path.join(scratch, '.obsidian'));
    const base = { lessonId: 'keys-card', conceptId: 'keys', title: 'Keys', topic: 'Database relationships' };
    const content = 'A key identifies a row.';
    const propositionId = learnPropositionId(content);
    const claim: LearnVaultInput = { ...base, type: 'proposition', content, relations: [] };
    await appendLearnVaultEvent(claim); await appendLearnVaultEvent({ ...claim, content: '  A key identifies a row.  ' });
    const events = path.join(scratch, 'Neura', '_System', 'events');
    assert.equal((await fs.readdir(events)).length, 1);
    await appendLearnVaultEvent({ ...claim, conceptId: 'other-concept' });
    assert.equal((await fs.readdir(events)).length, 2, 'same claim in another concept has separate scope');
    const relationTypes = ['requires', 'supports', 'example-of', 'contradicts', 'supersedes'] as const;
    await appendLearnVaultEvent({ ...claim, content: 'A primary key identifies a row uniquely.', relations: relationTypes.map(type => ({ type, conceptId: 'keys', propositionId })) });
    const conceptRoot = path.join(scratch, 'Neura', 'Concepts');
    const keysDirectory = (await fs.readdir(conceptRoot)).find(name => name.startsWith('keys-'))!;
    const notes = await fs.readdir(path.join(conceptRoot, keysDirectory));
    const text = (await Promise.all(notes.map(name => fs.readFile(path.join(conceptRoot, keysDirectory, name), 'utf8')))).join('\n');
    for (const type of relationTypes) assert.match(text, new RegExp(`${type}: \\[\\[Neura/Concepts/`));
    assert.match(text, new RegExp(propositionId));
    const envelope = JSON.parse(await fs.readFile(path.join(events, '0002.json'), 'utf8'));
    assert.equal(envelope.event.propositionId, learnPropositionId('A primary key identifies a row uniquely.'));
    await assert.rejects(appendLearnVaultEvent({ ...claim, relations: [{ type: 'supersedes', conceptId: 'keys', propositionId: envelope.event.propositionId }] }), /cycle/);
    const oldNote = path.join(conceptRoot, keysDirectory, `${propositionId}.md`);
    await fs.writeFile(oldNote, 'User edit must survive');
    await appendLearnVaultEvent(claim);
    assert.equal(await fs.readFile(oldNote, 'utf8'), 'User edit must survive');
    const stableCount = (await fs.readdir(conceptRoot, { recursive: true })).length;
    await appendLearnVaultEvent(claim);
    assert.equal((await fs.readdir(conceptRoot, { recursive: true })).length, stableCount);
    await assert.rejects(appendLearnVaultEvent({ ...claim, relations: [{ type: 'supersedes', conceptId: 'keys', propositionId: '0'.repeat(64) }] }), /existing different/);
    await assert.rejects(appendLearnVaultEvent({ ...claim, relations: [{ type: 'supersedes', conceptId: 'keys', propositionId }] }), /existing different/);
    await assert.rejects(appendLearnVaultEvent({ ...claim, relations: [{ type: 'requires', conceptId: '../escape' }] }), /relation/);
    await assert.rejects(appendLearnVaultEvent({ ...base, type: 'concept', goal: 'A goal', bullets: [], example: '', nextStep: 'Practice', relations: [{ type: 'supersedes', conceptId: 'keys', propositionId }] }), /proposition event/);
    const repeatedContent = { ...base, type: 'concept' as const, goal: 'A goal', bullets: ['Repeated claim.', '  Repeated claim.  '], example: '', nextStep: 'Practice' };
    await appendLearnVaultEvent(repeatedContent);
    const lastSlot = (await fs.readdir(events)).sort().at(-1)!;
    const repeatedEvent = JSON.parse(await fs.readFile(path.join(events, lastSlot), 'utf8'));
    assert.equal(repeatedEvent.event.propositions.length, 1);
    const unsafe = { ...claim, relations: [{ type: 'exec', conceptId: 'keys' }] } as unknown as LearnVaultInput;
    await assert.rejects(appendLearnVaultEvent(unsafe), /relation/);
    const linked = path.join(conceptRoot, keysDirectory);
    const outside = path.join(scratch, 'outside'); await fs.mkdir(outside);
    await fs.rename(linked, path.join(scratch, 'retained-keys'));
    await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(appendLearnVaultEvent({ ...claim, content: 'Must not escape' }), /link|junction/);
    assert.deepEqual(await fs.readdir(outside), []);
    const topicNotes = await fs.readdir(path.join(scratch, 'Neura', 'Topics'), { recursive: true });
    assert.ok(topicNotes.some(name => name.endsWith('.md')));
  } finally {
    if (oldVault === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = oldVault;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
