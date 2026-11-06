import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { createTerminalUI, terminalText, terminalLabel, type TerminalStatus } from '../src/terminal-ui.ts';
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
