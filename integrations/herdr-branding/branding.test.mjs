import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { artwork, badgeKey, cliResult, eventPane, ICON_KEY, ICONS, LEGACY_CAPTION, LEGACY_MARKER, metadataArgs, NEURA_LABEL, refresh, ROW_KEYS, runner, SOURCE } from './branding.mjs';
import { CANONICAL_AGENTS, prepareSidebar } from './sidebars.mjs';

const base = { pane_id: 'fixture:p1', agent: 'pi', agent_status: 'working', tokens: { mode: 'WORK', phase: 'IMPLEMENT', user_token: 'keep' } };
const env = { HERDR_ENV: '1', HERDR_BIN_PATH: process.execPath };
let sequence = 0n;
const clock = () => ++sequence;
const argValue = (args, flag) => args[args.indexOf(flag) + 1];

// Synthetic public-source contracts, never live Herdr/session access.
function model(entries = [base], ownedDisplays = new Set()) {
  const panes = new Map(entries.map((pane) => [pane.pane_id, structuredClone(pane)]));
  const displaySources = new Map(entries.filter((pane) => pane.display_agent !== undefined)
    .map((pane) => [pane.pane_id, ownedDisplays.has(pane.pane_id) ? SOURCE : 'external.fixture']));
  const calls = [];
  const sequences = new Map();
  const sequenceOwners = new Map();
  const recentlyExited = new Map();
  async function run(args) {
    calls.push(args);
    if (args[1] === 'list') return { panes: [...panes.values()].map((pane) => ({ pane_id: pane.pane_id })) };
    const pane = panes.get(args[2]);
    if (!pane) throw new Error('Synthetic vanished pane');
    if (args[1] === 'get') return { pane: structuredClone(pane) };
    assert.deepEqual(args.slice(0, 2), ['pane', 'report-metadata']);
    const source = argValue(args, '--source');
    const agent = args.includes('--agent') ? argValue(args, '--agent') : undefined;
    if (agent && agent === recentlyExited.get(pane.pane_id)) return undefined;
    const generation = BigInt(argValue(args, '--seq'));
    const owner = `${pane.pane_id}:${source}`;
    if (generation <= (sequences.get(owner) ?? -1n)) return undefined;
    sequences.set(owner, generation);
    if (agent) sequenceOwners.set(owner, agent);
    if (args.includes('--clear-display-agent') && displaySources.get(pane.pane_id) === source) {
      delete pane.display_agent;
      displaySources.delete(pane.pane_id);
    }
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--token') {
        const [key, ...value] = args[++i].split('=');
        (pane.tokens ??= {})[key] = value.join('=');
      } else if (args[i] === '--clear-token') delete (pane.tokens ??= {})[args[++i]];
    }
    return undefined;
  }
  function exit(id) {
    const pane = panes.get(id);
    recentlyExited.set(id, pane.agent);
    for (const [owner, kind] of sequenceOwners) if (owner.startsWith(`${id}:`) && kind === pane.agent) {
      sequences.delete(owner);
      sequenceOwners.delete(owner);
    }
    pane.agent = undefined;
    if (pane.display_agent === NEURA_LABEL) delete pane.display_agent;
  }
  function replace(id, agent) { panes.get(id).agent = agent; recentlyExited.delete(id); }
  return { run, panes, calls, sequences, exit, replace };
}

for (const key of Object.keys(ICONS)) {
  test(`${key}: artwork only, original identity/state untouched`, () => {
    assert.equal(badgeKey(key), key);
    const pane = { ...base, agent: key };
    const before = JSON.stringify(pane);
    const args = metadataArgs(pane, false, 123n);
    assert.equal(argValue(args, '--agent'), key);
    assert.equal(argValue(args, '--source'), SOURCE);
    assert.equal(argValue(args, '--seq'), '123');
    assert.ok(!args.some((arg) => ['report-agent', '--state', '--title', '--session-ref', '--clear-state-labels', '--display-agent'].includes(arg)));
    assert.equal(JSON.stringify(pane), before);
    assert.equal(artwork(pane)[ICON_KEY], ICONS[key]);
    assert.ok([...ICONS[key]].length <= 2);
    assert.ok(!/[\s\u200b\ufe0f]/u.test(ICONS[key]));
    for (const row of ROW_KEYS) assert.equal(artwork(pane)[row], null);
  });
}

