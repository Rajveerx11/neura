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
import { createConfiguredModel, isDirectGatewayModel, isGatewayProvider, listCodexModels, listGatewayModels, PROVIDER_KINDS, type ProviderConfig } from './providers.ts';
import { DEFAULT_TURN_STEPS, runTurn, WORK_TURN_STEPS, type TurnUsage, type ToolEvent, type TurnLimit } from './runtime.ts';
import { verifyWorkspace, workspaceReceiptStatus, type WorkspaceReceipt } from './verification.ts';
import { loadWorkspaceReceipt, saveWorkspaceReceipt } from './verification-store.ts';
import { createSession, saveSession, resumeSession, listSessions, withoutToolImages, taskRecovery, type Session, type TaskRecovery } from './session.ts';
import { redactSensitiveText } from '../agent/neura/redaction.ts';
import { captureWorktree, type TreeSnapshot } from '../agent/neura/verification.ts';
import { assessRisk, reviewCandidate, reviewReceiptCurrent, reviewerIndependence, reviewerIndependenceLabel, type ReviewReceipt } from './review.ts';
import { runReviewLoop, WORKFLOW_INSTRUCTIONS } from './workflow.ts';
import { createYoloTools, YOLO_CONFIRMATION, YOLO_INSTRUCTIONS, YOLO_WARNING } from './yolo.ts';
import { createTerminalUI, terminalText, commandMatches, type Mode, type TerminalStatus } from './terminal-ui.ts';
import { discoverSkills, skillName, skillRoots, skillTurn, SKILL_TOOL, withoutSkillResults, type InstalledSkill } from './skills.ts';
import { clearDraft, createCommandKeyboard } from './prompt-input.ts';
import { createSchedules, parseSchedule, scheduleTime } from './schedules.ts';
export { terminalText } from './terminal-ui.ts';

let asciiGlyphs = false;
const terminal = (stream: NodeJS.WriteStream = stdout) => createTerminalUI({ isTTY: Boolean(stream.isTTY), columns: stream.columns, env: process.env, ascii: asciiGlyphs });
const failure = (text: string) => stderr.write(terminal(stderr).feedback(redactSensitiveText(text, 8000), 'error') + '\n');
const isProvider = (value: string): value is ProviderConfig['provider'] => PROVIDER_KINDS.some(kind => kind === value);
const modelRoute = ({ provider, model }: ProviderConfig) => isGatewayProvider(provider) && model
  ? createHash('sha256').update(JSON.stringify([provider, model])).digest('hex')
  : undefined;

