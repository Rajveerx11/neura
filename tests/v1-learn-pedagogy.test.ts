import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { canonicalLearnPath, learnId, learnPathLayers, learnPathRevision, renderLearnPathText, type LearnPath } from '../agent/neura/learn-path.ts';
import { assertLearnLesson, learnBoardRevision, renderLearnCardText, renderLearnHtml, renderLearnPathHtml, type LearnLesson } from '../agent/neura/learn-renderer.ts';
import { LearnLessonSchema } from '../agent/neura/learn-schema.ts';
import { appendLearnVaultEvent, learnPropositionId, type LearnVaultInput } from '../agent/neura/learn-vault.ts';
import { emptyState, evidenceIdentity, currentAttempts, snapshot, restoreSnapshot, proposePath, acceptPlan, advanceLearn, guardLesson, LEARN_ASKED_MAX } from '../src/learn-state.ts';
import { createLearnWorkshop } from '../src/learn.ts';
import { runTurn, ToolFeedbackError } from '../src/runtime.ts';
import { evaluateLearnExercise, learnShortAnswerMatches } from '../agent/neura/learn-exercises.ts';
import { importLearningMaterial, validateLearningCitation } from '../agent/neura/learn-materials.ts';
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
  const longHyphenLesson = { ...card, id: `${'a'.repeat(69)}-x`, stepId: undefined };
  const longIdentity = evidenceIdentity(state, longHyphenLesson)!;
  assert.doesNotMatch(longIdentity.stepId, /--/);
  assert.ok(learnId(longIdentity.stepId));
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
  const oversized = emptyState(); oversized.attempts = [{ ...state.attempts[0], asked: 'x'.repeat(LEARN_ASKED_MAX + 1) }];
  assert.throws(() => restoreSnapshot(snapshot(oversized)), /Invalid saved attempt/);
  oversized.attempts[0].asked = 'A table of 0.25, 0.50, 0.25';
  assert.equal(restoreSnapshot(snapshot(oversized)).attempts[0].asked, 'A table of 0.25, 0.50, 0.25');
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

test('short answers accept equivalent math and complexity forms without accepting different values', () => {
  for (const [accepted, answer] of [['0.375', '3/8'], ['3/8', '37.5%'], ['0.5', '.5'], ['1/3', '0.333'], ['1/3', '33.3%'], ['0.3125', '0.312'], ['O(n log n)', 'o(nlogn)'], ['O(n^2)', 'O(n²)'], ['low = mid + 1;', 'low=mid+1'], ['-2', '−2']])
    assert.equal(learnShortAnswerMatches(accepted, answer), true, `${accepted} / ${answer}`);
  for (const [accepted, answer] of [['0.375', '3/9'], ['0.25', '0.3'], ['1/3', '0.33'], ['0.5', '5'], ['1/0', '1/0.0'], ['O(n)', 'O(n^2)'], ['0.5', '0.6%'], ['12', '12.4']])
    assert.equal(learnShortAnswerMatches(accepted, answer), false, `${accepted} / ${answer}`);
});

test('choice answers: numeric options mean values, text options keep numbering; board sends option text', async () => {
  const numeric = { kind: 'choice' as const, prompt: 'Comparisons?', options: ['2', '4', '8'], answer: 1, hints: ['Count.'], explanation: 'Four.' };
  assert.equal((await evaluateLearnExercise(numeric, '4')).correct, true);
  assert.equal((await evaluateLearnExercise(numeric, '2')).correct, false, 'a bare 2 is the value, not the second option');
  const named = { ...numeric, options: ['Stack', 'Queue'], answer: 1 };
  assert.equal((await evaluateLearnExercise(named, '2')).correct, true);
  assert.equal((await evaluateLearnExercise(named, 'queue')).correct, true);
  assert.equal((await evaluateLearnExercise(named, '1')).correct, false);
  const html = renderLearnHtml({ ...card, exercise: numeric });
  assert.match(html, /exercise\.options\[Number\(answer\)-1\]\.trim\(\)/, 'numeric options send the value, never a position');
  assert.match(html, /const matches=function learnShortAnswerMatches/);
  assert.doesNotMatch(html, /accepted: string/, 'board script must be plain JavaScript');
});

