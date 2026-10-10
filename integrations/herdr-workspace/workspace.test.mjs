import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadVault, checkedNote, collectNotes, createNote, leafExecutable, previewNote, editNote, noteSelection } from "./notes.mjs";
import { paneArgs, launchPane } from "./open-pane.mjs";
import { calendarCommands, calendarEditArgs, calendarExecutable, calendarMenuArgs, calendarRun } from "./calendar.mjs";

test("Workspace manifest declares the pane actions without requiring a live plugin link", () => {
  const manifest = path.join(import.meta.dirname, "herdr-plugin.toml");
  const source = fs.readFileSync(manifest, "utf8");
  assert.match(source, /^id = "neura\.workspace"$/m);
  assert.deepEqual([...source.matchAll(/^\[\[actions\]\]\s*\nid = "([^"]+)"/gm)].map((match) => match[1]).sort(), ["open-calendar", "open-notes"]);
  assert.deepEqual([...source.matchAll(/^\[\[panes\]\]\s*\nid = "([^"]+)"/gm)].map((match) => match[1]).sort(), ["calendar", "notes"]);
  assert.equal((source.match(/^placement = "split"$/gm) || []).length, 2);
});

test("right split focuses the requested pane and prefers caller pane over workspace", () => {
  assert.deepEqual(paneArgs("notes", { HERDR_PANE_ID: "w12:p2", HERDR_WORKSPACE_ID: "w12" }),
    ["plugin", "pane", "open", "--plugin", "neura.workspace", "--entrypoint", "notes", "--placement", "split", "--direction", "right", "--focus", "--target-pane", "w12:p2"]);
  assert.ok(paneArgs("calendar", { HERDR_PLUGIN_CONTEXT_JSON: '{"workspace_id":"w12"}' }).join(" ").endsWith("--workspace w12"));
  assert.throws(() => paneArgs("../../evil", {}));
  let invocation;
  assert.equal(launchPane("calendar", { HERDR_BIN_PATH: "test-herdr", HERDR_PANE_ID: "w12:p2" }, (...args) => {
    invocation = args;
    return { status: 0 };
  }), 0);
  assert.equal(invocation[0], "test-herdr");
  assert.ok(invocation[1].join(" ").includes("--direction right --focus --target-pane w12:p2"));
  assert.deepEqual(invocation[2], { stdio: "inherit", windowsHide: true });
});

test("Calendar requires an explicit absolute executable with matching SHA-256", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neura-calendar-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "gcalcli.exe");
  fs.writeFileSync(file, "synthetic-only");
  const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(calendarExecutable({}), undefined);
  assert.equal(calendarExecutable({ NEURA_GCALCLI_EXECUTABLE: "gcalcli", NEURA_GCALCLI_SHA256: digest }), undefined);
  assert.equal(calendarExecutable({ NEURA_GCALCLI_EXECUTABLE: file, NEURA_GCALCLI_SHA256: "0".repeat(64) }), undefined);
  assert.equal(calendarExecutable({ NEURA_GCALCLI_EXECUTABLE: file, NEURA_GCALCLI_SHA256: digest }), file);
});

test("Calendar invokes only the selected executable and refuses unavailable commands", () => {
  assert.throws(() => calendarRun(["list"], null), /Calendar executable changed or is unavailable/);
  assert.equal(calendarRun(["--version"], process.execPath), 0);
});

test("calendar command arguments remain fixed except the edit search text", () => {
  assert.deepEqual(calendarCommands["1"], ["--lineart", "unicode", "calm"]);
  assert.deepEqual(calendarCommands["2"], ["--lineart", "unicode", "calw", "today", "2"]);
  assert.deepEqual(calendarCommands["3"], ["agenda", "today", "+14d", "--details", "calendar", "--details", "location"]);
  assert.deepEqual(calendarCommands["4"], ["add"]);
  assert.deepEqual(calendarCommands["6"], ["list"]);
  assert.deepEqual(calendarCommands.a, ["init"]);
  assert.deepEqual(calendarEditArgs('hello & whoami'), ["edit", 'hello & whoami']);
  assert.deepEqual(calendarMenuArgs("1"), calendarCommands["1"]);
  assert.equal(calendarMenuArgs("constructor"), undefined);
  assert.equal(calendarMenuArgs("toString"), undefined);
});

