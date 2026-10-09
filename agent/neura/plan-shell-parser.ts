import { SECRET_PATH } from "./action-paths.ts";
// Syntax and explicit filesystem arguments only; containment and authorization
// remain in action-policy. Never execute commands parsed here.
export function shellTokens(command: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let started = false;

  for (const character of command) {
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) return null;
  if (started) tokens.push(token);
  return tokens;
}

export function hasUnquotedPowerShellOperator(command: string): boolean {
  let quote = "";
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "+" || /[\u2010-\u2015\u2212]/.test(character)) return true;
  }
  return false;
}

export function hasUnquotedPowerShellExpansion(command: string): boolean {
  let quote = "";
  let tokenStart = true;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStart = false;
    } else if (/\s/.test(character)) {
      tokenStart = true;
    } else {
      if (character === ",") return true;
      if (tokenStart && character === "@" && /[A-Za-z_({]/.test(command[index + 1] ?? "")) return true;
      tokenStart = false;
    }
  }
  return false;
}

function attachedOptionValue(argument: string, option: string): string | null {
  const lower = argument.toLowerCase();
  const normalizedOption = option.toLowerCase();
  for (const separator of ["=", ":"]) {
    const prefix = `${normalizedOption}${separator}`;
    if (lower.startsWith(prefix)) return argument.slice(prefix.length);
  }
  return null;
}

const POWERSHELL_ARGUMENTS = {
  "get-childitem": {
    flags: ["-directory", "-file", "-force", "-hidden", "-name", "-readonly", "-recurse", "-system"],
    values: ["-attributes", "-depth", "-exclude", "-filter", "-include"],
    pathValues: ["-path", "-literalpath"],
  },
  "get-content": {
    flags: ["-force", "-raw", "-wait"],
    values: ["-delimiter", "-encoding", "-readcount", "-stream", "-tail", "-totalcount"],
    pathValues: ["-path", "-literalpath"],
  },
  "get-item": {
    flags: ["-force"],
    values: ["-exclude", "-filter", "-include"],
    pathValues: ["-path", "-literalpath"],
  },
  "resolve-path": {
    flags: ["-relative"],
    values: [],
    pathValues: ["-path", "-literalpath", "-relativebasepath"],
  },
  "select-string": {
    flags: ["-allmatches", "-casesensitive", "-list", "-noemphasis", "-notmatch", "-quiet", "-raw", "-simplematch"],
    values: ["-context", "-culture", "-encoding"],
    pathValues: ["-path"],
  },
  "test-path": {
    flags: ["-isvalid"],
    values: ["-olderthan", "-newerthan", "-pathtype"],
    pathValues: ["-path", "-literalpath"],
  },
} as const;

function splitOption(argument: string): { name: string; attached: string | null } {
  const separator = argument.search(/[:=]/);
  return separator === -1
    ? { name: argument.toLowerCase(), attached: null }
    : { name: argument.slice(0, separator).toLowerCase(), attached: argument.slice(separator + 1) };
}

function ambiguousPowerShellArgument(argument: string): boolean {
  return argument === "--%";
}

function powershellFilesystemArguments(command: string, args: string[]): string[] | null {
  if (command === "measure-object") return args.length === 0 ? [] : null;
  const normalizedCommand = command === "ls" ? "get-childitem" : command;
  const spec = POWERSHELL_ARGUMENTS[normalizedCommand as keyof typeof POWERSHELL_ARGUMENTS];
  if (!spec) return null;

  const flags = new Set<string>(spec.flags);
  const values = new Set<string>(spec.values);
  const pathValues = new Set<string>(spec.pathValues);
  const paths: string[] = [];
  let patternSupplied = normalizedCommand !== "select-string";
  let options = true;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    // Commas form PowerShell arrays before cmdlet binding. Splatting and the
    // stop-parsing token also make literal argument recovery ambiguous.
    if (ambiguousPowerShellArgument(argument)) return null;
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument.startsWith("-")) {
      const { name, attached } = splitOption(argument);
      if (pathValues.has(name)) {
        const pathArgument = attached ?? args[++index];
        if (!pathArgument || ambiguousPowerShellArgument(pathArgument)) return null;
        paths.push(pathArgument);
      } else if (normalizedCommand === "select-string" && name === "-pattern") {
        const pattern = attached ?? args[++index];
        if (pattern === undefined || ambiguousPowerShellArgument(pattern)) return null;
        patternSupplied = true;
      } else if (flags.has(name)) {
        if (attached !== null) return null;
      } else if (values.has(name)) {
        const value = attached ?? args[++index];
        if (value === undefined || ambiguousPowerShellArgument(value)) return null;
      } else {
        // PowerShell accepts abbreviated parameter names, but resolving those
        // safely would require the full PowerShell binder. Exact names only.
        return null;
      }
      continue;
    }
    if (!patternSupplied) patternSupplied = true;
    else paths.push(argument);
  }
  return patternSupplied ? paths : null;
}

