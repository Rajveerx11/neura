import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Only synthetic test state can reach a suite, including when run directly.
export function isolate() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-test-'));
  const keep = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp']);
  for (const key of Object.keys(process.env)) {
    if (!keep.has(key.toLowerCase())) delete process.env[key];
  }
  Object.assign(process.env, {
    HOME: scratch, USERPROFILE: scratch, APPDATA: path.join(scratch, 'AppData'),
    LOCALAPPDATA: path.join(scratch, 'LocalAppData'),
    PI_CODING_AGENT_DIR: path.join(scratch, '.pi/agent'),
    NEURA_APPROVAL_DIR: path.join(scratch, 'approvals'), NEURA_HEADMASTER: 'off',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(scratch, 'empty.gitconfig'),
    GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Neura Test', GIT_COMMITTER_NAME: 'Neura Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  });
  fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[core]\n autocrlf = false\n');
  fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  return scratch;
}
