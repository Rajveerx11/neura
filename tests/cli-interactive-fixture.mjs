// Child-process test harness only. All credentials, input and provider traffic are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { codexSse } from './model-fixture.ts';
const config = JSON.parse(await fs.readFile(process.env.NEURA_CLI_FIXTURE, 'utf8'));
assert.ok(process.env.NEURA_HOME && process.env.NEURA_HOME !== process.env.USERPROFILE);
await fs.mkdir(process.env.NEURA_HOME, { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(process.env.NEURA_HOME, 'codex-auth.json'), JSON.stringify({ version: 1, access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Date.now() + 3600000, accountId: 'synthetic-account' }), { mode: 0o600 });
const answers = [...config.inputs];
Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
Object.defineProperty(process.stdout, 'columns', { configurable: true, value: config.columns ?? 80 });
if (config.term !== undefined) process.env.TERM = config.term;
class FixtureReadline extends EventEmitter {
  async question(prompt, options) {
    options?.signal?.throwIfAborted();
    process.stdout.write(prompt);
    if (!answers.length) throw new Error('No more synthetic input');
    const answer = answers.shift();
    if (answer === '[CTRL_C]') {
      process.emit('SIGINT');
      options?.signal?.throwIfAborted();
      throw new Error('Synthetic input closed');
    }
    return answer;
  }
  close() {}
}
const require = createRequire(import.meta.url);
require('node:readline/promises').createInterface = () => new FixtureReadline();
syncBuiltinESMExports();
const requests = [];
let modelRequests = 0;
globalThis.fetch = async (url, init) => {
  const target = new URL(String(url));
  assert.equal(target.origin, 'https://chatgpt.com');
  assert.equal(init.redirect, 'error');
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-access');
  if (target.pathname === '/backend-api/codex/models') {
    assert.equal(init.method, 'GET');
    requests.push({ type: 'catalog' });
    return new Response(JSON.stringify(config.catalogError ?? { models: [
      { slug: 'fixture-second', priority: 20, visibility: 'list' },
      { slug: 'fixture-first', priority: 10, visibility: 'list', supported_in_api: false, base_instructions: 'synthetic-private-value' },
      { slug: 'fixture-hidden', priority: 0, visibility: 'hide' },
    ] }), { status: config.catalogError ? 403 : 200, headers: { 'Content-Type': 'application/json' } });
  }
  assert.equal(target.pathname, '/backend-api/codex/responses');
  assert.equal(init.method, 'POST');
  const body = JSON.parse(init.body);
  assert.ok(!body.instructions.includes('synthetic-private-value'));
  if (config.projectGuidance && !body.instructions.includes('independent code reviewer')) {
    const marker = config.projectGuidance.split('\n').at(-1);
    assert.ok(!body.instructions.includes(marker), 'repository bytes must never become system instructions');
    const guidance = body.input.filter(item => JSON.stringify(item).includes(marker));
    assert.equal(guidance.length, 1, 'fresh guidance must be included once, not accumulated in history');
    assert.equal(guidance[0].role, 'user', 'repository guidance must stay below system authority');
  }
  requests.push({ type: 'model', model: body.model, ...(config.reasoning ? { summary: body.reasoning?.summary ?? null } : {}) });
  modelRequests++;
  if (config.denyModel) return new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'synthetic-private-value' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const toolName = config.writeTool ? 'write' : 'read';
  const toolInput = config.writeTool ? { path: 'smoke.txt', content: 'scratch-only', expectedHash: null } : { path: 'sample.txt' };
  const message = text => [{ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }];
  const functionCall = (name, input) => [{ type: 'function_call', id: `fc_${modelRequests}`, call_id: `call_${modelRequests}`, name, arguments: JSON.stringify(input), status: 'completed' }];
  const planned = config.stepPlan && !body.instructions.includes('independent code reviewer') ? config.stepPlan.shift() : undefined;
  const output = body.instructions.includes('independent code reviewer') ? message(config.reviewerPlan?.shift() ?? '{"findings":[]}')
    : planned ? functionCall(planned.name, planned.input)
    : (config.tool || config.writeTool) && modelRequests === 1 ? functionCall(toolName, toolInput)
    : message('Hello from selected model');
  const reasoning = config.reasoning ? [{ type: 'reasoning', id: 'rs_fixture', summary: [{ type: 'summary_text', text: 'I will inspect the workspace before answering.' }], encrypted_content: 'synthetic-private-value' }] : [];
  const snapshot = { id: 'resp_fixture', created_at: 1, model: body.model, status: 'completed', output: [...reasoning, ...output], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  if (config.jsonResponse) return new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  const response = codexSse(snapshot);
  if (config.sseContentType === null) response.headers.delete('Content-Type');
  else if (config.sseContentType !== undefined) response.headers.set('Content-Type', config.sseContentType);
  return response;
};
const { main } = await import('../src/cli.ts');
process.chdir(config.launchFromHome ? process.env.USERPROFILE : config.workspace);
await main([...(config.launchFromHome || config.omitCwd ? [] : ['--cwd', config.workspace]), ...(config.history ? [] : ['--no-history']), ...(config.args ?? [])]);
assert.equal(answers.length, 0, 'All intended interactive inputs must be consumed');
if (config.projectGuidance && config.history) {
  for (const directory of await fs.readdir(path.join(process.env.NEURA_HOME, 'sessions'))) {
    for (const file of await fs.readdir(path.join(process.env.NEURA_HOME, 'sessions', directory))) {
      if (file.endsWith('.json')) {
        const stored = await fs.readFile(path.join(process.env.NEURA_HOME, 'sessions', directory, file), 'utf8');
        assert.ok(stored.includes('second task'), 'the final task must have been saved');
        assert.ok(!stored.includes(config.projectGuidance.split('\n').at(-1)), 'guidance must not persist in session history');
      }
    }
  }
}
process.stdout.write('\nNEURA_FIXTURE_REQUESTS=' + JSON.stringify(requests) + '\n');
