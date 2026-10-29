#!/usr/bin/env node
import { parseArgs, stripVTControlCharacters } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { lockSession } from './session-lock.ts';
import { loginCodex, logoutCodex } from './auth.ts';
import { createLearnWorkshop } from './learn.ts';
import { createWorkspaceTools, WORK_INSTRUCTIONS, assertWorkspaceOutsideNeuraHome } from './work.ts';
import { createConfiguredModel, listCodexModels, type ProviderConfig } from './providers.ts';
import { runTurn } from './runtime.ts';
import { createSession, saveSession, resumeSession, listSessions, type Session } from './session.ts';
import { redactSensitiveText } from '../agent/neura/redaction.ts';

const wordmark = ['█  █ █▀▀▀ █  █ █▀▀▄ ▄▀▀▄', '██ █ █▀▀  █  █ █  █ █  █', '█ ██ ██▀▀ █  █ █▀▀  █▀▀█', '█  █ █▀▀  █  █ █ ▀▄ █  █', '▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀'];
export function terminalText(text: string): string { return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''); }
const say = (text: string) => stdout.write(terminalText(text) + '\n');
const warning = (text: string) => stderr.write(terminalText(redactSensitiveText(text, 8000)) + '\n');

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, check: { type: 'boolean' }, prompt: { type: 'string', short: 'p' }, cwd: { type: 'string' }, mode: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, 'base-url': { type: 'string' }, resume: { type: 'string' }, 'no-history': { type: 'boolean' },
  } });
  if (values.help) {
    say(`Neura · Mastra v1 development build
Usage: neura [task] [--mode work|learn] [--provider openai-codex|local|openai|anthropic] [--model NAME] [--base-url URL]
  -p, --prompt TEXT  Run one user request; commands fail closed without interactive approval
  --cwd PATH        Workspace (default: current directory)
  --resume UUID     Explicitly resume Neura history (never imports Pi)
  --no-history      Do not persist conversation history
  --check           Check source prerequisites without credentials or model calls
Commands: /help, /login, /logout, /mode work|learn, /learn, /new, /sessions, /resume UUID, /model [PROVIDER MODEL [URL]], /quit
/model opens the subscription model picker. Without --model, subscription requests use the catalog default, never a guessed model.
/login starts an interactive ChatGPT subscription sign-in. API billing is never a fallback.
Real account login remains a manual personal-use gate; distribution is not cleared.`);
    return;
  }
  if (values.check) {
    const runtime = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const learnRuntime = JSON.parse(fs.readFileSync(new URL('../agent/neura/package.json', import.meta.url), 'utf8'));
    for (const name of Object.keys(learnRuntime.dependencies)) {
      if (!fs.existsSync(new URL(`../agent/neura/node_modules/${name}/package.json`, import.meta.url))) throw new Error(`Learn dependency missing: ${name}. Run npm ci --prefix agent/neura --ignore-scripts.`);
    }
    say(JSON.stringify({ framework: 'Mastra', version: runtime.dependencies['@mastra/core'], modes: ['work', 'learn'], node: process.version, platform: process.platform, learnFirstCreation: process.platform === 'win32' ? 'supported' : 'requires native Windows', history: 'Neura-owned; no Pi imports', status: 'development; license/distribution and real-auth gates remain' }, null, 2));
    return;
  }
  const workspace = fs.realpathSync.native(path.resolve(values.cwd ?? process.cwd()));
  if (!fs.statSync(workspace).isDirectory()) throw new Error('Workspace must be a directory.');
  let mode: 'work' | 'learn' = 'work';
  if (values.mode !== undefined && !['work', 'learn'].includes(values.mode)) throw new Error('Only Work and Learn are implemented in this v1.');
  if (values.mode === 'learn') mode = 'learn';
  let generation = 0;
  const home = path.resolve(process.env.NEURA_HOME || path.join(os.homedir(), '.neura'));
  if (home.split(/[\\/]/).some(part => part.replace(/[. ]+$/, '').toLowerCase() === '.pi')) throw new Error('NEURA_HOME must be outside the legacy Pi profile.');
  assertWorkspaceOutsideNeuraHome(workspace, home);
  const workspaceKey = createHash('sha256').update(process.platform === 'win32' ? workspace.toLowerCase() : workspace).digest('hex');
  const sessions = path.join(home, 'sessions', workspaceKey);
  const prompt = values.prompt ?? (positionals.length ? positionals.join(' ') : undefined);
  if (prompt === undefined && !stdin.isTTY) throw new Error('Noninteractive input requires an explicit --prompt.');
  if (values.prompt !== undefined && positionals.length) throw new Error('Use either --prompt or a positional task, not both.');
  const providerKind = (values.provider ?? process.env.NEURA_PROVIDER ?? 'openai-codex') as ProviderConfig['provider'];
  if (!['openai-codex', 'local', 'openai', 'anthropic'].includes(providerKind)) throw new Error('Unsupported provider.');
  const configuredModel = values.model ?? process.env.NEURA_MODEL;
  if (configuredModel !== undefined && !configuredModel.trim()) throw new Error('Model name is required.');
  let modelExplicit = configuredModel !== undefined;
  let provider: ProviderConfig = { provider: providerKind, model: configuredModel ?? '', baseURL: values['base-url'] ?? process.env.NEURA_BASE_URL ?? (providerKind === 'local' ? 'http://127.0.0.1:8080/v1' : undefined) };
  const modelLabel = (value: string) => redactSensitiveText(value || '(not selected)', 200);
  const interactive = prompt === undefined && Boolean(stdin.isTTY && stdout.isTTY);
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;
  let abort: AbortController | undefined;
  const onInterrupt = () => { if (abort) abort.abort(); else rl?.close(); };
  process.on('SIGINT', onInterrupt);
  rl?.on('SIGINT', onInterrupt);
  const learn = createLearnWorkshop(workspace, () => mode === 'learn', warning);
  let session: Session | undefined;
  let memory: any[] = [];
  let releaseSession: (() => Promise<void>) | undefined;
  async function selectSession(id?: string) {
    const fresh = id ? undefined : await createSession(sessions);
    const release = await lockSession(sessions, id ?? fresh!.id);
    try {
      const next = fresh ?? await resumeSession(sessions, id!);
      await releaseSession?.(); releaseSession = release;
      session = next; memory = next.messages;
    } catch (error) { await release(); throw error; }
  }
  const approve = async (description: string) => {
    if (!rl) return false;
    const response = await rl.question(terminalText(description) + '\nType yes to approve (default: no): ', { signal: abort?.signal });
    return response.trim() === 'yes';
  };
  try {
    if (!values['no-history']) {
      await selectSession(values.resume);
    } else if (values.resume) throw new Error('--resume cannot be combined with --no-history.');
    if (interactive) for (const line of wordmark) say(line); // Logo-only launch; no false READY banner.
    async function changeModel(next: ProviderConfig) {
      createConfiguredModel(next);
      abort?.signal.throwIfAborted();
      if (!values['no-history']) await selectSession(); else memory = [];
      abort?.signal.throwIfAborted();
      provider = next; modelExplicit = true;
      generation++; learn.invalidate();
      say(`Model: ${modelLabel(provider.model)} (${provider.provider}). A fresh conversation is selected.`);
    }
    async function pickModel() {
      say(`Provider: ${provider.provider}\nCurrent model: ${modelLabel(provider.model)}`);
      if (provider.provider !== 'openai-codex') {
        say('For this provider use /model PROVIDER MODEL [URL]. API providers are explicitly selected and billed separately.');
        return;
      }
      abort = new AbortController();
      try {
        say('Fetching the subscription model catalog...');
        const choices = await listCodexModels({ signal: abort.signal, baseURL: provider.baseURL });
        choices.forEach((choice, index) => say(`  ${index + 1}. ${modelLabel(choice.id)}${index === 0 ? ' (catalog default)' : ''}${choice.id === provider.model ? ' (current)' : ''}`));
        if (!rl) return;
        for (;;) {
          const answer = (await rl.question('Choose a number or listed model ID; Enter cancels: ', { signal: abort.signal })).trim();
          if (!answer) { say('Model unchanged.'); return; }
          const selected = /^\d{1,3}$/.test(answer) ? choices[Number(answer) - 1] : choices.find(choice => choice.id === answer);
          if (!selected) { say('Choose one of the listed models, or press Enter to cancel.'); continue; }
          await changeModel({ provider: 'openai-codex', model: selected.id });
          return;
        }
      } finally { abort = undefined; }
    }
    async function turn(text: string, learnerInput = text) {
      if (!text.trim() || text.length > 32000) throw new Error('Task must contain 1-32000 characters.');
      abort = new AbortController();
      try {
        if (!provider.model) {
          if (provider.provider !== 'openai-codex') throw new Error('Choose a model with --model or /model PROVIDER MODEL [URL].');
          say('Fetching the subscription model catalog...');
          const choices = await listCodexModels({ signal: abort.signal, baseURL: provider.baseURL });
          provider = { ...provider, model: choices[0].id }; modelExplicit = false;
          say(`Model: ${modelLabel(provider.model)} (subscription catalog default). Use /model to change it.`);
        }
        const expected = generation;
        const userMessage = { role: 'user', content: text };
        learn.input(learnerInput);
        const model = createConfiguredModel(provider);
        const tools = [...createWorkspaceTools(workspace, () => mode, () => generation, approve), ...(mode === 'learn' ? learn.tools() : [])];
        const instructions = mode === 'learn' ? await learn.instructions(abort.signal) : WORK_INSTRUCTIONS;
        const outcome = await runTurn({ model, messages: [...memory, userMessage], instructions, tools, signal: abort.signal, onText: chunk => stdout.write(terminalText(chunk)), onToolEvent: event => say(`\n[tool] ${redactSensitiveText(event.toolName, 128)}: ${event.phase}`) });
        stdout.write('\n');
        if (generation !== expected) throw new Error('Session changed; result discarded.');
        memory = outcome.messages;
        if (session) {
          try { session = await saveSession(sessions, { ...session, messages: memory }); memory = session.messages; }
          catch { warning('Turn completed, but history was not saved safely. Do not repeat a mutation merely to save its result.'); }
        }
      } finally { abort = undefined; }
    }
    async function input(text: string): Promise<boolean> {
      if (!text.startsWith('/')) { await turn(text); return true; }
      const [, command, rest = ''] = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim()) ?? [];
      if (command === 'quit' || command === 'exit') return false;
      if (command === 'help') say('/login · /logout · /mode work|learn · /learn status|answer <text>|hint|reveal|save|saved|resume <file>|reset|explain|deeper|example\n/new · /sessions · /resume <id> · /model (subscription picker) · /model <provider> <model> [URL] · /quit\nOnly Work and Learn are implemented. API billing is never a subscription fallback.');
      else if (command === 'login') {
        if (!rl || rest.trim()) throw new Error('Use /login without arguments in an interactive Neura terminal.');
        abort = new AbortController();
        try {
          await loginCodex({ signal: abort.signal, onAuthorize: url => say(`Open this URL in your browser to sign in:\n${url}`) });
          const remembered = provider.provider === 'openai-codex' && modelExplicit ? provider.model : '';
          provider = { provider: 'openai-codex', model: remembered }; modelExplicit = Boolean(remembered);
          if (!values['no-history']) await selectSession(); else memory = [];
          generation++; learn.invalidate();
          say('Neura subscription login saved. A fresh conversation is selected; no Pi credentials were imported.');
        } finally { abort = undefined; }
      } else if (command === 'logout') {
        if (rest.trim()) throw new Error('/logout accepts no arguments.');
        await logoutCodex();
        if (!values['no-history']) await selectSession(); else memory = [];
        generation++; learn.invalidate(true);
        say('Neura subscription credentials removed locally. Remote tokens were not revoked.');
      } else if (command === 'mode') {
        if (!['work', 'learn'].includes(rest)) throw new Error('Only /mode work and /mode learn are available.');
        generation++; learn.invalidate(); mode = rest as typeof mode; say(`Mode: ${mode}`);
      } else if (command === 'learn') {
        if (mode !== 'learn') throw new Error('Enter /mode learn first.');
        abort = new AbortController();
        try { const reply = await learn.command(rest, abort.signal); if (reply.text) say(reply.text); if (reply.prompt) { abort = undefined; await turn(reply.prompt, ''); } }
        finally { abort = undefined; }
      } else if (command === 'new') {
        if (!values['no-history']) await selectSession(); else memory = [];
        generation++; learn.invalidate(true); say('New session; mode authority and learning state refreshed.');
      } else if (command === 'sessions') say(JSON.stringify(await listSessions(sessions), null, 2));
      else if (command === 'resume') {
        if (values['no-history']) throw new Error('History disabled.');
        await selectSession(rest);
        generation++; learn.invalidate(true); mode = 'work'; say('Workspace history resumed in Work. Use /mode learn and explicitly /learn resume to restore a lesson.');
      } else if (command === 'model') {
        if (!rest.trim()) { await pickModel(); return true; }
        const [kind, model, url, ...extra] = rest.split(/\s+/);
        if (!['openai-codex', 'local', 'openai', 'anthropic'].includes(kind) || !model || extra.length) throw new Error('Use /model openai-codex|local|openai|anthropic MODEL [URL].');
        const next = { provider: kind as ProviderConfig['provider'], model, baseURL: url ?? (kind === 'local' ? 'http://127.0.0.1:8080/v1' : undefined) };
        await changeModel(next);
      } else throw new Error('Unknown command. Use /help.');
      return true;
    }
    if (prompt !== undefined) { await input(prompt); return; }
    for (;;) {
      let text: string;
      try { text = await rl!.question(`${mode} > `); } catch { break; }
      try { if (!await input(text)) break; } catch (error) {
        const message = error instanceof Error ? error.message : 'Request failed.';
        warning(message);
        if (provider.provider === 'openai-codex' && message.includes('selected model is unavailable')) say('Use /model to choose a subscription model. No task was replayed; inspect current state before retrying.');
      }
    }
  } finally { generation++; learn.invalidate(true); process.off('SIGINT', onInterrupt); rl?.close(); await releaseSession?.(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { warning(error instanceof Error ? error.message : 'Neura failed.'); process.exitCode = 1; });
