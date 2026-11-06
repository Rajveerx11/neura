// Explicit configured-host acceptance. Missing Windows/WSL/bubblewrap is a failure, not a skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createWorkspaceTools } from '../src/work.ts';

test('configured-host Work acceptance: approved command succeeds only through the real sandbox', { timeout: 150000 }, async () => {
  assert.equal(process.platform, 'win32', 'Configured-host Work acceptance requires native Windows with WSL2/bubblewrap.');
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-host-')));
  const oldHome = process.env.NEURA_HOME;
  try {
    const workspace = path.join(scratch, 'workspace'); await fs.mkdir(workspace);
    process.env.NEURA_HOME = path.join(scratch, 'private');
    let approvals = 0;
    const tools = createWorkspaceTools(workspace, () => 'work', () => 0, async description => {
      approvals++; assert.match(description, /network-disabled WSL sandbox/); return true;
    });
    const result = (await tools.find(tool => tool.name === 'work_exec')!.execute({ command: "printf 'approved\\n' > approved.txt" }, {})).content[0];
    assert.ok(result.type === 'text'); assert.equal(JSON.parse(result.text).code, 0);
    assert.equal(await fs.readFile(path.join(workspace, 'approved.txt'), 'utf8'), 'approved\n');
    assert.equal(approvals, 1);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('configured-host sandbox: test scripts run with no prompt and cannot change .git', { timeout: 150000 }, async () => {
  assert.equal(process.platform, 'win32', 'Configured-host Work acceptance requires native Windows with WSL2/bubblewrap.');
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-git-')));
  const oldHome = process.env.NEURA_HOME;
  try {
    const workspace = path.join(scratch, 'workspace'); await fs.mkdir(workspace);
    process.env.NEURA_HOME = path.join(scratch, 'private');
    const plant = "const fs=require('fs');for(const f of ['.git/hooks/pre-commit','.git/config'])try{fs.appendFileSync(f,'planted');console.log('wrote',f)}catch(e){console.log('blocked',f,e.code)}fs.writeFileSync('built.txt','ok')";
    await fs.writeFile(path.join(workspace, 'plant.js'), plant);
    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node plant.js' } }));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', ...args], { cwd: workspace, stdio: 'pipe' });
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
    const config = await fs.readFile(path.join(workspace, '.git', 'config'));
    let approvals = 0;
    const exec = createWorkspaceTools(workspace, () => 'work', () => 0, async () => { approvals++; return false; }).find(tool => tool.name === 'work_exec')!;
    const run = async (command: string) => { const part = (await exec.execute({ command }, {})).content[0]; assert.ok(part.type === 'text'); return JSON.parse(part.text); };
    const test = await run('npm test');
    assert.equal(test.code, 0, test.stderr);
    assert.match(test.stdout, /blocked \.git\/hooks\/pre-commit/); assert.match(test.stdout, /blocked \.git\/config/);
    assert.doesNotMatch(test.stdout, /wrote/);
    assert.equal(await fs.readFile(path.join(workspace, 'built.txt'), 'utf8'), 'ok', 'the rest of the workspace stays writable');
    assert.deepEqual(await fs.readFile(path.join(workspace, '.git', 'config')), config);
    await assert.rejects(fs.stat(path.join(workspace, '.git', 'hooks', 'pre-commit')), { code: 'ENOENT' });
    const status = await run('git status --short');
    assert.equal(status.code, 0, status.stderr); assert.match(status.stdout, /built\.txt/);
    assert.equal(approvals, 0);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
