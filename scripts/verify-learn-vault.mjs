import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLearnExclusive } from "../agent/neura/learn-files.ts";
import { appendLearnVaultEvent, learnPreferenceEvidence, MAX_LEARN_VAULT_EVENTS, readLearnVaultContext } from "../agent/neura/learn-vault.ts";

const base = { lessonId: "linked-list-insertion", lessonRevision: "a".repeat(64), title: "Linked list insertion", topic: "DSA linked lists" };

if (process.argv[2] === "--append-child") {
  await appendLearnVaultEvent({ ...base, type: "finding", finding: process.argv[3] });
  process.exit(0);
}

const temporaryRoot = await fs.realpath(os.tmpdir());
const scratch = await fs.mkdtemp(path.join(temporaryRoot, "neura-learn-vault-"));
const original = process.env.NEURA_LEARN_VAULT;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const denied = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function vault(name) {
  const root = path.join(scratch, name);
  await fs.mkdir(path.join(root, ".obsidian"), { recursive: true });
  await fs.writeFile(path.join(root, "Welcome.md"), "untouched\n");
  return root;
}

function runChild(root, finding) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--append-child", finding], {
      env: { ...process.env, NEURA_LEARN_VAULT: root }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

async function allFileText(root) {
  const output = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) output.push(await fs.readFile(target, "utf-8"));
    }
  }
  await visit(root);
  return output.join("\n");
}

