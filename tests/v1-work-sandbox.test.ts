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

test('configured-host sandbox: model-written code cannot read secrets or leave host-run files', { timeout: 150000 }, async () => {
  assert.equal(process.platform, 'win32', 'Configured-host Work acceptance requires native Windows with WSL2/bubblewrap.');
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-guard-')));
  const oldHome = process.env.NEURA_HOME;
  try {
    const workspace = path.join(scratch, 'workspace'); await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
    process.env.NEURA_HOME = path.join(scratch, 'private');
    await fs.mkdir(path.join(workspace, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.github', 'workflows', 'ci.yml'), 'on: push');
    await fs.writeFile(path.join(workspace, '.env'), 'TOKEN=synthetic-secret');
    await fs.mkdir(path.join(workspace, 'node_modules', '.bin'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'node_modules', 'tool.txt'), 'linked-ok');
    await fs.mkdir(path.join(workspace, 'node_modules', 'demo'));
    for (const file of ['.github/.env', 'node_modules/demo/.env']) await fs.writeFile(path.join(workspace, file), 'fixture-sensitive-nested');
    execFileSync('wsl.exe', ['ln', '-s', '../tool.txt', 'node_modules/.bin/tool'], { cwd: workspace, stdio: 'pipe' });
    const plant = "const fs=require('fs');const t=(n,f)=>{try{f();console.log('wrote',n)}catch(e){console.log('blocked',n,e.code)}};try{console.log('env=['+fs.readFileSync('.env','utf8')+']')}catch(e){console.log('env-blocked='+e.code)};console.log('link='+fs.readFileSync('node_modules/.bin/tool','utf8'));for(const f of ['.github/.env','node_modules/demo/.env']){try{console.log('nested-secret='+f+':'+fs.readFileSync(f,'utf8'))}catch(e){console.log('nested-blocked='+f+':'+e.code)}}t('workflow',()=>fs.writeFileSync('.github/workflows/evil.yml','x'));t('husky',()=>{fs.mkdirSync('.husky');fs.writeFileSync('.husky/pre-commit','x')});t('nested',()=>fs.writeFileSync('src/.git','gitdir: ../git-storage'));t('linked-control',()=>fs.symlinkSync('src','.vscode'));t('secret-control',()=>{fs.mkdirSync('.aws/.git/hooks',{recursive:true});fs.writeFileSync('.aws/.git/hooks/pre-commit','x')})";
    await fs.writeFile(path.join(workspace, 'plant.js'), plant);
    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node plant.js' } }));
    execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'init', '-q'], { cwd: workspace, stdio: 'pipe' });
    let approvals = 0;
    const exec = createWorkspaceTools(workspace, () => 'work', () => 0, async () => { approvals++; return false; }).find(tool => tool.name === 'work_exec')!;
    const part = (await exec.execute({ command: 'npm test' }, {})).content[0]; assert.ok(part.type === 'text');
    const result = JSON.parse(part.text);
    assert.equal(approvals, 0);
    assert.match(result.stdout, /env=\[\]|env-blocked=EACCES/, result.stderr); assert.doesNotMatch(result.stdout, /synthetic-secret/);
    assert.match(result.stdout, /link=linked-ok/, 'a WSL-installed link must not block commands');
    assert.doesNotMatch(result.stdout, /fixture-sensitive-nested/, 'read-only host-run and dependency trees must not disclose secrets');
    for (const file of ['.github/.env', 'node_modules/demo/.env']) {
      assert.ok(result.stdout.includes(`nested-secret=${file}:\n`) || result.stdout.includes(`nested-blocked=${file}:EACCES`), result.stderr);
      assert.equal(await fs.readFile(path.join(workspace, file), 'utf8'), 'fixture-sensitive-nested');
    }
    assert.match(result.stdout, /blocked workflow/);
    assert.notEqual(result.code, 0, 'creating a protected path fails the command');
    assert.match(result.stderr, /removed protected paths[^\n]*\.husky/); assert.match(result.stderr, /src\/\.git/);
    for (const gone of [['.husky'], ['src', '.git'], ['.vscode'], ['.aws', '.git'], ['.github', 'workflows', 'evil.yml']]) await assert.rejects(fs.lstat(path.join(workspace, ...gone)), { code: 'ENOENT' }, gone.join('/'));
    assert.equal(await fs.readFile(path.join(workspace, '.env'), 'utf8'), 'TOKEN=synthetic-secret', 'the host file is untouched');
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('configured-host sandbox: pre-existing hardlink aliases cannot bypass secret or Git protection', { timeout: 150000 }, async () => {
  assert.equal(process.platform, 'win32');
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-hardlink-')));
  const oldHome = process.env.NEURA_HOME;
  try {
    process.env.NEURA_HOME = path.join(scratch, 'private');
    for (const target of ['.env', '.git/config']) {
      const workspace = path.join(scratch, target === '.env' ? 'secret' : 'git'); await fs.mkdir(workspace);
      execFileSync('git', ['init', '-q'], { cwd: workspace, stdio: 'pipe' });
      if (target === '.env') await fs.writeFile(path.join(workspace, target), 'fixture-sensitive-hardlink');
      const original = await fs.readFile(path.join(workspace, target));
      await fs.link(path.join(workspace, target), path.join(workspace, 'ordinary-alias'));
      assert.equal((await fs.stat(path.join(workspace, 'ordinary-alias'))).nlink, 2);
      await fs.writeFile(path.join(workspace, 'plant.js'), "const fs=require('fs');console.log(fs.readFileSync('ordinary-alias','utf8'));fs.appendFileSync('ordinary-alias','changed');fs.writeFileSync('executed.txt','x')");
      await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node plant.js' } }));
      let approvals = 0;
      const exec = createWorkspaceTools(workspace, () => 'work', () => 0, async () => { approvals++; return true; }).find(tool => tool.name === 'work_exec')!;
      await assert.rejects(exec.execute({ command: 'npm test' }, {}), /refused hardlinked workspace entry/);
      assert.equal(approvals, 0);
      assert.deepEqual(await fs.readFile(path.join(workspace, target)), original);
      await assert.rejects(fs.stat(path.join(workspace, 'executed.txt')), { code: 'ENOENT' });
    }
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('configured-host sandbox: large mount lists and paths with spaces survive Windows launch limits', { timeout: 150000 }, async () => {
  assert.equal(process.platform, 'win32');
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-many-mounts-')));
  const oldHome = process.env.NEURA_HOME;
  try {
    const workspace = path.join(scratch, 'workspace with spaces'); await fs.mkdir(workspace);
    process.env.NEURA_HOME = path.join(scratch, 'private');
    for (let index = 0; index < 400; index++) {
      const directory = path.join(workspace, 'packages', `package ${index} ${'x'.repeat(40)}`);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, '.env'), 'fixture-sensitive-many-mounts');
    }
    await fs.writeFile(path.join(workspace, 'plant.js'), "const fs=require('fs');for(const name of fs.readdirSync('packages')){try{if(fs.readFileSync('packages/'+name+'/.env','utf8')!=='')throw new Error('secret exposed')}catch(e){if(e.code!=='EACCES')throw e}}console.log('masked=400')");
    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node plant.js' } }));
    execFileSync('git', ['init', '-q'], { cwd: workspace, stdio: 'pipe' });
    const exec = createWorkspaceTools(workspace, () => 'work', () => 0).find(tool => tool.name === 'work_exec')!;
    const part = (await exec.execute({ command: 'npm test' }, {})).content[0]; assert.ok(part.type === 'text');
    const result = JSON.parse(part.text);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /masked=400/);
    assert.doesNotMatch(result.stdout, /fixture-sensitive-many-mounts/);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test('configured-host sandbox: gitfiles are refused before any project code executes', { timeout: 150000 }, async () => {
  assert.equal(process.platform, 'win32');
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-gitfile-')));
  const oldHome = process.env.NEURA_HOME;
  try {
    process.env.NEURA_HOME = path.join(scratch, 'private');
    for (const separate of [true, false]) {
      const workspace = path.join(scratch, separate ? 'separate' : 'nested'); await fs.mkdir(workspace);
      const plant = "require('fs').writeFileSync('git-storage/hooks/pre-commit','fixture hook')";
      await fs.writeFile(path.join(workspace, 'plant.js'), plant);
      await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node plant.js' } }));
      execFileSync('git', ['init', '-q', ...(separate ? ['--separate-git-dir', 'git-storage'] : [])], { cwd: workspace, stdio: 'pipe' });
      if (!separate) {
        await fs.mkdir(path.join(workspace, 'src'));
        await fs.mkdir(path.join(workspace, 'git-storage', 'hooks'), { recursive: true });
        await fs.writeFile(path.join(workspace, 'src', '.git'), 'gitdir: ../git-storage\n');
      }
      let approvals = 0;
      const exec = createWorkspaceTools(workspace, () => 'work', () => 0, async () => { approvals++; return true; }).find(tool => tool.name === 'work_exec')!;
      await assert.rejects(exec.execute({ command: 'npm test' }, {}), /do not support \.git files/);
      assert.equal(approvals, 0);
      await assert.rejects(fs.stat(path.join(workspace, 'git-storage', 'hooks', 'pre-commit')), { code: 'ENOENT' });
    }
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
