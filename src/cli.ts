#!/usr/bin/env node
import { parseArgs } from 'node:util';
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
import { createWorkspaceTools, projectInstructions, READ_ONLY_TOOLS, WORK_INSTRUCTIONS, assertWorkspaceOutsideNeuraHome } from './work.ts';
import { createConfiguredModel, listCodexModels, type ProviderConfig } from './providers.ts';
import { DEFAULT_TURN_STEPS, runTurn, WORK_TURN_STEPS, type TurnUsage, type ToolEvent } from './runtime.ts';
import { verifyWorkspace, workspaceReceiptStatus, type WorkspaceReceipt } from './verification.ts';
import { createSession, saveSession, resumeSession, listSessions, withoutToolImages, type Session } from './session.ts';
import { redactSensitiveText } from '../agent/neura/redaction.ts';
import { captureWorktree, type TreeSnapshot } from '../agent/neura/verification.ts';
import { assessRisk, reviewCandidate, reviewReceiptCurrent, reviewerIndependence, type ReviewReceipt } from './review.ts';
import { runReviewLoop, WORKFLOW_INSTRUCTIONS } from './workflow.ts';
import { createTerminalUI, terminalText, type TerminalStatus } from './terminal-ui.ts';
export { terminalText } from './terminal-ui.ts';

const terminal = (stream: NodeJS.WriteStream = stdout) => createTerminalUI({ isTTY: Boolean(stream.isTTY), columns: stream.columns, env: process.env });
const failure = (text: string) => stderr.write(terminal(stderr).feedback(redactSensitiveText(text, 8000), 'error') + '\n');

export type CliBridge = {
  write: (text: string) => void;
  approve: (description: string) => Promise<boolean>;
  onToolEvent?: (event: ToolEvent, invocationId?: string) => void;
  onReasoning?: (text: string) => void;
  onStepLimit?: () => void;
  serve: (session: { execute: (text: string) => Promise<boolean>; cancel: () => void }) => Promise<void>;
};

