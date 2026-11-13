import { stripVTControlCharacters } from 'node:util';
import { renderLogo } from './brand.ts';

export function terminalText(text: string): string {
  // Unicode line/paragraph separators become real newlines so words never merge; other controls are dropped.
  return stripVTControlCharacters(text).replace(/[\u2028\u2029]/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

type Tone = 'copper' | 'bone' | 'dim' | 'warning' | 'error' | 'code';
export type Mode = 'work' | 'learn' | 'yolo';
type Phase = 'requested' | 'started' | 'returned' | 'failed' | 'blocked' | 'cancelled';
export type TerminalOptions = { isTTY?: boolean; columns?: number; env?: Record<string, string | undefined>; ascii?: boolean };

/** Slash commands shown by the live menu. Options with a second word (e.g. `answer TEXT`) need more input. */
export type SlashCommand = { name: string; args?: string; description: string; needsArg?: boolean; options?: [string, string][] };
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: 'Show commands' },
  { name: 'status', description: 'Mode, model, workspace, history and last-turn usage' },
  { name: 'model', args: '[PROVIDER MODEL [URL]]', description: 'Pick a subscription model, or set one explicitly' },
  { name: 'mode', args: 'work|learn|yolo', description: 'Switch mode', needsArg: true, options: [
    ['work', 'Sandboxed tools with approvals (default)'], ['learn', 'Guided lessons'], ['yolo', 'No sandbox, no approvals; asks for a typed yes']] },
  { name: 'clear', description: 'Clear context and start a new chat (keeps saved chats)' },
  { name: 'new', description: 'Start a fresh conversation' },
  { name: 'sessions', description: 'List saved sessions for this workspace' },
  { name: 'resume', args: 'UUID', description: 'Resume a saved session', needsArg: true },
  { name: 'thinking', args: '[on|off]', description: 'Show or hide provider reasoning summaries', options: [['on', 'Show summaries'], ['off', 'Hide summaries']] },
  { name: 'workflow', args: '[on|off]', description: 'Independent read-only review of Work changes', options: [['on', 'Review each change'], ['off', 'No automatic review']] },
  { name: 'review', args: '[status]', description: 'Review changes since the session baseline', options: [['status', 'Is the last review still current?']] },
  { name: 'reviewer', args: '[PROVIDER MODEL [URL]|default]', description: 'Show or choose the independent reviewer', options: [['default', 'Follow the builder model']] },
  { name: 'verify', args: '[quick|full|status]', description: 'Manual verification in Work', options: [['quick', 'Detector-only check'], ['full', 'Full verification'], ['status', 'Check the last receipt']] },
  { name: 'learn', args: 'COMMAND', description: 'Lesson commands (Learn mode)', needsArg: true, options: [
    ['status', 'Lesson state'], ['path', 'Learning path'], ['accept-plan', 'Accept the proposed plan'], ['next', 'Next card'],
    ['answer TEXT', 'Answer the current exercise'], ['hint', 'Get a hint'], ['reveal', 'Reveal the answer'], ['explain', 'Explain again'],
    ['deeper', 'Go deeper'], ['example', 'Show an example'], ['save', 'Save progress'], ['saved', 'List saved progress'],
    ['resume FILE', 'Resume saved progress'], ['reset', 'Reset the lesson']] },
  { name: 'login', description: 'Sign in with a ChatGPT subscription' },
  { name: 'logout', description: 'Remove local subscription credentials' },
  { name: 'quit', description: 'Exit Neura' },
];
export type MenuItem = { value: string; label: string; hint: string; description: string; submit: boolean };
/** Slash-command options, or installed skills after `$`. Skills complete first so the user can add a task. */
export function commandMatches(line: string, skills: readonly { name: string; description: string }[] = []): MenuItem[] {
  const skill = /^\$([a-z0-9-]*)$/i.exec(line);
  if (skill) return skills.filter(entry => entry.name.startsWith(skill[1].toLowerCase())).map(entry => ({
    value: '$' + entry.name, label: '$' + entry.name, hint: 'TASK', description: entry.description, submit: false,
  }));
  const top = /^\/(\S*)$/.exec(line);
  if (top) {
    const typed = top[1].toLowerCase();
    return SLASH_COMMANDS.filter(command => command.name.startsWith(typed)).map(command => ({
      value: '/' + command.name, label: '/' + command.name, hint: command.args ?? '', description: command.description,
      submit: !command.needsArg }));
  }
  const sub = /^\/(\S+) (\S*)$/.exec(line);
  const command = sub && SLASH_COMMANDS.find(entry => entry.name === sub[1].toLowerCase());
  if (!sub || !command?.options) return [];
  return command.options.filter(([option]) => option.startsWith(sub[2].toLowerCase())).map(([option, description]) => {
    const [name, hint = ''] = option.split(' ');
    return { value: `/${command.name} ${name}`, label: name, hint, description, submit: !hint };
  });
}
export type TerminalStatus = {
  mode: Mode; provider: string; model: string; workspace: string; workspaceName: string;
  history: 'on' | 'off' | 'save failed'; sessionState: 'new' | 'resumed'; sessionId?: string;
  thinking: boolean; messageCount: number; lastTurnUsage?: { inputTokens: number; outputTokens: number };
};
const palette: Record<Tone, string> = {
  copper: '217;120;65', bone: '232;226;216', dim: '122;130;139', warning: '211;166;74', error: '223;107;99', code: '134;167;215',
};
const visible = (text: string) => cells(stripVTControlCharacters(text));
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
// Plain words, so the danger signal survives NO_COLOR and TERM=dumb.
const modeLabel = (mode: Mode) => mode === 'yolo' ? 'YOLO · DANGER' : mode === 'learn' ? 'Learn' : 'Work';
const reportedUsage = (usage: TerminalStatus['lastTurnUsage']) => usage &&
  Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 &&
  Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0 ? usage : undefined;

