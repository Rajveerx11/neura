import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import learn from "../agent/extensions/learn.ts";
import { getMode, setMode } from "../agent/neura/mode-state.ts";
import { learnLessonRevision } from "../agent/neura/learn-renderer.ts";
import { listLearnProgress, readLearnProgress, writeLearnArtifact, MAX_LEARN_SNAPSHOT_BYTES } from "../agent/neura/learn-store.ts";
import { pdf, zip, presentation } from "./learn-material-fixtures.mjs";

const temporaryRoot = await fs.realpath(os.tmpdir());
const scratch = await fs.mkdtemp(path.join(temporaryRoot, "neura-learn-end-to-end-"));
const workspace = path.join(scratch, "workspace");
await fs.mkdir(workspace);
const previousNeura = process.env.NEURA;
const previousMode = getMode();
let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count++; };
const denied = async (fn, pattern) => { await assert.rejects(fn, pattern); count++; };

function harness() {
  const tools = new Map(), commands = new Map(), events = new Map(), messages = [], notifications = [], statuses = new Map();
  const pi = {
    registerTool: (definition) => tools.set(definition.name, definition),
    registerCommand: (name, definition) => commands.set(name, definition),
    on: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
    sendMessage: (message) => messages.push(message.content),
    sendUserMessage: (message) => messages.push(message),
  };
  const ctx = { cwd: workspace, hasUI: true, isIdle: () => true, ui: {
    notify: (message) => notifications.push(message), setStatus: (key, value) => statuses.set(key, value),
  } };
  learn(pi);
  const fire = async (name, event = {}) => { let result; for (const handler of events.get(name) ?? []) result = await handler(event, ctx); return result; };
  const call = async (name, input, signal = new AbortController().signal) => tools.get(name).execute("test-call", input, signal, undefined, ctx);
  const command = async (text) => commands.get("learn").handler(text, ctx);
  return { tools, commands, messages, notifications, statuses, ctx, fire, call, command };
}

