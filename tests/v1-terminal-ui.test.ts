import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { createTerminalUI, terminalText, terminalLabel, commandMatches, SLASH_COMMANDS, type TerminalStatus } from '../src/terminal-ui.ts';
import { createCommandKeyboard } from '../src/prompt-input.ts';
import { renderLogo } from '../src/brand.ts';

const widths = [40, 56, 72, 92, 120];
const plain = (value: string) => stripVTControlCharacters(value);
const status: TerminalStatus = {
  mode: 'work', provider: 'openai-codex', model: 'fixture-first', workspace: 'C:/projects/Neura', workspaceName: 'Neura',
  history: 'on', sessionState: 'new', sessionId: '00000000-0000-4000-8000-000000000001', thinking: true, messageCount: 0,
};

test('TTY palette is restrained; redirected output, NO_COLOR (including empty) and dumb terminals stay plain', () => {
  for (const options of [
    {}, { isTTY: false, env: { FORCE_COLOR: '3' } },
    { isTTY: true, env: { NO_COLOR: '' } }, { isTTY: true, env: { NO_COLOR: '1', FORCE_COLOR: '3' } },
    { isTTY: true, env: { TERM: 'dumb' } },
  ]) {
    const ui = createTerminalUI(options);
    assert.equal(ui.color, false);
    for (const output of [ui.wordmark(), ui.help(true), ui.prompt('learn'), ui.boundary('answer'), ui.approval('Exact action'), ui.tool('read', 'returned'), ui.feedback('Failed', 'error')]) {
      assert.equal(output, plain(output));
    }
  }
  const ui = createTerminalUI({ isTTY: true });
  assert.match(ui.prompt('work'), /\x1b\[38;2;217;120;65m/);
  assert.match(ui.boundary('answer'), /\x1b\[38;2;232;226;216m/);
  assert.match(ui.boundary('waiting'), /\x1b\[38;2;122;130;139m/);
  assert.match(ui.approval('Run once'), /\x1b\[38;2;211;166;74m/);
  assert.match(ui.tool('read', 'failed'), /\x1b\[38;2;223;107;99m/);
  assert.match(ui.tool('read', 'returned'), /\x1b\[38;2;122;130;139m/, 'A returned tool is not a verified outcome');
});

test('wordmark, prose, prompts and short metadata fit every supported width, in color and plain text', () => {
  for (const columns of widths) for (const isTTY of [false, true]) {
    const ui = createTerminalUI({ columns, isTTY });
    for (const output of [ui.wordmark(), ui.help(true), ui.help(), ui.prompt('work'), ui.prompt('learn'), ui.pickerPrompt(), ui.approvalPrompt(), ui.sessions([]), ui.feedback('Unknown command. Use /help.', 'error'), ui.metadata([['Provider', 'openai-codex'], ['Current model', 'gpt-example']])]) {
      for (const line of plain(output).split('\n')) assert.ok(line.length <= columns, `${columns} columns: ${line}`);
    }
    const logo = plain(ui.wordmark());
    assert.deepEqual(logo.split('\n'), renderLogo(columns), 'Launch uses the approved, uncolored mark');
    assert.deepEqual(plain(createTerminalUI({ columns, env: { TERM: 'dumb' } }).wordmark()), '>_ neura');
    assert.equal(plain(ui.wordmark(true)), '>_ neura');
    assert.doesNotMatch(logo, /development|ready|session|model|work|learn/i, 'Startup carries identity only');
    const help = plain(ui.help()).replace(/\s+/g, ' ');
    assert.match(help, /Development\/testing only/);
    assert.match(help, /Detector-only is never verified/);
    assert.match(help, /API billing is never a fallback/);
  }
  assert.equal(createTerminalUI({ columns: Number.NaN }).width, 80);
});

test('compact status follows width priorities, fits large counts and preserves complete details on demand', () => {
  const model = 'model-' + 'long-code-'.repeat(70);
  const workspace = 'C:/projects/' + 'project-name-'.repeat(20);
  for (const columns of [40, 56, 80, 120]) for (const isTTY of [false, true]) {
    const ui = createTerminalUI({ columns, isTTY });
    for (const usage of [undefined, { inputTokens: 0, outputTokens: 0 }, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER }]) {
      const state = { ...status, model, workspace, workspaceName: 'long-project-name-'.repeat(20), lastTurnUsage: usage };
      const rendered = plain(ui.status(state));
      for (const line of rendered.split('\n')) assert.ok(line.length <= columns, `${columns}: ${line}`);
      assert.match(rendered, /Work/);
      assert.match(rendered, /history on\/new/);
      assert.match(rendered, /thinking on/);
      assert.match(rendered, /0 msgs/);
      assert.match(rendered, /\/status/);
      const details = plain(ui.statusDetails(state));
      assert.ok(details.includes(`Model: ${model}\n`));
      assert.ok(details.includes(`Workspace: ${workspace}\n`));
      assert.match(details, /Context window: unknown/);
      assert.doesNotMatch(details, /%|cost|occupancy|estimated/i);
      if (usage) assert.ok(details.includes(`Last turn output tokens: ${usage.outputTokens}`));
      assert.doesNotMatch(rendered, /Last turn/, 'Usage lives in /status only');
    }
  }
});

test('status omits missing, partial or invalid usage without erasing reported zero counts', () => {
  const ui = createTerminalUI();
  for (const lastTurnUsage of [undefined, {}, { inputTokens: 1 }, { inputTokens: -1, outputTokens: 1 },
    { inputTokens: NaN, outputTokens: 1 }, { inputTokens: 1, outputTokens: Infinity },
    { inputTokens: '1', outputTokens: 1 }, { inputTokens: 1.5, outputTokens: 1 }]) {
    const state = { ...status, lastTurnUsage } as TerminalStatus;
    assert.doesNotMatch(ui.status(state), /Last turn/);
    assert.match(ui.statusDetails(state), /Last turn tokens: unavailable/);
  }
  assert.match(ui.statusDetails({ ...status, lastTurnUsage: { inputTokens: 0, outputTokens: 0 } }), /Last turn input tokens: 0\nLast turn output tokens: 0/);
});

test('status labels neutralize line/control injection; Unicode labels stay within narrow display widths', () => {
  const ui = createTerminalUI({ columns: 40 });
  const hostile = 'line\nINJECT\r\ttab\u2028\x1b[31mcolor\x1b[0m';
  assert.equal(terminalLabel(hostile), 'line INJECT tab color');
  const state = { ...status, provider: hostile, model: hostile, workspace: hostile, workspaceName: hostile };
  const details = ui.statusDetails(state);
  assert.ok(details.includes('Model: line INJECT tab color\n'));
  assert.ok(details.includes('Workspace: line INJECT tab color\n'));
  assert.equal(details.split('\nINJECT').length, 1);
  const unicode = ui.status({ ...status, model: '界'.repeat(50), workspaceName: '界'.repeat(25) });
  for (const line of unicode.split('\n')) {
    const displayWidth = Array.from(line).reduce((count, char) => count + (char === '界' ? 2 : 1), 0);
    assert.ok(displayWidth <= 40, line);
  }
  assert.equal(plain(createTerminalUI({ columns: 40, isTTY: true, env: { NO_COLOR: '' } }).status(status)), ui.status(status));
});

test('model IDs and approval details remain complete without renderer wrapping or truncation', () => {
  const model = 'model-' + 'long-code-'.repeat(70);
  const action = `Run in network-disabled WSL sandbox?\n${'command-segment '.repeat(1000)}END\nTimeout: 120000 ms\nApproval applies once to this exact action.`;
  for (const columns of widths) {
    const ui = createTerminalUI({ columns, isTTY: true });
    assert.equal(plain(ui.modelChoice(model, 1, { current: true })), `  2. ${model} (current)`);
    assert.equal(plain(ui.metadata([['Provider', 'openai-codex'], ['Current model', model]])).split('\n').at(-1), `Current model: ${model}`);
    assert.equal(plain(ui.approval(action)), '[approval required]\n' + action);
    assert.equal(plain(ui.approvalPrompt()), 'Type yes to approve (default: no): ');
  }
});

test('untrusted terminal controls cannot become presentation styles or overwrite safety text', () => {
  const hostile = '\x1b[31mred\x1b[0m\x1b]8;;https://invalid\x07link\x1b]8;;\x07\r\x08\x9b\u202e';
  assert.equal(terminalText(hostile), 'redlink');
  const ui = createTerminalUI({ isTTY: true });
  for (const output of [ui.approval(hostile), ui.modelChoice(hostile, 0), ui.metadata([['Model', hostile]]), ui.feedback(hostile, 'error'), ui.tool(hostile, 'blocked')]) {
    assert.doesNotMatch(output, /\x1b\[31m|\x1b\]|\x07|\r|\x08|\x9b|\u202e/);
    assert.ok(plain(output).includes('redlink'));
  }
});

test('session presentation includes usable IDs, an explicit resume action, and an empty state', () => {
  const ui = createTerminalUI();
  assert.match(ui.sessions([]), /No saved sessions for this workspace/);
  const id = '00000000-0000-4000-8000-000000000001';
  const rendered = ui.sessions([{ id, updatedAt: '2026-11-02T00:00:00.000Z' }]);
  assert.ok(rendered.includes(id + '\n'));
  assert.match(rendered, /Use \/resume UUID/);
  for (const phase of ['requested', 'started', 'returned', 'failed', 'blocked', 'cancelled'] as const) {
    assert.equal(ui.tool('read', phase), phase === 'requested' ? '[tool] read' : `[tool] read: ${phase}`);
  }
  for (const columns of [20, 40, 80]) assert.ok(createTerminalUI({ columns }).boundary('waiting').length < columns, 'waiting line fits one row');
});

test('YOLO danger signal survives NO_COLOR and TERM=dumb and fits every supported width', () => {
  const yolo = { ...status, mode: 'yolo' as const };
  for (const options of [{ isTTY: true, env: { NO_COLOR: '1' } }, { isTTY: true, env: { TERM: 'dumb' } }, {}]) {
    const ui = createTerminalUI(options);
    assert.equal(ui.prompt('yolo'), 'yolo > ');
    assert.match(ui.status(yolo), /^YOLO · DANGER · /);
    assert.match(ui.statusDetails(yolo), /Mode: YOLO · DANGER\nSandbox: none · Approvals: none · Network: on/);
  }
  assert.match(createTerminalUI({ isTTY: true }).prompt('yolo'), /\x1b\[38;2;223;107;99m/);
  assert.doesNotMatch(createTerminalUI({}).statusDetails(status), /YOLO|Sandbox: none/);
  for (const columns of widths) {
    const ui = createTerminalUI({ columns });
    for (const output of [ui.prompt('yolo'), ui.status(yolo), ui.help(true)]) for (const line of plain(output).split('\n')) assert.ok(line.length <= columns, `${columns} columns: ${line}`);
    assert.match(plain(ui.help(true)), /--yolo/);
    if (columns >= 46) assert.match(plain(ui.help(true)), /--dangerously-bypass-approvals-and-sandbox/);
  }
});

test('answers render Markdown structure without leaking markers, and code blocks keep their bytes', () => {
  const source = '## Plan\n- **Fix bugs:** run `npm test` now\n1. First\n> quoted\n\n| A | B |\n| --- | ---: |\n| x | 10 |\n\n```ts\nconst a = **b**;\n```\n---';
  for (const columns of widths) for (const isTTY of [false, true]) for (const ascii of [false, true]) {
    const rendered = plain(createTerminalUI({ columns, isTTY, ascii }).markdown(source));
    for (const line of rendered.split('\n')) assert.ok(line.length <= columns, `${columns}: ${line}`);
    assert.doesNotMatch(rendered.replace('const a = **b**;', ''), /\*\*|^#/m);
    assert.ok(rendered.includes('const a = **b**;'), 'code is never restyled');
    assert.match(rendered, /^Plan$/m);
    assert.match(rendered, new RegExp(`^${ascii ? '-' : '•'} Fix bugs: run`, 'm'));
    assert.match(rendered, /\| x +\| +10 \||│ x +│ +10 │/);
  }
  const ui = createTerminalUI({ isTTY: true });
  assert.match(ui.markdown('**bold** and `code`'), /\x1b\[1mbold\x1b\[22m and \x1b\[38;2;134;167;215mcode\x1b\[39m/);
  // Streaming waits for whole lines, so a marker split across chunks still renders.
  const stream = ui.markdownStream();
  assert.equal(stream.push('**bo'), '');
  assert.equal(stream.push('ld**\npartial'), '\x1b[1mbold\x1b[22m\n');
  assert.equal(stream.flush(), 'partial\n');
  assert.equal(stream.flush(), '');
  assert.doesNotMatch(ui.markdown('\x1b[31mred\x1b[0m **x**'), /\x1b\[31m/, 'model text cannot inject terminal styles');
});

test('slash menu lists every command, narrows by prefix and offers known arguments', () => {
  assert.equal(commandMatches('/').length, SLASH_COMMANDS.length);
  assert.deepEqual(commandMatches('/mo').map(item => item.value), ['/model', '/mode']);
  assert.deepEqual(commandMatches('/cl').map(item => item.value), ['/clear']);
  assert.equal(commandMatches('/clear')[0].submit, true);
  assert.deepEqual(commandMatches('/mode ').map(item => item.value), ['/mode work', '/mode learn', '/mode yolo']);
  assert.equal(commandMatches('/mode').find(item => item.value === '/mode')!.submit, false, 'commands needing an argument are completed, not run');
  assert.equal(commandMatches('/learn ans')[0].submit, false);
  assert.deepEqual(commandMatches('hi /mode'), []);
  assert.deepEqual(commandMatches('/mode learn now'), []);
  for (const columns of [20, 40, 80, 120]) for (const ascii of [false, true]) {
    const rows = createTerminalUI({ columns, isTTY: true, ascii }).commandMenu(commandMatches('/'), 3);
    assert.equal(rows.length, 9, 'eight entries plus the key hint');
    for (const row of rows) assert.ok(plain(row).length < columns, `${columns}: ${plain(row)}`);
    assert.ok(createTerminalUI({ columns, isTTY: true, ascii }).activity(7, 5).length > 0);
  }
});

test('skill menu filters installed names and never intercepts dollar amounts or task text', () => {
  const skills = [{ name: 'alpha', description: 'First skill' }, { name: 'beta', description: 'Second skill' }];
  assert.deepEqual(commandMatches('$', skills).map(item => item.value), ['$alpha', '$beta']);
  assert.deepEqual(commandMatches('$AL', skills).map(item => item.value), ['$alpha']);
  assert.equal(commandMatches('$alpha', skills)[0].submit, false);
  for (const text of ['$100', 'cost $alpha', '$alpha task', '$../outside', '$missing']) assert.deepEqual(commandMatches(text, skills), []);
  assert.deepEqual(commandMatches('$'), []);
  for (const columns of [20, 40, 80]) {
    const ui = createTerminalUI({ columns, env: { NO_COLOR: '' } });
    for (const row of ui.commandMenu(commandMatches('$', skills), 0)) assert.ok(plain(row).length < columns);
  }
});

test('live slash menu runs, completes and dismisses commands through real readline and restores raw mode', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, raw: false, setRawMode(mode: boolean) { this.raw = mode; return this; } });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
  let screen = '';
  stdout.on('data', chunk => { screen += chunk; });
  const keyboard = createCommandKeyboard(stdin as any, stdout as any);
  const rl = createInterface({ input: keyboard.input, output: stdout as any, terminal: true });
  keyboard.attach(rl, () => createTerminalUI({ isTTY: true, columns: 80 }), () => true,
    line => commandMatches(line, [{ name: 'fixture-skill', description: 'Installed fixture' }]));
  const type = async (keys: string[]) => {
    const answer = rl.question('work > ');
    for (const key of keys) { stdin.write(key); await new Promise(resolve => setTimeout(resolve, 15)); }
    return answer;
  };
  assert.equal(stdin.raw, true);
  assert.equal(await type(['/', 's', 't', '\r']), '/status');
  assert.match(plain(screen), /Mode, model, workspace/);
  assert.equal(await type(['/', 'm', 'o', '\x1b[B', '\r', 'l', '\r']), '/mode learn');
  assert.equal(await type(['/', 'l', 'e', '\t', 'a', 'n', '\t', 'x', '\r']), '/learn answer x');
  assert.equal(await type(['/', 'q', '\x1b', '\r']), '/q', 'Esc closes the menu; Enter then submits what was typed');
  assert.equal(await type(['h', 'i', '\r']), 'hi');
  assert.equal(await type(['/', 'c', 'l', '\r']), '/clear');
  assert.equal(await type(['$', 'f', '\t', 'task', '\r']), '$fixture-skill task');
  assert.equal(await type(['$', '\r', 'task', '\r']), '$fixture-skill task', 'Enter selects a skill but leaves room for its task');
  assert.equal(await type(['$', '\x1b', '\r']), '$', 'Esc allows the bare skill-list command');
  rl.close();
  assert.equal(stdin.raw, false);
});