test('inline Pi mark and display-only aliases', () => {
  assert.equal(ICONS.pi, 'π');
  for (const [alias, kind] of [['claude-code', 'claude'], ['gemini-cli', 'gemini'], ['deepseek-tui', 'deepseek']]) {
    assert.equal(badgeKey(alias), kind);
    assert.equal(argValue(metadataArgs({ ...base, agent: alias }), '--agent'), alias);
  }
  for (const key of [undefined, '', 'unknown', '__proto__', 'constructor']) assert.equal(badgeKey(key), undefined);
});

test('Neura follows external explicit display only; no marker publisher', () => {
  assert.equal(badgeKey('pi', undefined), 'pi');
  assert.equal(badgeKey('pi', NEURA_LABEL), 'neura');
  assert.equal(badgeKey('claude', NEURA_LABEL), 'claude');
  assert.equal(badgeKey('pi', { [LEGACY_MARKER]: 'neura', mode: 'WORK' }), 'pi');
  assert.ok(!fs.existsSync(new URL('./pi-branding.js', import.meta.url)));
});

test('real CLI envelopes, silent writes, malformed reads and failed subprocesses', async () => {
  assert.deepEqual(cliResult('{"id":"fixture","result":{"panes":[]}}'), { panes: [] });
  assert.equal(cliResult('', true), undefined);
  for (const value of ['', 'null', 'not json', '{"ok":true}', '{"id":"fixture","error":{}}']) assert.throws(() => cliResult(value));
  const run = runner(env, async (_bin, args) => ({ stdout: args[1] === 'report-metadata' ? '' : '{"id":"fixture","result":{"panes":[]}}' }));
  assert.deepEqual(await run(['pane', 'list']), { panes: [] });
  assert.equal(await run(['pane', 'report-metadata', base.pane_id]), undefined);
  await assert.rejects(runner(env, async () => { throw new Error('nonzero exit'); })(['pane', 'list']));
});

test('runner refuses invalid context/binary', () => {
  for (const value of [{}, { ...env, HERDR_ENV: '0' }, { ...env, HERDR_BIN_PATH: 'herdr' }, { ...env, HERDR_BIN_PATH: '/nonexistent/herdr' }]) assert.throws(() => runner(value));
});

test('foreign labels never copied; obsolete caption cleared', async () => {
  const m = model([{ ...base, display_agent: 'Other owner', tokens: { ...base.tokens, [LEGACY_CAPTION]: 'old-name' } }]);
  await refresh(m.run, { clock });
  assert.equal(m.panes.get(base.pane_id).display_agent, 'Other owner');
  assert.ok(!m.panes.get(base.pane_id).tokens[LEGACY_CAPTION]);
  assert.ok(m.calls.every((args) => args[0] !== 'agent' && !args.includes('--display-agent')));
});

test('owned legacy display is cleared and icon follows fresh native presentation', async () => {
  const m = model([{ ...base, display_agent: NEURA_LABEL }], new Set([base.pane_id]));
  assert.equal((await refresh(m.run, { clock })).failed, 0);
  assert.equal(m.panes.get(base.pane_id).display_agent, undefined);
  assert.equal(m.panes.get(base.pane_id).tokens[ICON_KEY], ICONS.pi);
  assert.ok(m.calls.filter((args) => args[1] === 'report-metadata').length >= 2);
  assert.equal(m.panes.get(base.pane_id).agent_status, 'working');
});