try {
  delete process.env.NEURA_LEARN_VAULT;
  check((await readLearnVaultContext()).enabled === false, "Missing configuration did not remain opt-in");
  await denied(() => writeLearnExclusive(scratch, "../outside.txt", "x"), /plain filename/);
  await denied(() => writeLearnExclusive(scratch, "event.json:stream", "x"), /plain filename/);

  const fresh = await vault("fresh-concurrent");
  const firstWriters = await Promise.all([runChild(fresh, "Fresh writer one"), runChild(fresh, "Fresh writer two")]);
  check(firstWriters.every((result) => result.status === 0), `Concurrent first writers failed: ${firstWriters.map((item) => item.stderr).join(" ")}`);
  check(JSON.stringify((await fs.readdir(path.join(fresh, "Neura", "_System", "events"))).sort()) === JSON.stringify(["0000.json", "0001.json"]), "Concurrent first writers did not claim the first two contiguous slots");

  const root = await vault("working");
  process.env.NEURA_LEARN_VAULT = root;
  check((await readLearnVaultContext()).enabled === true, "Configured empty vault was not recognized before first capture");
  const beforeObsidian = await fs.readdir(path.join(root, ".obsidian"));
  const concept = await appendLearnVaultEvent({ ...base, type: "concept", goal: "Insert safely", bullets: ["Move the head pointer."], example: "```\n<script>alert(1)</script>\n```", nextStep: "Try insertion at the end." });
  check(concept.enabled && /^[a-f0-9-]{36}$/.test(concept.eventId), "Concept event was not persisted");
  check(await fs.readFile(path.join(root, "Welcome.md"), "utf-8") === "untouched\n", "Vault welcome note changed");
  check(JSON.stringify(await fs.readdir(path.join(root, ".obsidian"))) === JSON.stringify(beforeObsidian), "Obsidian configuration changed");
  const topic = path.join(root, "Neura", "Topics", "dsa-linked-lists");
  const conceptNote = path.join(topic, (await fs.readdir(topic))[0]);
  const markdown = await fs.readFile(conceptNote, "utf-8");
  check(markdown.includes("````text") && markdown.trimEnd().includes("\n````\n\n## Next practice"), "Code fences were not lengthened around hostile content");
  check(markdown.includes("<script>alert(1)</script>"), "Fenced example was unexpectedly changed");
  await fs.unlink(conceptNote);

  const secrets = [
    "ghp_AAAAAAAAAAAAAAAAAAAAAAAA", "ghp_BBBBBBBBBBBBBBBBBBBBBBBB", "ghp_CCCCCCCCCCCCCCCCCCCCCCCC",
    "ghp_DDDDDDDDDDDDDDDDDDDDDDDD", "ghp_EEEEEEEEEEEEEEEEEEEEEEEE", "ghp_FFFFFFFFFFFFFFFFFFFFFFFF",
  ];
  await appendLearnVaultEvent({ ...base, title: `Title ${secrets[0]}`, topic: `Topic ${secrets[0]}`, type: "concept", goal: `Goal ${secrets[1]}`, bullets: [`Bullet ${secrets[2]}`], example: `Example ${secrets[3]}`, nextStep: `Next ${secrets[4]}` });
  check(!!await fs.stat(conceptNote).catch(() => null), "A later writer did not recover a missing projection from its committed event slot");
  await appendLearnVaultEvent({ ...base, title: `Finding ${secrets[0]}`, type: "finding", finding: `Finding ${secrets[5]}`, nextStep: `Next ${secrets[4]}` });
  let persisted = await allFileText(root);
  check(secrets.every((secret) => !persisted.includes(secret)) && persisted.includes("[REDACTED]"), "A raw secret reached structured events or Markdown projections");
  const secretLessonId = "sk-proj-abcdefghijklmnopqrstuvwxyz";
  const eventsBeforeSecretId = (await fs.readdir(path.join(root, "Neura", "_System", "events"))).length;
  await denied(() => appendLearnVaultEvent({ ...base, lessonId: secretLessonId, type: "finding", finding: "must not persist" }), /sensitive-looking/);
  persisted = await allFileText(root);
  const contextAfterSecretId = JSON.stringify(await readLearnVaultContext());
  check((await fs.readdir(path.join(root, "Neura", "_System", "events"))).length === eventsBeforeSecretId && !persisted.includes(secretLessonId) && !contextAfterSecretId.includes(secretLessonId), "Secret-shaped lesson ID reached JSON, Markdown, or profile context");
  const descriptiveLessonId = "understanding-binary-search-trees";
  await appendLearnVaultEvent({ ...base, lessonId: descriptiveLessonId, type: "finding", finding: "Valid descriptive identifier" });
  check((await allFileText(root)).includes(descriptiveLessonId), "A valid descriptive lesson ID was rejected as high-entropy content");

  const repeated = learnPreferenceEvidence("Please use examples first");
  await appendLearnVaultEvent({ ...base, type: "preference", key: "exampleTiming", value: "first", evidenceDigest: repeated });
  await appendLearnVaultEvent({ ...base, type: "preference", key: "exampleTiming", value: "first", evidenceDigest: repeated });
  check((await readLearnVaultContext()).preferences.exampleTiming === undefined, "Duplicate evidence activated a preference candidate");
  await appendLearnVaultEvent({ ...base, type: "preference", key: "exampleTiming", value: "first", evidenceDigest: learnPreferenceEvidence("Show an example before explaining") });
  check((await readLearnVaultContext()).preferences.exampleTiming === "first", "Two distinct exact messages did not activate a preference");

  await appendLearnVaultEvent({ ...base, type: "practice", correct: false, assisted: false, revealed: false, exerciseKind: "short-answer" });
  await appendLearnVaultEvent({ ...base, type: "practice", correct: true, assisted: false, revealed: false, exerciseKind: "short-answer" });
  await appendLearnVaultEvent({ ...base, type: "practice", correct: true, assisted: true, revealed: false, exerciseKind: "choice" });
  await appendLearnVaultEvent({ ...base, lessonId: "open-discussion", type: "practice", correct: null, assisted: false, revealed: false, exerciseKind: "open" });
  const context = await readLearnVaultContext();
  check(context.difficulties.length === 1 && context.difficulties[0].count === 2, "Difficulty summary included clean success or unassisted discussion, or lost assisted evidence");
  check(JSON.stringify(context).length < 2000, "Prompt context was not bounded");

  const childWriters = await Promise.all(Array.from({ length: 6 }, (_, index) => runChild(root, `Concurrent observation ${index}`)));
  check(childWriters.every((result) => result.status === 0), `Ordinary cross-process contention failed: ${childWriters.map((item) => item.stderr).join(" ")}`);
  const eventDirectory = path.join(root, "Neura", "_System", "events");
  let eventFiles = (await fs.readdir(eventDirectory)).sort();
  check(eventFiles.length === 17 && eventFiles.every((name, index) => name === `${String(index).padStart(4, "0")}.json`), "Concurrent events did not claim contiguous numbered slots");
  check(!(await fs.readdir(path.join(root, "Neura", "_System"))).some((name) => /lock/i.test(name)), "Lock artifacts remained in the lock-free event store");

  const firstEvent = path.join(eventDirectory, eventFiles[0]);
  const hardlink = path.join(scratch, "event-hardlink.json");
  await fs.link(firstEvent, hardlink);
  await denied(() => readLearnVaultContext(), /unlinked regular file/);
  await fs.unlink(hardlink);
  await fs.writeFile(path.join(eventDirectory, "unexpected.txt"), "unexpected");
  await denied(() => readLearnVaultContext(), /unsupported entry/);
  await fs.unlink(path.join(eventDirectory, "unexpected.txt"));
  const tampered = JSON.parse(await fs.readFile(firstEvent, "utf-8"));
  tampered.event.finding = "tampered without updating digest";
  await fs.writeFile(firstEvent, JSON.stringify(tampered));
  await denied(() => readLearnVaultContext(), /integrity/);

  const malformed = await vault("malformed-envelope");
  process.env.NEURA_LEARN_VAULT = malformed;
  await appendLearnVaultEvent({ ...base, type: "finding", finding: "seed" });
  await fs.writeFile(path.join(malformed, "Neura", "_System", "events", "0000.json"), JSON.stringify({ version: 1, digest: "a".repeat(64) }));
  await denied(() => readLearnVaultContext(), /envelope/);

  const gapped = await vault("gapped");
  process.env.NEURA_LEARN_VAULT = gapped;
  await appendLearnVaultEvent({ ...base, type: "finding", finding: "first" });
  await appendLearnVaultEvent({ ...base, type: "finding", finding: "second" });
  const gapEvents = path.join(gapped, "Neura", "_System", "events");
  await fs.rename(path.join(gapEvents, "0001.json"), path.join(gapEvents, "0002.json"));
  await denied(() => readLearnVaultContext(), /contiguous/);

  const unowned = await vault("unowned");
  await fs.mkdir(path.join(unowned, "Neura"));
  await fs.writeFile(path.join(unowned, "Neura", "Personal.md"), "keep me");
  process.env.NEURA_LEARN_VAULT = unowned;
  await denied(() => appendLearnVaultEvent({ ...base, type: "finding", finding: "test" }), /owned/);
  check(await fs.readFile(path.join(unowned, "Neura", "Personal.md"), "utf-8") === "keep me", "Unowned user content was overwritten");

  process.env.NEURA_LEARN_VAULT = "relative/vault";
  await denied(() => appendLearnVaultEvent({ ...base, type: "finding", finding: "test" }), /absolute path/);
  process.env.NEURA_LEARN_VAULT = "\\\\server\\share\\vault";
  await denied(() => appendLearnVaultEvent({ ...base, type: "finding", finding: "test" }), /UNC path/);

  const target = await vault("target");
  const linked = path.join(scratch, "linked");
  await fs.symlink(target, linked, process.platform === "win32" ? "junction" : "dir");
  process.env.NEURA_LEARN_VAULT = linked;
  await denied(() => appendLearnVaultEvent({ ...base, type: "finding", finding: "test" }), /link|junction/);

  process.env.NEURA_LEARN_VAULT = root;
  await denied(() => appendLearnVaultEvent({ ...base, type: "preference", key: "pace", value: "unknown", evidenceDigest: "b".repeat(64) }), /Unknown Learn preference/);
  await denied(() => appendLearnVaultEvent({ ...base, type: "finding", finding: "x".repeat(1001) }), /1-1000/);

  const boundary = await vault("boundary");
  process.env.NEURA_LEARN_VAULT = boundary;
  await appendLearnVaultEvent({ ...base, type: "finding", finding: "seed" });
  const boundaryEvents = path.join(boundary, "Neura", "_System", "events");
  const template = { version: 1, ...base, type: "finding", finding: "synthetic boundary record", at: "2026-01-01T00:00:00.000Z" };
  const writes = [];
  for (let index = 1; index < MAX_LEARN_VAULT_EVENTS - 1; index++) {
    const event = { ...template, id: randomUUID() };
    const envelope = { version: 1, digest: digest(JSON.stringify(event)), event };
    writes.push(fs.writeFile(path.join(boundaryEvents, `${String(index).padStart(4, "0")}.json`), JSON.stringify(envelope), { flag: "wx", mode: 0o600 }));
  }
  await Promise.all(writes);
  const boundaryWriters = await Promise.all([runChild(boundary, "boundary one"), runChild(boundary, "boundary two")]);
  check(boundaryWriters.filter((result) => result.status === 0).length === 1, "Boundary race did not admit exactly one writer");
  check((await fs.readdir(boundaryEvents)).length === MAX_LEARN_VAULT_EVENTS, "Concurrent boundary writes exceeded the event limit");
  check((await readLearnVaultContext()).enabled, "Boundary rejection left the store unreadable");

  console.log(`Learn vault: ${checks} checks passed; redacted envelopes, lock-free numbered slots, cross-process contention, bounded capacity, preferences, and denied paths.`);
} finally {
  if (original === undefined) delete process.env.NEURA_LEARN_VAULT; else process.env.NEURA_LEARN_VAULT = original;
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith("neura-learn-vault-")) throw new Error("Unexpected Learn vault cleanup path.");
  await fs.rm(resolved, { recursive: true, force: true });
}
