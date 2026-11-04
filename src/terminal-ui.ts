import { stripVTControlCharacters } from 'node:util';
import { renderLogo } from './brand.ts';

export function terminalText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '');
}

type Tone = 'copper' | 'bone' | 'dim' | 'warning' | 'error';
type Mode = 'work' | 'learn';
type Phase = 'requested' | 'started' | 'returned' | 'failed' | 'blocked' | 'cancelled';
export type TerminalOptions = { isTTY?: boolean; columns?: number; env?: Record<string, string | undefined> };
export type TerminalStatus = {
  mode: Mode; provider: string; model: string; workspace: string; workspaceName: string;
  history: 'on' | 'off' | 'save failed'; sessionState: 'new' | 'resumed'; sessionId?: string;
  thinking: boolean; messageCount: number; lastTurnUsage?: { inputTokens: number; outputTokens: number };
};
const palette: Record<Tone, string> = {
  copper: '217;120;65', bone: '232;226;216', dim: '122;130;139', warning: '211;166;74', error: '223;107;99',
};
/** Labels cannot create extra status rows or inject terminal commands. */
export function terminalLabel(text: string): string {
  return terminalText(text.replace(/[\r\n\t]/g, ' ')).replace(/\s+/g, ' ').trim();
}
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
function cells(text: string): number {
  let size = 0;
  for (const { segment } of graphemes.segment(text)) {
    const code = segment.codePointAt(0)!;
    if (/^[\p{Mark}\u200b-\u200f]+$/u.test(segment)) continue;
    const wide = /\p{Extended_Pictographic}/u.test(segment) || code >= 0x1100 &&
      (code <= 0x115f || code === 0x2329 || code === 0x232a || code >= 0x2e80 && code <= 0xa4cf ||
       code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff || code >= 0xfe10 && code <= 0xfe6f ||
       code >= 0xff00 && code <= 0xff60 || code >= 0xffe0 && code <= 0xffe6 || code >= 0x20000);
    size += wide ? 2 : 1;
  }
  return size;
}
function shortLabel(text: string, limit: number): string {
  const label = terminalLabel(text);
  if (cells(label) <= limit) return label;
  let result = '';
  for (const { segment } of graphemes.segment(label)) {
    if (cells(result + segment) > limit - 1) break;
    result += segment;
  }
  return result + '…';
}
const reportedUsage = (usage: TerminalStatus['lastTurnUsage']) => usage &&
  Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 &&
  Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 ? usage : undefined;