test('known transitions clear obsolete marker; rollback preserves unrelated tokens', async () => {
  const m = model([{ ...base, tokens: { ...base.tokens, [LEGACY_MARKER]: 'neura', [LEGACY_CAPTION]: 'old-name' } }]);
  m.replace(base.pane_id, 'claude');
  await refresh(m.run, { clock });
  assert.ok(!m.panes.get(base.pane_id).tokens[LEGACY_MARKER]);
  assert.ok(!m.panes.get(base.pane_id).tokens[LEGACY_CAPTION]);
  m.replace(base.pane_id, 'pi');
  await refresh(m.run, { clock });
  assert.equal(m.panes.get(base.pane_id).tokens[ICON_KEY], artwork(base)[ICON_KEY]);
  await refresh(m.run, { clear: true, clock });
  assert.deepEqual(m.panes.get(base.pane_id).tokens, base.tokens);
});

test('one vanished pane does not abort remaining update/rollback', async () => {
  for (const clear of [false, true]) {
    const m = model();
    const run = (args) => args[1] === 'list' ? Promise.resolve({ panes: [{ pane_id: 'closed:p2' }, { pane_id: base.pane_id }] }) : m.run(args);
    assert.deepEqual(await refresh(run, { clear, clock }), { updated: 1, skipped: 0, failed: 1 });
  }
});

test('event scope and unknown/stale cleanup', async () => {
  const second = { ...base, pane_id: 'event:p2', agent: undefined, tokens: { ...base.tokens, [ROW_KEYS[0]]: 'stale' } };
  const m = model([base, second]);
  assert.equal(eventPane('{"data":{"pane":{"pane_id":"event:p2"}}}'), second.pane_id);
  assert.deepEqual(await refresh(m.run, { eventText: JSON.stringify({ data: { pane_id: second.pane_id } }), clock }), { updated: 1, skipped: 0, failed: 0 });
  assert.ok(m.calls.every((args) => args[1] !== 'list' && args[2] !== base.pane_id));
  assert.deepEqual(await refresh(m.run, { clock }), { updated: 1, skipped: 1, failed: 0 });
  assert.throws(() => eventPane('not json'));
});

test('older refresh cannot overwrite newer artwork', async () => {
  const m = model();
  let paused = false;
  const run = async (args) => {
    if (!paused && args[1] === 'report-metadata') { paused = true; m.replace(base.pane_id, 'claude'); await refresh(m.run, { clock }); }
    return m.run(args);
  };
  assert.equal((await refresh(run, { clock })).failed, 0);
  assert.equal(m.panes.get(base.pane_id).tokens[ICON_KEY], artwork({ ...base, agent: 'claude' })[ICON_KEY]);
});

test('native exit resets sequences and rejects recently exited reports', async () => {
  const m = model();
  await refresh(m.run, { clock });
  m.exit(base.pane_id);
  assert.equal(m.sequences.size, 0);
  await m.run(metadataArgs(base, false, clock()));
  assert.equal(m.sequences.size, 0);
  m.replace(base.pane_id, 'codex');
  assert.equal((await refresh(m.run, { clock })).failed, 0);
  assert.equal(m.panes.get(base.pane_id).tokens[ICON_KEY], artwork({ ...base, agent: 'codex' })[ICON_KEY]);
});

test('late old-generation snapshot is repaired after native sequence reset', async () => {
  const m = model();
  await refresh(m.run, { clock });
  let changed = false;
  const run = async (args) => {
    if (!changed && args[1] === 'report-metadata') { changed = true; m.exit(base.pane_id); m.replace(base.pane_id, 'codex'); }
    return m.run(args);
  };
  assert.equal((await refresh(run, { clock })).failed, 0);
  assert.equal(m.panes.get(base.pane_id).tokens[ICON_KEY], artwork({ ...base, agent: 'codex' })[ICON_KEY]);
});

test('foreign display change during write is preserved and reconciled', async () => {
  const m = model([{ ...base, display_agent: NEURA_LABEL }]);
  let changed = false;
  const run = async (args) => {
    if (!changed && args[1] === 'report-metadata') { changed = true; m.panes.get(base.pane_id).display_agent = 'Foreign label'; }
    return m.run(args);
  };
  assert.equal((await refresh(run, { clock })).failed, 0);
  assert.equal(m.panes.get(base.pane_id).display_agent, 'Foreign label');
  assert.equal(m.panes.get(base.pane_id).tokens[ICON_KEY], artwork(base)[ICON_KEY]);
});

