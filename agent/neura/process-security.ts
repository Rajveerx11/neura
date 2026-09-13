import * as fs from "node:fs";
import * as path from "node:path";

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

export function resolveExecutable(command: string, cwd = process.cwd()): string | null {
  const boundary = repositoryBoundary(cwd);
  if (path.isAbsolute(command)) {
    try {
      const candidate = fs.realpathSync(command);
      return fs.statSync(candidate).isFile() && !inside(boundary, candidate) ? candidate : null;
    } catch { return null; }
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(command)) return null;
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" && path.extname(command) ? command : command + extension.toLowerCase());
      try {
        const canonical = fs.realpathSync(candidate);
        if (fs.statSync(canonical).isFile() && !inside(boundary, canonical)) return canonical;
      } catch {}
    }
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