test('chat card shows the question, options and diagram text, but never the answer key; path display needs no model text', async () => {
  const board = path.join(os.tmpdir(), 'lesson-x.html');
  const lesson: LearnLesson = { ...card, phase: 'teach', example: 'Worked: row 7 has key 7.', diagram: { kind: 'flow', title: 'Pointer move', nodes: [{ id: 'prev', label: 'prev' }, { id: 'curr', label: 'curr', detail: 'Current node' }], edges: [{ from: 'curr', to: 'prev', label: 'next points back' }] },
    exercise: { kind: 'choice', prompt: 'Which is identity?', options: ['Primary key', 'Sort order'], answer: 0, hints: ['SECRET-HINT'], explanation: 'SECRET-EXPLANATION' } };
  const text = renderLearnCardText(lesson, board);
  for (const shown of ['[teach]', 'Which is identity?', '1. Primary key', '2. Sort order', 'curr --(next points back)--> prev', 'Worked: row 7', 'file:///']) assert.ok(text.includes(shown), shown);
  assert.doesNotMatch(text, /SECRET/);
  assert.match(renderLearnCardText({ ...lesson, exercise: { ...lesson.exercise, options: ['2', '4'] } as LearnLesson['exercise'] }, board), /<the value>/);
  const display = { content: [{ type: 'text' as const, text: 'model-only json' }], display: 'THE CARD', terminate: true };
  const tools = [{ name: 'card', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => display }];
  const preamble = fixture([[{ type: 'text', text: 'Here is your card.' }, { type: 'tool-call', toolCallId: 'a', toolName: 'card', input: '{}' }], [{ type: 'text', text: 'Must stop' }]]);
  const chunks: string[] = [];
  const shown = await runTurn({ model: preamble.model, messages: [{ role: 'user', content: 'x' }], instructions: 'T', tools, onText: chunk => chunks.push(chunk) });
  assert.match(chunks.join(''), /Here is your card\.[\s\S]*THE CARD/); assert.match(shown.text, /THE CARD/);
  const silent = fixture([[{ type: 'tool-call', toolCallId: 'a', toolName: 'card', input: '{}' }], [{ type: 'text', text: 'Must stop' }]]);
  assert.equal((await runTurn({ model: silent.model, messages: [{ role: 'user', content: 'x' }], instructions: 'T', tools })).text, 'THE CARD');
  assert.doesNotMatch(JSON.stringify(silent.requests), /THE CARD/);
});

