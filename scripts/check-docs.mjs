// Current source documentation gate. Historical Pi manifest/release checks are retained separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const docs = ['README.md', 'AGENTS.md', 'docs/STATUS.md', 'docs/README.md', 'docs/MASTRA_V1.md', 'docs/MASTRA_V1_DEPENDENCIES.md'];
if (fs.existsSync(path.join(root, 'docs/CODEX_AUTH.md'))) docs.push('docs/CODEX_AUTH.md');
for (const relative of docs) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  assert.ok(!/[ \t]+$/m.test(source), `Trailing whitespace: ${relative}`);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `Unclosed code fence: ${relative}`);
  for (const [, link] of source.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    if (/^(?:https?:|mailto:|#)/.test(link)) continue;
    const target = path.resolve(root, path.dirname(relative), decodeURIComponent(link.split('#')[0]));
    assert.ok(fs.existsSync(target), `Broken current-document link: ${relative} -> ${link}`);
  }
}
const status = fs.readFileSync(path.join(root, 'docs/STATUS.md'), 'utf8');
assert.match(status, /Not a release, full feature parity or production-ready/);
assert.match(status, /distribution approval remain unresolved/);
const current = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert.match(current, /Mastra, not Pi/);
assert.match(current, /not a production release/);
assert.match(current, /no automatic browser synchronization/i);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).private, true);
console.log(`PASS: ${docs.length} current documents checked; historical Pi links/manifests are not Mastra release certification.`);
