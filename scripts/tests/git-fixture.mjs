import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function repository(scratch, name = 'repo') {
  const root = path.join(scratch, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
  git(root, 'add', '.');
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'synthetic fixture');
  return root;
}