test("vault refuses UNC and junctions; picker and creation stay inside the canonical vault", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "neura-herdr-test-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const vault = path.join(base, "vault");
  const outside = path.join(base, "outside");
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.mkdirSync(outside);
  const profile = path.join(base, "profile.json");
  const configured = async (value) => { fs.writeFileSync(profile, JSON.stringify({ vault: value })); return loadVault(profile); };
  assert.equal(await configured(vault), fs.realpathSync(vault));
  await assert.rejects(configured("\\\\server\\share\\vault"), /UNC/);
  await assert.rejects(configured("\\\\?\\C:\\vault"), /UNC/);
  const linkedRoot = path.join(base, "linked-root");
  fs.symlinkSync(vault, linkedRoot, "junction");
  await assert.rejects(configured(linkedRoot), /link|junction/i);
  const link = path.join(vault, "linked");
  fs.symlinkSync(outside, link, "junction");
  const foreign = path.join(outside, "foreign.md");
  fs.writeFileSync(foreign, "outside");
  assert.ok(!collectNotes(vault).some((note) => note.full === path.join(link, "foreign.md")));
  await assert.rejects(checkedNote(vault, path.join(link, "foreign.md")), /link|junction|escaped/i);
  const directLink = path.join(vault, "linked.md");
  let linkedFile = false;
  try { fs.symlinkSync(foreign, directLink, "file"); linkedFile = true; }
  catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    t.diagnostic("File symlinks unavailable; junction containment still verified");
  }
  if (linkedFile) {
    await assert.rejects(checkedNote(vault, directLink), /unlinked/);
    assert.ok(!collectNotes(vault).some((note) => note.full === directLink));
  }
  await assert.rejects(checkedNote(vault, foreign), /escaped/);
  const folder = path.join(vault, "Herdr Notes");
  fs.symlinkSync(outside, folder, "junction");
  await assert.rejects(createNote(vault, "No escape"), /link|junction|escaped/i);
  assert.equal(fs.existsSync(path.join(outside, "No escape.md")), false);
  fs.unlinkSync(folder);
  const note = await createNote(vault, "Disposable test");
  assert.equal(fs.readFileSync(note, "utf8"), "# Disposable test\n\n");
  fs.writeFileSync(note, "# Disposable test\nSaved in temporary vault.\n");
  assert.equal(fs.readFileSync(await checkedNote(vault, note), "utf8"), "# Disposable test\nSaved in temporary vault.\n");
  assert.ok(collectNotes(vault).some((item) => item.full === note));
  await createNote(vault, "Disposable test");
  assert.match(fs.readFileSync(note, "utf8"), /Saved in temporary vault/);
});

test("Leaf discovery prefers native PATH then platform install, without spawning or reading viewer state", () => {
  const windowsInstall = "C:\\Users\\rajve\\AppData\\Local\\Programs\\leaf\\leaf.exe";
  const windowsPath = "C:\\Tools with spaces\\leaf.exe";
  const windows = { platform: "win32", env: { Path: "relative;;C:\\Tools with spaces", LOCALAPPDATA: "C:\\Users\\rajve\\AppData\\Local" }, home: "C:\\Users\\rajve" };
  assert.equal(leafExecutable({ ...windows, executable: (file) => file === windowsPath || file === windowsInstall }), windowsPath);
  assert.equal(leafExecutable({ ...windows, executable: (file) => file === windowsInstall }), windowsInstall);
  assert.equal(leafExecutable({ ...windows, env: {}, executable: (file) => file === windowsInstall }), windowsInstall);
  const visited = [];
  const linux = { platform: "linux", env: { PATH: "relative::/opt/leaf/bin:/usr/bin" }, home: "/home/rajveer" };
  assert.equal(leafExecutable({ ...linux, executable: (file) => { visited.push(file); return file === "/home/rajveer/.local/bin/leaf"; } }), "/home/rajveer/.local/bin/leaf");
  assert.deepEqual(visited, ["/opt/leaf/bin/leaf", "/usr/bin/leaf", "/home/rajveer/.local/bin/leaf"]);
  assert.equal(leafExecutable({ ...linux, executable: (file) => file === "/opt/leaf/bin/leaf" }), "/opt/leaf/bin/leaf");
  assert.equal(leafExecutable({ ...linux, executable: () => false }), undefined);
});

