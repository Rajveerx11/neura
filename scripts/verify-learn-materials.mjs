import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";
import { pdf, zip, presentation } from "./learn-material-fixtures.mjs";
import { pathToFileURL } from "node:url";
import { importLearningMaterial, validateLearningCitation } from "../agent/neura/learn-materials.ts";

const require = createRequire(new URL("../agent/neura/package.json", import.meta.url));
const { createCanvas } = require("@napi-rs/canvas");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "neura-learn-materials-"));
const workspace = path.join(scratch, "workspace");
await fs.mkdir(workspace);
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
async function denied(name, regex, options = {}) {
  await assert.rejects(() => importLearningMaterial({ workspace, path: name, ocr: false, ...options }), regex);
  assertions++;
}


try {
  const canvas = createCanvas(1000, 240);
  const context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, 1000, 240);
  context.fillStyle = "black"; context.font = "bold 70px Arial"; context.fillText("LEARN DATABASES", 35, 135);
  const jpeg = canvas.toBuffer("image/jpeg");
  const png = canvas.toBuffer("image/png");
  await fs.writeFile(path.join(workspace, "lesson.pdf"), pdf(["Customers make bookings", "Foreign keys connect tables"]));
  const result = await importLearningMaterial({ workspace, path: "lesson.pdf", ocr: false });
  check(result.pages.length === 2 && result.pages[1].number === 2, "PDF page count and numbering");
  check(result.pages[0].text.includes("Customers make bookings"), "PDF text extraction");
  check(result.pages.every((page) => page.images?.[0].data && page.images[0].mimeType === "image/png"), "Real PDF raster previews");
  const same = await importLearningMaterial({ workspace, path: "lesson.pdf", includeImages: false, ocr: false });
  check(same.id === result.id && !same.pages[0].images, "Immutable byte identity and optional previews");
  const citation = { sourceId: result.id, filename: result.name, unit: "page", number: 1, excerpt: "Customers make bookings" };
  check(validateLearningCitation(result, citation), "Exact valid citation");
  for (const tamper of [{ sourceId: "sha256:fake" }, { filename: "fake.pdf" }, { unit: "slide" }, { number: 2 }, { excerpt: "Made up wording" }, { excerpt: " " }]) check(!validateLearningCitation(result, { ...citation, ...tamper }), "Forged citation rejected");
  await fs.writeFile(path.join(workspace, "scanned.pdf"), pdf([""], jpeg));
  const scanned = await importLearningMaterial({ workspace, path: "scanned.pdf" });
  check(scanned.pages[0].extraction === "ocr" && /LEARN DATABASES/i.test(scanned.pages[0].text), "Actual offline English OCR from scanned PDF");
  check(scanned.warnings.some((warning) => /OCR can misread/.test(warning)), "OCR uncertainty visible");
  const noOcr = await importLearningMaterial({ workspace, path: "scanned.pdf", ocr: false, includeImages: false });
  check(noOcr.pages[0].extraction === "empty" && noOcr.warnings.some((warning) => /no extractable text/.test(warning)), "Unreadable page warning");
  const runtime = path.join(scratch, "runtime");
  const runtimeModules = path.join(runtime, "node_modules");
  await fs.mkdir(runtimeModules, { recursive: true });
  const sourceRuntime = path.resolve(import.meta.dirname, "../agent/neura");
  for (const filename of ["learn-materials.ts", "learn-materials-worker.mjs", "package.json"]) await fs.copyFile(path.join(sourceRuntime, filename), path.join(runtime, filename));
  const moduleLinks = ["saxes", "yauzl", "pdfjs-dist", "@napi-rs", "tesseract.js"];
  try {
    for (const module of moduleLinks) await fs.symlink(path.join(sourceRuntime, "node_modules", module), path.join(runtimeModules, module), process.platform === "win32" ? "junction" : "dir");
    const isolated = await import(pathToFileURL(path.join(runtime, "learn-materials.ts")).href);
    const missingOcr = await isolated.importLearningMaterial({ workspace, path: "scanned.pdf" });
    check(missingOcr.pages[0].extraction === "empty" && missingOcr.pages[0].images?.length === 1 && missingOcr.warnings.some((warning) => /OCR is unavailable/.test(warning)), "Missing OCR model preserves preview with honest warning");
  } finally {
    for (const module of moduleLinks) await fs.unlink(path.join(runtimeModules, module)).catch(() => {});
  }
  const parts = presentation(png);
  await fs.writeFile(path.join(workspace, "deck.pptx"), zip(parts));
  const deck = await importLearningMaterial({ workspace, path: "deck.pptx" });
  check(deck.pages.length === 2 && deck.pages[0].text.includes("Customers & bookings") && deck.pages[1].text.includes("Foreign keys"), "PPTX presentation order, XML entities and body text");
  check(deck.pages[0].notes === "One customer can create many bookings.", "PPTX notes via relationships, not guessed filenames");
  check(deck.pages[0].images?.length === 1 && /LEARN DATABASES/.test(deck.pages[0].text), "Embedded image preview and OCR");
  check(deck.warnings.some((warning) => /External.*ignored/.test(warning)), "External relationships never fetched");
  check(validateLearningCitation(deck, { sourceId: deck.id, filename: deck.name, unit: "slide", number: 1, excerpt: "One customer can create many bookings." }), "Speaker note citation");
  await denied("https://example.com/deck.pdf", /local workspace/);
  await denied("../outside.pdf", /inside the workspace/);
  await denied(".git/private.pdf", /hidden/);
  await denied(".neura-learning/saved.pdf", /hidden/);
  await denied("sessions/private.pdf", /session/);
  await denied("lesson.pdf:stream", /local workspace/);
  await denied("\\\\localhost\\share\\deck.pdf", /local workspace/);
  await denied("lesson.pdf", /maxPages/, { maxPages: 101 });
  await denied("lesson.pdf", /1-page limit/, { maxPages: 1 });
  await fs.writeFile(path.join(workspace, "legacy.ppt"), "legacy");
  await denied("legacy.ppt", /Export it as .pptx or PDF/);
  await fs.writeFile(path.join(workspace, "bad.pdf"), "%PDF-not-a-document");
  await denied("bad.pdf", /could not be parsed/);
  await fs.writeFile(path.join(workspace, "empty.pdf"), "");
  await denied("empty.pdf", /nonempty/);
  const oversized = await fs.open(path.join(workspace, "oversized.pdf"), "w");
  await oversized.truncate(25 * 1024 * 1024 + 1); await oversized.close();
  await denied("oversized.pdf", /25 MiB/);
  await fs.writeFile(path.join(workspace, "entity.pptx"), zip({ ...parts, "ppt/presentation.xml": '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]><x>&x;</x>' }));
  await denied("entity.pptx", /declarations and external entities/);
  await fs.writeFile(path.join(workspace, "traversal.pptx"), zip({ "../evil.xml": "bad" }));
  await denied("traversal.pptx", /Malformed|unsafe/);
  await fs.writeFile(path.join(workspace, "bomb.pptx"), zip({ "bomb.xml": "small" }, { fakeSize: 70 * 1024 * 1024 }));
  await denied("bomb.pptx", /exceeds extraction limits/);
  await fs.writeFile(path.join(workspace, "malformed.pptx"), zip({ ...parts, "ppt/presentation.xml": "<bad><unclosed>" }));
  await denied("malformed.pptx", /Malformed PowerPoint XML/);
  const oversizedPng = Buffer.from(png); oversizedPng.writeUInt32BE(100_000, 16); oversizedPng.writeUInt32BE(100_000, 20);
  await fs.writeFile(path.join(workspace, "image-bomb.pptx"), zip({ ...parts, "ppt/media/image1.png": oversizedPng }));
  const imageBomb = await importLearningMaterial({ workspace, path: "image-bomb.pptx", ocr: false });
  check(!imageBomb.pages[0].images && imageBomb.warnings.some((warning) => /before decoding/.test(warning)), "Compressed image dimensions rejected before native decoding");
  const checksumZip = zip(parts); const centralHeader = checksumZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); checksumZip.writeUInt32LE(0, centralHeader + 16);
  await fs.writeFile(path.join(workspace, "checksum.pptx"), checksumZip);
  await denied("checksum.pptx", /checksum mismatch/);
  await fs.writeFile(path.join(scratch, "outside.pdf"), pdf(["Private outside text"]));
  await fs.symlink(scratch, path.join(workspace, "linked"), process.platform === "win32" ? "junction" : "dir");
  await denied("linked/outside.pdf", /Linked learning materials/);
  await fs.link(path.join(workspace, "lesson.pdf"), path.join(workspace, "hardlink.pdf"));
  await denied("hardlink.pdf", /unlinked file/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => importLearningMaterial({ workspace, path: "deck.pptx" }, aborted.signal), /abort/i); assertions++;
  const cancel = new AbortController();
  const pending = importLearningMaterial({ workspace, path: "deck.pptx" }, cancel.signal);
  setTimeout(() => cancel.abort(), 100);
  await assert.rejects(() => pending, /cancelled|abort/i); assertions++;
  console.log(`Learn materials: ${assertions} assertions passed (real PDF, scanned PDF OCR, PPTX notes/images/OCR, citations, denied paths and malformed documents).`);
} finally {
  // Remove the junction itself first; never recurse through a linked target.
  await fs.unlink(path.join(workspace, "linked")).catch(() => {});
  await fs.rm(scratch, { recursive: true, force: true });
}
