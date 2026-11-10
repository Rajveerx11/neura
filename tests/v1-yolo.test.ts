import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createYoloTools } from '../src/yolo.ts';
import { createWorkspaceTools } from '../src/work.ts';
import { main, type CliBridge } from '../src/cli.ts';
import type { ToolDefinition } from '../src/runtime.ts';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const MIB = 1024 * 1024;
const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD';

async function scratch(run: (dir: { workspace: string; outside: string; home: string }) => Promise<void>) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-yolo-')));
  const dir = { workspace: path.join(base, 'workspace'), outside: path.join(base, 'outside'), home: path.join(base, 'home') };
  await Promise.all(Object.values(dir).map(item => fs.mkdir(item)));
  const previous = process.env.NEURA_HOME;
  process.env.NEURA_HOME = dir.home;
  try { await run(dir); } finally {
    if (previous === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = previous;
    await fs.rm(base, { recursive: true, force: true });
  }
}
const toolset = (workspace: string, mode: () => string = () => 'yolo', generation: () => number = () => 0, notice?: (line: string) => void) =>
  Object.fromEntries(createYoloTools(workspace, mode, generation, { notice }).map(tool => [tool.name, tool])) as Record<'read' | 'write' | 'edit' | 'exec', ToolDefinition>;
const call = async (tool: ToolDefinition, input: unknown, signal?: AbortSignal) => {
  const part = (await tool.execute(input, { signal })).content[0];
  return JSON.parse(part.type === 'text' ? part.text : '{}');
};
const runNode = (script: string) => `${process.platform === 'win32' ? '& ' : ''}"${process.execPath}" "${script}"`;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(condition: () => boolean | Promise<boolean>, what: string) {
  for (let elapsed = 0; elapsed < 15000; elapsed += 50) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for ${what}`);
}
// The shell starts a parent, and the parent starts a grandchild. Killing only the shell would leave both.
async function treeScript(workspace: string) {
  const script = path.join(workspace, 'tree.cjs');
  await fs.writeFile(script, `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(path.join(workspace, 'pids'))}, JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);`);
  return runNode(script);
}
async function assertTreeDead(workspace: string) {
  const pids: number[] = JSON.parse(await fs.readFile(path.join(workspace, 'pids'), 'utf8'));
  try { await until(() => !pids.some(alive), 'the process tree to exit'); }
  finally { for (const pid of pids) if (alive(pid)) process.kill(pid); }
}
const environment = (home: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|neura_git_executable)$/i.test(key))),
  HOME: home, USERPROFILE: home, NEURA_HOME: home, NO_COLOR: '1',
});
/** A loopback model that plays the given tool calls, then answers. */
async function modelServer(plan: Array<{ name: string; input: unknown }>, answer = 'Synthetic answer') {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const step = plan.shift();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'synthetic', object: 'chat.completion', created: 1, model: 'fixture',
      choices: [{ index: 0, finish_reason: step ? 'tool_calls' : 'stop', message: step
        ? { role: 'assistant', content: null, tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.input) } }] }
        : { role: 'assistant', content: answer } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {
    requests, url: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    close: () => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
const toolNames = (request: any) => request.tools.map((tool: any) => tool.function.name);
const cli = (dir: { workspace: string; home: string }, ...args: string[]) =>
  exec(process.execPath, ['src/cli.ts', '--cwd', dir.workspace, ...args], { cwd: root, env: environment(dir.home), timeout: 60000 });
/** The real CLI loop through its bridge, so a test can drive several commands in one session. */
async function bridgeSession(workspace: string, args: string[], approve: CliBridge['approve']) {
  let output = ''; const modes: string[] = [];
  let close!: () => void;
  const lifetime = new Promise<void>(resolve => { close = resolve; });
  let controller!: Parameters<CliBridge['serve']>[0];
  let done!: Promise<void>;
  await new Promise<void>(resolve => {
    done = main(['--cwd', workspace, ...args], { write: text => { output += text; }, approve, onModeChange: mode => modes.push(mode),
      serve: async value => { controller = value; resolve(); await lifetime; } });
  });
  return { execute: (text: string) => controller.execute(text), modes, close: () => { close(); return done; },
    output: () => output, status: async () => { output = ''; await controller.execute('/status'); return output; } };
}

test('YOLO exposes exactly four tools and reads, writes and edits anywhere with no policy or redaction', async () => {
  await scratch(async ({ workspace, outside }) => {
    const tools = toolset(workspace);
    assert.deepEqual(Object.keys(tools), ['read', 'write', 'edit', 'exec']);
    for (const name of ['.env', '.git/config', '.github/workflows/ci.yml', path.join(outside, 'deep/er/file.txt')]) {
      const written = await call(tools.write, { path: name, content: `TOKEN=${SECRET}\n` });
      assert.equal(written.bytes, SECRET.length + 7);
      assert.equal((await call(tools.read, { path: name })).text, `TOKEN=${SECRET}\n`, 'tool data is not redacted');
      await call(tools.edit, { path: name, old_string: 'TOKEN', new_string: 'KEY' });
      assert.equal(await fs.readFile(path.resolve(workspace, name), 'utf8'), `KEY=${SECRET}\n`);
    }
    assert.deepEqual(await fs.readdir(path.join(outside, 'deep/er')), ['file.txt'], 'the atomic write leaves no temporary file');
    await assert.rejects(call(tools.edit, { path: '.env', old_string: 'absent', new_string: 'x' }), /exactly once/);
    await fs.writeFile(path.join(workspace, 'twice'), 'a a');
    await assert.rejects(call(tools.edit, { path: 'twice', old_string: 'a', new_string: 'b' }), /exactly once/);
    assert.equal(await fs.readFile(path.join(workspace, 'twice'), 'utf8'), 'a a');
    await fs.writeFile(path.join(workspace, 'binary'), Buffer.from([0xff, 0x61]));
    await assert.rejects(call(tools.edit, { path: 'binary', old_string: 'a', new_string: 'b' }), /UTF-8/);
    assert.deepEqual([...await fs.readFile(path.join(workspace, 'binary'))], [0xff, 0x61]);
    await assert.rejects(call(tools.write, { path: 'big', content: 'x'.repeat(MIB + 1) }), /1 MiB/);
    await assert.rejects(fs.stat(path.join(workspace, 'big')), { code: 'ENOENT' });
    await fs.writeFile(path.join(workspace, 'huge'), 'x'.repeat(MIB + 1));
    await assert.rejects(call(tools.read, { path: 'huge' }), /1 MiB/);
  });
});

test('YOLO write follows links and keeps an existing file mode', async () => {
  await scratch(async ({ workspace, outside }) => {
    const tools = toolset(workspace);
    const target = path.join(outside, 'target.txt');
    await fs.writeFile(target, 'old');
    const link = path.join(workspace, 'junction');
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await call(tools.write, { path: 'junction/target.txt', content: 'new' });
    assert.equal(await fs.readFile(target, 'utf8'), 'new');
    assert.ok((await fs.lstat(link)).isSymbolicLink());
    if (process.platform !== 'win32') {
      await fs.chmod(target, 0o600);
      await call(tools.write, { path: target, content: 'newer' });
      assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    }
  });
});

test('exec runs on the host in the workspace with the inherited environment and returns unredacted data', async () => {
  await scratch(async ({ workspace }) => {
    const notices: string[] = [];
    process.env.NEURA_YOLO_SENTINEL = 'inherited-value';
    try {
      const { exec: run } = toolset(workspace, undefined, undefined, line => notices.push(line));
      const script = path.join(workspace, 'probe.cjs');
      await fs.writeFile(script, `console.log(JSON.stringify({ cwd: process.cwd(), env: process.env.NEURA_YOLO_SENTINEL, secret: ${JSON.stringify(SECRET)} })); console.error('to stderr');`);
      const result = await call(run, { command: `${runNode(script)} # ${SECRET}` });
      const printed = JSON.parse(result.stdout);
      assert.equal(await fs.realpath(printed.cwd), workspace);
      assert.equal(printed.env, 'inherited-value');
      assert.equal(printed.secret, SECRET, 'the model receives raw output');
      assert.match(result.stderr, /to stderr/);
      assert.deepEqual([result.exitCode, result.timedOut, result.truncated], [0, false, false]);
      assert.equal(notices.length, 1);
      assert.match(notices[0], /^Running on host: /);
      assert.ok(!notices[0].includes(SECRET), 'terminal text is redacted');
      assert.equal((await call(run, { command: 'exit 7' })).exitCode, 7);
      assert.match((await call(run, { command: process.platform === 'win32' ? `Write-Output 'héllo→'` : `printf 'héllo→'` })).stdout, /héllo→/);
    } finally { delete process.env.NEURA_YOLO_SENTINEL; }
  });
});