const RG_FLAGS = new Set([
  "--all", "--block-buffered", "--byte-offset", "--case-sensitive", "--column",
  "--count", "--count-matches", "--crlf", "--debug", "--files", "--files-with-matches",
  "--files-without-match", "--fixed-strings", "--heading", "--hidden", "--ignore-case",
  "--include-zero", "--invert-match", "--json", "--line-buffered", "--line-number",
  "--messages", "--mmap", "--multiline", "--multiline-dotall", "--no-config", "--no-filename",
  "--no-heading", "--no-ignore", "--no-ignore-dot", "--no-ignore-exclude", "--no-ignore-files",
  "--no-ignore-global", "--no-ignore-messages", "--no-ignore-parent", "--no-ignore-vcs", "--no-line-number",
  "--no-messages", "--no-mmap", "--no-require-git", "--null", "--null-data", "--one-file-system",
  "--only-matching", "--passthru", "--pcre2", "--pcre2-unicode", "--pretty", "--quiet",
  "--smart-case", "--stats", "--stop-on-nonmatch", "--text", "--trim", "--type-list",
  "--unrestricted", "--version", "--vimgrep", "--with-filename", "--word-regexp", "--line-regexp",
  "-0", "-a", "-b", "-c", "-f", "-h", "-i", "-j", "-l", "-m", "-n", "-o", "-p", "-q",
  "-s", "-u", "-v", "-w", "-x",
]);
const RG_VALUE_OPTIONS = new Set([
  "--after-context", "--before-context", "--color", "--colors", "--context", "--context-separator",
  "--dfa-size-limit", "--encoding", "--engine", "--field-context-separator", "--field-match-separator",
  "--glob", "--iglob", "--max-columns", "--max-count", "--max-depth", "--max-filesize",
  "--path-separator", "--regex-size-limit", "--replace", "--sort", "--sortr", "--type", "--type-add",
  "--type-clear", "-A", "-B", "-C", "-E", "-g", "-M", "-m", "-r", "-t", "-T",
]);
const RG_PATTERN_OPTIONS = new Set(["--regexp", "-e"]);
const RG_PATH_OPTIONS = new Set(["--file", "--ignore-file", "-f"]);

function ripgrepFilesystemArguments(args: string[]): string[] | null {
  const paths: string[] = [];
  let patternSupplied = false;
  let filesMode = false;
  let options = true;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument.startsWith("-")) {
      if (/^(?:-L|--follow)$/.test(argument)) return null;
      const equals = argument.indexOf("=");
      const option = equals === -1 ? argument : argument.slice(0, equals);
      const attached = equals === -1 ? null : argument.slice(equals + 1);
      if (RG_PATH_OPTIONS.has(option)) {
        const value = attached ?? args[++index];
        if (!value) return null;
        paths.push(value);
        patternSupplied = true;
      } else if (RG_PATTERN_OPTIONS.has(option)) {
        const value = attached ?? args[++index];
        if (value === undefined) return null;
        patternSupplied = true;
      } else if (RG_VALUE_OPTIONS.has(option)) {
        const value = attached ?? args[++index];
        if (value === undefined) return null;
      } else if (RG_FLAGS.has(argument)) {
        filesMode ||= argument === "--files";
      } else if (/^-[egftT].+/.test(argument)) {
        const shortOption = argument.slice(0, 2);
        const value = argument.slice(2);
        if (RG_PATH_OPTIONS.has(shortOption)) {
          paths.push(value);
          patternSupplied = true;
        } else if (RG_PATTERN_OPTIONS.has(shortOption)) patternSupplied = true;
      } else {
        return null;
      }
      continue;
    }
    if (!filesMode && !patternSupplied) patternSupplied = true;
    else paths.push(argument);
  }
  return filesMode || patternSupplied ? paths : null;
}

// Read-only Git commands can still launch configured pagers, filesystem monitors,
// hooks, signature verification, diff/text converters, or worktree filters. Keep
// global hardening exact; subcommand parsers admit only object/ref/index reads.
const PLAN_GIT_PREFIX = Object.freeze([
  "--no-pager",
  "--no-optional-locks",
  "--no-lazy-fetch",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "log.showSignature=false",
  "-c", "log.mailmap=false",
  "-c", "format.pretty=medium",
]);

