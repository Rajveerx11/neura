// Repository policy only. Runtime regression suites were removed at the owner's request.
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv.length !== 2) {
  console.error('Test suites are unavailable. Run without arguments to check repository policy.');
  process.exit(2);
}
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 }).split('\0').filter(Boolean);
const forbidden = /(?:^|\/)(?:tests?|__tests__|fixtures?|__fixtures__)(?:\/|$)|\.(?:tests?|spec)\.|-fixtures?\.|(?:^|\/)test-suites\.mjs$/i;
const found = files.filter(file => forbidden.test(file) && lstatSync(path.join(root, file), { throwIfNoEntry: false }));
if (found.length) {
  console.error('Test files are forbidden in this repository:\n' + [...new Set(found)].join('\n'));
  process.exit(1);
}
console.log('PASS: repository test-file policy. Runtime regression tests are unavailable; this is not test evidence.');
