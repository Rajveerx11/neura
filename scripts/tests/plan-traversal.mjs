// Dedicated real-filesystem/Git Plan traversal regressions; no mocked authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { isolate } from './isolation.mjs';
import { repository, git } from './git-fixture.mjs';
const scratch = isolate();
const { authorizePlanPath, readPlanFile, inspectPlanFiles } = await import('../../agent/neura/plan-files.ts');
const cwd = repository(scratch, 'traversal');
const write = (name, text) => {
  fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
  fs.writeFileSync(path.join(cwd, name), text);
};
const failures = [];
async function test(name, fn) {
  try { await fn(); console.log(`PASS traversal: ${name}`); }
  catch (error) { failures.push(name); console.log(`FAIL traversal: ${name}: ${error.message}`); }
}
async function patch(object, key, replacement, fn) {
  const original = object[key];
  object[key] = replacement(original);
  syncBuiltinESMExports();
  try { return await fn(); }
  finally { object[key] = original; syncBuiltinESMExports(); }
}
async function measure(label, fn) {
  let queries = 0, gitMs = 0;
  const inputs = [];
  const started = performance.now();
  let value;
  await patch(childProcess, 'spawnSync', original => (exe, args, options) => {
    const ignore = args.includes('check-ignore');
    const before = performance.now();
    try {
      if (ignore) { queries++; inputs.push(options.input); }
      return original(exe, args, options);
    } finally { if (ignore) gitMs += performance.now() - before; }
  }, async () => {
    try { value = await fn(); }
    finally { console.log(`MEASURE ${label}: queries=${queries} git_ms=${gitMs.toFixed(1)} total_ms=${(performance.now() - started).toFixed(1)}`); }
  });
  return { value, queries, inputs };
}

await test('batched real Git, ordinary find/ls/grep under unchanged 10s budget', async () => {
  const count = 40;
  for (let i = 0; i < count; i++) write(`ordinary/file-${String(i).padStart(2, '0')}.ts`, 'ordinary traversal needle\n');
  const root = path.join(cwd, 'ordinary');
  for (const tool of ['find', 'ls', 'grep']) {
    const result = await measure(tool, () => inspectPlanFiles(root, tool, { pattern: tool === 'find' ? '**/*' : 'traversal needle', literal: true }));
    assert.equal(result.value.split('\n').length, count);
    assert.equal(result.queries, tool === 'grep' ? 2 * count + 1 : 1, 'expected one enumeration query plus uncached before/after reads');
    const batch = result.inputs.find(input => input.split('\0').filter(Boolean).length === count);
    assert.ok(batch, 'directory children must share a real NUL-delimited check-ignore query');
    assert.equal(new Set(batch.split('\0').filter(Boolean)).size, count, 'identical lexical/canonical identities must not be duplicated');
  }
});

