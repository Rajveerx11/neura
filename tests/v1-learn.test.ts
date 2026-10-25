import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPlanFile } from '../agent/neura/plan-files.ts';
import path from 'node:path';
import { createLearnWorkshop } from '../src/learn.ts';
import { createWorkspaceTools, assertWorkspaceOutsideNeuraHome } from '../src/work.ts';
import { readLearnVaultContext } from '../agent/neura/learn-vault.ts';
import { learnLessonRevision } from '../agent/neura/learn-renderer.ts';
import { workshopFixture, sqlExercise } from '../scripts/learn-workshop-fixture.mjs';
import { pdf, zip, presentation } from '../scripts/learn-material-fixtures.mjs';

const decode = (result: any) => JSON.parse(result.content.find((part: any) => part.type === 'text').text);

test('Learn v1: actual document -> cited lesson -> attempt -> save -> new workshop -> resume', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-v1-learn-'));
  const oldHome = process.env.NEURA_HOME;
  const oldVault = process.env.NEURA_LEARN_VAULT;
  process.env.NEURA_HOME = path.join(scratch, 'private-home'); delete process.env.NEURA_LEARN_VAULT;
  try {
    let active = true;
    const learn = createLearnWorkshop(scratch, () => active);
    const tools = learn.tools();
    const invoke = (name: string, input: any) => tools.find(tool => tool.name === name)!.execute(input, {});
    await fs.writeFile(path.join(scratch, 'material.pdf'), pdf(['Customers make bookings']));
    const material = decode(await invoke('learn_material', { path: 'material.pdf', ocr: false }));
    assert.match(material.sourceId, /^sha256:[a-f0-9]{64}$/);
    const lesson = structuredClone(workshopFixture);
    lesson.references = [{ sourceId: material.sourceId, filename: 'material.pdf', unit: 'page', number: 1, excerpt: 'Customers make bookings' }];
    const forged = structuredClone(lesson); forged.references[0].excerpt = 'invented';
    await assert.rejects(() => invoke('learn_lesson', forged), /Citation/);
    await assert.rejects(() => invoke('learn_lesson', { ...lesson, extra: 'denied' }));
    if (process.platform !== 'win32') {
      await assert.rejects(() => invoke('learn_lesson', lesson), /native Windows/);
      return; // Windows-only first-create is a preserved boundary, not simulated away.
    }
    const publication = await invoke('learn_lesson', lesson);
    assert.equal(publication.terminate, true);
    const board = decode(publication).board;
    assert.match(await fs.readFile(board, 'utf8'), /Content-Security-Policy/);
    await assert.rejects(() => invoke('learn_exercise', { answer: 'invented by model' }), /latest answer/);
    const answer = lesson.exercise.kind === 'choice' ? String(lesson.exercise.answer + 1) : 'synthetic learner answer';
    learn.input(answer);
    assert.equal((await invoke('learn_exercise', { answer })).terminate, true);
    await assert.rejects(() => invoke('learn_exercise', { answer }), /latest answer/);
    const hinted = await learn.command('hint'); assert.ok(hinted.text);
    const save = await learn.command('save');
    const filename = /Resume: \/learn resume (\S+)/.exec(save.text)![1];
    const restored = createLearnWorkshop(scratch, () => true);
    const resume = await restored.command(`resume ${filename}`);
    assert.match(resume.text, /historical/);
    const restoredTools = restored.tools();
    const status = decode(await restoredTools.find(tool => tool.name === 'learn_progress')!.execute({ action: 'status' }, {}));
    assert.equal(status.lesson, lesson.title);
    assert.equal(status.attempts.length, 1);
    await assert.rejects(() => restoredTools.find(tool => tool.name === 'learn_lesson')!.execute(lesson, {}), /Reimport/);
    await assert.rejects(() => restored.command(`answer-for ${'0'.repeat(64)} answer`), /Stale board/);
    const revision = learnLessonRevision(status.currentLesson);
    const explanation = await restored.command(`explain-for ${revision}`);
    assert.ok(explanation.prompt);
    await assert.rejects(() => restoredTools.find(tool => tool.name === 'learn_exercise')!.execute({ answer: explanation.prompt }, {}), /latest answer/);
    await assert.rejects(() => restoredTools.find(tool => tool.name === 'learn_progress')!.execute({ action: 'preference', preferenceKey: 'pace', preferenceValue: 'slower', evidence: explanation.prompt }, {}), /latest learner/);
    active = false; learn.invalidate();
    await assert.rejects(() => invoke('learn_progress', { action: 'status' }), /changed/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(() => restoredTools[0].execute({ path: 'material.pdf' }, { signal: aborted.signal }));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
    await fs.writeFile(path.join(scratch, 'material.pptx'), zip(presentation(png)));
    const slides = decode(await restoredTools[0].execute({ path: 'material.pptx', ocr: false }, {}));
    assert.equal(slides.kind, 'pptx');
    assert.ok(slides.pageCount >= 1);
    const sqlLesson = { ...structuredClone(lesson), id: 'sql-practice', references: [], exercise: structuredClone(sqlExercise) };
    await restoredTools.find(tool => tool.name === 'learn_lesson')!.execute(sqlLesson, {});
    assert.equal(JSON.parse((await restored.command(`answer ${sqlExercise.solution}`)).text).correct, true);
    assert.equal(JSON.parse((await restored.command("answer ATTACH DATABASE '/tmp/blocked.db' AS other")).text).correct, false);
    await restored.command('reset');
    await assert.rejects(() => restoredTools[0].execute({ path: 'material.pdf' }, {}), /changed/);
    assert.equal(JSON.parse((await restored.command('status')).text).lesson, null);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    if (oldVault === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = oldVault;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('Work v1: contained writes preserve stale/user bytes; Learn cannot use a stale Work writer', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-v1-work-'));
  try {
    let mode: 'work' | 'learn' = 'work'; let generation = 0;
    const tools = createWorkspaceTools(scratch, () => mode, () => generation);
    const tool = (name: string) => tools.find(item => item.name === name)!;
    await tool('write').execute({ path: 'example.txt', content: 'original', expectedHash: null }, {});
    const read = decode(await tool('read').execute({ path: 'example.txt' }, {}));
    await assert.rejects(() => tool('write').execute({ path: 'example.txt', content: 'lost', expectedHash: null }, {}), /changed|expectedHash/);
    await tool('edit').execute({ path: 'example.txt', old_string: 'original', new_string: 'edited', expectedHash: read.sha256 }, {});
    assert.equal(await fs.readFile(path.join(scratch, 'example.txt'), 'utf8'), 'edited');
    await assert.rejects(() => tool('write').execute({ path: '../escape.txt', content: 'blocked', expectedHash: null }, {}));
    await assert.rejects(() => tool('write').execute({ path: '.env', content: 'blocked', expectedHash: null }, {}));
    await assert.rejects(() => tool('write').execute({ path: 'auth.json', content: 'blocked', expectedHash: null }, {}));
    assert.equal(await fs.readFile(path.join(scratch, 'example.txt'), 'utf8'), 'edited');
    mode = 'learn'; generation++;
    await assert.rejects(() => tool('write').execute({ path: 'another.txt', content: 'blocked', expectedHash: null }, {}), /stale/);
    const learnTools = createWorkspaceTools(scratch, () => mode, () => generation);
    assert.deepEqual(learnTools.map(item => item.name).sort(), ['ls', 'read']);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

// Builtin mocks live only in child processes, never in the application or other tests.
for (const scenario of ['denied', 'stale', 'cancelled', 'unavailable']) {
  test(`Work execution boundary: ${scenario} prevents sandbox/host payload effects`, async () => {
    const source = String.raw`
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import os from 'node:os';
      import child from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { AUTOMATIC_GIT_ARGUMENTS } from './agent/neura/process-security.ts';
      const scenario = process.argv[1];
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-work-boundary-'));
      const workspace = path.join(scratch, 'workspace');
      fs.mkdirSync(workspace);
      process.env.HOME = scratch; process.env.USERPROFILE = scratch;
      process.env.NEURA_HOME = path.join(scratch, 'private');
      delete process.env.NEURA_WSL_DISTRO;
      let probes = 0; let approvals = 0; let generation = 0; let wslPresent = false;
      const unexpected = [];
      const deny = (operation) => { unexpected.push(operation); throw new Error('Unexpected process execution: ' + operation); };
      const exists = fs.existsSync;
      const wsl = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'wsl.exe');
      fs.existsSync = (filename) => String(filename) === wsl ? wslPresent : exists(filename);
      child.execFile = (filename, args, options, callback) => {
        if (String(filename) !== wsl) return deny('execFile target');
        assert.deepEqual(args, ['--exec', 'sh', '-lc', 'command -v bwrap >/dev/null 2>&1']);
        probes++;
        queueMicrotask(() => callback(Object.assign(new Error('Synthetic missing bwrap/distro'), { code: 127 }), '', ''));
      };
      // Permit only synthetic Git identity/metadata responses required by policy binding.
      // No process, including Git, is actually launched by these mocks.
      const version = JSON.parse(fs.readFileSync('agent/neura/runtime-contract.json', 'utf8')).automaticExecutables.git.windowsVersion;
      const metadata = [
        ['rev-parse', '--verify', 'HEAD'], ['ls-files', '--stage', '-z'],
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'],
      ].map(tail => [...AUTOMATIC_GIT_ARGUMENTS, ...tail]);
      child.spawnSync = (filename, args) => {
        if (!/^(?:git|git.exe)$/.test(path.basename(String(filename)).toLowerCase())) return deny('spawnSync target');
        if (JSON.stringify(args) === JSON.stringify(['--version'])) return { status: 0, stdout: version, stderr: '' };
        if (!metadata.some(expected => JSON.stringify(expected) === JSON.stringify(args))) return deny('spawnSync arguments');
        return { status: 128, stdout: '', stderr: 'synthetic non-repository workspace' };
      };
      for (const name of ['exec', 'execSync', 'execFileSync', 'spawn', 'fork']) child[name] = () => deny(name);
      syncBuiltinESMExports();
      try {
        const { createWorkspaceTools } = await import('./src/work.ts');
        const controller = new AbortController();
        const approve = async description => {
          approvals++; assert.match(description, /network-disabled WSL sandbox/);
          if (scenario === 'stale') generation++;
          if (scenario === 'cancelled') controller.abort();
          return scenario !== 'denied';
        };
        const invoke = () => createWorkspaceTools(workspace, () => 'work', () => generation, approve)
          .find(tool => tool.name === 'work_exec').execute({ command: 'printf approved > approved.txt' }, { signal: controller.signal });
        if (scenario === 'unavailable') {
          // Both absent wsl.exe and present-executable/missing-distro states are synthetic.
          for (const present of [false, true]) {
            wslPresent = present;
            await assert.rejects(invoke(), process.platform === 'win32' ? /sandbox unavailable/ : /requires Windows/);
          }
          assert.equal(approvals, 2);
          assert.equal(probes, process.platform === 'win32' ? 1 : 0);
        } else {
          wslPresent = true;
          await assert.rejects(invoke(), scenario === 'denied' ? /Command denied/ : scenario === 'stale' ? /stale tool authority/ : { name: 'AbortError' });
          assert.equal(approvals, 1);
          assert.equal(probes, 0, 'invalid authority must not even probe WSL');
        }
        assert.deepEqual(unexpected, [], 'no host fallback or unexpected subprocess is permitted');
        assert.deepEqual(fs.readdirSync(workspace), [], 'no payload file effects');
        console.log('Work boundary passed: ' + scenario);
      } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    `;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|neura_git_executable)$/i.test(key)));
    const reply = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, scenario], { cwd: path.resolve(import.meta.dirname, '..'), env, timeout: 20000 });
    assert.match(reply.stdout, new RegExp(`Work boundary passed: ${scenario}`));
    assert.equal(reply.stderr, '');
  });
}

test('Work never exposes the Neura credential home or its reserved auth file', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-private-home-'));
  const oldHome = process.env.NEURA_HOME;
  try {
    const home = path.join(scratch, 'home'); const workspace = path.join(scratch, 'project');
    await fs.mkdir(home); await fs.mkdir(workspace); await fs.mkdir(path.join(home, 'nested'));
    process.env.NEURA_HOME = home;
    assert.doesNotThrow(() => assertWorkspaceOutsideNeuraHome(workspace, home));
    assert.doesNotThrow(() => assertWorkspaceOutsideNeuraHome(workspace, path.join(scratch, 'new-home')));
    assert.throws(() => assertWorkspaceOutsideNeuraHome(workspace, path.join(workspace, 'new-home')), /private Neura home/);
    const alias = path.join(scratch, 'project-alias');
    await fs.symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertWorkspaceOutsideNeuraHome(workspace, path.join(alias, 'missing-home')), /Linked|private Neura home/);
    await fs.mkdir(path.join(workspace, 'existing'));
    assert.throws(() => assertWorkspaceOutsideNeuraHome(workspace, path.join(alias, 'existing', 'missing-home')), /private Neura home/);
    const legacy = path.join(scratch, '.pi'); await fs.mkdir(legacy);
    assert.throws(() => createWorkspaceTools(legacy, () => 'work', () => 0), /legacy Pi profile/);
    assert.throws(() => createWorkspaceTools(scratch, () => 'work', () => 0), /private Neura home/);
    assert.throws(() => createWorkspaceTools(path.join(home, 'nested'), () => 'work', () => 0), /private Neura home/);
    const linked = path.join(scratch, 'linked-home'); await fs.symlink(home, linked, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => createWorkspaceTools(linked, () => 'work', () => 0), /private Neura home/);
    const tools = createWorkspaceTools(workspace, () => 'work', () => 0);
    const filename = path.join(workspace, 'codex-auth.json'); const content = '{"access":"synthetic-private-value"}';
    await fs.writeFile(filename, content);
    await assert.rejects(() => tools.find(tool => tool.name === 'read')!.execute({ path: 'codex-auth.json' }, {}));
    await assert.rejects(() => tools.find(tool => tool.name === 'write')!.execute({ path: 'codex-auth.json', content: 'changed', expectedHash: null }, {}));
    const listed = (await tools.find(tool => tool.name === 'ls')!.execute({ path: '.' }, {})).content[0];
    assert.ok(listed.type === 'text'); assert.doesNotMatch(listed.text, /codex-auth|synthetic-private/);
    assert.equal(await fs.readFile(filename, 'utf8'), content);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('Work hashes original bytes but never exposes or rewrites redacted values', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-redaction-'));
  try {
    const filename = path.join(scratch, 'sample.md');
    const original = 'ordinary paragraph\nAuthorization: Bearer synthetic-one\n';
    const changed = original.replace('synthetic-one', 'synthetic-two');
    await fs.writeFile(filename, original);
    const tools = createWorkspaceTools(scratch, () => 'work', () => 0);
    const read = async () => {
      const result = (await tools.find(tool => tool.name === 'read')!.execute({ path: 'sample.md' }, {})).content[0];
      assert.ok(result.type === 'text'); return JSON.parse(result.text);
    };
    const before = await read();
    assert.equal(before.sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(before.redacted, true); assert.equal(before.editable, false); assert.doesNotMatch(before.text, /synthetic-one/);
    assert.doesNotMatch(readPlanFile(scratch, 'sample.md').toString('utf8'), /synthetic-one/);
    await fs.writeFile(filename, changed);
    const after = await read();
    assert.equal(before.text, after.text); assert.notEqual(before.sha256, after.sha256);
    const write = tools.find(tool => tool.name === 'write')!;
    await assert.rejects(() => write.execute({ path: 'sample.md', content: 'model replacement', expectedHash: before.sha256 }, {}), /File changed/);
    await assert.rejects(() => write.execute({ path: 'sample.md', content: 'model replacement', expectedHash: after.sha256 }, {}), /redacted values/);
    await assert.rejects(() => tools.find(tool => tool.name === 'edit')!.execute({ path: 'sample.md', old_string: 'ordinary paragraph', new_string: 'replacement paragraph', expectedHash: after.sha256 }, {}), /redacted values/);
    assert.equal(await fs.readFile(filename, 'utf8'), changed);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('Work cannot rewrite its own reused runtime or bypass that boundary with an approved shell', async () => {
  const root = await fs.realpath(new URL('..', import.meta.url));
  let approvals = 0;
  const tools = createWorkspaceTools(root, () => 'work', () => 0, async () => { approvals++; return true; });
  const write = tools.find(tool => tool.name === 'write')!;
  for (const requested of ['agent/neura/palette.ts', 'agent/neura/verification.ts', 'launcher/neura.cmd', 'src/runtime.ts', 'package.json', 'tsconfig.json']) {
    const filename = path.join(root, requested); const before = await fs.readFile(filename);
    await assert.rejects(() => write.execute({ path: requested, content: 'must not be published', expectedHash: null }, {}), /control-plane/);
    assert.deepEqual(await fs.readFile(filename), before);
  }
  const palette = (await tools.find(tool => tool.name === 'read')!.execute({ path: 'agent/neura/palette.ts' }, {})).content[0];
  assert.ok(palette.type === 'text'); assert.match(palette.text, /PALETTE/);
  await assert.rejects(() => tools.find(tool => tool.name === 'work_exec')!.execute({ command: 'printf harmless' }, {}), /against Neura itself/);
  assert.equal(approvals, 0);
  for (const workspace of [path.join(root, 'agent', 'neura'), path.dirname(root)]) {
    let nested: ReturnType<typeof createWorkspaceTools>;
    try { nested = createWorkspaceTools(workspace, () => 'work', () => 0, async () => { approvals++; return false; }); }
    catch (error) { assert.equal(workspace, path.dirname(root)); assert.match((error as Error).message, /private Neura home/); continue; }
    const requested = path.relative(workspace, path.join(root, 'agent', 'neura', 'palette.ts'));
    await assert.rejects(() => nested.find(tool => tool.name === 'write')!.execute({ path: requested, content: 'must not be published', expectedHash: null }, {}), /control-plane/);
    await assert.rejects(() => nested.find(tool => tool.name === 'work_exec')!.execute({ command: 'printf harmless' }, {}), /against Neura itself/);
  }
  assert.equal(approvals, 0);
});

test('Learn config is Neura-owned: explicit new-home config works; Pi aliases and linked homes are refused', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-vault-config-'));
  const oldHome = process.env.NEURA_HOME; const oldVault = process.env.NEURA_LEARN_VAULT;
  delete process.env.NEURA_LEARN_VAULT;
  try {
    const home = path.join(scratch, 'home'); const vault = path.join(scratch, 'vault');
    await fs.mkdir(home); await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
    await fs.writeFile(path.join(home, 'learn-vault.json'), JSON.stringify({ version: 1, vault }));
    process.env.NEURA_HOME = home;
    assert.equal((await readLearnVaultContext()).enabled, true);
    for (const component of ['.pi', '.PI', '.pi.', '.pi ']) {
      process.env.NEURA_HOME = path.join(scratch, component, 'agent', 'neura');
      await assert.rejects(readLearnVaultContext(), /outside Pi/);
    }
    const linked = path.join(scratch, 'linked-home');
    await fs.symlink(home, linked, process.platform === 'win32' ? 'junction' : 'dir');
    process.env.NEURA_HOME = linked;
    await assert.rejects(readLearnVaultContext(), /link|junction/i);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    if (oldVault === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = oldVault;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
