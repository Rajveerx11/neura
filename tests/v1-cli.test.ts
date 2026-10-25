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
const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

function syntheticEnvironment(home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp)$/i.test(key)));
  return { ...env, HOME: home, USERPROFILE: home, NEURA_HOME: home, MASTRA_TELEMETRY_DISABLED: '1' };
}

test('CLI uses real Mastra/local transport for a Learn board, exposes no Work tools and stops at the lesson', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-learn-'));
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
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-check-'));
  try {
    for (const workspace of [scratch, path.join(scratch, 'missing-workspace')]) {
      const reply = await exec(process.execPath, [path.join(root, 'src/cli.ts'), '--check', '--cwd', workspace], { cwd: scratch, env: syntheticEnvironment(scratch) });
      const check = JSON.parse(reply.stdout);
      assert.equal(check.framework, 'Mastra');
      assert.deepEqual(check.modes, ['work', 'learn']);
      assert.equal(reply.stderr, '');
    }
    assert.deepEqual(await fs.readdir(scratch), []);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('CLI history is workspace-scoped and releases its writer lock; unavailable modes fail closed', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-cli-history-'));
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