test('exec reaches a loopback server, so commands have network access', async () => {
  await scratch(async ({ workspace }) => {
    let hits = 0;
    const server = createServer((_req, res) => { hits++; res.end('reached'); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const script = path.join(workspace, 'net.cjs');
      await fs.writeFile(script, `fetch('http://127.0.0.1:${(server.address() as any).port}/').then(r => r.text()).then(console.log);`);
      assert.match((await call(toolset(workspace).exec, { command: runNode(script) })).stdout, /reached/);
      assert.equal(hits, 1);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

test('exec timeout kills the whole process tree', async () => {
  await scratch(async ({ workspace }) => {
    const result = await call(toolset(workspace).exec, { command: await treeScript(workspace), timeoutMs: 5000 });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
    await assertTreeDead(workspace);
  });
});

test('turn abort kills the whole process tree', async () => {
  await scratch(async ({ workspace }) => {
    const controller = new AbortController();
    const pending = call(toolset(workspace).exec, { command: await treeScript(workspace) }, controller.signal);
    await until(() => fs.stat(path.join(workspace, 'pids')).then(() => true, () => false), 'the tree to start');
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await assertTreeDead(workspace);
  });
});

test('exec keeps both ends of each stream and flags the cut without killing the command', async () => {
  await scratch(async ({ workspace }) => {
    const script = path.join(workspace, 'loud.cjs');
    await fs.writeFile(script, `process.stdout.write('START' + 'x'.repeat(${2 * MIB}) + 'END', () => process.stderr.write('done', () => process.exit(3)));`);
    const result = await call(toolset(workspace).exec, { command: `${runNode(script)}; exit $${process.platform === 'win32' ? 'LASTEXITCODE' : '?'}` });
    assert.equal(result.truncated, true);
    assert.match(result.stdout, /^START/);
    assert.match(result.stdout, /END\s*$/);
    assert.match(result.stdout, /bytes omitted/);
    assert.ok(Buffer.byteLength(result.stdout) < 256 * 1024, 'one command fits in saved history');
    assert.match(result.stderr, /done/);
    assert.equal(result.exitCode, 3, 'the command ran to completion');
  });
});

test('a command flooding output does not grow memory with it', async () => {
  await scratch(async ({ workspace }) => {
    const script = path.join(workspace, 'flood.cjs');
    await fs.writeFile(script, `const line=Buffer.alloc(65536,120);line[65535]=10;let left=4096;(function write(){while(left-->0){if(!process.stdout.write(line))return process.stdout.once('drain',write);}})();`);
    const baseline = process.memoryUsage().arrayBuffers;
    let peak = baseline;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); }, 10);
    try {
      const result = await call(toolset(workspace).exec, { command: runNode(script), timeoutMs: 120000 });
      assert.equal(result.truncated, true);
    } finally { clearInterval(sampler); }
    assert.ok(peak - baseline < 128 * MIB, `retained ${Math.round((peak - baseline) / MIB)} MiB of a 256 MiB flood`);
  });
});

test('an empty final answer never prints raw tool data', async () => {
  await scratch(async dir => {
    const file = path.join(dir.outside, 'private.txt');
    await fs.writeFile(file, 'plain-marker-for-display\n');
    const model = await modelServer([{ name: 'read', input: { path: file } }], '');
    try {
      const reply = await cli(dir, '--no-history', '--yolo', '-p', 'read it', '--provider', 'local', '--model', 'fixture', '--base-url', model.url);
      assert.doesNotMatch(reply.stdout + reply.stderr, /plain-marker-for-display/);
      assert.match(reply.stdout, /Turn ended without assistant text/);
    } finally { await model.close(); }
  });
});

test('a YOLO call after the mode or session changed is stale and has no effect', async () => {
  await scratch(async ({ workspace }) => {
    for (const change of ['mode', 'generation']) {
      let mode = 'yolo'; let generation = 0;
      const tools = toolset(workspace, () => mode, () => generation);
      if (change === 'mode') mode = 'work'; else generation++;
      for (const [tool, input] of [[tools.write, { path: 'stale.txt', content: 'x' }], [tools.exec, { command: 'echo x > stale.txt' }], [tools.edit, { path: 'stale.txt', old_string: 'x', new_string: 'y' }], [tools.read, { path: 'stale.txt' }]] as const) {
        await assert.rejects(call(tool, input), /stale tool authority/);
      }
      await assert.rejects(fs.stat(path.join(workspace, 'stale.txt')), { code: 'ENOENT' });
    }
  });
});

test('Work and Learn keep their tool lists and policy', async () => {
  await scratch(async ({ workspace }) => {
    let approvals = 0;
    const work = createWorkspaceTools(workspace, () => 'work', () => 0, async () => { approvals++; return false; });
    assert.deepEqual(work.map(tool => tool.name), ['read', 'ls', 'grep', 'find', 'write', 'edit', 'work_exec']);
    assert.deepEqual(createWorkspaceTools(workspace, () => 'learn', () => 0).map(tool => tool.name), ['read', 'ls']);
    const write = work.find(tool => tool.name === 'write')!;
    await assert.rejects(write.execute({ path: '.env', content: 'x', expectedHash: null }, {}), /denied/);
    assert.equal(approvals, 0);
    await assert.rejects(write.execute({ path: '.github/workflows/a.yml', content: 'x', expectedHash: null }, {}), /Write denied/);
    assert.equal(approvals, 1, 'Work still asks for CI files');
    await assert.rejects(fs.stat(path.join(workspace, '.env')), { code: 'ENOENT' });
  });
});

test('startup flags: --yolo is the consent, --mode yolo and conflicting flags are refused, and no flag means Work', async () => {
  await scratch(async dir => {
    await assert.rejects(cli(dir, '--mode', 'yolo', '--prompt', '/status'), /refused\. Use --yolo/);
    await assert.rejects(cli(dir, '--yolo', '--mode', 'learn', '--prompt', '/status'), /cannot be combined/);
    await assert.rejects(cli(dir, '--no-history', '--prompt', '/mode yolo'), /Start with --yolo/);
    for (const flag of ['--yolo', '--dangerously-bypass-approvals-and-sandbox']) {
      const reply = await cli(dir, '--no-history', flag, '--prompt', '/status');
      assert.match(reply.stdout, /Mode: YOLO · DANGER/);
      assert.match(reply.stderr, /YOLO · DANGER: no sandbox, no approvals/);
    }
    assert.match((await cli(dir, '--no-history', '--prompt', '/status')).stdout, /Mode: Work/);
  });
});

test('real CLI --yolo -p does a real outside-workspace effect with zero approvals and no review', async () => {
  await scratch(async dir => {
    const target = path.join(dir.outside, 'effect.txt');
    const model = await modelServer([{ name: 'exec', input: { command: `echo done > "${target}"` } }]);
    try {
      const reply = await cli(dir, '--no-history', '--yolo', '-p', 'do the task', '--provider', 'local', '--model', 'fixture', '--base-url', model.url);
      await fs.stat(target);
      assert.doesNotMatch(reply.stdout + reply.stderr, /approval required/);
      assert.match(reply.stdout, /Running on host: /);
      assert.match(reply.stdout, /Synthetic answer/);
      assert.doesNotMatch(reply.stdout, /READY FOR YOUR APPROVAL|BLOCKED|Review skipped/);
      assert.equal(model.requests.length, 2, 'only the builder calls the model');
      assert.deepEqual(toolNames(model.requests[0]), ['read', 'write', 'edit', 'exec']);
      assert.match(JSON.stringify(model.requests[0].messages[0]), /full authority[\s\S]*did not ask for/);
    } finally { await model.close(); }
  });
});

test('Work turns never see YOLO tools or instructions', async () => {
  await scratch(async dir => {
    const model = await modelServer([]);
    try {
      await cli(dir, '--no-history', '-p', 'hello', '--provider', 'local', '--model', 'fixture', '--base-url', model.url);
      assert.deepEqual(toolNames(model.requests[0]), ['read', 'ls', 'grep', 'find', 'write', 'edit', 'work_exec']);
      assert.doesNotMatch(JSON.stringify(model.requests[0].messages[0]), /YOLO mode/);
    } finally { await model.close(); }
  });
});

test('/mode yolo confirms every entry, and a denial keeps the current mode', async () => {
  await scratch(async ({ workspace }) => {
    const answers = [false, true, false];
    let prompts: string[] = [];
    const session = await bridgeSession(workspace, ['--no-history'], async text => { prompts.push(text); return answers.shift()!; });
    try {
      await session.execute('/mode yolo');
      assert.match(prompts[0], /No sandbox and no approvals[\s\S]*network and your full account access until \/mode work or exit/);
      assert.match(await session.status(), /Mode: Work/);
      assert.deepEqual(session.modes, []);
      await session.execute('/mode yolo');
      assert.match(await session.status(), /Mode: YOLO · DANGER/);
      assert.deepEqual(session.modes, ['yolo']);
      await session.execute('/mode work');
      await session.execute('/mode yolo');
      assert.equal(prompts.length, 3, 'every entry confirms again');
      assert.match(await session.status(), /Mode: Work/);
    } finally { await session.close(); }
  });
});

test('/resume returns to Work, and the mode is never saved', async () => {
  await scratch(async dir => {
    const session = await bridgeSession(dir.workspace, [], async () => true);
    let id: string;
    try {
      await session.execute('/sessions');
      id = JSON.parse(session.output())[0].id;
      await session.execute('/new');
      await session.execute('/mode yolo');
      assert.match(await session.status(), /Mode: YOLO · DANGER/);
      await session.execute(`/resume ${id}`);
      assert.match(await session.status(), /Mode: Work/);
    } finally { await session.close(); }
    await cli(dir, '--yolo', '--prompt', '/status');
    const directory = path.join(dir.home, 'sessions', (await fs.readdir(path.join(dir.home, 'sessions')))[0]);
    for (const file of (await fs.readdir(directory)).filter(name => name.endsWith('.json'))) {
      assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'))).sort(), ['createdAt', 'id', 'messages', 'updatedAt', 'version']);
    }
    assert.match((await cli(dir, '--resume', id!, '--prompt', '/status')).stdout, /Mode: Work/);
  });
});
