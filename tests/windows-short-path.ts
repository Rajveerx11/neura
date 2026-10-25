// Native 8.3 alias evidence for synthetic Windows fixtures only; no profile or tool installation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

export async function windowsShortPath(directory: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Windows short-path fixture requires Windows.');
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const modules = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec|temp|tmp)$/i.test(key)));
  Object.assign(env, { HOME: path.dirname(directory), USERPROFILE: path.dirname(directory), PSModulePath: modules, WinPSModulePath: modules });
  const quoted = `'${directory.replaceAll("'", "''")}'`;
  const reply = await promisify(execFile)(path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'; $fso=New-Object -ComObject Scripting.FileSystemObject; [Console]::WriteLine($fso.GetFolder(${quoted}).ShortPath)`], { env, timeout: 10000 });
  const short = reply.stdout.trim();
  if (!path.isAbsolute(short) || reply.stderr || await realpath(short) !== await realpath(directory)) throw new Error('Invalid short-path fixture result.');
  return short;
}
