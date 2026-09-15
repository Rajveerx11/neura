import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { isolate } from './isolation.mjs';
const scratchRoot = isolate();
const repoRoot = path.resolve(import.meta.dirname, '../..');
const { parseRuntimeContract } = await import('../../agent/extensions/harness-health.ts');
const files = fs.readdirSync(path.join(repoRoot, 'agent/extensions'));
assert.equal(files.some((file) => file === "autogit.ts"), false, "retired autogit extension still loads");
const installerSource = fs.readFileSync(path.join(repoRoot, "install.ps1"), "utf-8");
const artworkPath = path.join(repoRoot, "agent", "neura", "launch-artwork.png");
const runtimeContract = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "runtime-contract.json"), "utf-8"));
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
assert.match(installerSource, /\$retiredExtensions\s*=\s*@\("autogit\.ts"\)/, "installer does not retire the old autogit hook");
assert.match(installerSource, /Remove-Item -LiteralPath \$retiredPath -Force/, "installer does not remove the retired autogit hook");
assert.match(installerSource, /is retired but remains installed/, "drift check does not detect the retired autogit hook");
assert.match(installerSource, /function Get-PackageIdentity/, "installer cannot reconcile exact runtime package pins");
assert.match(installerSource, /runtime package is not exactly pinned/, "drift check ignores runtime package pins");
assert.match(installerSource, /runtime-contract\.json/, "installer does not consume the runtime contract");
assert.match(installerSource, /scripts\\check-proof-runtime\.mjs/, "installer does not validate the WSL proof runtime");
assert.match(installerSource, /\$capabilityWarnings \+= "WSL proof runtime unavailable/, "missing optional proof runtime is not reported");
assert.doesNotMatch(installerSource, /\$drift \+= "WSL proof runtime unavailable/, "missing optional proof runtime still fails live drift checks");
assert.doesNotMatch(installerSource, /@\("pi", "git", "uvx"\)/, "installer still requires ambient Windows uvx");
assert.match(installerSource, /function Get-NeuraTerminalFragment/, "installer cannot create the Windows Terminal profile");
assert.match(installerSource, /Windows Terminal\\Fragments\\Neura/, "installer does not isolate the Windows Terminal fragment");
assert.match(installerSource, /launch-artwork\.png/, "installer does not connect the bundled launch artwork");
assert.match(installerSource, /backgroundImageStretchMode = "uniform"/, "installer can distort launch artwork");
assert.match(installerSource, /Start Menu\\Programs\\Neura\.lnk/, "installer does not create the single-window Neura shortcut");
assert.match(installerSource, /Arguments = "-w new -p Neura"/, "Neura shortcut does not launch the image profile directly");
assert.equal(createHash("sha256").update(fs.readFileSync(artworkPath)).digest("hex"), "6f7f01d54fe31eb1b8ba0f07542158eac2fc9a4a0320c5071a591952bcc7c244", "launch artwork changed without provenance update");
assert.doesNotMatch(installerSource, /C:\\Users\\rajve/i, "installer contains a machine-specific artwork path");
assert.match(installerSource, /\$requiredPiVersion\s*=\s*\[string\]\$runtimeContract\.piVersion/, "installer does not enforce the runtime contract Pi version");
assert.match(installerSource, /\$schemaIsInteger\s*=\s*\(\$runtimeContract\.schemaVersion -is \[int\]\) -or \(\$runtimeContract\.schemaVersion -is \[long\]\)/, "installer allows a coercible non-integer runtime contract schema");
assert.equal(runtimeContract.schemaVersion, 1, "runtime contract schema version changed without migration");
assert.equal(runtimeContract.piVersion, packageManifest.devDependencies["@earendil-works/pi-coding-agent"], "runtime contract and development Pi pin disagree");
assert.equal(parseRuntimeContract(runtimeContract), runtimeContract.piVersion, "valid runtime contract was rejected");
assert.equal(parseRuntimeContract({ schemaVersion: "1", piVersion: runtimeContract.piVersion }), null, "string runtime contract schema was coerced");

console.log('PASS installer contract');

const shell = process.platform === 'win32'
  ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
// Supply only the shell's own modules and a writable synthetic cache. Avoid
// cold module discovery through user/Program Files locations on hosted Windows.
const shellEnv = { ...process.env,
  APPDATA: path.join(scratchRoot, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(scratchRoot, 'AppData', 'Local'),
  PSModuleAnalysisCachePath: path.join(scratchRoot, 'powershell-module-cache'),
  POWERSHELL_UPDATECHECK: 'Off', POWERSHELL_TELEMETRY_OPTOUT: '1',
};
for (const key of ['APPDATA', 'LOCALAPPDATA']) fs.mkdirSync(shellEnv[key], { recursive: true });
if (process.platform === 'win32') shellEnv.PSModulePath = path.join(path.dirname(shell), 'Modules');
// Windows PowerShell's first startup on a hosted VM can exceed 15 seconds.
// No prompts/profile scripts; retain a bounded cold-start allowance.
const functions = spawnSync(shell, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'installer-functions.ps1'),'-Source',path.join(repoRoot,'install.ps1'),'-Scratch',scratchRoot], {env:shellEnv,encoding:'utf8',windowsHide:true,timeout:60000});
assert.equal(functions.status,0, `Installer function verification failed (${functions.error?.code ?? functions.signal ?? functions.status}):\n${functions.stdout}\n${functions.stderr}`);
console.log(functions.stdout.trim());
