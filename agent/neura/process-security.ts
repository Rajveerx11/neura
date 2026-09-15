import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const INHERITED_ENVIRONMENT = [
  "APPDATA", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA", "PATH", "PATHEXT",
  "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR",
];

export function scopedProcessEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENVIRONMENT) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, ...extra };
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function repositoryBoundary(cwd: string): string {
  let current = fs.realpathSync(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return fs.realpathSync(cwd);
    current = parent;
  }
}

function namedCandidates(command: string): string[] {
  const name = command.toLowerCase().replace(/\.(?:cmd|exe)$/i, "");
  if (process.platform === "win32") {
    if (name === "git") return [
      ...(process.env.NEURA_GIT_EXECUTABLE ? [process.env.NEURA_GIT_EXECUTABLE] : []),
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\bin\\git.exe",
    ];
    return [];
  }
  if (name === "git") return ["/usr/bin/git", "/usr/local/bin/git"];
  return [];
}

function expectedWindowsGit(): { version: string; sha256: string } | null {
  try {
    const file = fileURLToPath(new URL("./runtime-contract.json", import.meta.url));
    const contract = JSON.parse(fs.readFileSync(file, "utf8"));
    const version = contract?.automaticExecutables?.git?.windowsVersion;
    const sha256 = contract?.automaticExecutables?.git?.windowsSha256;
    return typeof version === "string" && /^[a-f0-9]{64}$/.test(sha256) ? { version, sha256 } : null;
  } catch { return null; }
}

function trustedIdentity(command: string, executable: string): boolean {
  if (process.platform !== "win32" || command.toLowerCase().replace(/\.(?:cmd|exe)$/i, "") !== "git") return true;
  const expected = expectedWindowsGit();
  if (!expected) return false;
  const hash = createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
  if (hash !== expected.sha256) return false;
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8", env: scopedProcessEnvironment(), timeout: 3_000, windowsHide: true,
  });
  return result.status === 0 && String(result.stdout).trim() === expected.version;
}

export function resolveExecutable(command: string, cwd = process.cwd()): string | null {
  const boundary = repositoryBoundary(cwd);
  if (path.isAbsolute(command)) {
    try {
      const candidate = fs.realpathSync(command);
      return fs.statSync(candidate).isFile()
        && !inside(boundary, path.resolve(command)) && !inside(boundary, candidate) ? candidate : null;
    } catch { return null; }
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(command)) return null;
  for (const candidate of namedCandidates(command)) {
    try {
      const canonical = fs.realpathSync(candidate);
      if (fs.statSync(canonical).isFile() && !inside(boundary, path.resolve(candidate))
        && !inside(boundary, canonical) && trustedIdentity(command, canonical)) return canonical;
    } catch {}
  }
  return null;
}

// Git for Windows translates `/dev/null`; Win32's `\\.\nul` is rejected by Git config loading.
const nullDevice = "/dev/null";

export const AUTOMATIC_GIT_ARGUMENTS = [
  "--no-pager", "--no-optional-locks", "--no-lazy-fetch",
  "-c", "core.fsmonitor=false",
  "-c", `core.hooksPath=${nullDevice}`,
  "-c", `core.attributesFile=${nullDevice}`,
  "-c", `core.excludesFile=${nullDevice}`,
  "-c", "credential.helper=",
  "-c", "core.askPass=",
  "-c", "log.showSignature=false",
  "-c", "log.mailmap=false",
] as const;

export function automaticGitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return scopedProcessEnvironment({
    GIT_ASKPASS: "",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: nullDevice,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    SSH_ASKPASS: "",
    ...extra,
  });
}
