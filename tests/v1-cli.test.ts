import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { workshopFixture } from '../scripts/learn-workshop-fixture.mjs';
import { windowsShortPath } from './windows-short-path.ts';
import { automaticGitEnvironment, AUTOMATIC_GIT_ARGUMENTS, resolveExecutable } from '../agent/neura/process-security.ts';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

function syntheticEnvironment(home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|neura_git_executable)$/i.test(key)));
  return { ...env, HOME: home, USERPROFILE: home, NEURA_HOME: home, MASTRA_TELEMETRY_DISABLED: '1' };
}

async function interactiveFixture(options: { inputs: string[]; args?: string[]; tool?: boolean; denyModel?: boolean; catalogError?: unknown; jsonResponse?: boolean; launchFromHome?: boolean; omitCwd?: boolean; writeTool?: boolean; history?: boolean; sseContentType?: string | null; reasoning?: boolean; gitWorkspace?: boolean }) {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-models-')));
  try {
    const workspace = path.join(scratch, 'workspace'); const profile = path.join(scratch, 'profile');
    const home = options.launchFromHome ? path.join(profile, '.neura') : path.join(scratch, 'home');
    await fs.mkdir(workspace); await fs.mkdir(profile);
    await fs.writeFile(path.join(workspace, 'sample.txt'), 'synthetic-private-value');
    if (options.gitWorkspace) {
      const git = resolveExecutable('git', workspace); assert.ok(git);
      const run = (args: string[]) => exec(git, [...AUTOMATIC_GIT_ARGUMENTS, ...args], { cwd: workspace, env: automaticGitEnvironment(), timeout: 10000 });
      await run(['init', '--initial-branch=main']);
      await run(['add', 'sample.txt']);
      await run(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'fixture']);
    }
    const config = path.join(scratch, 'fixture.json');
    await fs.writeFile(config, JSON.stringify({ ...options, workspace }));
    const reply = await exec(process.execPath, ['tests/cli-interactive-fixture.mjs'], { cwd: root, env: { ...syntheticEnvironment(profile), TEMP: scratch, TMP: scratch, NEURA_HOME: home, NEURA_CLI_FIXTURE: config }, timeout: 20000 });
    const match = /NEURA_FIXTURE_REQUESTS=(.+)/.exec(reply.stdout);
    assert.ok(match, 'The real CLI must consume all synthetic interactive input');
    assert.ok(!reply.stdout.includes('synthetic-private-value'));
    assert.ok(!reply.stderr.includes('synthetic-private-value'));
    if (!options.history) await assert.rejects(fs.stat(path.join(home, 'sessions')), { code: 'ENOENT' });
    if (options.launchFromHome) {
      const opened = /^Scratch workspace: (.+)$/m.exec(reply.stdout)?.[1];
      assert.ok(opened, 'Home launches must show the selected scratch directory');
      assert.equal(path.dirname(opened), scratch);
      assert.match(path.basename(opened), /^neura-workspace-/);
      await assert.rejects(fs.stat(path.join(opened, 'sample.txt')), { code: 'ENOENT' });
      if (options.writeTool) assert.equal(await fs.readFile(path.join(opened, 'smoke.txt'), 'utf8'), 'scratch-only');
      await assert.rejects(fs.stat(path.join(profile, 'smoke.txt')), { code: 'ENOENT' });
      assert.deepEqual(await fs.readdir(home), options.history ? ['codex-auth.json', 'sessions'] : ['codex-auth.json']);
      if (options.history) {
        const key = createHash('sha256').update(process.platform === 'win32' ? opened.toLowerCase() : opened).digest('hex');
        assert.deepEqual(await fs.readdir(path.join(home, 'sessions')), [key], 'History must be scoped to the new workspace, not the user profile');
        const files = await fs.readdir(path.join(home, 'sessions', key));
        assert.equal(files.filter(name => name.endsWith('.json')).length, 1);
        assert.ok(!files.some(name => name.endsWith('.lock')), 'The session writer lease must be released');
      }
    }
    return { ...reply, requests: JSON.parse(match[1]) as Array<{ type: string; model?: string; summary?: string | null }> };
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

test('bare interactive launch from the user home uses a separate scratch workspace, including actual Work writes', async () => {
  const idle = await interactiveFixture({ launchFromHome: true, history: true, inputs: ['/help', '/quit'] });
  assert.match(idle.stdout, /work > /);
  assert.equal(idle.stderr, '');
  assert.deepEqual(idle.requests, [], 'Startup must not authenticate or call a provider');
  const written = await interactiveFixture({ launchFromHome: true, writeTool: true, inputs: ['Create a synthetic file', '/quit'] });
  assert.match(written.stdout, /\[tool\] write: returned/);
  assert.equal(written.stderr, '');
  assert.deepEqual(written.requests, [{ type: 'catalog' }, { type: 'model', model: 'fixture-first' }, { type: 'model', model: 'fixture-first' }]);
  const project = await interactiveFixture({ omitCwd: true, inputs: ['/help', '/quit'] });
  assert.ok(!project.stdout.includes('Scratch workspace:'));
  assert.deepEqual(project.requests, []);
});

test('bare /model lists advertised subscription choices, reprompts bad input and selects a real request model', async () => {
  const reply = await interactiveFixture({ inputs: ['/model', 'invalid', '2', 'hi', '/quit'] });
  assert.match(reply.stdout, /Current model: \(not selected\)/);
  assert.match(reply.stdout, /1\. fixture-first \(catalog default\)/);
  assert.match(reply.stdout, /2\. fixture-second/);
  assert.match(reply.stdout, /Choose one of the listed models/);
  assert.match(reply.stdout, /Model: fixture-second/);
  assert.match(reply.stdout, /Hello from selected model/);
  assert.ok(!reply.stdout.includes('fixture-hidden'));
  assert.deepEqual(reply.requests, [{ type: 'catalog' }, { type: 'model', model: 'fixture-second' }]);
  const byId = await interactiveFixture({ inputs: ['/model', 'fixture-second', 'hi', '/quit'] });
  assert.deepEqual(byId.requests, [{ type: 'catalog' }, { type: 'model', model: 'fixture-second' }]);
});

test('first request uses the catalog default and real Agent tool calls are visible without payloads', async () => {
  const reply = await interactiveFixture({ inputs: ['hi', '/quit'], tool: true });
  assert.match(reply.stdout, /Model: fixture-first \(subscription catalog default\)/);
  for (const phase of ['requested', 'started', 'returned']) assert.match(reply.stdout, new RegExp('\\[tool\\] read: ' + phase));
  assert.match(reply.stdout, /Hello from selected model/);
  assert.deepEqual(reply.requests, [{ type: 'catalog' }, { type: 'model', model: 'fixture-first' }, { type: 'model', model: 'fixture-first' }]);
});

test('subscription picker followed by a JSON model response completes text and tool turns without retries', async () => {
  for (const tool of [false, true]) {
    const reply = await interactiveFixture({ inputs: ['/model', '1', 'hi', '/quit'], tool, jsonResponse: true });
    assert.match(reply.stdout, /Model: fixture-first/);
    assert.match(reply.stdout, /Hello from selected model/);
    assert.equal(reply.stderr, '');
    assert.deepEqual(reply.requests, [{ type: 'catalog' }, ...Array.from({ length: tool ? 2 : 1 }, () => ({ type: 'model', model: 'fixture-first' }))]);
    if (tool) for (const phase of ['requested', 'started', 'returned']) assert.match(reply.stdout, new RegExp('\\[tool\\] read: ' + phase));
  }
});

test('CLI accepts completed Responses SSE with generic or missing MIME without retrying the task', async () => {
  for (const sseContentType of ['text/plain; charset=utf-8', 'application/octet-stream', null]) {
    const reply = await interactiveFixture({ launchFromHome: true, inputs: ['hi', '/quit'], sseContentType, writeTool: true });
    assert.match(reply.stdout, /Hello from selected model/);
    assert.match(reply.stdout, /\[tool\] write: returned/);
    assert.equal(reply.stderr, '');
    assert.deepEqual(reply.requests, [{ type: 'catalog' }, { type: 'model', model: 'fixture-first' }, { type: 'model', model: 'fixture-first' }]);
  }
});

test('thinking status and provider summaries are separate from the answer and can be disabled', async () => {
  const args = ['--model', 'gpt-6.1-sol'];
  for (const jsonResponse of [false, true]) {
    const shown = await interactiveFixture({ inputs: ['hi', '/quit'], args, reasoning: true, jsonResponse });
    assert.match(shown.stdout, /\[thinking\] Waiting for model response/);
    assert.match(shown.stdout, /\[reasoning summary\][\s\S]*I will inspect the workspace before answering/);
    assert.match(shown.stdout, /\[answer\][\s\S]*Hello from selected model/);
    assert.ok(shown.stdout.indexOf('[thinking]') < shown.stdout.indexOf('[reasoning summary]'));
    assert.ok(shown.stdout.indexOf('[reasoning summary]') < shown.stdout.indexOf('[answer]'));
    assert.deepEqual(shown.requests, [{ type: 'model', model: 'gpt-6.1-sol', summary: 'auto' }]);
  }
  const toggled = await interactiveFixture({ inputs: ['/thinking off', 'hi', '/thinking on', 'hi', '/quit'], args, reasoning: true, jsonResponse: true });
  assert.equal(toggled.stdout.split('[reasoning summary]').length - 1, 1);
  assert.deepEqual(toggled.requests.map(request => request.summary), [null, 'auto']);
  const hidden = await interactiveFixture({ inputs: ['hi', '/quit'], args: [...args, '--no-thinking'], reasoning: true, jsonResponse: true });
  assert.ok(!hidden.stdout.includes('[reasoning summary]'));
  assert.deepEqual(hidden.requests.map(request => request.summary), [null]);
});

test('manual /verify is provider-free, full proof fails closed, and denied quick checks never execute', async () => {
  const full = await interactiveFixture({ inputs: ['/verify full', '/quit'], gitWorkspace: true });
  assert.match(full.stdout, /full_evidence_unavailable/);
  assert.match(full.stdout, /"verified": false/);
  assert.match(full.stdout, /No tests were run/);
  assert.deepEqual(full.requests, []);
  const denied = await interactiveFixture({ inputs: ['/verify quick', 'no', '/verify status', '/new', '/verify status', '/quit'], gitWorkspace: true });
  assert.match(denied.stdout, /approval_denied/);
  assert.match(denied.stdout, /"current": false/);
  assert.match(denied.stdout, /No verification receipt in this session/);
  assert.deepEqual(denied.requests, []);
  const learn = await interactiveFixture({ inputs: ['/mode learn', '/verify quick', '/quit'], gitWorkspace: true });
  assert.match(learn.stderr, /Verification is available only in Work/);
  assert.ok(!learn.stdout.includes('Type yes to approve'));
  assert.deepEqual(learn.requests, []);
  await assert.rejects(interactiveFixture({ inputs: [], args: ['--prompt', '/verify full'], gitWorkspace: true }), (error: Error & { stdout?: string }) => /full_evidence_unavailable/.test(error.stdout ?? ''));
});

test('headless /model lists current subscription choices without inference or a selection prompt', async () => {
  const reply = await interactiveFixture({ inputs: [], args: ['--prompt', '/model'] });
  assert.match(reply.stdout, /Current model: \(not selected\)/);
  assert.match(reply.stdout, /fixture-first/);
  assert.ok(!reply.stdout.includes('Choose a number'));
  assert.deepEqual(reply.requests, [{ type: 'catalog' }]);
});

test('model cancellation, catalog denial and explicit rejected models never trigger hidden retries', async () => {
  const cancelled = await interactiveFixture({ inputs: ['/model', '', 'hi', '/quit'], args: ['--model', 'fixture-explicit'] });
  assert.match(cancelled.stdout, /Model unchanged/);
  assert.deepEqual(cancelled.requests, [{ type: 'catalog' }, { type: 'model', model: 'fixture-explicit' }]);
  const interrupted = await interactiveFixture({ inputs: ['/model', '[CTRL_C]', '/quit'], args: ['--model', 'fixture-explicit'] });
  assert.match(interrupted.stderr, /aborted/i);
  assert.deepEqual(interrupted.requests, [{ type: 'catalog' }]);
  const denied = await interactiveFixture({ inputs: ['hi', '/quit'], args: ['--model', 'fixture-explicit'], denyModel: true });
  assert.match(denied.stdout, /Use \/model to choose a subscription model/);
  assert.deepEqual(denied.requests, [{ type: 'model', model: 'fixture-explicit' }]);
  const failedCatalog = await interactiveFixture({ inputs: ['/model', '/quit'], catalogError: { error: { code: 'unknown', message: 'synthetic-private-value' } } });
  assert.match(failedCatalog.stderr, /model discovery denied \(403\)/);
  assert.deepEqual(failedCatalog.requests, [{ type: 'catalog' }]);
});

test('home scratch fallback never retargets explicit, headless or resume requests and retains private-root denial', async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-home-boundary-')));
  const profile = path.join(scratch, 'profile'); const home = path.join(profile, '.neura');
  await fs.mkdir(home, { recursive: true });
  const source = String.raw`
    import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
    import { createRequire, syncBuiltinESMExports } from 'node:module';
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    process.chdir(process.env.USERPROFILE);
    let readlineCalls = 0; let allocations = 0;
    createRequire(import.meta.url)('node:readline/promises').createInterface = () => { readlineCalls++; throw new Error('Must not open readline'); };
    const mkdtemp = fs.mkdtempSync;
    fs.mkdtempSync = (...args) => { allocations++; return mkdtemp(...args); };
    syncBuiltinESMExports();
    globalThis.fetch = async () => { throw new Error('No provider or credential requests allowed'); };
    const { main } = await import('./src/cli.ts');
    const listeners = process.listenerCount('SIGINT');
    for (const args of [
      ['--cwd', process.env.USERPROFILE, '--no-history'],
      ['--cwd', process.env.NEURA_HOME, '--no-history'],
      ['--prompt', '/help', '--no-history'],
      ['--resume', '00000000-0000-4000-8000-000000000000'],
    ]) await assert.rejects(main(args), /private Neura home/);
    await assert.rejects(main(['--provider', 'invalid', '--no-history']), /Unsupported provider/);
    assert.equal(allocations, 0, 'Explicit or noninteractive requests must not allocate scratch workspaces');
    process.env.TEMP = process.env.NEURA_HOME; process.env.TMP = process.env.NEURA_HOME;
    await assert.rejects(main(['--no-history']), /private Neura home/);
    assert.equal(allocations, 1);
    assert.deepEqual(fs.readdirSync(process.env.NEURA_HOME), [], 'Rejected scratch allocation must be removed');
    const pi = path.join(process.env.USERPROFILE, '.pi'); fs.mkdirSync(pi);
    process.env.TEMP = pi; process.env.TMP = pi;
    await assert.rejects(main(['--no-history']), /legacy Pi profile/);
    assert.deepEqual(fs.readdirSync(pi), []);
    assert.equal(readlineCalls, 0);
    assert.equal(process.listenerCount('SIGINT'), listeners);
    console.log('home fallback boundaries passed');
  `;
  try {
    const reply = await exec(process.execPath, ['--input-type=module', '-e', source], { cwd: root, env: { ...syntheticEnvironment(profile), NEURA_HOME: home }, timeout: 20000 });
    assert.match(reply.stdout, /home fallback boundaries passed/);
    assert.equal(reply.stderr, '');
    await assert.rejects(fs.stat(path.join(home, 'sessions')), { code: 'ENOENT' });
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('invalid startup model/provider opens no readline or interrupt handler; valid commands clean up', async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-invalid-model-')));
  const workspace = path.join(scratch, 'workspace'); await fs.mkdir(workspace);
  const source = String.raw`
    import assert from 'node:assert/strict';
    import { createRequire, syncBuiltinESMExports } from 'node:module';
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    let readlineCalls = 0;
    createRequire(import.meta.url)('node:readline/promises').createInterface = () => {
      readlineCalls++; throw new Error('Readline must not open for invalid configuration');
    };
    syncBuiltinESMExports();
    const { main } = await import('./src/cli.ts');
    const listeners = process.listenerCount('SIGINT');
    const base = ['--cwd', process.argv[1], '--no-history'];
    for (const [args, expected] of [
      [['--model', ''], /Model name is required/],
      [['--model', '   '], /Model name is required/],
      [['--provider', 'invalid'], /Unsupported provider/],
    ]) {
      await assert.rejects(main([...base, ...args]), expected);
      assert.equal(process.listenerCount('SIGINT'), listeners);
      assert.equal(readlineCalls, 0);
    }
    process.env.NEURA_MODEL = ' ';
    await assert.rejects(main(base), /Model name is required/);
    assert.equal(process.listenerCount('SIGINT'), listeners);
    assert.equal(readlineCalls, 0);
    await main([...base, '--model', 'fixture-explicit', '--prompt', '/help']);
    assert.equal(process.listenerCount('SIGINT'), listeners);
    assert.equal(readlineCalls, 0);
    console.log('startup validation and cleanup passed');
  `;
  try {
    const reply = await exec(process.execPath, ['--input-type=module', '-e', source, workspace], { cwd: root, env: syntheticEnvironment(path.join(scratch, 'home')), timeout: 20000 });
    assert.match(reply.stdout, /startup validation and cleanup passed/);
    assert.equal(reply.stderr, '');
    assert.deepEqual(await fs.readdir(scratch), ['workspace']);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('CLI uses real Mastra/local transport for a Learn board, exposes no Work tools and stops at the lesson', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-learn-')));
  const workspace = path.join(scratch, 'workspace'); await fs.mkdir(workspace);
  const lesson = structuredClone(workshopFixture); lesson.references = [];
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'synthetic', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'lesson', type: 'function', function: { name: 'learn_lesson', arguments: JSON.stringify(lesson) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const reply = await exec(process.execPath, ['src/cli.ts', '--cwd', workspace, '--mode', 'learn', '--provider', 'local', '--model', 'fixture', '--base-url', `http://127.0.0.1:${address.port}/v1`, '--no-history', '--prompt', 'Teach me with a visual board'], { cwd: root, env: syntheticEnvironment(path.join(scratch, 'home')) });
    assert.match(reply.stdout, /Open this local HTML file/);
    assert.equal(requests.length, 1, 'lesson publication must stop provider continuation');
    const names = requests[0].tools.map((tool: any) => tool.function.name).sort();
    assert.deepEqual(names, ['learn_exercise', 'learn_lesson', 'learn_material', 'learn_progress', 'ls', 'read']);
    const artifacts = await fs.readdir(path.join(workspace, '.neura-learning'));
    const board = artifacts.find(name => /^lesson-.*\.html$/.test(name));
    assert.ok(board);
    assert.match(await fs.readFile(path.join(workspace, '.neura-learning', board), 'utf8'), /Content-Security-Policy/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(scratch, { recursive: true, force: true }); }
});

test('CLI source check is independent of workspace/private-home configuration and creates no history', async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-check-')));
  try {
    const env = syntheticEnvironment(scratch);
    assert.equal(env.NEURA_GIT_EXECUTABLE, process.env.NEURA_GIT_EXECUTABLE, 'preserve the CI-selected Git identity');
    for (const workspace of [scratch, path.join(scratch, 'missing-workspace')]) {
      const reply = await exec(process.execPath, [path.join(root, 'src/cli.ts'), '--check', '--cwd', workspace], { cwd: scratch, env });
      const check = JSON.parse(reply.stdout);
      assert.equal(check.framework, 'Mastra');
      assert.deepEqual(check.modes, ['work', 'learn']);
      assert.equal(reply.stderr, '');
    }
    assert.deepEqual(await fs.readdir(scratch), []);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('CLI genuine short workspace/home spellings share history and retain private/Pi guards', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-short-')));
  try {
    const workspace = path.join(scratch, 'project'); const home = path.join(scratch, 'home');
    await fs.mkdir(workspace); await fs.mkdir(home);
    const short = await windowsShortPath(scratch);
    assert.notEqual(path.relative(short, scratch), '');
    const shortWorkspace = path.join(short, 'project'); const shortHome = path.join(short, 'home');
    const run = (cwd: string, privateHome: string) => exec(process.execPath, [path.join(root, 'src/cli.ts'), '--cwd', cwd, '--prompt', '/sessions'], { cwd: root, env: syntheticEnvironment(privateHome) });
    const first = JSON.parse((await run(shortWorkspace, shortHome)).stdout);
    const second = JSON.parse((await run(workspace, home)).stdout);
    assert.equal(first.length, 1); assert.equal(second.length, 2);
    assert.ok(second.some((session: { id: string }) => session.id === first[0].id));
    await assert.rejects(run(home, shortHome), /private Neura home/);
    await assert.rejects(run(shortWorkspace, workspace), /private Neura home/);
    const linked = path.join(scratch, 'linked-home'); await fs.symlink(home, linked, 'junction');
    await assert.rejects(run(workspace, path.join(linked, 'uncreated')), /Linked|private Neura home/);
    await assert.rejects(fs.stat(path.join(home, 'uncreated')), { code: 'ENOENT' });
    const pi = path.join(scratch, '.pi'); await fs.mkdir(pi);
    const untouchedHome = path.join(scratch, 'untouched-home');
    await assert.rejects(run(await windowsShortPath(pi), untouchedHome), /legacy Pi profile/);
    await assert.rejects(fs.stat(untouchedHome), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(pi), []);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('CLI history is workspace-scoped and releases its writer lock; unavailable modes fail closed', async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-history-')));
  try {
    const home = path.join(scratch, 'home');
    const a = path.join(scratch, 'workspace-a'); const b = path.join(scratch, 'workspace-b');
    await fs.mkdir(a); await fs.mkdir(b);
    const run = (cwd: string, prompt: string, privateHome = home) => exec(process.execPath, ['src/cli.ts', '--cwd', cwd, '--prompt', prompt], { cwd: root, env: syntheticEnvironment(privateHome) });
    const first = JSON.parse((await run(a, '/sessions')).stdout);
    const second = JSON.parse((await run(b, '/sessions')).stdout);
    assert.equal(first.length, 1); assert.equal(second.length, 1); assert.notEqual(first[0].id, second[0].id);
    await assert.rejects(run(scratch, '/sessions'), /private Neura home/);
    await assert.rejects(run(home, '/sessions'), /private Neura home/);
    const alias = path.join(scratch, 'project-alias');
    await fs.symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(run(a, '/sessions', path.join(alias, 'uncreated-home')), /Linked|private Neura home/);
    await assert.rejects(fs.stat(path.join(a, 'uncreated-home')));
    await assert.rejects(run(b, `/resume ${first[0].id}`));
    await assert.rejects(run(a, '/mode yolo'));
    await assert.rejects(run(a, '/login'), /interactive Neura terminal/);
    await fs.writeFile(path.join(home, 'codex-auth.json'), 'synthetic-local-credential', { mode: 0o600 });
    assert.match((await run(a, '/logout')).stdout, /removed locally/);
    await assert.rejects(fs.stat(path.join(home, 'codex-auth.json')));
    for (const key of await fs.readdir(path.join(home, 'sessions'))) {
      assert.ok(!(await fs.readdir(path.join(home, 'sessions', key))).some(name => name.endsWith('.lock')));
    }
    await assert.rejects(fs.stat(path.join(home, '.pi')));
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});