test("Leaf Windows discovery rejects drive-relative roots and accepts qualified drives/shares", () => {
  const visited = [];
  const options = {
    platform: "win32", home: "C:\\Users\\fixture",
    env: { PATH: "\\Tools;/Tools;C:Tools;C:\\Tools;\\\\server\\share\\Tools" },
    executable: (file) => { visited.push(file); return false; },
  };
  assert.equal(leafExecutable(options), undefined);
  assert.deepEqual(visited, ["C:\\Tools\\leaf.exe", "\\\\server\\share\\Tools\\leaf.exe", "C:\\Users\\fixture\\AppData\\Local\\Programs\\leaf\\leaf.exe"]);
  assert.equal(leafExecutable({ ...options, executable: (file) => file === "C:\\Tools\\leaf.exe" }), "C:\\Tools\\leaf.exe");
  assert.equal(leafExecutable({ ...options, executable: (file) => file === "\\\\server\\share\\Tools\\leaf.exe" }), "\\\\server\\share\\Tools\\leaf.exe");
  assert.equal(leafExecutable({ ...options, env: { PATH: "\\Tools;/Tools", LOCALAPPDATA: "\\Local" }, executable: () => true }), undefined);
});

test("Leaf discovery rejects missing files and directories", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neura-leaf-discovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { env: { PATH: dir }, home: dir };
  assert.equal(leafExecutable(options), undefined);
  const candidate = path.join(dir, process.platform === "win32" ? "leaf.exe" : "leaf");
  fs.mkdirSync(candidate);
  assert.equal(leafExecutable(options), undefined);
  if (process.platform !== "win32") {
    fs.rmdirSync(candidate);
    fs.writeFileSync(candidate, "not executable", { mode: 0o600 });
    assert.equal(leafExecutable(options), undefined);
    fs.chmodSync(candidate, 0o700);
    assert.equal(leafExecutable(options), candidate);
  }
});

function previewFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neura-leaf-preview-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Spaces, Unicode, apostrophe and shell metacharacters must stay one literal argv.
  const file = path.join(root, "-Résumé's note & $(whoami); [1].md");
  fs.writeFileSync(file, "# Disposable preview\n\n**Markdown** stays unchanged.\n");
  const leaf = "C:\\Users\\rajve\\AppData\\Local\\Programs\\leaf\\leaf.exe";
  const options = { platform: "win32", env: {}, home: "C:\\Users\\rajve", executable: (candidate) => candidate === leaf };
  return { root, file, leaf, options };
}

test("Leaf preview spawns only the authorized note as literal argv, with no shell or watch flags", async (t) => {
  const { root, file, leaf, options } = previewFixture(t);
  const before = fs.readFileSync(file);
  const calls = [];
  const run = (...args) => { calls.push(args); return { status: 0 }; };
  await previewNote(root, file, { ...options, run });
  assert.deepEqual(calls, [[leaf, [file], { stdio: "inherit", windowsHide: true, shell: false }]]);
  assert.deepEqual(fs.readFileSync(file), before);
  // A Linux Notes process selects native Leaf and retains the native note path.
  await previewNote(root, file, { platform: "linux", env: {}, home: "/home/rajveer", executable: () => true, run });
  assert.equal(calls[1][0], "/home/rajveer/.local/bin/leaf");
  assert.deepEqual(calls[1][1], [file]);
});

