import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineInventory, validateMatrix } from '../scripts/check-parity-matrix.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const exists = (file: string) => fs.existsSync(path.join(root, file));
const link = 'https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/';
const owner = (issue: number) => `[M](https://github.com/Rajveerx11/neura/issues/${issue})`;
const row = (id: string, status = '`partial`', issue = 116) => `| \`${id}\` | [src](${link}x.ts) | ${owner(issue)} | ${status} | none | needed | |`;
const synthetic = (rows: string[]) => ['Baseline 3ebaac07c8320125bcc32478b5aa3865746a997c', ...rows].join('\n');
const inventory = { extensions: ['a.ts', 'b.ts'], commands: ['go'], exists };
const complete = [row('ext:a.ts'), row('ext:b.ts'), row('cmd:/go'), row('gate:human-away', '`unavailable`'), row('gate:full-proof', '`unavailable`', 121)];

test('real matrix covers every baseline extension and command with one owner and an honest status', () => {
  const baseline = baselineInventory(root);
  assert.equal(baseline.extensions.length, 19);
  assert.equal(baseline.commands.length, 15);
  const text = fs.readFileSync(path.join(root, 'docs/PARITY_MATRIX.md'), 'utf8');
  assert.deepEqual(validateMatrix(text, { ...baseline, exists }), []);
});

test('synthetic complete matrix passes; an omitted extension fails', () => {
  assert.deepEqual(validateMatrix(synthetic(complete), inventory), []);
  const errors = validateMatrix(synthetic(complete.filter(line => !line.includes('ext:b.ts'))), inventory);
  assert.ok(errors.some(error => error.includes('ext:b.ts: missing')), errors.join('\n'));
});

test('unowned, out-of-range owner and missing permalink rows fail', () => {
  const unowned = complete.map(line => line.replace(owner(116), 'TBD'));
  assert.ok(validateMatrix(synthetic(unowned), inventory).some(error => error.includes('exactly one owner')));
  const foreign = complete.map(line => line.replace(owner(116), owner(91)));
  assert.ok(validateMatrix(synthetic(foreign), inventory).some(error => error.includes('exactly one owner')));
  const unlinked = complete.map(line => line.replace(link, 'https://example.com/'));
  assert.ok(validateMatrix(synthetic(unlinked), inventory).some(error => error.includes('missing baseline permalink')));
});

test('Human Away or full proof marked implemented fails, as do invalid statuses and fake evidence', () => {
  const away = complete.map(line => line.includes('gate:human-away') ? line.replace('`unavailable`', '`implemented`').replace('| none |', '| `tests/v1-cli.test.ts` |') : line);
  assert.ok(validateMatrix(synthetic(away), inventory).some(error => error.includes('Human Away and full proof cannot be implemented')));
  const proof = complete.map(line => line.includes('gate:full-proof') ? line.replace('`unavailable`', '`implemented`') : line);
  assert.ok(validateMatrix(synthetic(proof), inventory).some(error => error.includes('cannot be implemented')));
  const supported = complete.map(line => line.includes('ext:a.ts') ? line.replace('`partial`', '`supported`') : line);
  assert.ok(validateMatrix(synthetic(supported), inventory).some(error => error.includes('invalid status')));
  const invented = complete.map(line => line.includes('ext:a.ts') ? line.replace('| none |', '| `tests/does-not-exist.test.ts` |') : line);
  assert.ok(validateMatrix(synthetic(invented), inventory).some(error => error.includes('evidence path does not exist')));
});