try {
  delete process.env.NEURA;
  check(harness().tools.size === 0, "Plain Pi must not register learning tools");
  process.env.NEURA = "1";
  setMode("learn");
  const app = harness();
  await app.fire("session_start");
  check(app.tools.size === 4 && app.commands.has("learn"), "Learning tools and command register");

  await fs.writeFile(path.join(workspace, "booking.pdf"), pdf(["Customers have bookings.", "Each booking belongs to one customer."]));
  const imported = await app.call("learn_material", { path: "booking.pdf", ocr: false });
  const source = JSON.parse(imported.content[0].text);
  check(source.filename === "booking.pdf" && source.pageCount === 2 && source.verifiedThisSession, "PDF imported through actual extension tool");
  check(imported.content.some((item) => item.type === "image"), "PDF preview reaches the model for visual inspection");
  const second = JSON.parse((await app.call("learn_material", { sourceId: source.sourceId, page: 2 })).content[0].text);
  check(second.text.includes("Each booking"), "Page selection preserves numbering");
  await denied(() => app.call("learn_material", { path: "../outside.pdf" }), /workspace/);
  await denied(() => app.call("learn_material", { sourceId: source.sourceId, page: 99 }), /page/);
  await denied(() => app.call("learn_material", { path: "booking.pdf", sourceId: source.sourceId }), /exactly one/);

  const require = createRequire(new URL("../agent/neura/package.json", import.meta.url));
  const canvas = require("@napi-rs/canvas").createCanvas(100, 60);
  const drawing = canvas.getContext("2d"); drawing.fillStyle = "white"; drawing.fillRect(0, 0, 100, 60);
  await fs.writeFile(path.join(workspace, "relationships.pptx"), zip(presentation(canvas.toBuffer("image/png"))));
  const ppt = JSON.parse((await app.call("learn_material", { path: "relationships.pptx", ocr: false })).content[0].text);
  check(ppt.kind === "pptx" && ppt.number === 1 && ppt.notes, "PPTX slide and notes imported through actual tool");

  const lesson = {
    id: "booking-relationships", title: "Build a booking database", goal: "Find the customers who have a booking.",
    steps: ["Connect customers and bookings", "Query one relationship"], currentStep: 0,
    bullets: ["Customers can have several bookings.", "Each booking points to one customer.", "A key identifies the related customer."],
    example: "Customer 1 has booking 101; customer 2 has none.",
    diagram: { kind: "er", title: "Customers and bookings", nodes: [
      { id: "customer", label: "Customer", fields: ["id", "name"] }, { id: "booking", label: "Booking", fields: ["id", "customer_id"] },
    ], edges: [{ from: "customer", to: "booking", label: "1 to many" }], focus: "booking" },
    references: [{ sourceId: source.sourceId, filename: source.filename, unit: "page", number: 1, excerpt: "Customers have bookings." },
      { sourceId: ppt.sourceId, filename: ppt.filename, unit: "slide", number: 1, excerpt: ppt.text.trim() }],
    exercise: { kind: "choice", prompt: "Which table contains customer_id?", options: ["Booking", "Customer"], answer: 0,
      hints: ["Which record belongs to the customer?", "Look at the booking fields."], explanation: "The booking points to the customer through customer_id." },
  };
  const published = JSON.parse((await app.call("learn_lesson", lesson)).content[0].text);
  check((await fs.readFile(published.board, "utf-8")).includes("Build a booking database"), "PDF/PPTX citations reach rendered lesson");
  await fs.copyFile(path.join(workspace, "booking.pdf"), path.join(workspace, "alias.pdf"));
  const alias = JSON.parse((await app.call("learn_material", { path: "alias.pdf", ocr: false })).content[0].text);
  check(alias.filename === source.filename && alias.sourceId === source.sourceId, "Duplicate content preserves canonical citation filename");
  check((await listLearnProgress(workspace)).length === 0, "Publishing a lesson does not silently save progress");
  const forged = structuredClone(lesson); forged.references[0].excerpt = "Fabricated citation";
  await denied(() => app.call("learn_lesson", forged), /Citation/);
  await app.fire("input", { source: "interactive", text: "Teach me 1 concept" });
  await denied(() => app.call("learn_exercise", { answer: "1" }), /complete latest answer/);
  await app.fire("input", { source: "interactive", text: "1" });
  const attempt = JSON.parse((await app.call("learn_exercise", { answer: "1" })).content[0].text);
  check(attempt.correct === true && /not a mastery/.test(attempt.evidence), "Learner answer evaluated without mastery claim");
  await denied(() => app.call("learn_exercise", { answer: "1" }), /complete latest answer/);
  await app.command("hint");
  await app.command("answer-helped 1");
  const progress = JSON.parse((await app.call("learn_progress", { action: "status" })).content[0].text);
  check(progress.attempts.length === 2 && progress.attempts[1].assisted, "Assisted attempt records help usage");
  await app.command("reveal");
  await app.call("learn_progress", { action: "note", note: "Needs practice choosing the foreign-key side.", nextStep: "Query the relationship." });
  await app.command("save");
  const saved = await listLearnProgress(workspace);
  check(saved.length === 1, "Only explicit save writes a progress snapshot");
  const snapshot = await readLearnProgress(workspace, saved[0]);
  check(snapshot.materials.every((material) => material.pages.every((page) => !page.images)), "Saved progress omits image payloads");
  await app.command("reset");
  await app.command(`resume ${saved[0]}`);
  const resumed = JSON.parse((await app.call("learn_progress", { action: "status" })).content[0].text);
  check(resumed.attempts.length === 2 && resumed.nextStep === "Query the relationship.", "Progress resumes attempts and next step");
  check(resumed.currentLesson.diagram.kind === "er" && resumed.currentLesson.exercise.prompt === lesson.exercise.prompt && resumed.currentLesson.example === lesson.example, "Tutor can retrieve full resumed lesson through progress tool");
  check(resumed.sources.every((material) => !material.verifiedThisSession), "Restored excerpts are not silently trusted");
  check((await fs.readFile(resumed.board, "utf-8")).includes("Saved snapshot"), "Resumed board labels historical material");
  await denied(() => app.call("learn_lesson", lesson), /Reimport/);
  await app.command("answer 1");
  const assistedRestore = JSON.parse((await app.call("learn_progress", { action: "status" })).content[0].text);
  check(assistedRestore.attempts.at(-1).revealed, "Reveal history survives resume");
  await app.call("learn_material", { path: "booking.pdf", ocr: false });
  await app.call("learn_material", { path: "relationships.pptx", ocr: false });
  await app.call("learn_lesson", lesson);
  for (let index = 0; index < 10; index++) {
    await fs.writeFile(path.join(workspace, `extra-${index}.pdf`), pdf([`Synthetic learning reference ${index}.`]));
    await app.call("learn_material", { path: `extra-${index}.pdf`, ocr: false });
  }
  await app.command("save");
  const fullSaved = (await listLearnProgress(workspace))[0];
  await app.command("reset"); await app.command(`resume ${fullSaved}`);
  const reverified = JSON.parse((await app.call("learn_material", { path: "booking.pdf", ocr: false })).content[0].text);
  check(reverified.verifiedThisSession, "A full twelve-source snapshot can reimport existing material");
  await app.call("learn_material", { path: "relationships.pptx", ocr: false });
  await fs.writeFile(path.join(workspace, "thirteenth.pdf"), pdf(["Thirteenth reference."]));
  await denied(() => app.call("learn_material", { path: "thirteenth.pdf", ocr: false }), /Twelve/);

  const malformed = structuredClone(snapshot); malformed.materials[0].warnings = ["x".repeat(1001)];
  const malformedPath = await writeLearnArtifact(workspace, "progress", JSON.stringify(malformed));
  await app.command(`resume ${path.basename(malformedPath)}`);
  check(/Invalid saved material/.test(app.notifications.at(-1)), "Oversized snapshot warning rejected before prompt context");
  const malformedAttempt = structuredClone(snapshot); malformedAttempt.attempts[0].at = "x".repeat(1000);
  const malformedAttemptPath = await writeLearnArtifact(workspace, "progress", JSON.stringify(malformedAttempt));
  await app.command(`resume ${path.basename(malformedAttemptPath)}`);
  check(/Invalid saved attempt/.test(app.notifications.at(-1)), "Oversized snapshot date rejected before prompt context");
  const mixedHistory = structuredClone(snapshot); mixedHistory.attempts[0].lessonId = "another-lesson";
  const mixedPath = await writeLearnArtifact(workspace, "progress", JSON.stringify(mixedHistory));
  await app.command(`resume ${path.basename(mixedPath)}`);
  const mixedStatus = JSON.parse((await app.call("learn_progress", { action: "status" })).content[0].text);
  check(mixedStatus.attempts.length === 1 && mixedStatus.attempts[0].lessonId === lesson.id, "Restored current progress excludes another lesson's attempts");
  check(mixedStatus.otherLessonHistory.attempts[0].lessonId === "another-lesson" && /unverified/.test(mixedStatus.otherLessonHistory.notice), "Other lesson attempts remain explicitly separate unverified history");
  check(/1 attempts/.test(app.statuses.get("neura-learn")), "Terminal count excludes other lesson attempts");
  await app.command("status");
  check(/Practice attempts: 1; current lesson only/.test(app.messages.at(-1)), "Status command excludes other lesson attempts");
  const mixedPrompt = await app.fire("before_agent_start", { systemPrompt: "base" });
  check(mixedPrompt.systemPrompt.includes('"practiceAttempts":1'), "Tutor brief counts only active lesson attempts");
  const noLessonHistory = structuredClone(mixedHistory); delete noLessonHistory.lesson;
  const noLessonPath = await writeLearnArtifact(workspace, "progress", JSON.stringify(noLessonHistory));
  await app.command(`resume ${path.basename(noLessonPath)}`);
  const noLessonStatus = JSON.parse((await app.call("learn_progress", { action: "status" })).content[0].text);
  check(noLessonStatus.attempts.length === 0 && noLessonStatus.otherLessonHistory.attempts.length === 2, "Attempts without an active lesson remain separate history");
  const manyWarnings = structuredClone(snapshot); manyWarnings.materials[0].warnings = Array.from({ length: 33 }, (_, index) => `Page ${index + 1} preview unavailable.`);
  const warningPath = await writeLearnArtifact(workspace, "progress", JSON.stringify(manyWarnings));
  await app.command(`resume ${path.basename(warningPath)}`);
  const warningStatus = JSON.parse((await app.call("learn_progress", { action: "status" })).content[0].text);
  check(warningStatus.sources[0].warnings.length === 33, "Valid many-page warning lists survive snapshot roundtrip");
  await app.call("learn_material", { path: "booking.pdf", ocr: false });
  await app.call("learn_material", { path: "relationships.pptx", ocr: false });

  const sql = structuredClone(lesson);
  sql.id = "booking-query"; sql.currentStep = 1;
  sql.exercise = { kind: "sql", prompt: "Select all customer names.", hints: ["Use SELECT name FROM customers."], explanation: "SELECT returns the requested column.",
    tables: [{ name: "customers", columns: [{ name: "name", type: "TEXT" }], rows: [["Asha"], ["Sam"]] }],
    expectedRows: [{ name: "Asha" }, { name: "Sam" }], solution: "SELECT name FROM customers" };
  await app.call("learn_lesson", sql);
  const invalidKey = structuredClone(sql); invalidKey.exercise.expectedRows = [{ name: "Nobody" }];
  await denied(() => app.call("learn_lesson", invalidKey), /answer key/);
  await app.command(`answer-for ${learnLessonRevision(lesson)} 1`);
  check(/different lesson revision/.test(app.notifications.at(-1)), "Old board cannot submit into the current lesson");
  await app.command(`deeper-for ${learnLessonRevision(lesson)}`);
  check(/different lesson revision/.test(app.notifications.at(-1)), "Old board cannot request teaching for a different lesson");
  await app.command(`answer-for ${learnLessonRevision(sql)} SELECT name FROM customers`);
  check(JSON.parse(app.messages.at(-1)).correct, "Actual SQL lab executes through terminal command");
  await app.command("answer ATTACH DATABASE 'outside.db' AS outside");
  check(!await fs.stat(path.join(workspace, "outside.db")).catch(() => null), "SQL never creates an attached host database");

  for (const mode of ["plan", "work", "yolo", "human-away"]) {
    setMode(mode);
    for (const name of app.tools.keys()) await denied(() => app.call(name, {}), /only in Learn/);
    await app.command("save");
    check(/only in Learn/.test(app.notifications.at(-1)), "Direct command respects mode boundary");
  }
  setMode("learn");
  const abort = new AbortController(); abort.abort();
  await denied(() => app.call("learn_lesson", lesson, abort.signal), /cancelled/);
  await denied(() => readLearnProgress(workspace, "../outside.json"), /filename/);
  await denied(() => writeLearnArtifact(workspace, "progress", "x".repeat(MAX_LEARN_SNAPSHOT_BYTES + 1)), /size/);
  const linkedWorkspace = path.join(scratch, "linked"); await fs.mkdir(linkedWorkspace);
  const outside = path.join(scratch, "outside"); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(linkedWorkspace, ".neura-learning"), process.platform === "win32" ? "junction" : "dir");
  await denied(() => writeLearnArtifact(linkedWorkspace, "lesson", "test"), /link|junction/);
  check((await fs.readdir(outside)).length === 0, "Junction does not receive artifacts");
  const hardlink = path.join(workspace, ".neura-learning", `progress-${"a".repeat(36)}.json`);
  await fs.link(path.join(workspace, ".neura-learning", saved[0]), hardlink);
  await denied(() => readLearnProgress(workspace, saved[0]), /unlinked/);
  await fs.unlink(hardlink);
  const datedDirectory = path.join(scratch, "dated"); await fs.mkdir(datedDirectory);
  for (let index = 0; index < 101; index++) {
    const filename = await writeLearnArtifact(datedDirectory, "progress", "{}");
    const date = new Date(1_700_000_000_000 + index * 1000); await fs.utimes(filename, date, date);
  }
  const newest = await writeLearnArtifact(datedDirectory, "progress", "{}");
  const listed = await listLearnProgress(datedDirectory);
  check(listed.length === 100 && listed[0] === path.basename(newest), "Saved listing retains newest entries beyond 100 snapshots");
  const installer = await fs.readFile(new URL("../install.ps1", import.meta.url), "utf-8");
  const firstMutation = installer.indexOf('New-Item -ItemType Directory -Force "$agent');
  check(installer.indexOf('if (-not (Test-Command "npm"))') < firstMutation && installer.indexOf("[version]'24.15.0'") < firstMutation, "Installer validates prerequisites before copying live files");
  check(installer.includes("Learn document runtime dependencies missing") && installer.includes("Node.js 24.15 or newer is required"), "Drift check covers Learn runtime and Node compatibility");
  await app.fire("session_start");
  const restarted = JSON.parse((await app.call("learn_progress", { action: "status" })).content[0].text);
  check(restarted.sources.length === 0 && restarted.attempts.length === 0, "New session cannot leak previous learning data");
  await app.fire("session_shutdown");
  console.log(`Learn integration: ${count} assertions passed (documents, citations, board, attempts, SQL, explicit save/resume, and denied boundaries).`);
} finally {
  if (previousNeura === undefined) delete process.env.NEURA; else process.env.NEURA = previousNeura;
  setMode(previousMode);
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith("neura-learn-end-to-end-")) throw new Error("Unexpected test cleanup path.");
  await fs.rm(resolved, { recursive: true, force: true });
}