test('continuous races exhaust bounded retry and fail truthfully', async () => {
  const m = model();
  const run = async (args) => { const result = await m.run(args); if (args[1] === 'report-metadata') m.panes.get(base.pane_id).tokens[ICON_KEY] = 'raced'; return result; };
  assert.deepEqual(await refresh(run, { clock }), { updated: 0, skipped: 0, failed: 1 });
  assert.equal(m.calls.filter((args) => args[1] === 'report-metadata').length, 3);
});

const layout = { rows: [[{ token: 'state_icon' }, { token: 'agent', bold: true }, 'state_text'], ['workspace']], rows_by_agent: { claude: [['agent', 'state_text'], ['$custom_user']], cursor: [['agent', '$leave_alone']] } };
const nativeLabel = (token, value) => token.rules?.some((rule) => rule.equals === value && rule.hide) ? undefined : value;

test('native labels rename/clear immediately, without unsupported hook/caption', () => {
  const token = prepareSidebar(layout).rows_by_agent.pi[0][2];
  assert.equal(token.token, 'agent');
  for (const name of ['my-worker', 'new-worker', 'Foreign label', 'Pi']) assert.equal(nativeLabel(token, name), name);
  for (const name of ['pi', NEURA_LABEL]) assert.equal(nativeLabel(token, name), undefined);
  assert.ok(!fs.readFileSync(new URL('./herdr-plugin.toml', import.meta.url), 'utf8').includes('pane.updated'));
});

test('base/unrelated overrides, styles/rules and user rows preserved', () => {
  const before = JSON.stringify(layout);
  const planned = prepareSidebar(layout);
  assert.equal(JSON.stringify(layout), before);
  assert.deepEqual(planned.rows.slice(1), layout.rows.slice(1));
  assert.equal(planned.rows[0][1].token, `$${ICON_KEY}`);
  assert.equal(planned.rows[0][2].token, 'agent');
  assert.deepEqual(planned.rows_by_agent.cursor, layout.rows_by_agent.cursor);
  for (const key of CANONICAL_AGENTS) { const old = layout.rows_by_agent[key] ?? layout.rows; assert.equal(planned.rows_by_agent[key].length, old.length); assert.deepEqual(planned.rows_by_agent[key].at(-1), old.at(-1)); }
  const custom = prepareSidebar({ rows: [[{ token: 'agent', fg: '#abcdef', rules: [{ equals: 'custom', dim: true }] }]] });
  assert.equal(custom.rows_by_agent.pi[0][1].fg, '#abcdef');
  assert.deepEqual(custom.rows_by_agent.pi[0][1].rules.at(-1), { equals: 'custom', dim: true });
  assert.ok(!planned.rows_by_agent.fx && !planned.rows_by_agent.deepseek);
});

test('Pi rule boundary 14 accepted / 15 refused; no mutation/truncation', () => {
  const rules = (n) => Array.from({ length: n }, (_, i) => ({ equals: `user-${i}`, dim: true }));
  const accepted = prepareSidebar({ rows: [['agent']], rows_by_agent: { pi: [[{ token: 'agent', rules: rules(14) }]] } });
  assert.equal(accepted.rows_by_agent.pi[0][1].rules.length, 16);
  assert.deepEqual(accepted.rows_by_agent.pi[0][1].rules.slice(2), rules(14));
  const input = { rows: [['agent']], rows_by_agent: { pi: [[{ token: 'agent', rules: rules(15) }]] } }; const before = JSON.stringify(input);
  assert.throws(() => prepareSidebar(input), /rule cap exceeded/); assert.equal(JSON.stringify(input), before);
});

