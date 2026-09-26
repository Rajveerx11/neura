import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadVault, checkedNote, collectNotes, createNote } from "./notes.mjs";
import { paneArgs, launchPane } from "./open-pane.mjs";
import { calendarCommands, calendarEditArgs, calendarExecutable } from "./calendar.mjs";

test("Workspace manifest declares the pane actions without requiring a live plugin link", (t) => {
  const manifest = path.join(import.meta.dirname, "herdr-plugin.toml");
  const source = fs.readFileSync(manifest, "utf8");
  assert.match(source, /^id = "neura\.workspace"$/m);
  assert.deepEqual([...source.matchAll(/^\[\[actions\]\]\s*\nid = "([^"]+)"/gm)].map((match) => match[1]).sort(), ["open-calendar", "open-notes"]);
  assert.deepEqual([...source.matchAll(/^\[\[panes\]\]\s*\nid = "([^"]+)"/gm)].map((match) => match[1]).sort(), ["calendar", "notes"]);
  assert.equal((source.match(/^placement = "split"$/gm) || []).length, 2);
  const result = spawnSync("herdr", ["plugin", "list", "--plugin", "neura.workspace", "--json"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return t.diagnostic("Herdr not available; manifest source verified");
  const plugin = JSON.parse(result.stdout).result.plugins.find((item) => item.plugin_id === "neura.workspace");
  const linked = plugin && path.normalize(plugin.manifest_path).replace(/^\\\\\?\\/, "").toLowerCase();
  if (linked !== manifest.toLowerCase()) return t.diagnostic("Herdr links another checkout; manifest source verified");
  assert.ok(plugin.enabled);
  assert.deepEqual(plugin.actions.map((item) => item.id).sort(), ["open-calendar", "open-notes"]);
  assert.deepEqual(plugin.panes.map((item) => item.id).sort(), ["calendar", "notes"]);
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

test("calendar command arguments remain fixed except the edit search text", () => {
  assert.deepEqual(calendarCommands["1"], ["--lineart", "unicode", "calm"]);
  assert.deepEqual(calendarCommands["2"], ["--lineart", "unicode", "calw", "today", "2"]);
  assert.deepEqual(calendarCommands["3"], ["agenda", "today", "+14d", "--details", "calendar", "--details", "location"]);
  assert.deepEqual(calendarCommands["4"], ["add"]);
  assert.deepEqual(calendarCommands["6"], ["list"]);
  assert.deepEqual(calendarCommands.a, ["init"]);
  assert.deepEqual(calendarEditArgs('hello & whoami'), ["edit", 'hello & whoami']);
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
  fs.symlinkSync(foreign, directLink, "file");
  await assert.rejects(checkedNote(vault, directLink), /unlinked/);
  assert.ok(!collectNotes(vault).some((note) => note.full === directLink));
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