export type CliBridge = {
  write: (text: string) => void;
  approve: (description: string) => Promise<boolean>;
  onToolEvent?: (event: ToolEvent, invocationId?: string) => void;
  onReasoning?: (text: string) => void;
  onTurnLimit?: (limit: TurnLimit) => void;
  onModeChange?: (mode: Mode) => void;
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
    help: { type: 'boolean', short: 'h' }, check: { type: 'boolean' }, ascii: { type: 'boolean' }, prompt: { type: 'string', short: 'p' }, cwd: { type: 'string' }, mode: { type: 'string' }, yolo: { type: 'boolean' }, 'dangerously-bypass-approvals-and-sandbox': { type: 'boolean' }, provider: { type: 'string' }, model: { type: 'string' }, 'base-url': { type: 'string' }, resume: { type: 'string' }, 'no-history': { type: 'boolean' }, 'no-thinking': { type: 'boolean' },
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
    say(JSON.stringify({ framework: 'Neura agent loop', version: runtime.version, providers: { '@ai-sdk/openai': runtime.dependencies['@ai-sdk/openai'], '@ai-sdk/anthropic': runtime.dependencies['@ai-sdk/anthropic'] }, modes: ['work', 'learn', 'yolo'], node: process.version, platform: process.platform, learnFirstCreation: process.platform === 'win32' ? 'supported' : 'requires native Windows', history: 'Neura-owned; no Pi imports', status: 'development; release packaging and real-auth gates remain' }, null, 2));
    return;
  }
  let workspace = fs.realpathSync.native(path.resolve(values.cwd ?? process.cwd()));
  if (!fs.statSync(workspace).isDirectory()) throw new Error('Workspace must be a directory.');
  const yoloFlag = Boolean(values.yolo || values['dangerously-bypass-approvals-and-sandbox']);
  if (values.mode === 'yolo') throw new Error('--mode yolo is refused. Use --yolo; that flag is your explicit consent to no sandbox and no approvals.');
  if (values.mode !== undefined && !['work', 'learn'].includes(values.mode)) throw new Error('Only --mode work and --mode learn are available.');
  if (yoloFlag && values.mode !== undefined) throw new Error('--yolo cannot be combined with --mode.');
  let mode: Mode = yoloFlag ? 'yolo' : values.mode === 'learn' ? 'learn' : 'work';
  let generation = 0;
  const home = path.resolve(process.env.NEURA_HOME || path.join(os.homedir(), '.neura'));
  if (home.split(/[\\/]/).some(part => part.replace(/[. ]+$/, '').toLowerCase() === '.pi')) throw new Error('NEURA_HOME must be outside the legacy Pi profile.');
  const prompt = values.prompt ?? (positionals.length ? positionals.join(' ') : undefined);
  if (!bridge && prompt === undefined && !(stdin.isTTY && stdout.isTTY)) throw new Error('Noninteractive input requires an explicit --prompt.');
  if (values.prompt !== undefined && positionals.length) throw new Error('Use either --prompt or a positional task, not both.');
  const defaultBaseURL = (kind: string) => kind === 'local' ? 'http://127.0.0.1:8080/v1' : undefined;
  const providerKind = values.provider ?? process.env.NEURA_PROVIDER ?? 'openai-codex';
  if (!isProvider(providerKind)) throw new Error('Unsupported provider.');
  const reviewerKind = values['reviewer-provider'] ?? process.env.NEURA_REVIEWER_PROVIDER;
  const reviewerModel = values['reviewer-model'] ?? process.env.NEURA_REVIEWER_MODEL;
  const reviewerURL = values['reviewer-base-url'] ?? process.env.NEURA_REVIEWER_BASE_URL;
  if (reviewerKind !== undefined && !isProvider(reviewerKind)) throw new Error('Unsupported reviewer provider.');
  if (reviewerModel !== undefined && !reviewerModel.trim()) throw new Error('Reviewer model name is required.');
  if ((reviewerKind !== undefined || reviewerURL !== undefined) && reviewerModel === undefined) throw new Error('Reviewer model is required with a reviewer provider or base URL.');
  const configuredModel = values.model ?? process.env.NEURA_MODEL;
  if (configuredModel !== undefined && !configuredModel.trim()) throw new Error('Model name is required.');
  if (configuredModel !== undefined && isGatewayProvider(providerKind) && !isDirectGatewayModel(configuredModel)) {
    throw new Error('Gateway requires a direct model ID without server tools.');
  }
  let modelExplicit = configuredModel !== undefined;
  let showReasoning = Boolean(bridge && !values['no-thinking']);
  let provider: ProviderConfig = { provider: providerKind, model: configuredModel ?? '', baseURL: values['base-url'] ?? process.env.NEURA_BASE_URL ?? defaultBaseURL(providerKind) };
  const modelLabel = (value: string, kind: ProviderConfig['provider']) => terminalText(
    isGatewayProvider(kind) && isDirectGatewayModel(value) ? value : redactSensitiveText(value || '(not selected)', 200));
  // Explicit reviewer only; otherwise the reviewer follows the current builder model (same-family, labelled weaker).
  let reviewerOverride: ProviderConfig | undefined = reviewerModel === undefined ? undefined : { provider: reviewerKind ?? providerKind, model: reviewerModel, baseURL: reviewerURL ?? defaultBaseURL(reviewerKind ?? providerKind) };
  const reviewer = (): ProviderConfig => reviewerOverride ?? { provider: provider.provider, model: provider.model, baseURL: provider.baseURL };
  const parseProvider = (rest: string, command: string): ProviderConfig => {
    const [kind, model, url, ...extra] = rest.split(/\s+/);
    if (!isProvider(kind) || !model || extra.length) throw new Error(`Use /${command} PROVIDER MODEL [URL]. Providers: ${PROVIDER_KINDS.join(', ')}.`);
    return { provider: kind, model, baseURL: url ?? defaultBaseURL(kind) };
  };
  let workflowOn = true;
  let sessionBaseline: { generation: number; snapshot: TreeSnapshot | null } | undefined;
  let lastReview: { generation: number; receipt: ReviewReceipt } | undefined;
  let recovery: TaskRecovery | undefined;
  let reconciliationRequired = false;
  let fixStopped = false;
  let baselineWarned = false;
  const interactive = prompt === undefined && Boolean(stdin.isTTY && stdout.isTTY);
  const schedules = createSchedules();
  const scratchWorkspace = values.cwd === undefined && interactive && !values.resume && path.relative(fs.realpathSync.native(os.homedir()), workspace) === '';
  if (scratchWorkspace) workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'neura-workspace-')));
  try { assertWorkspaceOutsideNeuraHome(workspace, home); }
  catch (error) { if (scratchWorkspace) fs.rmdirSync(workspace); throw error; }
  const workspaceKey = createHash('sha256').update(process.platform === 'win32' ? workspace.toLowerCase() : workspace).digest('hex');
  const sessions = path.join(home, 'sessions', workspaceKey);
  asciiGlyphs = Boolean(values.ascii);
  // ANSI-capable terminals with raw input get the composer and command menus.
  const keyboard = interactive && process.env.TERM !== 'dumb' && typeof stdin.setRawMode === 'function' ? createCommandKeyboard(stdin, process.stdout) : undefined;
  const rl = interactive ? createInterface({ input: keyboard?.input ?? stdin, output: process.stdout, terminal: true }) : undefined;
  const roots = skillRoots(workspace, home);
  let installedSkills: InstalledSkill[] | undefined;
  const composer = rl && keyboard ? keyboard.attach(rl, () => terminal(), line => {
    if (line.startsWith('$')) installedSkills ??= discoverSkills(roots);
    return commandMatches(line, installedSkills);
  }) : undefined;
  let pauseActivity = () => {};
  let abort: AbortController | undefined;
  const inputClosed = new AbortController();
  // readline.close() does not settle a pending promises.question() on its own.
  const onClose = () => { inputClosed.abort(); abort?.abort(); };
  const onInterrupt = () => { if (abort) abort.abort(); else inputClosed.abort(); };
  process.on('SIGINT', onInterrupt);
  rl?.on('SIGINT', onInterrupt);
  rl?.once('close', onClose);
  const learn = createLearnWorkshop(workspace, () => mode === 'learn', warning);
  let session: Session | undefined;
  let memory: any[] = [];
  let sessionState: TerminalStatus['sessionState'] = 'new';
  let lastTurnUsage: TurnUsage | undefined;
  let historySaveFailed = false;
  const canRunScheduled = () => mode === 'work' && !reconciliationRequired && !historySaveFailed &&
    (!recovery || recovery.stage === 'completed');
  let lastVerification: WorkspaceReceipt | undefined;
  let verificationGeneration = -1;
  let releaseSession: (() => Promise<void>) | undefined;
  let pendingSessionSave: Promise<Session> | undefined;
  const restoreTaskBaseline = () => {
    sessionBaseline = recovery ? { generation, snapshot: recovery.baseline } : undefined;
  };
  const recoveryNotice = () => {
    if (reconciliationRequired) warning('Task outcome needs reconciliation. Inspect workspace and any external effects, then use /reconcile to acknowledge that inspection. No task was replayed. Use /new to keep this history and start a separate task.');
    else if (recovery?.stage === 'unfinished') say('Saved task is unfinished. Its original base is retained. Continue only with an explicit task.');
  };
  async function persistRecovery(next: TaskRecovery, expected: number, messages?: Session['messages']) {
    const selected = session;
    if (generation !== expected) throw new Error('Session changed; task state discarded.');
    if (selected) {
      let saved: Session;
      const write = saveSession(sessions, { ...selected, messages: messages ?? selected.messages, recovery: next });
      pendingSessionSave = write;
      try { saved = await write; }
      catch (error) { if (generation === expected && session?.id === selected.id) historySaveFailed = true; throw error; }
      finally { if (pendingSessionSave === write) pendingSessionSave = undefined; }
      if (generation !== expected || session?.id !== selected.id) throw new Error('Session changed; task state discarded.');
      session = saved;
      if (messages !== undefined) { memory = saved.messages; historySaveFailed = false; }
    }
    if (recovery?.taskId !== next.taskId) { lastReview = undefined; lastVerification = undefined; verificationGeneration = -1; }
    recovery = next;
    restoreTaskBaseline();
  }
  async function selectSession(id?: string, config = provider) {
    const route = modelRoute(config);
    const fresh = id ? undefined : await createSession(sessions, route);
    const release = await lockSession(sessions, id ?? fresh!.id);
    try {
      const next = fresh ?? await resumeSession(sessions, id!);
      if (next.recovery && next.recovery.workspaceKey !== workspaceKey) throw new Error('Task recovery belongs to another workspace.');
      if (id && ((next.modelRoute && next.modelRoute !== route) || (isGatewayProvider(config.provider) && !next.modelRoute))) {
        throw new Error('This history requires its original provider and model. Select that route before resuming, or start a new chat.');
      }
      if (session) generation++; // Fence outstanding work before releasing the old writer lease.
      await pendingSessionSave?.catch(() => {});
      await releaseSession?.(); releaseSession = release;
      session = next; memory = next.messages;
      recovery = next.recovery;
      reconciliationRequired = Boolean(id && (recovery ? ['running', 'reconcile'].includes(recovery.stage) : memory.length));
      // Old chats remain readable, but no historical task base can be inferred from today's HEAD.
      if (!recovery && memory.length) recovery = { ...taskRecovery(workspaceKey, null), stage: 'reconcile' };
      restoreTaskBaseline();
      sessionState = id ? 'resumed' : 'new'; lastTurnUsage = undefined; historySaveFailed = false;
    } catch (error) { await release(); throw error; }
  }
  async function freshConversation(config = provider) {
    if (!values['no-history']) await selectSession(undefined, config);
    else { memory = []; recovery = undefined; reconciliationRequired = false; restoreTaskBaseline(); sessionState = 'new'; lastTurnUsage = undefined; }
  }
  const statusSnapshot = (): TerminalStatus => ({
    mode, provider: provider.provider, model: modelLabel(provider.model, provider.provider),
    workspace: redactSensitiveText(workspace),
    history: values['no-history'] ? 'off' : historySaveFailed ? 'save failed' : 'on',
    sessionState, sessionId: session?.id, thinking: showReasoning, messageCount: memory.length, lastTurnUsage,
  });
  // Transient activity only belongs on terminals that can erase it.
  const erasable = interactive && process.env.TERM !== 'dumb';
  const approve = async (description: string) => {
    if (bridge) return bridge.approve(description);
    if (!rl) return false;
    pauseActivity();
    // Typeahead entered during a turn is not a response to this action.
    clearDraft(rl);
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
    recoveryNotice();
    if (mode === 'yolo') warning(YOLO_WARNING);
    if (scratchWorkspace) warning('OS temp cleanup can remove scratch files. Use /status for the workspace path.');
    async function changeModel(next: ProviderConfig) {
      createConfiguredModel(next);
      abort?.signal.throwIfAborted();
      await freshConversation(next);
      provider = next; modelExplicit = true;
      generation++; learn.invalidate();
      say(`Model: ${modelLabel(provider.model, provider.provider)} (${provider.provider}). A fresh conversation is selected.`);
    }
    async function pickModel(kind = provider.provider) {
      stdout.write(terminal().metadata([['Provider', provider.provider], ['Current model', modelLabel(provider.model, provider.provider)]]) + '\n');
      if (kind !== 'openai-codex' && !isGatewayProvider(kind)) {
        say('Use /model PROVIDER MODEL [URL], or /model openrouter or /model airouter for a gateway catalog.');
        return;
      }
      abort = new AbortController();
      try {
        say(kind === 'openai-codex' ? 'Fetching the subscription model catalog...' : `Fetching the ${kind} API model catalog. Usage bills through that gateway.`);
        const baseURL = kind === provider.provider ? provider.baseURL : undefined;
        const choices = kind === 'openai-codex'
          ? await listCodexModels({ signal: abort.signal, baseURL })
          : await listGatewayModels(kind, { signal: abort.signal });
        if (!choices.length) { say(`No models listed. Use /model ${kind} MODEL to select one explicitly.`); return; }
        choices.forEach((choice, index) => stdout.write(terminal().modelChoice(modelLabel(choice.id, kind), index, { catalogDefault: kind === 'openai-codex' && index === 0, current: kind === provider.provider && choice.id === provider.model }) + '\n'));
        if (!rl) return;
        for (;;) {
          const answer = (await rl.question(terminal().pickerPrompt(), { signal: abort.signal })).trim();
          if (!answer) { say('Model unchanged.'); return; }
          const selected = /^\d+$/.test(answer) ? choices[Number(answer) - 1] : choices.find(choice => choice.id === answer);
          if (!selected) { say('Choose one of the listed models, or press Enter to cancel.'); continue; }
          await changeModel({ provider: kind, model: selected.id, baseURL });
          return;
        }
      } finally { abort = undefined; }
    }
    async function turn(text: string, learnerInput = text, reviewTurn = true, selectedSkill?: InstalledSkill) {
      if (!text.trim() || text.length > 32000) throw new Error('Task must contain 1-32000 characters.');
      if (reconciliationRequired) throw new Error('Task outcome needs reconciliation. Inspect effects and use /reconcile, or /new for a separate task. No task was replayed.');
      const resumingTask = Boolean(recovery && recovery.stage !== 'completed');
      const skills = skillTurn(reviewTurn ? installedSkills ??= discoverSkills(roots) : [], selectedSkill);
      const owned = !abort; // workflow fix turns reuse the outer request's cancellation
      abort ??= new AbortController();
      if (owned) { lastTurnUsage = undefined; fixStopped = false; }
      let lineOpen = false;
      let waitingOpen = false;
      let ticker: NodeJS.Timeout | undefined;
      // Interactive answers render as Markdown. Pipes and ACP receive sanitized text.
      const markdown = interactive && !bridge ? terminal().markdownStream() : undefined;
      const waiting = (label?: string) => {
        if (!erasable || waitingOpen) return;
        waitingOpen = true;
        const started = Date.now();
        let frame = 0;
        const draw = () => stdout.write('\r\x1b[2K' + terminal().activity(frame++, Math.floor((Date.now() - started) / 1000), label));
        draw();
        ticker = setInterval(draw, 100); ticker.unref();
      };
      const endLine = () => {
        if (ticker) { clearInterval(ticker); ticker = undefined; }
        if (waitingOpen) stdout.write('\r\x1b[2K');
        else if (lineOpen) stdout.write('\n');
        lineOpen = false; waitingOpen = false;
        const rest = markdown?.flush();
        if (rest) stdout.write(rest);
      };
      pauseActivity = endLine;
      const expected = generation;
      let taskStarted = false;
      try {
        if (!provider.model) {
          if (provider.provider !== 'openai-codex') throw new Error('Choose a model with --model or /model PROVIDER MODEL [URL].');
          waiting();
          const choices = await listCodexModels({ signal: abort.signal, baseURL: provider.baseURL });
          endLine();
          provider = { ...provider, model: choices[0].id }; modelExplicit = false;
        }
        const userMessage = { role: 'user', content: text };
        learn.input(learnerInput);
        const model = createConfiguredModel({ ...provider, reasoningSummary: showReasoning });
        const tools = mode === 'yolo' ? createYoloTools(workspace, () => mode, () => generation)
          : [...createWorkspaceTools(workspace, () => mode, () => generation, approve), ...(mode === 'learn' ? learn.tools() : [])];
        if (skills.tool) tools.push(skills.tool);
        const instructions = mode === 'learn' ? await learn.instructions(abort.signal)
          : mode === 'yolo' ? YOLO_INSTRUCTIONS
          : [WORK_INSTRUCTIONS, ...(workflowOn ? [WORKFLOW_INSTRUCTIONS] : [])].join('\n\n');
        const guidance = [mode === 'learn' ? '' : projectInstructions(workspace), skills.guidance].filter(Boolean).join('\n\n');
        const guidanceIndex = memory.length;
        const messages = [...memory, ...(guidance ? [{ role: 'user', content: guidance }] : []), userMessage];
        const maxSteps = mode === 'learn' ? DEFAULT_TURN_STEPS : WORK_TURN_STEPS;
        const review = reviewTurn && mode === 'work' && workflowOn;
        if (mode !== 'learn') {
          const next = recovery && recovery.stage !== 'completed' ? { ...recovery, stage: 'running' as const }
            : taskRecovery(workspaceKey, await captureWorktree(workspace, { signal: abort.signal }));
          abort.signal.throwIfAborted();
          // Save intent before any model/tool effect. A failed write must prevent execution.
          try { await persistRecovery(next, expected); }
          catch (error) {
            if (generation !== expected) throw error;
            // Rename may have succeeded before an error was reported. Re-read only; never retry effects.
            try {
              const stored = session && await resumeSession(sessions, session.id);
              if (stored?.recovery?.taskId === next.taskId) { recovery = stored.recovery; reconciliationRequired = true; }
            } catch { recovery = next; reconciliationRequired = true; }
            restoreTaskBaseline(); recoveryNotice();
            throw error;
          }
          taskStarted = true;
          abort.signal.throwIfAborted();
        }
        const baseline = recovery?.baseline ?? null;
        waiting();
        let section: 'none' | 'reasoning' | 'answer' = 'none';
        let answerVisible = false;
        let mutationAttempted = false;
        let failedEffect = false;
        let toolStarted: number | undefined;
        const outcome = await runTurn({ model, messages, instructions, tools, signal: abort.signal, current: () => generation === expected, maxSteps, hideToolText: mode !== 'learn',
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
            if (markdown) stdout.write(markdown.push(text));
            else { stdout.write(text); lineOpen = !text.endsWith('\n'); }
            section = 'answer'; answerVisible = true;
          },
          onToolEvent: (event, invocationId) => {
            bridge?.onToolEvent?.(event, invocationId);
            const effect = event.toolName !== 'unknown' && event.toolName !== SKILL_TOOL && !READ_ONLY_TOOLS.has(event.toolName);
            if (event.phase === 'started') mutationAttempted ||= effect;
            if (event.phase === 'failed' || event.phase === 'blocked') failedEffect ||= effect;
            if (bridge?.onToolEvent || event.phase === 'requested') return;
            const name = mode === 'yolo' && event.toolName === 'exec' ? 'exec on host' : event.toolName;
            if (event.phase === 'started') {
              toolStarted = performance.now();
              endLine();
              waiting(`Running ${name}`);
              return;
            }
            endLine();
            const elapsed = toolStarted === undefined ? undefined : performance.now() - toolStarted;
            toolStarted = undefined;
            if (interactive) stdout.write(terminal().tool(name, event.phase, elapsed) + '\n');
            else if (event.phase !== 'returned') stderr.write((bridge ? terminal() : terminal(process.stderr)).tool(name, event.phase, elapsed) + '\n');
            if (!abort?.signal.aborted) waiting();
          } });
        endLine();
        const stopped = outcome.stopReason !== 'finished';
        let actionFailed = outcome.actionFailed;
        if (interactive && !answerVisible && !stopped) say('Turn ended without answer text. Review tool outcomes above.');
        if (generation !== expected || abort.signal.aborted) throw new Error('Session changed or turn cancelled; result discarded.');
        // Guidance and raw skill results expire at the end of the turn.
        memory = withoutToolImages(withoutSkillResults(guidance ? outcome.messages.filter((_, index) => index !== guidanceIndex) : outcome.messages));
        // A request's usage includes its workflow fix turns; any unreported count makes the total unknown.
        lastTurnUsage = owned ? outcome.usage : lastTurnUsage && outcome.usage
          ? { inputTokens: lastTurnUsage.inputTokens + outcome.usage.inputTokens, outputTokens: lastTurnUsage.outputTokens + outcome.usage.outputTokens } : undefined;
        if (taskStarted) {
          try { await persistRecovery({ ...recovery!, stage: 'running' }, expected, memory); }
          catch (error) {
            if (generation !== expected) throw error;
            reconciliationRequired = true;
            warning('Turn completed, but history was not saved safely. Do not repeat a mutation merely to save its result.');
            throw new Error('Task outcome needs reconciliation because session save failed. No task was replayed.');
          }
        } else if (session) {
          try { session = await saveSession(sessions, { ...session, messages: memory }); memory = session.messages; historySaveFailed = false; }
          catch { historySaveFailed = true; warning('Turn completed, but history was not saved safely. Do not repeat a mutation merely to save its result.'); }
        }
        if (outcome.stopReason !== 'finished') {
          const limit = outcome.stopReason === 'step-limit' ? `${maxSteps}-step limit` : 'model output limit';
          bridge?.onTurnLimit?.(outcome.stopReason);
          if (!rl && !bridge) process.exitCode = 1;
          if (!reviewTurn) {
            fixStopped = true;
            await persistRecovery({ ...recovery!, stage: 'unfinished' }, expected);
            taskStarted = false;
            throw new Error(`The fix reached the ${limit} and is unfinished. Say "continue" to go on.`);
          }
          say(`Reached the ${limit}. Task unfinished. Say "continue" to go on.`);
        } else if (mode !== 'learn' && failedEffect) {
          fixStopped = true;
          say(`Task unfinished after a failed ${mode === 'yolo' ? 'YOLO' : 'Work'} action. Inspect its effects before continuing.`);
        } else if (review && baseline) {
          if (!await workflow(text, baseline, false)) actionFailed = true;
        }
        else if (review && (mutationAttempted || resumingTask)) {
          fixStopped = true; // An unavailable original base must never become a completed/rebased task.
          if (mutationAttempted && !baselineWarned) {
            baselineWarned = true; // once per session; plain chat stays answer-only
            stdout.write(terminal().feedback('Review unavailable: no workspace baseline (needs a committed Git repository within snapshot limits), so changes here are not reviewed. /workflow off hides this note.') + '\n');
          }
        }
        if (taskStarted && owned) {
          abort.signal.throwIfAborted();
          let stage: TaskRecovery['stage'] = stopped || fixStopped || actionFailed ? 'unfinished' : 'completed';
          if (reconciliationRequired) stage = 'reconcile';
          await persistRecovery({ ...recovery!, stage }, expected);
          abort.signal.throwIfAborted();
        }
        if (owned && interactive) stdout.write('\n');
        const succeeded = !stopped && !fixStopped && !actionFailed;
        if (owned && !succeeded && prompt !== undefined && !bridge) process.exitCode = 1;
        return succeeded;
      } catch (error) {
        endLine();
        if (taskStarted && generation === expected) {
          reconciliationRequired = true;
          recovery = { ...recovery!, stage: 'reconcile' };
          try { await persistRecovery(recovery, expected); }
          catch { warning('Task recovery could not be saved. Inspect effects before retrying; saved state may still be running.'); }
          recoveryNotice();
        }
        if (abort?.signal.aborted) throw new DOMException('Turn cancelled. No task was replayed. Inspect current state before retrying.', 'AbortError');
        throw error;
      } finally { endLine(); if (owned) { abort = undefined; pauseActivity = () => {}; } }
    }
    async function workflow(task: string, baseline: TreeSnapshot | null, manual: boolean) {
      const expected = generation;
      fixStopped = false;
      const current = baseline ? await captureWorktree(workspace, { signal: abort?.signal }) : null;
      if (generation !== expected || mode !== 'work' || abort?.signal.aborted) return false;
      if (baseline && current?.head !== baseline.head) {
        fixStopped = true;
        say('Review unavailable: HEAD changed since the original task base. The reviewer diffs current HEAD and cannot attest historical task changes. Original base retained; inspect committed changes separately.');
        return false;
      }
      const outcome = await runReviewLoop({ workspace, task, baseline, reviewer: reviewer(), builder: provider, signal: abort?.signal, manual }, {
        capture: async (root, signal) => {
          const snapshot = await captureWorktree(root, { signal });
          return baseline && snapshot?.head !== baseline.head ? null : snapshot;
        },
        review: input => reviewCandidate(input), assessRisk,
        fixTurn: prompt => turn(prompt, prompt, false),
        current: () => generation === expected && mode === 'work',
        report: line => say(line),
      });
      if (outcome.state === 'blocked') fixStopped = true;
      if (outcome.receipt && generation === expected) lastReview = { generation, receipt: outcome.receipt };
      return outcome.state !== 'blocked';
    }
    async function input(text: string): Promise<boolean> {
      if (interactive && /^(?:exit|quit)$/i.test(text.trim())) text = '/quit'; // bare words, as in a shell
      if (text.startsWith('$')) {
        const match = /^\$(\S+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
        const [, rawName, task = ''] = match ?? [];
        const name = rawName && skillName(rawName.normalize('NFKC').toLowerCase());
        if (!match || (rawName && !name)) throw new Error('Use $ to list installed skills, or $NAME TASK to apply one.');
        installedSkills = discoverSkills(roots);
        if (!name) {
          if (!installedSkills.length) say('No installed skills found. Add a package with SKILL.md under .agents/skills, .claude/skills or .neura/skills.');
          else for (const skill of installedSkills) say(`$${skill.name} — ${skill.description || 'Installed skill'}`);
          return true;
        }
        const skill = installedSkills.find(entry => entry.name === name);
        if (!skill) throw new Error('Installed skill not found. Type $ to list available skills.');
        if (!task.trim()) throw new Error(`Use $${skill.name} TASK to apply this skill.`);
        await turn(text, task, true, skill);
        return true;
      }
      if (!text.startsWith('/')) { await turn(text); return true; }
      const [, command, rest = ''] = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim()) ?? [];
      if (command === 'quit' || command === 'exit') return false;
      if (command === 'verify' && rest !== 'status' && recovery && (!recovery.baseline || reconciliationRequired)) throw new Error('Verification unavailable: original task base snapshot or reconciliation is missing. Inspect effects; no newer HEAD was substituted.');
      if (command === 'help') stdout.write(terminal().help() + '\n');
      else if (command === 'status') {
        if (rest.trim()) throw new Error('Use /status without arguments.');
        const ui = interactive ? terminal() : createTerminalUI({ columns: stdout.columns });
        stdout.write(ui.statusDetails(statusSnapshot()) + '\n');
        if (recovery) say(`Task recovery: ${reconciliationRequired ? 'reconcile' : recovery.stage}. This records progress only, not verification or approval.`);
      }
      else if (command === 'verify') {
        if (mode !== 'work') throw new Error('Verification is available only in Work. Learn cannot execute proof.');
        if (!['', 'quick', 'full', 'status'].includes(rest)) throw new Error('Use /verify quick, /verify full or /verify status.');
        abort = new AbortController();
        const expected = generation;
        const verificationSession = values['no-history'] ? undefined : session?.id;
        const verificationOptions = { signal: abort.signal, current: () => generation === expected && mode === 'work' && (values['no-history'] || session?.id === verificationSession) };
        try {
          if (rest === 'status') {
            if (verificationSession) {
              lastVerification = await loadWorkspaceReceipt(sessions, verificationSession, workspace, verificationOptions);
              verificationGeneration = expected;
            }
            if (!lastVerification || verificationGeneration !== generation) { say('No verification receipt in this session. Run /verify quick or /verify full.'); return true; }
            const status = await workspaceReceiptStatus(workspace, lastVerification, abort.signal);
            abort.signal.throwIfAborted();
            if (!verificationOptions.current()) throw new Error('Verification mode/session changed; result discarded.');
            say(JSON.stringify(status, null, 2));
          } else {
            const receipt = await verifyWorkspace(workspace, rest === 'quick' ? 'detector-only' : 'full', {
              ...verificationOptions, approve,
              // Compare against where this session started, so a commit made mid-task stays in the diff.
              base: sessionBaseline?.generation === expected ? sessionBaseline.snapshot?.head : undefined,
            });
            if (verificationSession) await saveWorkspaceReceipt(sessions, verificationSession, workspace, receipt, verificationOptions);
            abort.signal.throwIfAborted();
            if (!verificationOptions.current()) throw new Error('Verification mode/session changed; result discarded.');
            lastVerification = receipt;
            verificationGeneration = expected;
            say(JSON.stringify(lastVerification, null, 2));
            if (!rl && !bridge && lastVerification.status !== 'detector-only') process.exitCode = 1;
            if (lastVerification.reason === 'full_evidence_unavailable') say('Full verification is blocked: PoW 0.2.0 lacks trusted suite/candidate evidence. No tests were run.');
            else if (lastVerification.reason === 'snapshot_unavailable') say('Use a committed Git repository root within the snapshot limits. No proof command was run.');
            else if (lastVerification.reason === 'runner_unavailable') say('Pinned offline PoW/WSL sandbox unavailable. No host fallback was used.');
            say('This receipt is session metadata, not signed attestation, automatic approval or task completion. Detector-only is never verified.');
          }
        } finally { abort = undefined; }
      } else if (command === 'schedule' || command === 'loop') {
        if (!interactive || mode !== 'work') throw new Error('Schedules require an interactive Work terminal.');
        if (command === 'schedule' && (!rest || rest === 'list')) {
          const jobs = schedules.list();
          if (!jobs.length) say('No schedules.');
          else {
            if (!canRunScheduled()) say('Schedules paused. Resolve the current task to resume.');
            for (const job of jobs) {
              const label = terminalText(redactSensitiveText(job.task, 120)).replace(/\s+/g, ' ').trim();
              say(`#${job.id} · ${scheduleTime(job)}${job.interval ? ' · repeats' : ''} · ${label}`);
            }
          }
        } else if (command === 'schedule' && rest.startsWith('cancel ')) {
          const id = rest.slice(7);
          if (!/^\d+$/.test(id) || !schedules.remove(Number(id))) throw new Error('Schedule ID not found. Use /schedule list.');
          say(`Cancelled schedule #${id}.`);
        } else {
          if (!canRunScheduled()) throw new Error('Resolve the current task before scheduling a new one.');
          if (command === 'loop' && !rest) throw new Error('Use /loop DURATION TASK.');
          const job = schedules.add(parseSchedule(command === 'loop' ? `every ${rest}` : rest));
          say(`Schedule #${job.id} · ${scheduleTime(job)}`);
        }
      } else if (command === 'workflow') {
        if (rest && !['on', 'off'].includes(rest)) throw new Error('Use /workflow on or /workflow off.');
        if (rest) workflowOn = rest === 'on';
        say(`Review workflow: ${workflowOn ? 'on (Work changes get an independent read-only review)' : 'off (no automatic review)'}.`);
      } else if (command === 'reviewer') {
        if (rest === 'default') reviewerOverride = undefined;
        else if (rest) { const next = parseProvider(rest, 'reviewer'); createConfiguredModel(next); reviewerOverride = next; }
        const current = reviewer();
        say(`Reviewer: ${modelLabel(current.model, current.provider)} (${current.provider}${reviewerOverride ? '' : ', follows builder'}). ${reviewerIndependenceLabel(reviewerIndependence(current, provider))}.`);
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
            if (!recovery && sessionBaseline?.generation !== generation) {
              say('No session baseline yet; capturing one now, so only later changes can be reviewed.');
              sessionBaseline = { generation, snapshot: await captureWorktree(workspace, { signal: abort.signal }) };
            }
            if (reconciliationRequired) throw new Error('Reconcile the interrupted task before review. No task was replayed.');
            await workflow('Manual /review of all workspace changes since the original task baseline.', sessionBaseline?.snapshot ?? null, true);
          }
        } finally { abort = undefined; }
      } else if (command === 'thinking') {
        if (rest && !['on', 'off'].includes(rest)) throw new Error('Use /thinking on or /thinking off.');
        if (rest) showReasoning = rest === 'on';
        say(`Provider reasoning summaries: ${showReasoning ? 'on' : 'off'}.`);
      } else if (command === 'login') {
        if (!rl || rest.trim()) throw new Error('Use /login without arguments in an interactive Neura terminal.');
        abort = new AbortController();
        try {
          await loginCodex({ signal: abort.signal, onAuthorize: url => say(`Open this URL in your browser to sign in:\n${url}`) });
          const remembered = provider.provider === 'openai-codex' && modelExplicit ? provider.model : '';
          const next: ProviderConfig = { provider: 'openai-codex', model: remembered };
          await freshConversation(next);
          provider = next; modelExplicit = Boolean(remembered);
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
        if (!['work', 'learn', 'yolo'].includes(rest)) throw new Error('Only /mode work, /mode learn and /mode yolo are available.');
        const previousAbort = abort;
        if (rest === 'yolo') {
          if (!rl && !bridge) throw new Error('/mode yolo needs a person to confirm. Start with --yolo instead.');
          abort = new AbortController();
          let confirmed = false;
          try { confirmed = await approve(YOLO_CONFIRMATION) && !abort.signal.aborted; } // A cancel can land with the approval.
          catch (error) { if (!abort.signal.aborted) throw error; } // Ctrl+C or end of input is a denial.
          finally { abort = undefined; }
          if (!confirmed) { say(`YOLO not enabled. Mode: ${mode}`); return true; }
          warning(YOLO_WARNING);
        }
        previousAbort?.abort();
        while (pendingSessionSave) await pendingSessionSave.catch(() => {});
        if (recovery?.stage === 'running') reconciliationRequired = true;
        generation++; restoreTaskBaseline(); learn.invalidate(); mode = rest as Mode; say(`Mode: ${mode}`); bridge?.onModeChange?.(mode);
        recoveryNotice();
      } else if (command === 'learn') {
        if (mode !== 'learn') throw new Error('Enter /mode learn first.');
        abort = new AbortController();
        try { const reply = await learn.command(rest, abort.signal); if (reply.text) say(reply.text); if (reply.prompt) { abort = undefined; await turn(reply.prompt, ''); } }
        finally { abort = undefined; }
      } else if (command === 'new' || command === 'clear') {
        if (rest.trim()) throw new Error(`Use /${command} without arguments.`);
        await freshConversation();
        generation++; learn.invalidate(true);
        sessionBaseline = undefined; lastReview = undefined;
        lastVerification = undefined; verificationGeneration = -1; baselineWarned = false;
        say(command === 'clear' ? 'Context cleared. New chat started; saved chats kept.' : 'New session; mode authority and learning state refreshed.');
      } else if (command === 'sessions') {
        const items = await listSessions(sessions);
        if (interactive) stdout.write(terminal().sessions(items) + '\n');
        else say(JSON.stringify(items, null, 2));
      } else if (command === 'resume') {
        if (values['no-history']) throw new Error('History disabled.');
        await selectSession(rest);
        generation++; restoreTaskBaseline(); lastReview = undefined; lastVerification = undefined; verificationGeneration = -1;
        learn.invalidate(true); mode = 'work'; say('Workspace history resumed in Work. Use /mode learn and explicitly /learn resume to restore a lesson.'); recoveryNotice(); bridge?.onModeChange?.(mode);
      } else if (command === 'reconcile') {
        if (rest.trim()) throw new Error('Use /reconcile without arguments after inspecting the workspace and any external effects.');
        if (!reconciliationRequired || !recovery) throw new Error('No task outcome awaiting reconciliation.');
        await persistRecovery({ ...recovery, stage: 'unfinished' }, generation);
        reconciliationRequired = false;
        say('Inspection acknowledged. Original task base retained; no actions replayed, approvals restored or verification granted. Give an explicit task to continue.');
      } else if (command === 'model') {
        if (!rest) await pickModel();
        else if (rest === 'openai-codex' || isGatewayProvider(rest)) await pickModel(rest);
        else await changeModel(parseProvider(rest, 'model'));
      } else throw new Error('Unknown command. Use /help.');
      return true;
    }
    if (bridge) { await bridge.serve({ execute: input, cancel: () => abort?.abort() }); return; }
    if (prompt !== undefined) { await input(prompt); return; }
    if (interactive) stdout.write(terminal().status(statusSnapshot()) + '\n');
    let scheduleGeneration = generation;
    for (;;) {
      if (scheduleGeneration !== generation) {
        schedules.clear();
        scheduleGeneration = generation;
      }
      let text: string | undefined;
      const wake = new AbortController();
      const stopTimer = canRunScheduled() ? schedules.wake(() => {
        if (rl!.line || inputClosed.signal.aborted) return false;
        wake.abort();
        return true;
      }) : undefined;
      try { text = await (composer ?? rl!).question(terminal().prompt(mode), { signal: AbortSignal.any([inputClosed.signal, wake.signal]) }); }
      catch (error) {
        if (inputClosed.signal.aborted) break;
        if (!wake.signal.aborted) throw error;
      } finally { stopTimer?.(); }
      const job = text === undefined ? schedules.takeDue() : undefined;
      try {
        if (job) {
          say(`Running schedule #${job.id}.`);
          const succeeded = await turn(job.task);
          if (job.interval) {
            if (succeeded && canRunScheduled()) schedules.repeat(job);
            else say(`Loop #${job.id} stopped. Use /loop to schedule it again.`);
          }
        } else if (text?.trim() && !await input(text)) break;
      } catch (error) {
        if (job?.interval) say(`Loop #${job.id} stopped. Use /loop to schedule it again.`);
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