await test('literal filesystem brackets/braces remain discoverable; model wildcards stay denied', async () => {
  write('weird/app/[id]/page.tsx', 'weird traversal needle\n');
  write('weird/{literal}.ts', 'weird traversal needle\n');
  const found = await inspectPlanFiles(cwd, 'find', { path: 'weird', pattern: '**/*' });
  assert.match(found, /app\/\[id\]\/page\.tsx/);
  assert.match(found, /\{literal\}\.ts/);
  assert.match(await inspectPlanFiles(cwd, 'ls', { path: 'weird/app' }), /\[id\]\//);
  const grep = await inspectPlanFiles(cwd, 'grep', { path: 'weird', pattern: 'weird traversal needle', literal: true });
  assert.match(grep, /app\/\[id\]\/page\.tsx:1:weird traversal needle/);
  assert.match(grep, /\{literal\}\.ts:1:weird traversal needle/);
  for (const requested of ['weird/app/[id]', 'weird/{literal}.ts', '*.ts', '?', '~', '@alias', '../outside', 'file:stream']) {
    assert.throws(() => authorizePlanPath(cwd, requested));
    assert.throws(() => readPlanFile(cwd, requested));
    await assert.rejects(inspectPlanFiles(cwd, 'find', { path: requested, pattern: '**/*' }));
  }
  for (const pattern of ['[id]/*', '{a,b}', '**\\*']) {
    await assert.rejects(inspectPlanFiles(cwd, 'find', { pattern }), /glob/);
  }
});

await test('large assets and long lines do not abort other authorized matches', async () => {
  write('limits/a-large.bin', 'x'.repeat(8 * 1024 * 1024 + 1));
  write('limits/b-long.ts', 'x'.repeat(16_385) + '\nordinary traversal needle\n');
  write('limits/c-normal.ts', 'ordinary traversal needle\n');
  write('limits/ignored-large.bin', 'x'.repeat(8 * 1024 * 1024 + 1));
  fs.appendFileSync(path.join(cwd, '.gitignore'), 'limits/ignored-large.bin\n');
  assert.ok(authorizePlanPath(cwd, 'limits/a-large.bin').stat.size > 8 * 1024 * 1024);
  assert.throws(() => readPlanFile(cwd, 'limits/a-large.bin'), /size limit/);
  for (const tool of ['find', 'ls']) {
    const value = await inspectPlanFiles(cwd, tool, { path: 'limits', pattern: '**/*' });
    assert.match(value, /a-large\.bin/);
    assert.match(value, /c-normal\.ts/);
    assert.doesNotMatch(value, /ignored-large/);
  }
  for (const glob of ['**/*', '*.ts', 'c-normal.ts']) {
    const value = await inspectPlanFiles(cwd, 'grep', { path: 'limits', pattern: 'ordinary traversal needle', literal: true, glob });
    assert.match(value, /c-normal\.ts:1:ordinary traversal needle/);
    assert.doesNotMatch(value, /b-long\.ts:|ignored-large/);
    if (glob !== 'c-normal.ts') assert.match(value, /skipped.*content limits/i);
    else assert.doesNotMatch(value, /skipped/i);
  }
  const privateOnly = await inspectPlanFiles(cwd, 'grep', { path: 'limits', pattern: 'x', literal: true, glob: 'ignored-large.bin' });
  assert.equal(privateOnly, 'No authorized matches.', 'ignored overlarge files must not produce skip metadata');
});

await test('ignore edits during enumeration, across directories and across calls are fresh', async () => {
  write('changes/victim.ts', 'IGNORE_RACE_CANARY\n');
  write('changes/normal.ts', 'ordinary traversal needle\n');
  const rules = path.join(cwd, '.gitignore');
  const initial = fs.readFileSync(rules, 'utf8');
  for (const tool of ['find', 'ls', 'grep']) {
    fs.writeFileSync(rules, initial);
    await patch(fs, 'readdirSync', original => (...args) => {
      const names = original(...args);
      if (String(args[0]) === path.join(cwd, 'changes')) fs.appendFileSync(rules, 'changes/victim.ts\n');
      return names;
    }, async () => {
      const value = await inspectPlanFiles(cwd, tool, { path: 'changes', pattern: tool === 'find' ? '**/*' : 'IGNORE_RACE_CANARY', literal: true });
      assert.doesNotMatch(value, /victim|IGNORE_RACE_CANARY/);
    });
    fs.writeFileSync(rules, initial);
    const fresh = await inspectPlanFiles(cwd, 'find', { path: 'changes', pattern: '**/*' });
    assert.match(fresh, /victim\.ts/);
  }
  write('across/a/first.ts', 'ordinary traversal needle\n');
  write('across/b/victim.ts', 'IGNORE_RACE_CANARY\n');
  await patch(fs, 'readdirSync', original => (...args) => {
    const names = original(...args);
    if (String(args[0]) === path.join(cwd, 'across/a')) fs.appendFileSync(rules, 'across/b/victim.ts\n');
    return names;
  }, async () => assert.doesNotMatch(await inspectPlanFiles(cwd, 'find', { path: 'across', pattern: '**/*' }), /victim/));
  fs.writeFileSync(rules, initial);
});

await test('ignore changes before and after reads cannot reuse enumeration results', async () => {
  write('read-race/victim.ts', 'IGNORE_READ_CANARY\n');
  const rules = path.join(cwd, '.gitignore');
  const initial = fs.readFileSync(rules, 'utf8');
  let batchChanged = false;
  await patch(childProcess, 'spawnSync', original => (exe, args, options) => {
    const result = original(exe, args, options);
    if (!batchChanged && args.includes('check-ignore') && options.input.includes('read-race/victim.ts')) {
      batchChanged = true;
      fs.appendFileSync(rules, 'read-race/victim.ts\n');
    }
    return result;
  }, async () => assert.doesNotMatch(await inspectPlanFiles(cwd, 'grep', { path: 'read-race', pattern: 'IGNORE_READ_CANARY', literal: true }), /IGNORE_READ_CANARY|victim/));
  assert.ok(batchChanged);
  fs.writeFileSync(rules, initial);
  let readChanged = false;
  const victimStat = fs.statSync(path.join(cwd, 'read-race/victim.ts'));
  await patch(fs, 'readSync', original => (...args) => {
    const count = original(...args);
    const opened = fs.fstatSync(args[0]);
    if (!readChanged && opened.ino === victimStat.ino && opened.dev === victimStat.dev) { readChanged = true; fs.appendFileSync(rules, 'read-race/victim.ts\n'); }
    return count;
  }, async () => {
    assert.throws(() => readPlanFile(cwd, 'read-race/victim.ts'), /confidential/);
    assert.ok(readChanged);
    fs.writeFileSync(rules, initial);
    readChanged = false;
    assert.doesNotMatch(await inspectPlanFiles(cwd, 'grep', { path: 'read-race', pattern: 'IGNORE_READ_CANARY', literal: true }), /IGNORE_READ_CANARY|victim/);
  });
  assert.ok(readChanged);
  fs.writeFileSync(rules, initial);
});

await test('private, tracked/global ignore, canonical links, hardlinks and file races stay denied', async () => {
  write('boundaries/public/normal.ts', 'ordinary traversal needle\n');
  write('boundaries/private/hidden.ts', 'BOUNDARY_CANARY\n');
  write('boundaries/ignored/hidden.ts', 'BOUNDARY_CANARY\n');
  git(cwd, 'add', '-f', 'boundaries/ignored/hidden.ts');
  fs.appendFileSync(path.join(cwd, '.gitignore'), 'boundaries/ignored/\n');
  write('boundaries/global.ts', 'BOUNDARY_CANARY\n');
  const globalRules = path.join(scratch, 'traversal-global-ignore');
  fs.writeFileSync(globalRules, 'boundaries/global.ts\n');
  const config = process.env.GIT_CONFIG_GLOBAL;
  const previousConfig = fs.readFileSync(config, 'utf8');
  fs.appendFileSync(config, `\n[core]\n excludesFile = "${globalRules.replaceAll('\\', '/')}"\n`);
  const outside = path.join(scratch, 'traversal-outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'outside.ts'), 'BOUNDARY_CANARY\n');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(outside, path.join(cwd, 'boundaries/outside-link'), linkType);
  fs.symlinkSync(path.join(cwd, 'boundaries/ignored'), path.join(cwd, 'boundaries/ignored-link'), linkType);
  fs.symlinkSync(path.join(cwd, 'boundaries/public'), path.join(cwd, 'boundaries/source-link'), linkType);
  fs.linkSync(path.join(outside, 'outside.ts'), path.join(cwd, 'boundaries/hardlink.ts'));
  try {
    for (const tool of ['find', 'ls', 'grep']) {
      const value = await inspectPlanFiles(cwd, tool, { path: 'boundaries', pattern: tool === 'find' ? '**/*' : 'BOUNDARY_CANARY', literal: true });
      assert.doesNotMatch(value, /hidden|global\.ts|outside-link|ignored-link|hardlink|BOUNDARY_CANARY/);
      if (tool !== 'grep') assert.match(value, /normal\.ts|public\//);
    }
    assert.match(await inspectPlanFiles(cwd, 'grep', { path: 'boundaries/source-link', pattern: 'ordinary traversal needle', literal: true }), /normal\.ts:1:/);
    const linkedRead = await measure('canonical-link-read', () => readPlanFile(cwd, 'boundaries/source-link/normal.ts').toString('utf8'));
    assert.match(linkedRead.value, /ordinary traversal needle/);
    assert.equal(linkedRead.queries, 2);
    for (const input of linkedRead.inputs) {
      assert.ok(input.includes('boundaries/source-link/normal.ts\0'));
      assert.ok(input.includes('boundaries/public/normal.ts\0'));
    }
    for (const name of ['boundaries/ignored/hidden.ts', 'boundaries/global.ts', 'boundaries/hardlink.ts', 'boundaries/outside-link/outside.ts', 'boundaries/ignored-link/hidden.ts']) assert.throws(() => readPlanFile(cwd, name));
    let changed = false;
    const normalStat = fs.statSync(path.join(cwd, 'boundaries/public/normal.ts'));
    await patch(fs, 'readSync', original => (...args) => {
      const count = original(...args);
      const opened = fs.fstatSync(args[0]);
      if (!changed && opened.ino === normalStat.ino && opened.dev === normalStat.dev) { changed = true; write('boundaries/public/normal.ts', 'changed content\n'); }
      return count;
    }, async () => assert.throws(() => readPlanFile(cwd, 'boundaries/public/normal.ts'), /changed/));
    assert.ok(changed);
  } finally { fs.writeFileSync(config, previousConfig); }
});

await test('link replacement during a directory batch cannot expose stale metadata', async () => {
  write('metadata-race/public/normal.ts', 'ordinary traversal needle\n');
  write('metadata-race/private/hidden.ts', 'METADATA_RACE_CANARY\n');
  const alias = path.join(cwd, 'metadata-race/alias');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(path.join(cwd, 'metadata-race/public'), alias, linkType);
  let swapped = false;
  await patch(childProcess, 'spawnSync', original => (exe, args, options) => {
    const result = original(exe, args, options);
    if (!swapped && args.includes('check-ignore') && options.input.includes('metadata-race/alias\0')) {
      swapped = true;
      fs.unlinkSync(alias);
      fs.symlinkSync(path.join(cwd, 'metadata-race/private'), alias, linkType);
    }
    return result;
  }, async () => assert.doesNotMatch(await inspectPlanFiles(cwd, 'ls', { path: 'metadata-race' }), /alias|private|hidden|METADATA_RACE_CANARY/));
  assert.ok(swapped);
});

await test('metadata query failure and cancellation remain fail-closed', async () => {
  await patch(childProcess, 'spawnSync', original => (exe, args, options) => args.includes('check-ignore') ? { status: 2, stdout: '', stderr: '' } : original(exe, args, options), async () => {
    assert.throws(() => readPlanFile(cwd, 'ordinary/file-00.ts'), /failed closed/);
    // Traversal may reject or return no authorized entries; neither may reveal names/content.
    try { assert.equal(await inspectPlanFiles(cwd, 'find', { path: 'ordinary', pattern: '**/*' }), 'No authorized matches.'); }
    catch (error) { assert.match(error.message, /failed closed/); }
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(inspectPlanFiles(cwd, 'grep', { path: 'ordinary', pattern: 'needle', literal: true }, controller.signal), /aborted/);
});
assert.deepEqual(failures, [], 'dedicated Plan traversal regressions failed');
console.log('PASS plan traversal');