function isSafeGitRefAtom(value: string): boolean {
  let candidate = value;
  while (true) {
    const suffix = /(?:\^\{(?:commit|tree|tag|object)\}|@\{\d+\}|~\d*|\^\d*)$/.exec(candidate);
    if (!suffix) break;
    candidate = candidate.slice(0, -suffix[0].length);
  }
  if (/^(?:HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD)$/.test(candidate)) return true;
  if (/^[0-9a-f]{4,64}$/i.test(candidate)) return true;
  if (!candidate.startsWith("refs/") || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(candidate)) return false;
  return !candidate.includes("..")
    && !candidate.includes("//")
    && !candidate.endsWith("/")
    && !candidate.endsWith(".")
    && candidate.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"));
}

function isSafeGitRevision(value: string, allowExclusion = false): boolean {
  if (allowExclusion && value.startsWith("^")) return isSafeGitRefAtom(value.slice(1));
  const range = /^(.*?)(\.\.\.?)(.*?)$/.exec(value);
  if (range) return isSafeGitRefAtom(range[1]) && isSafeGitRefAtom(range[3]);
  return isSafeGitRefAtom(value);
}

function isSafeGitTreePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\") || /[\0:*?\[\]{}]/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..")
    && !SECRET_PATH.test(`/${value}`);
}

function isSafeGitObject(value: string): boolean {
  const separator = value.indexOf(":");
  return separator === -1
    ? isSafeGitRevision(value)
    : isSafeGitRevision(value.slice(0, separator)) && isSafeGitTreePath(value.slice(separator + 1));
}

function gitDiffFilesystemArguments(args: string[]): string[] | null {
  const flags = new Set([
    "--no-ext-diff", "--no-textconv", "--cached", "--staged", "--merge-base",
    "--stat", "--numstat", "--shortstat", "--summary", "--name-only", "--name-status",
    "--check", "--raw", "--patch", "-p", "-u", "--no-patch", "-s", "--full-index",
    "--binary", "--minimal", "--patience", "--histogram", "--ignore-space-at-eol",
    "--ignore-space-change", "-b", "--ignore-all-space", "-w", "--ignore-blank-lines",
    "--exit-code", "--quiet", "--find-renames", "--find-copies", "--no-renames",
  ]);
  const paths: string[] = [];
  let options = true;
  let externalDiffDisabled = false;
  let textConversionDisabled = false;
  let staged = false;
  let separatorSupplied = false;
  const revisions: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (options && argument === "--") {
      options = false;
      separatorSupplied = true;
      continue;
    }
    if (!options) {
      paths.push(argument);
      continue;
    }
    if (!argument.startsWith("-")) {
      if (!isSafeGitRevision(argument)) return null;
      revisions.push(argument);
      continue;
    }
    if (argument === "--no-ext-diff") externalDiffDisabled = true;
    if (argument === "--no-textconv") textConversionDisabled = true;
    if (argument === "--cached" || argument === "--staged") staged = true;
    if (flags.has(argument)
      || /^--abbrev(?:=\d+)?$/.test(argument)
      || /^--unified(?:=\d+)?$/.test(argument)
      || /^-U\d+$/.test(argument)
      || /^--inter-hunk-context=\d+$/.test(argument)
      || /^--diff-algorithm=(?:myers|minimal|patience|histogram)$/.test(argument)
      || /^--find-renames=\d+%?$/.test(argument)
      || /^--find-copies=\d+%?$/.test(argument)
      || /^-[MC]\d*%?$/.test(argument)
      || /^--diff-filter=[ACDMRTUXB*]+$/i.test(argument)
      || /^--color=(?:always|never|auto)$/.test(argument)
      || /^--word-diff(?:=(?:color|plain|porcelain|none))?$/.test(argument)) {
      continue;
    }
    if (argument === "--word-diff-regex") {
      if (args[++index] === undefined) return null;
      continue;
    }
    return null;
  }
  const rangeComparison = revisions.length === 1 && /\.\.\.?/.test(revisions[0]);
  const safeInputs = staged ? revisions.length <= 1 && !rangeComparison : rangeComparison && separatorSupplied;
  return externalDiffDisabled && textConversionDisabled && safeInputs ? paths : null;
}

