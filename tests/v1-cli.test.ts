import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { workshopFixture } from '../scripts/learn-workshop-fixture.mjs';
import { windowsShortPath } from './windows-short-path.ts';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

function syntheticEnvironment(home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|neura_git_executable)$/i.test(key)));
  return { ...env, HOME: home, USERPROFILE: home, NEURA_HOME: home, MASTRA_TELEMETRY_DISABLED: '1' };
}

async function interactiveFixture(options: { inputs: string[]; args?: string[]; tool?: boolean; denyModel?: boolean; catalogError?: unknown }) {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-models-')));
  try {
    const workspace = path.join(scratch, 'workspace'); const home = path.join(scratch, 'home'); const profile = path.join(scratch, 'profile');
    await fs.mkdir(workspace); await fs.mkdir(profile);
    await fs.writeFile(path.join(workspace, 'sample.txt'), 'synthetic-private-value');
    const config = path.join(scratch, 'fixture.json');
    await fs.writeFile(config, JSON.stringify({ ...options, workspace }));
    const reply = await exec(process.execPath, ['tests/cli-interactive-fixture.mjs'], { cwd: root, env: { ...syntheticEnvironment(profile), NEURA_HOME: home, NEURA_CLI_FIXTURE: config }, timeout: 20000 });
    const match = /NEURA_FIXTURE_REQUESTS=(.+)/.exec(reply.stdout);
    assert.ok(match, 'The real CLI must consume all synthetic interactive input');
    assert.ok(!reply.stdout.includes('synthetic-private-value'));
    assert.ok(!reply.stderr.includes('synthetic-private-value'));
    await assert.rejects(fs.stat(path.join(home, 'sessions')), { code: 'ENOENT' });
    return { ...reply, requests: JSON.parse(match[1]) as Array<{ type: string; model?: string }> };
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

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