test("Leaf preview rejects outside, missing, non-Markdown and linked notes before discovery/spawn", async (t) => {
  const { root, file, options } = previewFixture(t);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neura-leaf-outside-")));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const foreign = path.join(outside, "foreign.md");
  fs.writeFileSync(foreign, "outside");
  const text = path.join(root, "not-markdown.txt");
  fs.writeFileSync(text, "not a note");
  const hardlink = path.join(root, "hardlink.md");
  fs.linkSync(file, hardlink);
  const linkedDirectory = path.join(root, "redirected");
  fs.symlinkSync(outside, linkedDirectory, "junction");
  let discoveries = 0;
  let spawns = 0;
  const mocks = { ...options, executable: () => { discoveries++; return true; }, run: () => { spawns++; return { status: 0 }; } };
  for (const target of [foreign, root, text, path.join(root, "missing.md"), hardlink, path.join(linkedDirectory, "foreign.md")]) {
    await assert.rejects(previewNote(root, target, mocks));
  }
  const symlink = path.join(root, "symlink.md");
  try { fs.symlinkSync(foreign, symlink, "file"); }
  catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    t.diagnostic("File symlinks unavailable; hardlink and junction rejection still verified");
  }
  if (fs.existsSync(symlink)) await assert.rejects(previewNote(root, symlink, mocks), /unlinked/);
  assert.equal(discoveries, 0);
  assert.equal(spawns, 0);
});

test("Leaf unavailable/start/exit/signal errors are clear and leave nano usable", async (t) => {
  const { root, file, options } = previewFixture(t);
  let calls = 0;
  await assert.rejects(previewNote(root, file, { ...options, executable: () => false, run: () => { calls++; } }), /Leaf is unavailable.*PATH/);
  assert.equal(calls, 0);
  for (const [result, message] of [
    [{ error: new Error("ENOENT"), status: null }, /Leaf preview could not start: ENOENT/],
    [{ status: 7 }, /Leaf preview failed \(exit 7\)/],
    [{ status: null, signal: "SIGTERM" }, /Leaf preview failed \(signal SIGTERM\)/],
  ]) {
    await assert.rejects(previewNote(root, file, { ...options, run: () => result }), message);
  }
  let editorCall;
  await editNote(root, file, { editor: "GNU nano", run: (...args) => { editorCall = args; return { status: 0 }; } });
  assert.deepEqual(editorCall, ["GNU nano", [file], { stdio: "inherit", windowsHide: true, shell: false }]);
  const created = await createNote(root, "New note still edits");
  await editNote(root, created, { editor: "GNU nano", run: (_editor, args) => { assert.deepEqual(args, [created]); return { status: 0 }; } });
  await assert.rejects(editNote(root, path.join(root, "missing.md"), { editor: "GNU nano", run: () => assert.fail("must not spawn") }));
  await assert.rejects(editNote(root, file, { editor: null, run: () => assert.fail("must not spawn") }), /GNU nano is unavailable/);
  const editorError = new Error("nano ENOENT");
  await assert.rejects(editNote(root, file, { editor: "GNU nano", run: () => ({ error: editorError }) }), (error) => error === editorError);
});

test("Notes selection keeps numeric edit, preview aliases and filtered indexes separate from menu commands", () => {
  const all = [{ full: "first.md" }, { full: "filtered.md" }];
  const visible = all.slice(1);
  assert.deepEqual(noteSelection("1", visible), { note: all[1], preview: false });
  for (const answer of ["r1", "v1", "R1", "V1"]) {
    assert.deepEqual(noteSelection(answer, visible), { note: all[1], preview: true });
  }
  for (const answer of ["r", "refresh", "n", "new", "/filter", "q", "quit", "r0", "v2", "1; whoami", "v-1", "r999999999999999999999"]) {
    assert.equal(noteSelection(answer, visible), undefined);
  }
});