/** Pure presentation. Only prose is wrapped; IDs, actions and structured output stay intact. */
export function createTerminalUI({ isTTY = false, columns = 80, env = {} }: TerminalOptions = {}) {
  const width = Number.isFinite(columns) ? Math.max(20, Math.floor(columns)) : 80;
  const color = isTTY && env.NO_COLOR === undefined && env.TERM !== 'dumb';
  const paint = (text: string, tone: Tone) => {
    const safe = terminalText(text);
    return color ? `\x1b[38;2;${palette[tone]}m${safe}\x1b[0m` : safe;
  };
  function prose(text: string, indent = ''): string {
    const words = terminalText(text).split(/\s+/);
    const lines: string[] = [];
    let line = indent;
    for (const word of words) {
      if (line.length > indent.length && cells(line) + cells(word) + 1 > width) { lines.push(line); line = indent; }
      line += (line.length > indent.length ? ' ' : '') + word;
    }
    lines.push(line);
    return lines.join('\n');
  }
  function group(title: string, rows: [string, string][]): string {
    return paint(title, 'copper') + '\n' + rows.map(([command, description]) =>
      paint('  ' + command, 'bone') + '\n' + paint(prose(description, '    '), 'dim')).join('\n');
  }
  function help(options = false): string {
    const groups = [
      paint('Neura · Mastra v1 development build', 'bone'),
      group('Work and Learn', [
        ['/mode work|learn', 'Choose Work or Learn. Only these modes are implemented.'],
        ['/learn', 'Lesson commands: status, answer <text>, hint, reveal, save, saved, resume <file>, reset, explain, deeper, example.'],
        ['/verify [quick|full|status]', 'Manual verification in Work. Detector-only is never verified.'],
      ]),
      group('Review workflow', [
        ['/workflow [on|off]', 'Work reviews each change read-only (up to 3 rounds, must-fix findings auto-fixed) and ends with READY FOR YOUR APPROVAL, BLOCKED or Review skipped. It never commits, pushes or merges.'],
        ['/review [status]', 'Review all changes since the session baseline, or check whether the last review is still current.'],
        ['/reviewer PROVIDER MODEL [URL]', 'Choose an independent reviewer. Use a different provider for cross-family review.'],
        ['/reviewer [default]', 'Show the reviewer, or reset it to follow the builder model (labelled same-family).'],
      ]),
      group('Models and sign-in', [
        ['/model', 'Subscription picker: enter a number or listed model ID; Enter cancels.'],
        ['/model PROVIDER MODEL [URL]', 'Select openai-codex, local, openai or anthropic explicitly.'],
        ['/login · /logout', 'Interactive ChatGPT subscription sign-in or local credential removal. API billing is never a fallback.'],
        ['/thinking [on|off]', 'Provider summaries only. Hidden internal reasoning is not available.'],
      ]),
      group('Conversation', [
        ['/status', 'Mode, model, workspace, history and last-turn usage. Context window stays unknown unless verified.'],
        ['/new · /sessions · /resume UUID', 'Start fresh, list workspace history or explicitly resume it. Never imports Pi.'],
        ['/help · /quit', 'Show help or exit. Ctrl+C cancels active work; at the input prompt it exits.'],
      ]),
    ];
    if (options) groups.splice(1, 0,
      paint('Usage: neura [task] [options]', 'bone'),
      group('Request options', [
        ['-p, --prompt TEXT', 'Run one request. Commands fail closed without interactive approval.'],
        ['--cwd PATH', 'Project directory. Bare interactive launch from ~ opens a scratch workspace.'],
        ['--mode work|learn', 'Start in Work (default) or Learn.'],
        ['--provider PROVIDER', 'openai-codex (default), local, openai or anthropic.'],
        ['--model NAME · --base-url URL', 'Explicit model and endpoint. Subscription default comes from the catalog, never a guessed model.'],
      ]),
      group('History and diagnostics', [
        ['--resume UUID · --no-history', 'Resume Neura history, or disable conversation persistence.'],
        ['--no-thinking', 'Hide provider reasoning summaries.'],
        ['--check', 'Check source prerequisites without credentials or model calls.'],
        ['--ascii', 'Use the ASCII launch logo for limited terminal fonts.'],
        ['--reviewer-provider PROVIDER', 'Independent Work reviewer provider (env NEURA_REVIEWER_PROVIDER).'],
        ['--reviewer-model NAME', 'Reviewer model (env NEURA_REVIEWER_MODEL). Default: builder model, labelled same-family.'],
        ['--reviewer-base-url URL', 'Reviewer endpoint (env NEURA_REVIEWER_BASE_URL).'],
        ['-h, --help', 'Show options and commands.'],
      ]));
    groups.push(paint(prose('Development/testing only. Real account login remains a manual personal-use gate; distribution is not cleared.'), 'dim'));
    return groups.join('\n\n');
  }
  return {
    width, color, help,
    // Approved static mark (src/brand.ts), uncolored; ASCII for --ascii, TERM=dumb or narrow terminals.
    wordmark(ascii = false) { return renderLogo(columns, ascii || env.TERM === 'dumb').join('\n'); },
    status(state: TerminalStatus) {
      const mode = state.mode === 'learn' ? 'Learn' : 'Work';
      const model = shortLabel(`${state.provider}/${state.model || '(not selected)'}`, width - mode.length - 3);
      const lines = [paint(mode, 'copper') + paint(' · ' + model, 'dim')];
      const fields = [shortLabel(state.workspaceName, Math.min(width, 24)),
        `history ${state.history}${state.history === 'off' ? '' : '/' + state.sessionState}`,
        `thinking ${state.thinking ? 'on' : 'off'}`, `${state.messageCount} msgs`, '/status'];
      let line = '';
      for (const field of fields) {
        if (line && cells(line + ' · ' + field) > width) { lines.push(paint(line, 'dim')); line = ''; }
        line += (line ? ' · ' : '') + field;
      }
      if (line) lines.push(paint(line, 'dim'));
      const usage = reportedUsage(state.lastTurnUsage);
      if (usage) {
        const tokens = `Last turn: ${usage.inputTokens} in · ${usage.outputTokens} out tokens`;
        lines.push(paint(cells(tokens) <= width ? tokens : `Last turn in: ${usage.inputTokens} tokens\nLast turn out: ${usage.outputTokens} tokens`, 'dim'));
      }
      return lines.join('\n');
    },
    statusDetails(state: TerminalStatus) {
      const usage = reportedUsage(state.lastTurnUsage);
      return paint('Neura status', 'bone') + '\n' + [
        `Mode: ${state.mode === 'learn' ? 'Learn' : 'Work'}`, `Provider: ${state.provider}`,
        `Model: ${state.model || '(not selected)'}`, `Workspace: ${state.workspace}`,
        `Session: ${state.sessionState} ${state.sessionId || '(in memory)'}`, `History: ${state.history}`,
        `Thinking: ${state.thinking ? 'on' : 'off'}`, `Conversation: ${state.messageCount} messages`,
        ...(usage ? [`Last turn input tokens: ${usage.inputTokens}`, `Last turn output tokens: ${usage.outputTokens}`] : ['Last turn tokens: unavailable']),
        'Context window: unknown',
      ].map(terminalLabel).join('\n') + '\n' + paint(prose('Development/testing only. Distribution is not cleared.'), 'dim');
    },
    prompt(mode: Mode) { return paint(`${mode} > `, 'copper'); },
    // Move whole metadata fields to their own line when space runs out. Never shorten values.
    metadata(entries: [string, string][]) {
      const lines: string[] = [];
      let line = '';
      for (const [label, value] of entries) {
        const field = terminalText(`${label}: ${value}`);
        if (line && line.length + field.length + 3 > width) { lines.push(line); line = ''; }
        line += (line ? ' · ' : '') + field;
      }
      if (line) lines.push(line);
      return lines.map(line => paint(line, 'dim')).join('\n');
    },
    boundary(kind: 'waiting' | 'reasoning' | 'answer') {
      const labels = { waiting: '[thinking] Waiting for model response...', reasoning: '[reasoning summary]', answer: '[answer]' };
      return paint(labels[kind], kind === 'answer' ? 'bone' : 'dim');
    },
    tool(name: string, phase: Phase) {
      const tone = phase === 'failed' || phase === 'blocked' ? 'error' : phase === 'cancelled' ? 'warning' : 'dim';
      return paint(`[tool] ${name}: ${phase}`, tone);
    },
    approval(description: string) { return paint('[approval required]', 'warning') + '\n' + terminalText(description); },
    approvalPrompt() { return paint('Type yes to approve (default: no): ', 'warning'); },
    pickerPrompt() { return paint(width < 56 ? 'Model number or ID (Enter cancels): ' : 'Choose a number or listed model ID; Enter cancels: ', 'copper'); },
    modelChoice(id: string, index: number, flags: { catalogDefault?: boolean; current?: boolean } = {}) {
      return paint(`  ${index + 1}. ${id}${flags.catalogDefault ? ' (catalog default)' : ''}${flags.current ? ' (current)' : ''}`, flags.current ? 'copper' : 'bone');
    },
    feedback(text: string, kind: 'error' | 'warning' | 'cancelled' | 'info' = 'info') {
      const prefix = kind === 'error' ? 'Error: ' : kind === 'warning' ? 'Warning: ' : '';
      return paint(prose(prefix + text), kind === 'info' ? 'dim' : kind === 'cancelled' ? 'warning' : kind);
    },
    sessions(items: { id: string; updatedAt: string }[]) {
      if (!items.length) return paint(prose('No saved sessions for this workspace. Use /new to start one.'), 'dim');
      return paint('Workspace sessions', 'bone') + '\n' + items.map(item =>
        terminalText(item.id) + '\n' + paint(`  Updated: ${terminalText(item.updatedAt)}`, 'dim')).join('\n') +
        '\n' + paint('Use /resume UUID to resume explicitly.', 'dim');
    },
  };
}
