import { ICON_KEY, ICONS, NEURA_LABEL, ROW_KEYS } from './branding.mjs';

// Custom fx/DeepSeek reporters use the base layout, not invented canonical keys.
export const CANONICAL_AGENTS = ['pi', 'claude', 'codex', 'gemini', 'hermes', 'opencode'];
const tokenName = (token) => typeof token === 'string' ? token : token.token;
const legacyToken = (token) => ROW_KEYS.some((key) => tokenName(token) === `$${key}`);
const colors = { claude: '#d97757', gemini: '#55aaff', hermes: '#ffcc66', fx: '#55ffff', deepseek: '#5555ff', neura: '#55ffff' };

function compactRows(original, wordmarks) {
  if (!Array.isArray(original)) throw new Error('Supply resolved sidebar rows before preparing logos.');
  const rows = structuredClone(original).filter((row) => {
    if (!row.some(legacyToken)) return true;
    if (!row.every(legacyToken)) throw new Error('Mixed legacy artwork requires manual reconciliation; no changes made.');
    return false; // Remove only task-owned standalone multi-line artwork rows.
  });
  let header = false;
  for (const row of rows) {
    // Idempotent migration: remove our old inline token before inserting it once.
    for (let i = row.length - 1; i >= 0; i--) if (tokenName(row[i]) === `$${ICON_KEY}`) row.splice(i, 1);
    for (let i = 0; i < row.length; i++) {
      if (tokenName(row[i]) !== 'agent') continue;
      header = true;
      const styled = typeof row[i] === 'string' ? { token: row[i] } : row[i];
      const rules = [...(styled.rules ?? [])];
      const missing = wordmarks.filter((equals) => !rules.some((rule) => rule.equals === equals && rule.hide === true));
      rules.unshift(...missing.map((equals) => ({ equals, hide: true })));
      if (rules.length > 16) throw new Error('Sidebar rule cap exceeded; preserve user rules and stop activation.');
      row[i] = { ...styled, rules };
      // Logo occupies the former wordmark position, immediately beside native status.
      row.splice(i, 0, {
        token: `$${ICON_KEY}`, fg: '#ffffff', bold: true,
        rules: Object.entries(colors).map(([key, fg]) => ({ equals: ICONS[key], fg })),
      });
      i++;
    }
  }
  if (!header) throw new Error('A layout without an agent token requires manual review; no changes made.');
  if (rows.length > 16 || rows.some((row) => row.length > 16)) {
    throw new Error('Sidebar row/token cap exceeded; preserve user rows and stop activation.');
  }
  return rows;
}

/** Pure migration: no config IO, linking or reload; custom names remain native. */
export function prepareSidebar(agents) {
  const result = structuredClone(agents);
  const overrides = result.rows_by_agent ??= {};
  for (const kind of CANONICAL_AGENTS) {
    overrides[kind] = compactRows(overrides[kind] ?? result.rows, kind === 'pi' ? [kind, NEURA_LABEL] : [kind]);
  }
  result.rows = compactRows(result.rows, ['fx', 'deepseek', 'deepseek-tui']);
  // Unrelated per-agent overrides and all non-artwork rows/styles remain intact.
  return result;
}