function gitHistoryFilesystemArguments(args: string[], showObjects: boolean): string[] | null {
  const flags = new Set([
    "--no-ext-diff", "--no-textconv", "--oneline", "--stat", "--numstat", "--shortstat",
    "--summary", "--name-only", "--name-status", "--raw", "--patch", "-p", "--no-patch",
    "-s", "--full-diff", "--no-merges", "--merges", "--first-parent", "--reverse", "--graph",
    "--decorate", "--no-decorate", "--source", "--no-source", "--date-order", "--author-date-order",
    "--topo-order", "--all", "--branches", "--tags", "--remotes", "--no-use-mailmap",
  ]);
  const valueOptions = new Set(["--max-count", "-n", "--skip", "--since", "--after", "--until", "--before", "--author", "--committer", "--grep"]);
  const paths: string[] = [];
  let options = true;
  let externalDiffDisabled = false;
  let textConversionDisabled = false;
  let mailmapDisabled = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (!options) {
      paths.push(argument);
      continue;
    }
    if (!argument.startsWith("-")) {
      if (!(showObjects ? isSafeGitObject(argument) : isSafeGitRevision(argument, true))) return null;
      continue;
    }
    if (argument === "--no-ext-diff") externalDiffDisabled = true;
    if (argument === "--no-textconv") textConversionDisabled = true;
    if (argument === "--no-use-mailmap") mailmapDisabled = true;
    if (flags.has(argument)
      || /^-\d+$/.test(argument)
      || /^--max-count=\d+$/.test(argument)
      || /^--skip=\d+$/.test(argument)
      || /^--decorate=(?:short|full|auto|no)$/.test(argument)
      || /^--date=(?:relative|local|iso|iso-strict|rfc|short|raw|human|unix)$/.test(argument)
      || /^--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw)$/.test(argument)) {
      continue;
    }
    if (valueOptions.has(argument)) {
      const value = args[++index];
      if (value === undefined || ((argument === "--max-count" || argument === "-n" || argument === "--skip") && !/^\d+$/.test(value))) return null;
      continue;
    }
    return null;
  }
  return externalDiffDisabled && textConversionDisabled && mailmapDisabled ? paths : null;
}

function gitFilesystemArguments(args: string[]): string[] | null {
  if (!PLAN_GIT_PREFIX.every((argument, index) => args[index] === argument)) return null;
  const subcommand = args[PLAN_GIT_PREFIX.length]?.toLowerCase();
  if (!subcommand) return null;
  const commandArgs = args.slice(PLAN_GIT_PREFIX.length + 1);
  if (subcommand === "branch") {
    return commandArgs.every((argument) => /^(?:--show-current|-a|-r|--all|--remotes)$/.test(argument)) ? [] : null;
  }
  if (subcommand === "rev-parse") {
    const paths: string[] = [];
    for (let index = 0; index < commandArgs.length; index++) {
      const argument = commandArgs[index];
      const attached = attachedOptionValue(argument, "--resolve-git-dir");
      if (attached !== null) {
        if (!attached) return null;
        paths.push(attached);
      } else if (argument === "--resolve-git-dir") {
        const pathArgument = commandArgs[++index];
        if (!pathArgument) return null;
        paths.push(pathArgument);
      } else if (/^(?:--show-toplevel|--show-prefix|--show-cdup|--git-dir|--absolute-git-dir|--is-inside-git-dir|--is-inside-work-tree|--is-bare-repository|--is-shallow-repository|--show-superproject-working-tree|--verify|--quiet|-q|--revs-only|--no-revs|--flags|--no-flags|--symbolic|--symbolic-full-name)$/.test(argument)
        || /^--short(?:=\d+)?$/.test(argument)
        || /^--abbrev-ref(?:=(?:strict|loose))?$/.test(argument)
        || /^--path-format=(?:absolute|relative)$/.test(argument)) {
        continue;
      } else if (!argument.startsWith("-")) {
        if (!isSafeGitRevision(argument)) return null;
      } else {
        return null;
      }
    }
    return paths;
  }
  if (subcommand === "status") return null;
  if (subcommand === "diff") return gitDiffFilesystemArguments(commandArgs);
  if (subcommand === "log" || subcommand === "show") return gitHistoryFilesystemArguments(commandArgs, subcommand === "show");
  if (subcommand !== "ls-files") return null;

  const separator = commandArgs.indexOf("--");
  const paths = separator === -1 ? [] : commandArgs.slice(separator + 1);
  const options = separator === -1 ? commandArgs : commandArgs.slice(0, separator);
  for (const argument of options) {
    if (/^(?:-z|-t|-v|-f|-c|--cached|-s|--stage|-u|--unmerged|--resolve-undo|--full-name|--error-unmatch|--deduplicate|--sparse)$/.test(argument)) {
      continue;
    } else if (!argument.startsWith("-")) {
      paths.push(argument);
    } else {
      return null;
    }
  }
  return paths;
}

export function planShellFilesystemArguments(tokens: string[]): string[] | null {
  const command = tokens[0]?.toLowerCase();
  const args = tokens.slice(1);
  if (!command) return null;
  if (command === "pwd" || command === "get-location") return args.length === 0 ? [] : null;
  if (["ls", "get-childitem", "get-item", "get-content", "select-string", "resolve-path", "test-path", "measure-object"].includes(command)) {
    return powershellFilesystemArguments(command, args);
  }
  if (command === "rg") return ripgrepFilesystemArguments(args);
  if (command === "git") return gitFilesystemArguments(args);
  return null;
}