test('text materials: HTML notes and C source import as inert citable text; unsafe inputs stay refused', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-text-material-')));
  const write = (name: string, value: string | Buffer) => fs.writeFile(path.join(scratch, name), value);
  try {
    await write('notes.html', '<html><head><title>x</title><style>.a{}</style></head><body><script>steal()</script><h1>Worst case</h1><p>O(n<sup>2</sup>) when sorted &amp; pivot &rarr; last</p><!-- hidden --></body></html>');
    await write('lab.c', 'int pivot = arr[high]; /* Lomuto */\n');
    await write('big.txt', Array.from({ length: 200 }, () => 'x'.repeat(5999)).join('\n'));
    await write('data.txt', Buffer.from([0x66, 0x00, 0x67]));
    await write('invalid.txt', Buffer.from([0xff, 0xfe, 0x41]));
    await write('tool.exe', 'MZ');
    await fs.mkdir(path.join(scratch, '.hidden')); await write(path.join('.hidden', 'n.html'), '<p>no</p>');
    const notes = await importLearningMaterial({ workspace: scratch, path: 'notes.html' });
    assert.equal(notes.kind, 'text');
    assert.match(notes.pages[0].text, /O\(n\^2\) when sorted & pivot → last/);
    assert.doesNotMatch(notes.pages[0].text, /steal|hidden|\.a\{|<h1>/);
    assert.equal(validateLearningCitation(notes, { sourceId: notes.id, filename: 'notes.html', unit: 'page', number: 1, excerpt: 'when sorted & pivot' }), true);
    assert.equal(validateLearningCitation(notes, { sourceId: notes.id, filename: 'notes.html', unit: 'slide', number: 1, excerpt: 'when sorted & pivot' }), false);
    assert.equal(validateLearningCitation(notes, { sourceId: notes.id, filename: 'notes.html', unit: 'page', number: 1, excerpt: 'not in the notes' }), false);
    assert.match((await importLearningMaterial({ workspace: scratch, path: 'lab.c' })).pages[0].text, /Lomuto/);
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: 'big.txt' }), /limit is 100/);
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: 'data.txt' }), /binary/);
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: 'invalid.txt' }), /UTF-8/);
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: 'tool.exe' }), /Supported learning materials/);
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: '.hidden/n.html' }), /hidden/);
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: '../outside.html' }), /inside the workspace/);
    await fs.mkdir(path.join(scratch, 'private')); await write(path.join('private', 'n.md'), 'no');
    await write('credentials.txt', 'no');
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: 'private/n.md' }), /private or credential/);
    await assert.rejects(importLearningMaterial({ workspace: scratch, path: 'credentials.txt' }), /private or credential/);
    await write('leak.txt', 'keep this\nAPI_KEY=abc123secret\n');
    const redacted = await importLearningMaterial({ workspace: scratch, path: 'leak.txt' });
    assert.match(redacted.pages[0].text, /keep this/); assert.doesNotMatch(redacted.pages[0].text, /abc123secret/);
    const state = emptyState(); state.materials.set(notes.id, notes);
    const restored = restoreSnapshot(snapshot(state));
    assert.equal(restored.materials.get(notes.id)!.kind, 'text');
    assert.equal(restored.verifiedSources.size, 0, 'saved excerpts still require reimport');
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('mastery gates: revealed answers cannot pass, ungraded checks are refused with a reason, remediation survives a fresh process', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-gates-')));
  const oldHome = process.env.NEURA_HOME; const oldVault = process.env.NEURA_LEARN_VAULT;
  process.env.NEURA_HOME = path.join(scratch, 'home'); delete process.env.NEURA_LEARN_VAULT;
  try {
    const single: LearnPath = { goal: 'One idea', targetConceptId: 'rows', concepts: [{ id: 'rows', title: 'Rows' }], edges: [] };
    const learn = createLearnWorkshop(scratch, () => true);
    const invoke = (name: string, input: unknown) => learn.tools().find(tool => tool.name === name)!.execute(input, {});
    const phase = async () => JSON.parse((await learn.command('status')).text).phase;
    const lesson = (value: string, extra: object = {}) => ({ ...card, phase: value, conceptId: 'rows', ...extra });
    await invoke('learn_lesson', { ...card, phase: 'probe' }); await learn.command('answer primary key'); await learn.command('next');
    await invoke('learn_path', { path: single }); await learn.command('accept-plan');
    await invoke('learn_lesson', lesson('teach')); await learn.command('answer primary key'); await learn.command('next');
    assert.equal(await phase(), 'check');
    const ungraded = { exercise: { kind: 'short', prompt: 'Explain.', acceptedAnswers: [], hints: ['Think.'], explanation: 'Open.' } };
    await assert.rejects(invoke('learn_lesson', lesson('check', ungraded)), (error: Error) => error instanceof ToolFeedbackError && /automatically graded/.test(error.message));
    const model = fixture([[call('learn_lesson', lesson('check', ungraded))], [{ type: 'text', text: 'Noted.' }]]);
    await runTurn({ model: model.model, instructions: 'T', messages: [{ role: 'user', content: 'x' }], tools: learn.tools() });
    assert.match(JSON.stringify(model.requests[1].prompt), /automatically graded/, 'the model sees why the card was refused');
    await invoke('learn_lesson', lesson('check')); await learn.command('reveal'); await learn.command('answer primary key');
    const revealed = await learn.command('next');
    assert.equal(await phase(), 'teach', 'a revealed answer goes back to teaching');
    assert.match(revealed.text, /remediation required/);
    assert.match(revealed.prompt!, /"revealed":true/);
    await invoke('learn_lesson', lesson('teach')); await learn.command('answer primary key'); await learn.command('next');
    await invoke('learn_lesson', lesson('check', { exercise: { kind: 'choice', prompt: 'SECOND-CHECK', options: ['GOOD-OPTION', 'wrong idea'], answer: 0, hints: ['Think.'], explanation: 'Because.' } })); await learn.command('answer 2');
    const file = /Resume: \/learn resume (\S+)/.exec((await learn.command('save')).text)![1];
    const fresh = createLearnWorkshop(scratch, () => true); await fresh.command(`resume ${file}`);
    const remediation = await fresh.command('next');
    assert.match(remediation.prompt!, /SECOND-CHECK/); assert.match(remediation.prompt!, /wrong idea/); assert.match(remediation.prompt!, /"learnerAnswer":"2"/);
    assert.doesNotMatch(remediation.prompt!, /acceptedAnswers/);
    const asked = JSON.parse((await fresh.command('status')).text).otherLessonHistory.attempts.map((attempt: { asked?: string }) => attempt.asked);
    assert.ok(asked.some((text?: string) => text?.includes('SECOND-CHECK')), 'questions asked before a save stay visible after resume');
    assert.ok(asked.every((text?: string) => text && text.length <= LEARN_ASKED_MAX));
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
    await fs.unlink(linked);
    await fs.rename(path.join(scratch, 'retained-keys'), linked);
    // Concept with omitted example
    await appendLearnVaultEvent({ ...base, type: 'concept', goal: 'Example-free goal', bullets: ['A core truth.'], nextStep: 'Practice' });
    const topicNotes = await fs.readdir(path.join(scratch, 'Neura', 'Topics'), { recursive: true });
    assert.ok(topicNotes.some(name => name.endsWith('.md')));
    // Proposition is filed under Topics, never Learner/Mistakes
    const learnerDir = path.join(scratch, 'Neura', 'Learner');
    try {
      const learnerFiles = await fs.readdir(learnerDir, { recursive: true });
      assert.ok(!learnerFiles.some(file => String(file).includes(propositionId)));
    } catch (err) {
      // Learner directory may not even exist for purely knowledge events
      assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
    }
  } finally {
    if (oldVault === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = oldVault;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
