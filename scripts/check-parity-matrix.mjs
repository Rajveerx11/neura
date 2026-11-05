// M0 parity matrix gate (#114). Checks inventory coverage, honest status labels, that source
// links resolve to files in the frozen baseline tree and that evidence names test files.
// It does not run or certify the evidence tests the matrix names.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BASELINE = '3ebaac07c8320125bcc32478b5aa3865746a997c';
export const STATUSES = Object.freeze(['implemented', 'partial', 'unavailable', 'future']);
const PERMALINK = `https://github.com/Rajveerx11/neura/blob/${BASELINE}/`;
const EVIDENCE = /^(?:tests\/[^/]+\.test\.ts|scripts\/tests\/[^/]+\.mjs)$/;
const OWNER = /https:\/\/github\.com\/Rajveerx11\/neura\/issues\/(\d+)/g;
// ponytail: /mcp is registered by @spences10/pi-mcp through the mcp.ts wrapper, so a literal
// registerCommand scan cannot see it. Add names here only for the same reason.
const WRAPPED_COMMANDS = ['mcp'];

// Rows are table lines whose first cell is a backticked `kind:name` identifier.
export function parseMatrix(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\|\s*`([a-z]+:[^`]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (match) rows.push({ id: match[1], line: index + 1, cells: match[2].split('|').map(cell => cell.trim()) });
  });
  return rows;
}

// Pure validation. `exists(relativePath)` decides whether evidence/fixture paths are real;
// `files` is the set of baseline-tree paths that source links must resolve to.
export function validateMatrix(text, { extensions, commands, files, exists }) {
  const errors = [];
  const rows = parseMatrix(text);
  if (!text.includes(BASELINE)) errors.push(`Matrix must name frozen baseline ${BASELINE}`);
  const seen = new Map();
  for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
  for (const [id, count] of seen) if (count > 1) errors.push(`${id}: appears ${count} times`);
  const expect = (id) => { if (!seen.has(id)) errors.push(`${id}: missing from matrix`); };
  extensions.forEach(name => expect(`ext:${name}`));
  commands.forEach(name => expect(`cmd:/${name}`));
  ['gate:human-away', 'gate:full-proof'].forEach(expect);
  for (const row of rows) {
    const [source = '', owner = '', status = '', evidence = '', fixture = ''] = row.cells;
    const where = `${row.id} (line ${row.line})`;
    if (!source.includes(PERMALINK)) errors.push(`${where}: missing baseline permalink`);
    for (const [, target] of source.matchAll(/\]\((https:[^\s)]+)\)/g)) {
      if (!target.startsWith(PERMALINK)) continue;
      const file = decodeURIComponent(target.slice(PERMALINK.length).split('#')[0]).replace(/\/$/, '');
      if (!files.has(file)) errors.push(`${where}: source link is not in the baseline tree: ${file}`);
    }
    const owners = [...owner.matchAll(OWNER)].map(match => Number(match[1]));
    if (owners.length !== 1 || owners[0] < 114 || owners[0] > 129) errors.push(`${where}: needs exactly one owner in #114-#129`);
    const label = status.replace(/`/g, '');
    if (!STATUSES.includes(label)) errors.push(`${where}: invalid status "${status}"`);
    if (label === 'implemented' && /human away|full proof|human-away|full-proof/i.test(row.id + ' ' + row.cells.join(' '))) {
      errors.push(`${where}: Human Away and full proof cannot be implemented`);
    }
    if (label === 'implemented' && evidence === 'none') errors.push(`${where}: implemented requires evidence`);
    for (const [name, cell, empty] of [['evidence', evidence, 'none'], ['fixture', fixture, 'needed']]) {
      if (cell === empty) continue;
      const paths = [...cell.matchAll(/`([^`]+)`/g)].map(match => match[1]);
      if (!paths.length) errors.push(`${where}: ${name} must be \`path\` or ${empty}`);
      for (const file of paths) {
        if (!exists(file)) errors.push(`${where}: ${name} path does not exist: ${file}`);
        // ponytail: structural only; a test filename cannot prove non-mock coverage or that it ran.
        else if (name === 'evidence' && !EVIDENCE.test(file)) errors.push(`${where}: evidence must be a test file (tests/*.test.ts or scripts/tests/*.mjs): ${file}`);
      }
    }
  }
  return errors;
}

// Baseline inventory is derived from Git at the frozen commit, never from the live checkout.
export function baselineInventory(root) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed at ${BASELINE}; a full-history checkout is required.`);
    return result.stdout;
  };
  const extensions = git('ls-tree', '--name-only', BASELINE, 'agent/extensions/').split('\n')
    .filter(file => file.endsWith('.ts')).map(file => path.posix.basename(file)).sort();
  const literal = git('grep', '-h', '-o', '-E', `registerCommand\\(\\s*["'][a-z-]+["']`, BASELINE, '--', 'agent/extensions', 'agent/neura');
  const commands = [...new Set([...literal.matchAll(/["']([a-z-]+)["']/g)].map(match => match[1]).concat(WRAPPED_COMMANDS))].sort();
  // -t keeps directories too, so a link to a baseline folder also resolves.
  const files = new Set(git('ls-tree', '-r', '-t', '--name-only', BASELINE).split('\n').filter(Boolean));
  return { extensions, commands, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const inventory = baselineInventory(root);
  const text = fs.readFileSync(path.join(root, 'docs/PARITY_MATRIX.md'), 'utf8');
  const errors = validateMatrix(text, { ...inventory, exists: file => fs.existsSync(path.join(root, file)) });
  if (errors.length) {
    console.error(errors.map(error => `FAIL: ${error}`).join('\n'));
    process.exit(1);
  }
  console.log(`PASS: ${parseMatrix(text).length} matrix rows cover ${inventory.extensions.length} baseline extensions and ${inventory.commands.length} commands. Coverage only; evidence tests are not certified by this check.`);
}
