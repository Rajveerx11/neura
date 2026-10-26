// Native 8.3 alias evidence for synthetic Windows fixtures only; no profile or tool installation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

export async function windowsShortPath(directory: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Windows short-path fixture requires Windows.');
  if (/["\r\n]/.test(directory)) throw new Error('Unsupported short-path fixture input.');
  const canonical = await realpath(directory);
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp)$/i.test(key)));
  env.NEURA_SHORT_DIRECTORY = canonical;
  // The path is data in one quoted environment expansion, never interpolated command text.
  const command = 'for %I in ("%NEURA_SHORT_DIRECTORY%") do @echo "%~sI"';
  const reply = await promisify(execFile)(path.join(root, 'System32', 'cmd.exe'), ['/d', '/v:off', '/s', '/c', command], { cwd: canonical, env, windowsVerbatimArguments: true, windowsHide: true, timeout: 10000 });
  const output = reply.stdout.trim();
  const short = output.startsWith('"') && output.endsWith('"') ? output.slice(1, -1) : '';
  if (!path.isAbsolute(short) || reply.stderr || await realpath(short) !== canonical) throw new Error('Invalid short-path fixture result.');
  return short;
}