test('other-kind rule boundary 15 accepted / 16 refused; no mutation/truncation', () => {
  const rules = (n) => Array.from({ length: n }, (_, i) => ({ equals: `user-${i}`, bold: false }));
  const accepted = prepareSidebar({ rows: [['agent']], rows_by_agent: { claude: [[{ token: 'agent', rules: rules(15) }]] } });
  assert.equal(accepted.rows_by_agent.claude[0][1].rules.length, 16);
  assert.deepEqual(accepted.rows_by_agent.claude[0][1].rules.slice(1), rules(15));
  const input = { rows: [['agent']], rows_by_agent: { claude: [[{ token: 'agent', rules: rules(16) }]] } }; const before = JSON.stringify(input);
  assert.throws(() => prepareSidebar(input), /rule cap exceeded/); assert.equal(JSON.stringify(input), before);
});

test('row/token caps and missing/duplicate headers stop safely', () => {
  const input = { rows: [['agent'], ...Array.from({ length: 16 }, () => ['workspace'])] }; const before = JSON.stringify(input);
  assert.throws(() => prepareSidebar(input), /cap exceeded/); assert.equal(JSON.stringify(input), before);
  assert.throws(() => prepareSidebar({ rows: [['workspace']] }), /manual review/);
  assert.throws(() => prepareSidebar({ rows: [['agent', '$herdr_brand_row1']] }), /manual reconciliation/);
  assert.throws(() => prepareSidebar({ rows: [Array.from({ length: 17 }, () => 'agent')] }), /cap exceeded/);
  assert.equal(prepareSidebar({ rows: [['agent'], ...Array.from({ length: 15 }, () => ['workspace'])] }).rows_by_agent.pi.length, 16);
  assert.throws(() => prepareSidebar({ rows: [['agent', ...Array.from({ length: 15 }, () => 'workspace')]] }), /cap exceeded/);
});

test('multi-line migration restores compact headers and is idempotent', () => {
  const old = structuredClone(layout);
  old.rows.splice(1, 0, ...ROW_KEYS.map((key) => [{ token: `$${key}`, bold: true }]));
  old.rows_by_agent.pi = structuredClone(old.rows);
  old.rows_by_agent.claude = structuredClone(old.rows);
  const saved = JSON.stringify(old);
  const planned = prepareSidebar(old);
  assert.equal(JSON.stringify(old), saved);
  for (const rows of [planned.rows, ...CANONICAL_AGENTS.map((key) => planned.rows_by_agent[key])]) {
    assert.equal(rows.length, 2);
    assert.ok(!rows.flat().some((token) => ROW_KEYS.some((key) => (typeof token === 'string' ? token : token.token) === `$${key}`)));
    const header = rows[0].map((token) => typeof token === 'string' ? token : token.token);
    assert.deepEqual(header, ['state_icon', `$${ICON_KEY}`, 'agent', 'state_text']);
  }
  assert.deepEqual(prepareSidebar(planned), planned);
  assert.deepEqual(planned.rows_by_agent.cursor, old.rows_by_agent.cursor);
});

test('inline refresh clears old large art; exit clears stale icon only', async () => {
  const m = model([{ ...base, tokens: { ...base.tokens, ...Object.fromEntries(ROW_KEYS.map((key) => [key, 'old-large-row'])) } }]);
  assert.equal((await refresh(m.run, { clock })).failed, 0);
  assert.equal(m.panes.get(base.pane_id).tokens[ICON_KEY], 'π');
  for (const row of ROW_KEYS) assert.ok(!m.panes.get(base.pane_id).tokens[row]);
  m.exit(base.pane_id);
  assert.equal((await refresh(m.run, { clock })).failed, 0);
  assert.deepEqual(m.panes.get(base.pane_id).tokens, base.tokens);
});

test('generic fallback rule cap 13 accepted / 14 refused', () => {
  const rules = (n) => Array.from({ length: n }, (_, i) => ({ equals: `generic-${i}`, dim: true }));
  assert.equal(prepareSidebar({ rows: [[{ token: 'agent', rules: rules(13) }]] }).rows[0][1].rules.length, 16);
  assert.throws(() => prepareSidebar({ rows: [[{ token: 'agent', rules: rules(14) }]] }), /rule cap exceeded/);
});
