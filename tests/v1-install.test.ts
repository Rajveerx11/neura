import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
const nativeModules = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
const powershell = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

function nativePowerShellEnvironment(home: string, inherited = process.env): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => /^(?:path|pathext|systemroot|windir|comspec)$/i.test(key)));
  return { ...env, USERPROFILE: home, HOME: home, NEURA_HOME: path.join(home, 'neura'), TEMP: home, TMP: home,
    PSModulePath: nativeModules, WinPSModulePath: nativeModules };
}

test('Windows development installer: isolated positive/check plus preservation of unknown launchers', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-v1-install-')));
  const env = nativePowerShellEnvironment(scratch);
  const run = (args: string[]) => execute(powershell, ['-NoProfile', '-File', path.join(root, 'install.ps1'), ...args], { cwd: root, env });
  try {
    const bin = path.join(scratch, 'bin');
    await run(['-Development', '-BinDirectory', bin]);
    const launcher = await fs.readFile(path.join(bin, 'neura.cmd'), 'utf8');
    assert.match(launcher, /NEURA_SOURCE=/);
    assert.doesNotMatch(launcher, /\.pi\\|pi --/);
    assert.match((await run(['-Check', '-BinDirectory', bin])).stdout, /matches/);
    await run(['-Development', '-BinDirectory', bin]);
    await fs.writeFile(path.join(bin, 'neura.cmd'), '@echo user-owned\r\n');
    await assert.rejects(run(['-Check', '-BinDirectory', bin]));
    await assert.rejects(run(['-Development', '-BinDirectory', bin]));
    assert.equal(await fs.readFile(path.join(bin, 'neura.cmd'), 'utf8'), '@echo user-owned\r\n');
    const untouched = path.join(scratch, 'not-installed');
    await assert.rejects(run(['-BinDirectory', untouched]));
    await assert.rejects(fs.stat(untouched));
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('Windows PowerShell fixtures pin native modules despite hostile inherited paths', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-native-modules-')));
  try {
    const filename = path.join(scratch, 'receipt-input.txt'); const content = 'synthetic receipt bytes';
    await fs.writeFile(filename, content);
    const foreign = path.join(scratch, 'foreign-modules'); await fs.mkdir(foreign);
    const env = nativePowerShellEnvironment(scratch, { ...process.env, PSModulePath: foreign, WinPSModulePath: foreign });
    assert.equal(env.PSModulePath, nativeModules); assert.equal(env.WinPSModulePath, nativeModules);
    const reply = await execute(powershell, ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'; [pscustomobject]@{ major=$PSVersionTable.PSVersion.Major; module=(Get-Command Get-FileHash).Module.ModuleBase; hash=(Get-FileHash -LiteralPath ${quote(filename)} -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json -Compress`], { cwd: scratch, env });
    const result = JSON.parse(reply.stdout);
    assert.equal(result.major, 5);
    // Windows PowerShell may expose inbox cmdlets from PSHOME or its Modules subtree.
    const nativeHome = await fs.realpath(path.dirname(nativeModules));
    const relative = path.relative(nativeHome, await fs.realpath(result.module));
    assert.ok(relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)));
    assert.equal(result.hash, createHash('sha256').update(content).digest('hex'));
    assert.equal(reply.stderr, '');
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('Windows development installer refuses non-ASCII source paths before writing a launcher', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-install-path-')));
  try {
    const source = path.join(scratch, 'source-\u00e9');
    const bin = path.join(scratch, 'bin');
    await fs.mkdir(path.join(source, 'src'), { recursive: true });
    await fs.copyFile(path.join(root, 'install.ps1'), path.join(source, 'install.ps1'));
    // Only isolate the path/encoding boundary; no real runtime, credentials or live install.
    await fs.writeFile(path.join(source, 'src', 'cli.ts'), 'process.exit(0);');
    await assert.rejects(execute(powershell, ['-NoProfile', '-File', path.join(source, 'install.ps1'), '-Development', '-BinDirectory', bin], { cwd: scratch, env: nativePowerShellEnvironment(scratch) }), /non-ASCII source path/);
    await assert.rejects(fs.stat(bin), { code: 'ENOENT' });
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('Legacy retirement inventory is read-only and preserves modified/private files', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-v1-retire-')));
  try {
    const profile = path.join(scratch, 'profile');
    await fs.mkdir(path.join(profile, 'neura'), { recursive: true });
    await fs.mkdir(path.join(profile, 'extensions'));
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    await fs.writeFile(path.join(profile, 'extensions', 'neura.ts'), 'owned');
    await fs.writeFile(path.join(profile, 'extensions', 'learn.ts'), 'human changes');
    await fs.writeFile(path.join(profile, 'neura', 'MEMORY.md'), 'synthetic private content');
    await fs.writeFile(path.join(profile, 'neura', '.install-state.json'), JSON.stringify({ schemaVersion: 1, files: {
      'agent/extensions/neura.ts': hash('owned'), 'agent/extensions/learn.ts': hash('old'), 'agent/neura/MEMORY.md': hash('synthetic private content'),
    } }));
    const result = await execute(powershell, ['-NoProfile', '-File', path.join(root, 'scripts/retire-pi-neura.ps1'), '-ProfileRoot', profile], { cwd: root, env: nativePowerShellEnvironment(scratch) });
    assert.match(result.stdout, /Receipt-matched legacy files: 1/);
    assert.match(result.stdout, /modified\/private files preserved: 2/);
    assert.doesNotMatch(result.stdout, /synthetic private content|human changes/);
    assert.equal(await fs.readFile(path.join(profile, 'extensions', 'neura.ts'), 'utf8'), 'owned');
    assert.equal(await fs.readFile(path.join(profile, 'extensions', 'learn.ts'), 'utf8'), 'human changes');
    assert.equal(await fs.readFile(path.join(profile, 'neura', 'MEMORY.md'), 'utf8'), 'synthetic private content');
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});

test('Legacy retirement moves only owned synthetic files, journals recovery, and refuses active processes or linked roots', { skip: process.platform !== 'win32' }, async () => {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'neura-v1-retire-apply-')));
  try {
    const profile = path.join(scratch, 'profile'); const backup = path.join(scratch, 'backup');
    await fs.mkdir(path.join(profile, 'neura'), { recursive: true }); await fs.mkdir(path.join(profile, 'extensions'));
    const owned = path.join(profile, 'extensions', 'neura.ts'); const changed = path.join(profile, 'extensions', 'learn.ts');
    const privateFile = path.join(profile, 'neura', 'MEMORY.md'); const receipt = path.join(profile, 'neura', '.install-state.json');
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    await fs.writeFile(owned, 'owned'); await fs.writeFile(changed, 'human changes'); await fs.writeFile(privateFile, 'synthetic private');
    await fs.writeFile(receipt, JSON.stringify({ schemaVersion: 1, files: {
      'agent/extensions/neura.ts': hash('owned'), 'agent/extensions/learn.ts': hash('old'), 'agent/neura/MEMORY.md': hash('synthetic private'),
    } }));
    // Only this test process mocks process enumeration; production has no bypass or test flag.
    const run = (active: boolean, target = profile) => execute(powershell, ['-NoProfile', '-Command', `function Get-CimInstance { param($ClassName) ${active ? "[pscustomobject]@{ Name='node.exe'; CommandLine='synthetic/pi-coding-agent' }" : '@()'} }; & ${quote(path.join(root, 'scripts/retire-pi-neura.ps1'))} -Apply -ProfileRoot ${quote(target)} -BackupRoot ${quote(backup)}`], { cwd: root, env: nativePowerShellEnvironment(scratch) });
    await assert.rejects(run(true), /Pi agents are active/);
    assert.equal(await fs.readFile(owned, 'utf8'), 'owned'); await assert.rejects(fs.stat(backup));
    const linked = path.join(scratch, 'linked-profile'); await fs.symlink(profile, linked, 'junction');
    await assert.rejects(run(false, linked), /Linked cleanup paths/);
    const applied = await run(false);
    assert.match(applied.stdout, /Retired 1 matched files reversibly/);
    assert.doesNotMatch(applied.stdout, /synthetic private|human changes/);
    await assert.rejects(fs.stat(owned));
    assert.equal(await fs.readFile(path.join(backup, 'agent', 'extensions', 'neura.ts'), 'utf8'), 'owned');
    assert.equal(await fs.readFile(changed, 'utf8'), 'human changes'); assert.equal(await fs.readFile(privateFile, 'utf8'), 'synthetic private');
    const journal = JSON.parse((await fs.readFile(path.join(backup, 'retirement.jsonl'), 'utf8')).trim());
    assert.equal(journal.source, owned); assert.equal(journal.sha256, hash('owned'));
    assert.ok(await fs.stat(path.join(backup, 'legacy-install-receipt.json')));
    await assert.rejects(run(false), /Backup destination must not exist/);
    await fs.writeFile(receipt, JSON.stringify({ schemaVersion: 1, files: { 'agent/neura/../../outside.txt': hash('owned') } }));
    await assert.rejects(run(false), /Unsafe legacy receipt/);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});
