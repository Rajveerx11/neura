import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { learnPathInside, realLearnDirectory, writeLearnExclusive } from "../../agent/neura/learn-files.ts";

const profilePath = path.join(os.homedir(), ".pi", "agent", "neura", "learn-vault.json");
const nanoCandidates = [
  "C:\\Program Files\\Git\\usr\\bin\\nano.exe",
  "C:\\Program Files (x86)\\Git\\usr\\bin\\nano.exe",
  "nano",
];
const nano = nanoCandidates.find((candidate) => candidate === "nano" || fs.existsSync(candidate));

function clear() { process.stdout.write("\x1b[2J\x1b[H"); }
function fail(message) { console.error(`\n${message}`); process.exitCode = 1; }

export async function loadVault(profile = profilePath) {
  const config = JSON.parse(fs.readFileSync(profile, "utf8"));
  const supplied = config?.vault;
  if (typeof supplied !== "string" || !path.isAbsolute(supplied) || /^[\\/]{2}/.test(supplied)) {
    throw new Error("Obsidian vault must be an absolute local path, not a UNC/device path.");
  }
  const vault = await realLearnDirectory(supplied);
  const marker = await realLearnDirectory(path.join(vault, ".obsidian"));
  if (path.dirname(marker) !== vault) throw new Error("Obsidian marker escaped the vault.");
  return vault;
}

// Never pass a linked file or a path through a linked directory to an external editor.
export async function checkedNote(root, file) {
  if (!learnPathInside(root, file) || file === root || path.extname(file).toLowerCase() !== ".md") throw new Error("Note escaped the vault.");
  let directory = root;
  for (const component of path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean)) {
    directory = path.join(directory, component);
    const canonical = await realLearnDirectory(directory);
    if (!learnPathInside(root, canonical)) throw new Error("Note directory escaped the vault.");
  }
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !learnPathInside(root, fs.realpathSync(file))) {
    throw new Error("Note must be an unlinked regular file inside the vault.");
  }
  return file;
}

export function collectNotes(root) {
  const notes = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".obsidian" || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Windows junctions normally report as links; also reject any other redirected directory.
        if (fs.realpathSync(full) === full) visit(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const stat = fs.statSync(full);
        if (stat.nlink === 1 && fs.realpathSync(full) === full) notes.push({ full, relative: path.relative(root, full), modified: stat.mtimeMs });
      }
    }
  };
  visit(root);
  return notes.sort((a, b) => b.modified - a.modified);
}

export function safeTitle(value) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").slice(0, 100);
}

export async function createNote(root, title) {
  const name = safeTitle(title);
  if (!name || name === "." || name === "..") throw new Error("Invalid note title.");
  const folder = path.join(root, "Herdr Notes");
  fs.mkdirSync(folder, { recursive: true });
  const canonical = await realLearnDirectory(folder);
  if (path.dirname(canonical) !== root) throw new Error("Note folder escaped the vault.");
  const file = path.join(canonical, `${name}.md`);
  try { await writeLearnExclusive(canonical, `${name}.md`, `# ${name}\n\n`); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  return checkedNote(root, file);
}

function isExecutable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

// Resolve only when preview is requested. Never run a shell, picker, watcher,
// history/config command, or a Windows executable from the Linux Notes pane.
export function leafExecutable({ platform = process.platform, env = process.env, home = os.homedir(), executable = isExecutable } = {}) {
  const windows = platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  // A Windows root without a drive/share (\\Tools or /Tools) is drive-relative.
  const absolute = (file) => paths.isAbsolute(file) && (!windows || !/^[\\/]+$/.test(paths.parse(file).root));
  const searchPath = windows ? Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] : env.PATH;
  const candidates = (searchPath || "").split(paths.delimiter)
    .filter(absolute)
    .map((directory) => paths.join(directory, windows ? "leaf.exe" : "leaf"));
  candidates.push(windows
    ? paths.join(env.LOCALAPPDATA || paths.join(home, "AppData", "Local"), "Programs", "leaf", "leaf.exe")
    : paths.join(home, ".local", "bin", "leaf"));
  return candidates.find((candidate) => absolute(candidate) && executable(candidate));
}

export async function previewNote(root, file, { run = spawnSync, ...discovery } = {}) {
  const note = await checkedNote(root, file);
  const leaf = leafExecutable(discovery);
  if (!leaf) throw new Error("Leaf is unavailable. Install Leaf or add it to PATH (Windows: %LOCALAPPDATA%\\Programs\\leaf\\leaf.exe; Linux: ~/.local/bin/leaf).");
  const result = run(leaf, [note], { stdio: "inherit", windowsHide: true, shell: false });
  if (result.error) throw new Error(`Leaf preview could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Leaf preview failed (${result.signal ? `signal ${result.signal}` : `exit ${result.status}`}).`);
}

export async function editNote(root, file, { run = spawnSync, editor = nano } = {}) {
  if (!editor) throw new Error("GNU nano is unavailable. Install Git for Windows or add nano to PATH.");
  const result = run(editor, [await checkedNote(root, file)], { stdio: "inherit", windowsHide: true, shell: false });
  if (result.error) throw result.error;
}

export function noteSelection(answer, visible) {
  const match = /^([rv]?)(\d+)$/i.exec(answer);
  if (!match) return undefined;
  const note = visible[Number(match[2]) - 1];
  return note ? { note, preview: Boolean(match[1]) } : undefined;
}

export async function recoverNoteAction(action, { report = console.error, pause }) {
  try {
    await action();
    return true;
  } catch (error) {
    report(`\n${error instanceof Error ? error.message : String(error)}`);
    await pause("Press Enter to return to Notes.");
    return false;
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const recover = (action) => recoverNoteAction(action, { pause: (message) => rl.question(message) });
  try {
    const vault = await loadVault();
    let filter = "";
    while (true) {
      clear();
      const all = collectNotes(vault);
      const visible = all.filter((note) => note.relative.toLowerCase().includes(filter.toLowerCase())).slice(0, 40);
      console.log(" NEURA / OBSIDIAN NOTES");
      console.log(` Live vault: ${vault}`);
      console.log(" Select a note to edit with GNU nano or preview Markdown with Leaf in this pane.");
      console.log(" Nano: Ctrl+O save | Enter confirm | Ctrl+X close editor. Close Leaf to return.\n");
      visible.forEach((note, index) => {
        const stamp = new Date(note.modified).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        console.log(`${String(index + 1).padStart(2)}  ${note.relative}  [${stamp}]`);
      });
      if (!visible.length) console.log("No matching Markdown notes.");
      console.log("\n[number] edit | r[number]/v[number] Leaf preview | /text filter | n new note | r refresh | q close pane");
      const answer = (await rl.question("> ")).trim();
      if (/^(q|quit)$/i.test(answer)) break;
      if (/^(r|refresh)$/i.test(answer)) { filter = ""; continue; }
      if (answer.startsWith("/")) { filter = answer.slice(1).trim(); continue; }
      if (/^(n|new)$/i.test(answer)) {
        const title = await rl.question("Note title: ");
        if (!safeTitle(title)) continue;
        await recover(async () => editNote(vault, await createNote(vault, title)));
        continue;
      }
      const selected = noteSelection(answer, visible);
      if (selected?.preview) {
        await recover(() => previewNote(vault, selected.note.full));
      } else if (selected) {
        await recover(() => editNote(vault, selected.note.full));
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    await rl.question("Press Enter to close.");
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
