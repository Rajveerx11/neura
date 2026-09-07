import assert from "node:assert/strict";
import { assertLearnExercise, evaluateLearnExercise } from "../agent/neura/learn-exercises.ts";
import { assertLearnLesson, renderLearnHtml, learnLessonRevision } from "../agent/neura/learn-renderer.ts";
import { workshopFixture, sqlExercise } from "./learn-workshop-fixture.mjs";

const clone = (value) => structuredClone(value);
assertLearnLesson(workshopFixture);
assert.match(learnLessonRevision(workshopFixture), /^[a-f0-9]{64}$/);
assert.equal(learnLessonRevision(workshopFixture), learnLessonRevision(clone(workshopFixture)));
assert.notEqual(learnLessonRevision(workshopFixture), learnLessonRevision({ ...workshopFixture, example: "A different worked example." }));
assert.match(renderLearnHtml(workshopFixture, { historical: true }), /Saved snapshot — source excerpts have not been reverified/);
assert.doesNotMatch(renderLearnHtml(workshopFixture), /Saved snapshot — source excerpts have not been reverified/);
for (const kind of ["flow", "er", "sequence"]) {
  const fixture = clone(workshopFixture); fixture.diagram.kind = kind;
  const html = renderLearnHtml(fixture);
  assert.match(html, /<svg role="img"/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
}
const malicious = clone(workshopFixture);
malicious.title = '</title><script>globalThis.pwned=true</script>';
malicious.example = '<img src="https://example.invalid/track" onerror="alert(1)">';
malicious.references[0].excerpt = '<script>fetch("https://example.invalid")</script>';
const escaped = renderLearnHtml(malicious);
assert.ok(!escaped.includes(malicious.title));
assert.ok(!escaped.includes(malicious.example));
assert.match(escaped, /\\u003cscript/);
for (const mutate of [
  (value) => { value.bullets = ["only one"]; },
  (value) => { value.diagram.nodes[0].id = '../outside'; },
  (value) => { value.diagram.nodes[1].id = value.diagram.nodes[0].id; },
  (value) => { value.diagram.edges[0].from = 'missing'; },
  (value) => { value.diagram.focus = 'missing'; },
  (value) => { value.references[0].sourceId = 'forged'; },
  (value) => { value.currentStep = 99; },
  (value) => { value.title = '\0invalid'; },
]) { const fixture = clone(workshopFixture); mutate(fixture); assert.throws(() => assertLearnLesson(fixture)); }
assert.equal((await evaluateLearnExercise(workshopFixture.exercise, '1')).correct, true);
assert.equal((await evaluateLearnExercise(workshopFixture.exercise, '2')).correct, false);
const short = { kind: 'short', prompt: 'Name the key', acceptedAnswers: ['foreign key'], hints: ['It refers to another table.'], explanation: 'A foreign key connects tables.' };
assert.equal((await evaluateLearnExercise(short, ' FOREIGN   KEY ')).correct, true);
assert.equal((await evaluateLearnExercise(short, 'primary key')).correct, false);
assert.equal((await evaluateLearnExercise({ ...short, acceptedAnswers: [] }, 'My reasoning')).correct, null);

const good = await evaluateLearnExercise(sqlExercise, sqlExercise.solution);
assert.equal(good.correct, true, good.feedback);
assert.equal(good.rows.length, 3);
const count = await evaluateLearnExercise({ ...sqlExercise, expectedRows: [{ total: 3 }] }, 'SELECT count(*) AS total FROM bookings');
assert.equal(count.correct, true, count.feedback);
const nullExpected = { ...sqlExercise, expectedRows: [{ value: null }] };
assert.equal((await evaluateLearnExercise(nullExpected, 'SELECT NULL AS value')).correct, true);
for (const expression of ['1e999', '-1e999', '1e20', '-1e20']) {
  const numeric = await evaluateLearnExercise(nullExpected, `SELECT ${expression} AS value`);
  assert.equal(numeric.correct, false, 'Invalid SQL numbers must not serialize to a matching null');
  assert.equal(numeric.rows, undefined);
  assert.match(numeric.feedback, /finite.*safe/);
}
assert.equal((await evaluateLearnExercise(sqlExercise, 'SELECT name FROM customers')).correct, false);
assert.equal((await evaluateLearnExercise({ ...sqlExercise, expectedRows: undefined }, 'SELECT name FROM customers')).correct, null);
assert.equal((await evaluateLearnExercise(sqlExercise, `${sqlExercise.solution} ORDER BY name DESC`)).correct, true);
for (const query of [
  'ATTACH DATABASE \'outside.db\' AS outside', 'SELECT 1; DROP TABLE customers',
  'SELECT load_extension(\'outside\')', 'SELECT readfile(\'C:/Windows/win.ini\')',
  'SELECT * FROM sqlite_master', 'SELECT * FROM pragma_database_list',
  'SELECT randomblob(1000000000)', 'SELECT printf(\'%1000000000s\',\'x\')',
  'WITH RECURSIVE numbers(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM numbers) SELECT * FROM numbers',
  'WITH x AS (SELECT 1) DELETE FROM customers', 'SELECT name FROM customers INTO OUTFILE \'outside\'',
  'SELECT name FROM customers\n;\nATTACH DATABASE \'outside\' AS outside',
]) {
  const denied = await evaluateLearnExercise(sqlExercise, query);
  assert.equal(denied.correct, false, `Unexpectedly allowed: ${query}`);
  assert.match(denied.feedback, /^SQL lab:/, denied.feedback);
  assert.equal(denied.rows, undefined);
}
await assert.rejects(() => evaluateLearnExercise(sqlExercise, 'SELECT \0'));
const badTable = clone(sqlExercise); badTable.tables[0].name = 'customers"; ATTACH';
assert.throws(() => assertLearnExercise(badTable));
const badRows = clone(sqlExercise); badRows.tables[0].rows[0][0] = Infinity;
assert.throws(() => assertLearnExercise(badRows));
const duplicateColumns = await evaluateLearnExercise(sqlExercise, 'SELECT customers.id, bookings.id FROM customers JOIN bookings');
assert.match(duplicateColumns.feedback, /unique column aliases/);
const large = clone(sqlExercise);
large.tables = [{ name: 'items', columns: [{ name: 'id', type: 'INTEGER' }], rows: Array.from({ length: 200 }, (_, index) => [index]) }];
const truncated = await evaluateLearnExercise(large, 'SELECT a.id FROM items a CROSS JOIN items b');
assert.equal(truncated.rows.length, 200); assert.equal(truncated.truncated, true); assert.equal(truncated.correct, null);
const started = Date.now();
const timeout = await evaluateLearnExercise(large, 'SELECT count(*) FROM items a, items b, items c, items d, items e');
assert.equal(timeout.correct, false); assert.match(timeout.feedback, /limit/); assert.ok(Date.now() - started < 6000);
assert.equal((await evaluateLearnExercise(sqlExercise, sqlExercise.solution)).correct, true, 'Fresh lab survives prohibited/resource-heavy prior attempts');
console.log('Learn workshop: structured diagrams, escaping, choice/short/SQL grading, denied operations, bounded results and timeout passed.');