/** Pure presentation. Only prose is wrapped; IDs, actions and structured output stay intact. */
export function createTerminalUI({ isTTY = false, columns = 80, env = {}, ascii = false }: TerminalOptions = {}) {
  const width = Number.isFinite(columns) ? Math.max(20, Math.floor(columns)) : 80;
  const color = isTTY && env.NO_COLOR === undefined && env.TERM !== 'dumb';
  const plainGlyphs = ascii || env.TERM === 'dumb';
  const paint = (text: string, tone: Tone) => {
    const safe = terminalText(text);
    return color ? `\x1b[38;2;${palette[tone]}m${safe}\x1b[0m` : safe;
  };
  // Inline styles use specific SGR resets so they nest inside each other.
  const sgr = (text: string, on: string, off: string) => color ? `\x1b[${on}m${text}\x1b[${off}m` : text;
  const box = plainGlyphs ? { h: '-', v: '|', tl: '+', tm: '+', tr: '+', ml: '+', mm: '+', mr: '+', bl: '+', bm: '+', br: '+', bullet: '-', quote: '|' }
    : { h: '─', v: '│', tl: '┌', tm: '┬', tr: '┐', ml: '├', mm: '┼', mr: '┤', bl: '└', bm: '┴', br: '┘', bullet: '•', quote: '│' };
  function wrapStyled(text: string, first: string, rest: string): string[] {
    const lines: string[] = [];
    let line = first, empty = true;
    for (const word of text.split(' ')) {
      if (!word) continue;
      if (!empty && visible(line) + 1 + visible(word) > width) { lines.push(line); line = rest; empty = true; }
      line += (empty ? '' : ' ') + word; empty = false;
    }
    lines.push(line);
    return lines;
  }
  /** Inline Markdown: code spans are protected first, so their contents are never styled. Input is already sanitized. */
  function inline(text: string): string {
    const spans: string[] = [];
    let out = text.replace(/`([^`]+)`/g, (_, code: string) => { spans.push(code); return `\0${spans.length - 1}\0`; });
    out = out
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => sgr(label, '4', '24') + (url === label ? '' : sgr(` (${url})`, `38;2;${palette.dim}`, '39')))
      .replace(/\*\*(?=\S)([^\n]*?\S)\*\*|__(?=\S)([^\n]*?\S)__/g, (_, a?: string, b?: string) => sgr(a ?? b ?? '', '1', '22'))
      .replace(/~~(?=\S)([^\n]*?\S)~~/g, (_, struck: string) => sgr(struck, '9', '29'))
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, (_, lead: string, em: string) => lead + sgr(em, '3', '23'))
      .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, (_, lead: string, em: string) => lead + sgr(em, '3', '23'));
    return out.replace(/\0(\d+)\0/g, (_, index: string) => color ? sgr(spans[Number(index)], `38;2;${palette.code}`, '39') : '`' + spans[Number(index)] + '`');
  }
  function table(rows: string[]): string[] {
    const split = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
    const parsed = rows.map(split);
    const fallback = () => rows.flatMap(row => wrapStyled(inline(row), '', ''));
    if (parsed.length < 2 || !parsed[1].every(cell => /^:?-+:?$/.test(cell))) return fallback();
    const header = parsed[0].map(inline);
    const body = parsed.slice(2).map(row => header.map((_, index) => inline(row[index] ?? '')));
    const align = parsed[1].map(cell => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : 'left');
    const sizes = header.map((cell, index) => Math.max(visible(cell), ...body.map(row => visible(row[index]))));
    if (sizes.reduce((sum, size) => sum + size + 3, 1) > width) {
      // ponytail: too wide for a grid, so each row becomes a labelled bullet that wraps.
      return body.flatMap(row => wrapStyled(row.map((cell, index) => `${sgr(stripVTControlCharacters(header[index]), '1', '22')}: ${cell}`).join(' · '),
        paint(box.bullet, 'copper') + ' ', '  '));
    }
    const pad = (cell: string, index: number) => {
      const gap = sizes[index] - visible(cell);
      return align[index] === 'right' ? ' '.repeat(gap) + cell : align[index] === 'center'
        ? ' '.repeat(Math.floor(gap / 2)) + cell + ' '.repeat(Math.ceil(gap / 2)) : cell + ' '.repeat(gap);
    };
    const rule = (left: string, middle: string, right: string) => paint(left + sizes.map(size => box.h.repeat(size + 2)).join(middle) + right, 'dim');
    const line = (row: string[], bold = false) => paint(box.v, 'dim') + row.map((cell, index) => ' ' + (bold ? sgr(pad(cell, index), '1', '22') : pad(cell, index)) + ' ').join(paint(box.v, 'dim')) + paint(box.v, 'dim');
    return [rule(box.tl, box.tm, box.tr), line(header, true), rule(box.ml, box.mm, box.mr), ...body.map(row => line(row)), rule(box.bl, box.bm, box.br)];
  }
  /**
   * Streaming Markdown for interactive answers. Complete lines render as they arrive; tables wait for their
   * last row. Code blocks keep their bytes (no wrapping or inline styling) so they stay copyable.
   */
  function markdownStream() {
    let pending = '';
    let fence: string | undefined;
    let rows: string[] = [];
    const endTable = () => { const out = rows.length ? table(rows) : []; rows = []; return out; };
    function block(line: string): string[] {
      const fenceMark = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);
      if (fence !== undefined) {
        if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length && !fenceMark[2]) { fence = undefined; return [paint('  ' + box.bl + box.h, 'dim')]; }
        return [paint('  ' + box.v + ' ', 'dim') + paint(line, 'code')];
      }
      if (fenceMark) { fence = fenceMark[1]; return [paint('  ' + box.tl + box.h + (fenceMark[2] ? ' ' + fenceMark[2] : ''), 'dim')]; }
      if (/^\s*\|.*\|\s*$/.test(line)) { rows.push(line); return []; }
      const done = endTable();
      if (!line.trim()) return [...done, ''];
      const heading = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
      if (heading) return [...done, ...wrapStyled(sgr(inline(heading[2]), heading[1].length <= 2 ? `1;38;2;${palette.copper}` : '1', '22;39'), '', '')];
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return [...done, paint(box.h.repeat(Math.min(width, 48)), 'dim')];
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) return [...done, ...wrapStyled(sgr(inline(quote[1]), '3', '23'), paint(box.quote, 'dim') + ' ', paint(box.quote, 'dim') + ' ')];
      const item = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
      if (item) {
        const indent = ' '.repeat(Math.min(Math.floor(item[1].length / 2) * 2, 12));
        let marker = /\d/.test(item[2]) ? item[2] : box.bullet;
        let text = item[3];
        const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
        if (task) { marker = task[1] === ' ' ? '[ ]' : '[x]'; text = task[2]; }
        return [...done, ...wrapStyled(inline(text), indent + paint(marker, 'copper') + ' ', indent + ' '.repeat(cells(marker) + 1))];
      }
      const lead = /^\s*/.exec(line)![0].slice(0, 12);
      return [...done, ...wrapStyled(inline(line.trim()), lead, lead)];
    }
    return {
      /** Returns rendered complete lines (each ending in a newline), or ''. */
      push(chunk: string): string {
        const parts = (pending + terminalText(chunk)).split('\n');
        pending = parts.pop()!;
        return parts.flatMap(block).map(line => line + '\n').join('');
      },
      /** Renders anything buffered, including an unterminated last line or table. */
      flush(): string {
        const last = pending; pending = '';
        return [...(last ? block(last) : []), ...endTable()].map(line => line + '\n').join('');
      },
    };
  }
  const spinner = plainGlyphs ? ['-', '\\', '|', '/'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
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
        ['/mode work|learn', 'Choose Work or Learn.'],
        ['/mode yolo', 'After a typed yes: no sandbox, no approvals, network and full account access until /mode work or exit.'],
        ['/learn', 'Lesson commands: status, path, accept-plan, next, answer <text>, hint, reveal, save, saved, resume <file>, reset, explain, deeper, example.'],
        ['/verify [quick|full|status]', 'Manual verification in Work. Detector-only is never verified.'],
      ]),
      group('Review workflow', [
        ['/workflow [on|off]', 'Work reviews each change read-only (up to 3 rounds, must-fix findings auto-fixed) and ends with READY FOR YOUR APPROVAL, BLOCKED or Review skipped; a turn that changed nothing ends silently. It never commits, pushes or merges.'],
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
        ['/clear · /new', 'Clear conversation context and start a new chat. Saved chats remain available; mode and model stay selected.'],
        ['/sessions · /resume UUID', 'List workspace history or explicitly resume it. Never imports Pi.'],
        ['$ · $NAME TASK', 'List installed skills, or apply one to a task. Skills do not grant tools or permissions.'],
        ['/help · /quit', 'Show help or exit (bare exit or quit also works). Ctrl+C cancels active work; at the input prompt it exits.'],
      ]),
    ];
    if (options) groups.splice(1, 0,
      paint('Usage: neura [task] [options]', 'bone'),
      group('Request options', [
        ['-p, --prompt TEXT', 'Run one request. Known commands run in the sandbox; others fail closed.'],
        ['--cwd PATH', 'Project directory. Bare interactive launch from ~ opens a scratch workspace.'],
        ['--mode work|learn', 'Start in Work (default) or Learn. Never persisted: a new process starts in Work.'],
        ['--yolo', 'Start in YOLO with no prompt: no sandbox, no approvals, network and full account access. The flag is your consent. Use only on repositories you trust.'],
        ...(width >= 46 ? [['--dangerously-bypass-approvals-and-sandbox', 'Same as --yolo.'] as [string, string]] : []),
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
    width, color, help, markdownStream,
    markdown(text: string) { const stream = markdownStream(); return (stream.push(text) + stream.flush()).replace(/\n$/, ''); },
    /** One erasable row: spinner, label, elapsed seconds and the cancel key. */
    activity(frame: number, seconds: number, label = 'Thinking') {
      const glyph = spinner[frame % spinner.length];
      return paint(glyph, 'copper') + ' ' + paint(shortLabel(`${label}… ${seconds}s · Ctrl+C to cancel`, width - 3), 'dim');
    },
    /** Rows drawn under the prompt. Each fits in width - 1 cells so the terminal never wraps one. */
    commandMenu(items: MenuItem[], selected: number, rows = 8): string[] {
      const start = Math.min(Math.max(0, selected - rows + 1), Math.max(0, items.length - rows));
      const shown = items.slice(start, start + rows);
      const labelWidth = Math.min(Math.max(...shown.map(item => cells(item.label + (item.hint ? ' ' + item.hint : '')))), Math.floor(width / 2));
      const lines = shown.map((item, index) => {
        const active = start + index === selected;
        const label = shortLabel(item.label + (item.hint ? ' ' + item.hint : ''), labelWidth);
        const room = width - 1 - 2 - labelWidth - 2;
        const description = room > 8 ? '  ' + shortLabel(item.description, room) : '';
        const pointer = active ? (plainGlyphs ? '>' : '›') : ' ';
        return paint(pointer + ' ', 'copper') + paint(label + ' '.repeat(labelWidth - cells(label)), active ? 'copper' : 'bone') + paint(description, active ? 'bone' : 'dim');
      });
      const more = items.length > rows ? `${start + 1}-${start + shown.length} of ${items.length} · ` : '';
      lines.push(paint('  ' + shortLabel(`${more}${plainGlyphs ? 'Up/Down' : '↑↓'} select · Tab complete · Enter run · Esc close`, width - 3), 'dim'));
      return lines;
    },
    inputHint() { return paint(shortLabel('Type / for commands · $ for skills · Ctrl+C cancels a running task', width - 1), 'dim'); },
    // Approved static mark (src/brand.ts), uncolored; ASCII for --ascii, TERM=dumb or narrow terminals.
    wordmark(ascii = false) { return renderLogo(columns, ascii || env.TERM === 'dumb').join('\n'); },
    status(state: TerminalStatus) {
      const mode = modeLabel(state.mode);
      const model = shortLabel(`${state.provider}/${state.model || '(not selected)'}`, width - mode.length - 3);
      const lines = [paint(mode, state.mode === 'yolo' ? 'error' : 'copper') + paint(' · ' + model, 'dim')];
      const fields = [shortLabel(state.workspaceName, Math.min(width, 24)),
        `history ${state.history}${state.history === 'off' ? '' : '/' + state.sessionState}`,
        `thinking ${state.thinking ? 'on' : 'off'}`, `${state.messageCount} msgs`, '/status'];
      let line = '';
      for (const field of fields) {
        if (line && cells(line + ' · ' + field) > width) { lines.push(paint(line, 'dim')); line = ''; }
        line += (line ? ' · ' : '') + field;
      }
      if (line) lines.push(paint(line, 'dim'));
      return lines.join('\n');
    },
    statusDetails(state: TerminalStatus) {
      const usage = reportedUsage(state.lastTurnUsage);
      return paint('Neura status', 'bone') + '\n' + [
        `Mode: ${modeLabel(state.mode)}`, ...(state.mode === 'yolo' ? ['Sandbox: none · Approvals: none · Network: on'] : []), `Provider: ${state.provider}`,
        `Model: ${state.model || '(not selected)'}`, `Workspace: ${state.workspace}`,
        `Session: ${state.sessionState} ${state.sessionId || '(in memory)'}`, `History: ${state.history}`,
        `Thinking: ${state.thinking ? 'on' : 'off'}`, `Conversation: ${state.messageCount} messages`,
        ...(usage ? [`Last turn input tokens: ${usage.inputTokens}`, `Last turn output tokens: ${usage.outputTokens}`] : ['Last turn tokens: unavailable']),
        'Context window: unknown',
      ].map(terminalLabel).join('\n') + '\n' + paint(prose('Development/testing only. Distribution is not cleared.'), 'dim');
    },
    prompt(mode: Mode) { return paint(`${mode} > `, mode === 'yolo' ? 'error' : 'copper'); },
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
      // One row only, so the transient waiting line can be erased with a single line clear.
      return paint(shortLabel(labels[kind], width - 1), kind === 'answer' ? 'bone' : 'dim');
    },
    tool(name: string, phase: Phase) {
      const tone = phase === 'failed' || phase === 'blocked' ? 'error' : phase === 'cancelled' ? 'warning' : 'dim';
      return paint(phase === 'requested' ? `[tool] ${name}` : `[tool] ${name}: ${phase}`, tone);
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