/** The terminal and ACP share one loop, policy, workflow and Learn state. */
export async function main(args = process.argv.slice(2), bridge?: CliBridge): Promise<void> {
  const output = bridge ? { write: (text: string) => { bridge.write(text); return true; }, isTTY: false, columns: undefined } : process.stdout;
  const stdout = output;
  const stderr = bridge ? output : process.stderr;
  const say = (text: string) => stdout.write(terminalText(text) + '\n');
  const warning = (text: string) => stderr.write(bridge ? redactSensitiveText(text, 8000) + '\n' : terminal(process.stderr).feedback(redactSensitiveText(text, 8000), 'warning') + '\n');
  const failure = (text: string) => bridge ? warning(text) : process.stderr.write(terminal(process.stderr).feedback(redactSensitiveText(text, 8000), 'error') + '\n');
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, check: { type: 'boolean' }, ascii: { type: 'boolean' }, prompt: { type: 'string', short: 'p' }, cwd: { type: 'string' }, mode: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, 'base-url': { type: 'string' }, resume: { type: 'string' }, 'no-history': { type: 'boolean' }, 'no-thinking': { type: 'boolean' },
    'reviewer-provider': { type: 'string' }, 'reviewer-model': { type: 'string' }, 'reviewer-base-url': { type: 'string' },
  } });
  if (values.help) {
    stdout.write(terminal().help(true) + '\n');
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
  let workspace = fs.realpathSync.native(path.resolve(values.cwd ?? process.cwd()));
  if (!fs.statSync(workspace).isDirectory()) throw new Error('Workspace must be a directory.');
  let mode: 'work' | 'learn' = 'work';
  if (values.mode !== undefined && !['work', 'learn'].includes(values.mode)) throw new Error('Only Work and Learn are implemented in this v1.');
  if (values.mode === 'learn') mode = 'learn';
  let generation = 0;
  const home = path.resolve(process.env.NEURA_HOME || path.join(os.homedir(), '.neura'));
  if (home.split(/[\\/]/).some(part => part.replace(/[. ]+$/, '').toLowerCase() === '.pi')) throw new Error('NEURA_HOME must be outside the legacy Pi profile.');
  const prompt = values.prompt ?? (positionals.length ? positionals.join(' ') : undefined);
  if (!bridge && prompt === undefined && !(stdin.isTTY && stdout.isTTY)) throw new Error('Noninteractive input requires an explicit --prompt.');
  if (values.prompt !== undefined && positionals.length) throw new Error('Use either --prompt or a positional task, not both.');
  const providerKinds = ['openai-codex', 'local', 'openai', 'anthropic'];
  const defaultBaseURL = (kind: string) => kind === 'local' ? 'http://127.0.0.1:8080/v1' : undefined;
  const providerKind = (values.provider ?? process.env.NEURA_PROVIDER ?? 'openai-codex') as ProviderConfig['provider'];
  if (!providerKinds.includes(providerKind)) throw new Error('Unsupported provider.');
  const reviewerKind = values['reviewer-provider'] ?? process.env.NEURA_REVIEWER_PROVIDER;
  const reviewerModel = values['reviewer-model'] ?? process.env.NEURA_REVIEWER_MODEL;
  const reviewerURL = values['reviewer-base-url'] ?? process.env.NEURA_REVIEWER_BASE_URL;
  if (reviewerKind !== undefined && !providerKinds.includes(reviewerKind)) throw new Error('Unsupported reviewer provider.');
  if (reviewerModel !== undefined && !reviewerModel.trim()) throw new Error('Reviewer model name is required.');
  if ((reviewerKind !== undefined || reviewerURL !== undefined) && reviewerModel === undefined) throw new Error('Reviewer model is required with a reviewer provider or base URL.');
  const configuredModel = values.model ?? process.env.NEURA_MODEL;
  if (configuredModel !== undefined && !configuredModel.trim()) throw new Error('Model name is required.');
  let modelExplicit = configuredModel !== undefined;
  let showReasoning = !values['no-thinking'];
  let provider: ProviderConfig = { provider: providerKind, model: configuredModel ?? '', baseURL: values['base-url'] ?? process.env.NEURA_BASE_URL ?? defaultBaseURL(providerKind) };
  const modelLabel = (value: string) => terminalText(redactSensitiveText(value || '(not selected)', 200));
  // Explicit reviewer only; otherwise the reviewer follows the current builder model (same-family, labelled weaker).
  let reviewerOverride: ProviderConfig | undefined = reviewerModel === undefined ? undefined : { provider: (reviewerKind ?? providerKind) as ProviderConfig['provider'], model: reviewerModel, baseURL: reviewerURL ?? defaultBaseURL(reviewerKind ?? providerKind) };
  const reviewer = (): ProviderConfig => reviewerOverride ?? { provider: provider.provider, model: provider.model, baseURL: provider.baseURL };
  const parseProvider = (rest: string, command: string): ProviderConfig => {
    const [kind, model, url, ...extra] = rest.split(/\s+/);
    if (!providerKinds.includes(kind) || !model || extra.length) throw new Error(`Use /${command} openai-codex|local|openai|anthropic MODEL [URL].`);
    return { provider: kind as ProviderConfig['provider'], model, baseURL: url ?? defaultBaseURL(kind) };
  };
  let workflowOn = true;
  let sessionBaseline: { generation: number; snapshot: TreeSnapshot | null } | undefined;
  let lastReview: { generation: number; receipt: ReviewReceipt } | undefined;
  // A task cut off at the step limit keeps its starting baseline, so the eventual review covers all of it.
  let unfinished: { generation: number; snapshot: TreeSnapshot | null } | undefined;
  let fixStopped = false;
  let baselineWarned = false;
  const interactive = prompt === undefined && Boolean(stdin.isTTY && stdout.isTTY);
  const scratchWorkspace = values.cwd === undefined && interactive && !values.resume && path.relative(fs.realpathSync.native(os.homedir()), workspace) === '';
  if (scratchWorkspace) workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'neura-workspace-')));
  try { assertWorkspaceOutsideNeuraHome(workspace, home); }
  catch (error) { if (scratchWorkspace) fs.rmdirSync(workspace); throw error; }
  const workspaceKey = createHash('sha256').update(process.platform === 'win32' ? workspace.toLowerCase() : workspace).digest('hex');
  const sessions = path.join(home, 'sessions', workspaceKey);
  const rl = interactive ? createInterface({ input: stdin, output: process.stdout }) : undefined;
  let abort: AbortController | undefined;
  const inputClosed = new AbortController();
  // readline.close() does not settle a pending promises.question() on its own.
  const onClose = () => { inputClosed.abort(); abort?.abort(); };
  const onInterrupt = () => { if (abort) abort.abort(); else rl?.close(); };
  process.on('SIGINT', onInterrupt);
  rl?.on('SIGINT', onInterrupt);
  rl?.once('close', onClose);
  const learn = createLearnWorkshop(workspace, () => mode === 'learn', warning);
  let session: Session | undefined;
  let memory: any[] = [];
  let sessionState: TerminalStatus['sessionState'] = 'new';
  let lastTurnUsage: TurnUsage | undefined;
  let historySaveFailed = false;
  let lastVerification: WorkspaceReceipt | undefined;
  let verificationGeneration = -1;
  let releaseSession: (() => Promise<void>) | undefined;
  async function selectSession(id?: string) {
    const fresh = id ? undefined : await createSession(sessions);
    const release = await lockSession(sessions, id ?? fresh!.id);
    try {
      const next = fresh ?? await resumeSession(sessions, id!);
      await releaseSession?.(); releaseSession = release;
      session = next; memory = next.messages;
      sessionState = id ? 'resumed' : 'new'; lastTurnUsage = undefined; historySaveFailed = false;
    } catch (error) { await release(); throw error; }
  }
  async function freshConversation() {
    if (!values['no-history']) await selectSession();
    else { memory = []; sessionState = 'new'; lastTurnUsage = undefined; }
  }
  const statusSnapshot = (): TerminalStatus => ({
    mode, provider: provider.provider, model: modelLabel(provider.model),
    workspace: redactSensitiveText(workspace), workspaceName: redactSensitiveText(path.basename(workspace) || workspace),
    history: values['no-history'] ? 'off' : historySaveFailed ? 'save failed' : 'on',
    sessionState, sessionId: session?.id, thinking: showReasoning, messageCount: memory.length, lastTurnUsage,
  });
  // ANSI-capable terminals erase the transient waiting line; plain ones keep it as a record.
  const erasable = interactive && process.env.TERM !== 'dumb';
  const approve = async (description: string) => {
    if (bridge) return bridge.approve(description);
    if (!rl) return false;
    stdout.write('\n' + terminal().approval(description) + '\n');
    const response = await rl.question(terminal().approvalPrompt(), { signal: abort?.signal });
    const approved = response.trim() === 'yes';
    say(approved ? 'Approved once for this exact action.' : 'Denied. No approval granted.');
    return approved;
  };
  try {
    if (!values['no-history']) {
      await selectSession(values.resume);
    } else if (values.resume) throw new Error('--resume cannot be combined with --no-history.');
    if (interactive) stdout.write(terminal().wordmark(values.ascii) + '\n\n'); // Approved logo; no false READY banner.
    if (scratchWorkspace) {
      say(`Scratch workspace: ${workspace}`);
      say('Files remain here after exit, but OS temp cleanup may remove them. Use --cwd PATH for a project.');
    }
    async function changeModel(next: ProviderConfig) {
      createConfiguredModel(next);
      abort?.signal.throwIfAborted();
      await freshConversation();
      abort?.signal.throwIfAborted();
      provider = next; modelExplicit = true;
      generation++; learn.invalidate();
      say(`Model: ${modelLabel(provider.model)} (${provider.provider}). A fresh conversation is selected.`);
    }
    async function pickModel() {
      stdout.write(terminal().metadata([['Provider', provider.provider], ['Current model', modelLabel(provider.model)]]) + '\n');
      if (provider.provider !== 'openai-codex') {
        say('For this provider use /model PROVIDER MODEL [URL]. API providers are explicitly selected and billed separately.');
        return;
      }
      abort = new AbortController();
      try {
        say('Fetching the subscription model catalog...');
        const choices = await listCodexModels({ signal: abort.signal, baseURL: provider.baseURL });
        if (!choices.length) { say('No subscription models available. Model unchanged.'); return; }
        choices.forEach((choice, index) => stdout.write(terminal().modelChoice(modelLabel(choice.id), index, { catalogDefault: index === 0, current: choice.id === provider.model }) + '\n'));
        if (!rl) return;
        for (;;) {
          const answer = (await rl.question(terminal().pickerPrompt(), { signal: abort.signal })).trim();
          if (!answer) { say('Model unchanged.'); return; }
          const selected = /^\d{1,3}$/.test(answer) ? choices[Number(answer) - 1] : choices.find(choice => choice.id === answer);
          if (!selected) { say('Choose one of the listed models, or press Enter to cancel.'); continue; }
          await changeModel({ provider: 'openai-codex', model: selected.id });
          return;
        }
      } finally { abort = undefined; }
    }
    async function turn(text: string, learnerInput = text, reviewTurn = true) {
      if (!text.trim() || text.length > 32000) throw new Error('Task must contain 1-32000 characters.');
      const owned = !abort; // workflow fix turns reuse the outer request's cancellation
      abort ??= new AbortController();
      if (owned) lastTurnUsage = undefined;
      let lineOpen = false;
      let waitingOpen = false;
      const waiting = () => { if (!interactive || waitingOpen) return; stdout.write(terminal().boundary('waiting')); waitingOpen = true; };
      const endLine = () => {
        if (waitingOpen) stdout.write(erasable ? '\r\x1b[2K' : '\n');
        else if (lineOpen) stdout.write('\n');
        lineOpen = false; waitingOpen = false;
      };
      try {
        if (!provider.model) {
          if (provider.provider !== 'openai-codex') throw new Error('Choose a model with --model or /model PROVIDER MODEL [URL].');
          waiting();
          const choices = await listCodexModels({ signal: abort.signal, baseURL: provider.baseURL });
          endLine();
          provider = { ...provider, model: choices[0].id }; modelExplicit = false;
        }
        const expected = generation;
        const userMessage = { role: 'user', content: text };
        learn.input(learnerInput);
        const model = createConfiguredModel({ ...provider, reasoningSummary: showReasoning });
        const tools = [...createWorkspaceTools(workspace, () => mode, () => generation, approve, { notice: line => { endLine(); say(line); } }), ...(mode === 'learn' ? learn.tools() : [])];
        const instructions = mode === 'learn' ? await learn.instructions(abort.signal)
          : [WORK_INSTRUCTIONS, ...(workflowOn ? [WORKFLOW_INSTRUCTIONS] : [])].join('\n\n');
        const guidance = mode === 'work' ? projectInstructions(workspace) : '';
        const guidanceIndex = memory.length;
        const messages = [...memory, ...(guidance ? [{ role: 'user', content: guidance }] : []), userMessage];
        const maxSteps = mode === 'work' ? WORK_TURN_STEPS : DEFAULT_TURN_STEPS;
        const review = reviewTurn && mode === 'work' && workflowOn;
        const needSessionBaseline = mode === 'work' && sessionBaseline?.generation !== expected;
        const carried = review && unfinished?.generation === expected ? unfinished.snapshot : null;
        const baseline = carried ?? (review || needSessionBaseline ? await captureWorktree(workspace, { signal: abort.signal }) : null);
        if (needSessionBaseline) sessionBaseline = { generation: expected, snapshot: baseline };
        waiting();
        let section: 'none' | 'reasoning' | 'answer' | 'tool' = 'none';
        let answerVisible = false;
        let mutationAttempted = false;
        const outcome = await runTurn({ model, messages, instructions, tools, signal: abort.signal, maxSteps,
          onReasoning: showReasoning ? summary => {
            if (bridge?.onReasoning) { bridge.onReasoning(redactSensitiveText(summary, 8000)); return; }
            endLine();
            stdout.write(terminal().boundary('reasoning') + '\n');
            say(redactSensitiveText(summary, 8000)); section = 'reasoning';
          } : undefined,
          onText: chunk => {
            const text = terminalText(chunk);
            if (!text) return;
            if (section !== 'answer') {
              endLine();
              // Label the answer only where it must be told apart from a labelled reasoning summary.
              if (section === 'reasoning') stdout.write(terminal().boundary('answer') + '\n');
            }
            stdout.write(text); lineOpen = !text.endsWith('\n'); section = 'answer'; answerVisible = true;
          },
          onToolEvent: (event, invocationId) => {
            bridge?.onToolEvent?.(event, invocationId);
            // One line per tool call; started/returned are routine. Failed, blocked and cancelled stay visible.
            if (event.phase === 'started') { mutationAttempted ||= !READ_ONLY_TOOLS.has(event.toolName); return; }
            if (event.phase === 'returned') { if (erasable) waiting(); return; }
            if (bridge?.onToolEvent) return;
            endLine();
            stdout.write(terminal().tool(redactSensitiveText(event.toolName, 128), event.phase) + '\n'); section = 'tool';
          } });
        endLine();
        const stopped = outcome.stopReason === 'step-limit';
        if (interactive && !answerVisible && !stopped) say('Turn ended without answer text. Review tool outcomes above.');
        if (generation !== expected) throw new Error('Session changed; result discarded.');
        // Repository context is lower-priority user data, refreshed each turn rather than persisted into history.
        memory = withoutToolImages(guidance ? outcome.messages.filter((_, index) => index !== guidanceIndex) : outcome.messages);
        // A request's usage includes its workflow fix turns; any unreported count makes the total unknown.
        lastTurnUsage = owned ? outcome.usage : lastTurnUsage && outcome.usage
          ? { inputTokens: lastTurnUsage.inputTokens + outcome.usage.inputTokens, outputTokens: lastTurnUsage.outputTokens + outcome.usage.outputTokens } : undefined;
        if (session) {
          try { session = await saveSession(sessions, { ...session, messages: memory }); memory = session.messages; historySaveFailed = false; }
          catch { historySaveFailed = true; warning('Turn completed, but history was not saved safely. Do not repeat a mutation merely to save its result.'); }
        }
        if (stopped) {
          bridge?.onStepLimit?.();
          if (!rl && !bridge) process.exitCode = 1;
          if (!reviewTurn) { fixStopped = true; throw new Error(`the fix stopped at the ${maxSteps}-step limit and is unfinished. Say "continue" to go on.`); }
          if (review) unfinished = { generation: expected, snapshot: baseline };
          say(`Stopped at the ${maxSteps}-step limit. The task is unfinished${review ? ' and was not reviewed' : ''}. Say "continue" to go on.`);
        } else if (review && baseline) { unfinished = undefined; await workflow(text, baseline, false); }
        else if (review && mutationAttempted && !baselineWarned) {
          baselineWarned = true; // once per session, and only when something may have changed: plain chat stays answer-only
          stdout.write(terminal().feedback('Review unavailable: no workspace baseline (needs a committed Git repository within snapshot limits), so changes here are not reviewed. /workflow off hides this note.') + '\n');
        }
        if (owned && interactive) stdout.write('\n');
      } catch (error) {
        if (abort?.signal.aborted) throw new DOMException('Turn cancelled. No task was replayed. Inspect current state before retrying.', 'AbortError');
        throw error;
      } finally { endLine(); if (owned) abort = undefined; }
    }
    async function workflow(task: string, baseline: TreeSnapshot | null, manual: boolean) {
      const expected = generation;
      fixStopped = false;
      const outcome = await runReviewLoop({ workspace, task, baseline, reviewer: reviewer(), builder: provider, signal: abort?.signal, manual }, {
        capture: (root, signal) => captureWorktree(root, { signal }),
        review: input => reviewCandidate(input), assessRisk,
        fixTurn: prompt => turn(prompt, prompt, false),
        current: () => generation === expected && mode === 'work',
        report: line => say(line),
      });
      if (fixStopped) unfinished = { generation: expected, snapshot: baseline }; // The next review must still cover the whole task.
      if (outcome.receipt && generation === expected) lastReview = { generation, receipt: outcome.receipt };
    }
    async function input(text: string): Promise<boolean> {
      if (interactive && /^(?:exit|quit)$/i.test(text.trim())) text = '/quit'; // bare words, as in a shell
      if (!text.startsWith('/')) { await turn(text); return true; }
      const [, command, rest = ''] = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim()) ?? [];
      if (command === 'quit' || command === 'exit') { if (interactive) say('Neura closed.'); return false; }
      if (command === 'help') stdout.write(terminal().help() + '\n');
      else if (command === 'status') {
        if (rest.trim()) throw new Error('Use /status without arguments.');
        const ui = interactive ? terminal() : createTerminalUI({ columns: stdout.columns });
        stdout.write(ui.statusDetails(statusSnapshot()) + '\n');
      }
      else if (command === 'verify') {
        if (mode !== 'work') throw new Error('Verification is available only in Work. Learn cannot execute proof.');
        if (!['', 'quick', 'full', 'status'].includes(rest)) throw new Error('Use /verify quick, /verify full or /verify status.');
        abort = new AbortController();
        const expected = generation;
        try {
          if (rest === 'status') {
            if (!lastVerification || verificationGeneration !== generation) { say('No verification receipt in this session. Run /verify quick or /verify full.'); return true; }
            const status = await workspaceReceiptStatus(workspace, lastVerification, abort.signal);
            if (generation !== expected || mode !== 'work') throw new Error('Verification mode/session changed; result discarded.');
            say(JSON.stringify(status, null, 2));
          } else {
            lastVerification = await verifyWorkspace(workspace, rest === 'quick' ? 'detector-only' : 'full', {
              signal: abort.signal, current: () => generation === expected && mode === 'work', approve,
            });
            verificationGeneration = expected;
            say(JSON.stringify(lastVerification, null, 2));
            if (!rl && !bridge && lastVerification.status !== 'detector-only') process.exitCode = 1;
            if (lastVerification.reason === 'full_evidence_unavailable') say('Full verification is blocked: PoW 0.2.0 lacks trusted suite/candidate evidence. No tests were run.');
            else if (lastVerification.reason === 'snapshot_unavailable') say('Use a committed Git repository root within the snapshot limits. No proof command was run.');
            else if (lastVerification.reason === 'runner_unavailable') say('Pinned offline PoW/WSL sandbox unavailable. No host fallback was used.');
            say('This receipt is session-local metadata, not signed attestation or task completion. Detector-only is never verified.');
          }
        } finally { abort = undefined; }
      } else if (command === 'workflow') {
        if (rest && !['on', 'off'].includes(rest)) throw new Error('Use /workflow on or /workflow off.');
        if (rest) workflowOn = rest === 'on';
        say(`Review workflow: ${workflowOn ? 'on (Work changes get an independent read-only review)' : 'off (no automatic review)'}.`);
      } else if (command === 'reviewer') {
        if (rest === 'default') reviewerOverride = undefined;
        else if (rest) { const next = parseProvider(rest, 'reviewer'); createConfiguredModel(next); reviewerOverride = next; }
        const current = reviewer();
        say(`Reviewer: ${modelLabel(current.model)} (${current.provider}${reviewerOverride ? '' : ', follows builder'}); ${reviewerIndependence(current, provider) === 'cross-family' ? 'cross-family' : 'same-family, weaker independence'}.`);
      } else if (command === 'review') {
        if (mode !== 'work') throw new Error('Review is available only in Work.');
        if (!['', 'status'].includes(rest)) throw new Error('Use /review or /review status.');
        abort = new AbortController();
        const expected = generation;
        try {
          if (rest === 'status') {
            if (!lastReview || lastReview.generation !== generation) { say('No review receipt in this session. Run /review.'); return true; }
            const current = await reviewReceiptCurrent(workspace, lastReview.receipt, abort.signal);
            if (generation !== expected || mode !== 'work') throw new Error('Review mode/session changed; result discarded.');
            say(`Last review (${lastReview.receipt.status}) is ${current ? 'current for the workspace' : 'stale: the workspace changed since it was reviewed'}.`);
          } else {
            if (sessionBaseline?.generation !== generation) {
              say('No session baseline yet; capturing one now, so only later changes can be reviewed.');
              sessionBaseline = { generation, snapshot: await captureWorktree(workspace, { signal: abort.signal }) };
            }
            await workflow('Manual /review of all workspace changes since the session baseline.', sessionBaseline.snapshot, true);
          }
        } finally { abort = undefined; }
      } else if (command === 'thinking') {
        if (rest && !['on', 'off'].includes(rest)) throw new Error('Use /thinking on or /thinking off.');
        if (rest) showReasoning = rest === 'on';
        say(`Provider reasoning summaries: ${showReasoning ? 'on' : 'off'}. Hidden internal reasoning is not available.`);
      } else if (command === 'login') {
        if (!rl || rest.trim()) throw new Error('Use /login without arguments in an interactive Neura terminal.');
        abort = new AbortController();
        try {
          await loginCodex({ signal: abort.signal, onAuthorize: url => say(`Open this URL in your browser to sign in:\n${url}`) });
          const remembered = provider.provider === 'openai-codex' && modelExplicit ? provider.model : '';
          provider = { provider: 'openai-codex', model: remembered }; modelExplicit = Boolean(remembered);
          await freshConversation();
          generation++; learn.invalidate();
          say('Neura subscription login saved. A fresh conversation is selected; no Pi credentials were imported.');
        } finally { abort = undefined; }
      } else if (command === 'logout') {
        if (rest.trim()) throw new Error('/logout accepts no arguments.');
        await logoutCodex();
        await freshConversation();
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
        await freshConversation();
        generation++; learn.invalidate(true); say('New session; mode authority and learning state refreshed.');
      } else if (command === 'sessions') {
        const items = await listSessions(sessions);
        if (interactive) stdout.write(terminal().sessions(items) + '\n');
        else say(JSON.stringify(items, null, 2));
      } else if (command === 'resume') {
        if (values['no-history']) throw new Error('History disabled.');
        await selectSession(rest);
        generation++; learn.invalidate(true); mode = 'work'; say('Workspace history resumed in Work. Use /mode learn and explicitly /learn resume to restore a lesson.');
      } else if (command === 'model') {
        if (!rest.trim()) { await pickModel(); return true; }
        await changeModel(parseProvider(rest, 'model'));
      } else throw new Error('Unknown command. Use /help.');
      return true;
    }
    if (bridge) { await bridge.serve({ execute: input, cancel: () => abort?.abort() }); return; }
    if (prompt !== undefined) { await input(prompt); return; }
    if (interactive) stdout.write(terminal().status(statusSnapshot()) + '\n'); // Once at launch. Chat shows answers only; /status has the rest.
    for (;;) {
      let text: string;
      try { text = await rl!.question(terminal().prompt(mode), { signal: inputClosed.signal }); } catch { say('Neura closed.'); break; }
      if (!text.trim()) continue;
      try { if (!await input(text)) break; } catch (error) {
        const message = error instanceof Error ? error.message : 'Request failed.';
        if (error instanceof Error && error.name === 'AbortError') {
          stderr.write(terminal(process.stderr).feedback('Cancelled. No task was replayed. Inspect current state before retrying.', 'cancelled') + '\n');
          continue;
        }
        failure(message);
        if (provider.provider === 'openai-codex' && message.includes('selected model is unavailable')) say('Use /model to choose a subscription model. No task was replayed; inspect current state before retrying.');
        if (provider.provider === 'openai-codex' && message.includes('rejected request field: reasoning.summary')) say('This model rejected summaries. Use /thinking off before a manual retry. No task was replayed.');
      }
    }
  } finally { generation++; learn.invalidate(true); process.off('SIGINT', onInterrupt); rl?.close(); await releaseSession?.(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { failure(error instanceof Error ? error.message : 'Neura failed.'); process.exitCode = 1; });
