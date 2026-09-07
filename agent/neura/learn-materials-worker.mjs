// Disposable parser process. Only captured local bytes enter; nothing is written.
import { createRequire } from "node:module";
import * as path from "node:path";
import { crc32 } from "node:zlib";
import { SaxesParser } from "saxes";
import yauzl from "yauzl";

const require = createRequire(import.meta.url);
const MAX_TEXT = 1_000_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
let retainedImages = 0;
let retainedText = 0;
let ocrWorker;
let ocrUnavailable = false;
const warnings = [];
const warn = (message) => { if (!warnings.includes(message)) warnings.push(message); };
const fail = (message) => { throw new Error(message); };

function textBudget(text) {
  if (text.length > 100_000 || (retainedText += text.length) > MAX_TEXT) fail("Document text exceeds the supported extraction limit. Split the document.");
  return text.replace(/\u0000/g, "").trim();
}

async function canvasLibrary() { return import("@napi-rs/canvas"); }

function retainImage(buffer, description, options) {
  if (!options.includeImages) return undefined;
  if (buffer.length > 1024 * 1024 || retainedImages + buffer.length > MAX_IMAGE_BYTES) {
    warn("Some previews were omitted because the image budget was reached. Text and page numbering are retained.");
    return undefined;
  }
  retainedImages += buffer.length;
  return { mimeType: "image/png", data: buffer.toString("base64"), description };
}

// Check dimensions before native decoding, including compressed image bombs.
function imageDimensions(bytes, png) {
  if (png) {
    if (bytes.length < 24 || bytes.subarray(12, 16).toString() !== "IHDR") return undefined;
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) return undefined;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) return undefined;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return size >= 7 ? [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)] : undefined;
    }
    offset += size;
  }
  return undefined;
}

async function recognize(image, options) {
  if (!options.ocr) { warn("OCR is disabled. Image-only content has no searchable text."); return ""; }
  if (ocrUnavailable) return "";
  try {
    if (!ocrWorker) {
      const { createWorker } = await import("tesseract.js");
      // An explicit installed local path bypasses the default CDN; no disk cache.
      const { access } = await import("node:fs/promises");
      const language = require("@tesseract.js-data/eng");
      await access(path.join(language.langPath, "eng.traineddata.gz"));
      ocrWorker = await createWorker("eng", 1, { langPath: language.langPath, cacheMethod: "none", gzip: true, logger: () => {}, errorHandler: () => {} });
    }
    const result = await ocrWorker.recognize(image);
    warn("English OCR was used for image-only content. Check extracted wording against the preview; OCR can misread diagrams, handwriting, and other languages.");
    return result.data.text.trim();
  } catch {
    ocrUnavailable = true;
    warn("Offline English OCR is unavailable. Repair the pinned Learn runtime dependencies; image-only content remains untranscribed.");
    return "";
  }
}

async function pdf(bytes, options) {
  if (bytes.subarray(0, 5).toString() !== "%PDF-") fail("Invalid PDF header.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const loading = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    cMapUrl: path.join(pdfRoot, "cmaps").replaceAll("\\", "/") + "/",
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfRoot, "standard_fonts").replaceAll("\\", "/") + "/",
    wasmUrl: path.join(pdfRoot, "wasm").replaceAll("\\", "/") + "/",
    maxImageSize: 16_000_000,
    verbosity: 0,
    stopAtErrors: true,
  });
  let document;
  try { document = await loading.promise; }
  catch (error) {
    await loading.destroy();
    fail(error?.name === "PasswordException" ? "Password-protected PDF is unsupported. Export an unlocked copy before importing." : "PDF could not be parsed. Export a fresh PDF and try again.");
  }
  try {
    if (!document.numPages || document.numPages > options.maxPages) fail(`PDF exceeds the ${options.maxPages}-page limit. Split it into smaller documents.`);
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = content.items.map((item) => typeof item.str === "string" ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      let extraction = text ? "text" : "empty";
      let images;
      try {
        if (options.includeImages || (!text && options.ocr)) {
          const { createCanvas } = await canvasLibrary();
          const original = page.getViewport({ scale: 1 });
          if (!Number.isFinite(original.width) || !Number.isFinite(original.height) || original.width <= 0 || original.height <= 0) fail("Invalid PDF page dimensions.");
          const viewport = page.getViewport({ scale: Math.min(2, 1400 / Math.max(original.width, original.height)) });
          const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
          await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvas, background: "#ffffff" }).promise;
          const png = canvas.toBuffer("image/png");
          if (!text) { text = await recognize(png, options); extraction = text ? "ocr" : "empty"; }
          const image = retainImage(png, `Original PDF page ${number} raster preview`, options);
          if (image) images = [image];
        }
      } catch { warn(`Page ${number} preview could not be rendered; extracted text is retained. Image-only content may be unreadable.`); }
      if (!text) warn(`Page ${number} has no extractable text. Inspect its preview or supply a clearer copy.`);
      pages.push({ number, text: textBudget(text), extraction, ...(images ? { images } : {}) });
      page.cleanup();
    }
    return pages;
  } finally { await loading.destroy(); }
}

/** A strict XML tree: no DTD, entities, network resolution, or executable markup. */
function xml(bytes) {
  if (!bytes || bytes.length > 4 * 1024 * 1024) fail("Missing or oversized PowerPoint XML part.");
  const source = bytes.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail("PowerPoint XML declarations and external entities are not allowed.");
  const parser = new SaxesParser({ xmlns: true });
  let root;
  const stack = [];
  let nodes = 0;
  parser.on("opentag", (tag) => {
    if (++nodes > 100_000 || stack.length > 80) fail("PowerPoint XML exceeds structural limits.");
    const node = { local: tag.local, uri: tag.uri, attributes: tag.attributes, children: [], text: "" };
    if (stack.length) stack.at(-1).children.push(node); else root = node;
    stack.push(node);
  });
  const append = (text) => { if (stack.length) stack.at(-1).text += text; };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => stack.pop());
  parser.on("error", () => fail("Malformed PowerPoint XML."));
  parser.write(source).close();
  if (!root) fail("Empty PowerPoint XML part.");
  return root;
}
function descendants(node, local) {
  return [...(node.local === local ? [node] : []), ...node.children.flatMap((child) => descendants(child, local))];
}
function attribute(node, local) { return Object.values(node.attributes).find((entry) => entry.local === local)?.value; }
function drawingText(root) {
  return descendants(root, "p").map((paragraph) => descendants(paragraph, "t").map((entry) => entry.text).join("")).filter(Boolean).join("\n");
}

async function unzip(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(new Error("PowerPoint is not a valid ZIP-based .pptx file."));
      const parts = new Map();
      let expanded = 0;
      let entries = 0;
      let stopped = false;
      const stop = (message) => { if (!stopped) { stopped = true; zip.close(); reject(new Error(message)); } };
      zip.on("error", () => stop("Malformed or unsupported PowerPoint archive."));
      zip.on("entry", (entry) => {
        const name = entry.fileName;
        if (++entries > 3000 || (expanded += entry.uncompressedSize) > MAX_ZIP_BYTES || entry.uncompressedSize > 16 * 1024 * 1024) return stop("PowerPoint archive exceeds extraction limits. Split or simplify the presentation.");
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (name.includes("\\") || name.startsWith("/") || name.includes(":") || name.split("/").includes("..") || /[\x00-\x1f]/.test(name) || parts.has(name) || mode === 0xa000 || (entry.generalPurposeBitFlag & 1)) return stop("PowerPoint archive contains unsafe, duplicate, linked, or encrypted entries.");
        if (name.endsWith("/")) { parts.set(name, Buffer.alloc(0)); return zip.readEntry(); }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return stop("PowerPoint archive entry could not be read.");
          const chunks = [];
          let count = 0;
          stream.on("data", (chunk) => {
            count += chunk.length;
            if (count > entry.uncompressedSize || count > 16 * 1024 * 1024) { stream.destroy(); stop("PowerPoint archive entry exceeded its declared size."); }
            else chunks.push(chunk);
          });
          stream.on("error", () => stop("Corrupt PowerPoint archive entry."));
          stream.on("end", () => {
            if (stopped) return;
            if (count !== entry.uncompressedSize) return stop("PowerPoint archive entry size mismatch.");
            const content = Buffer.concat(chunks);
            if (crc32(content) !== entry.crc32) return stop("PowerPoint archive entry checksum mismatch.");
            parts.set(name, content);
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => { if (!stopped) resolve(parts); });
      zip.readEntry();
    });
  });
}

function relations(parts, part) {
  const relationshipPart = path.posix.join(path.posix.dirname(part), "_rels", path.posix.basename(part) + ".rels");
  const bytes = parts.get(relationshipPart);
  if (!bytes) return new Map();
  const result = new Map();
  for (const entry of descendants(xml(bytes), "Relationship")) {
    const id = attribute(entry, "Id");
    const target = attribute(entry, "Target");
    const type = attribute(entry, "Type");
    if (!id || !target || !type || result.has(id)) fail("Invalid or duplicate PowerPoint relationship.");
    if (attribute(entry, "TargetMode") === "External") {
      warn("External PowerPoint links and linked media were ignored; no network requests were made.");
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:|^\/\/|\\|[\x00-\x1f]/i.test(target)) fail("Unsafe PowerPoint relationship target.");
    const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(part), target));
    if (resolved.startsWith("../") || resolved.includes("%") || resolved.includes("#") || !parts.has(resolved)) fail("PowerPoint relationship points to a missing or unsafe part.");
    result.set(id, { type, target: resolved });
  }
  return result;
}

async function pptx(bytes, options) {
  const parts = await unzip(bytes);
  if (!parts.has("[Content_Types].xml") || !parts.has("ppt/presentation.xml")) fail("Archive is not a PowerPoint .pptx presentation.");
  if ([...parts.keys()].some((name) => /vbaProject|activeX|embeddings\//i.test(name))) warn("Macros, embedded objects, and active content were ignored and never executed.");
  const presentation = xml(parts.get("ppt/presentation.xml"));
  const presentationRelations = relations(parts, "ppt/presentation.xml");
  const slides = descendants(presentation, "sldId");
  if (!slides.length || slides.length > options.maxPages) fail(`Presentation must contain 1-${options.maxPages} slides. Split larger decks.`);
  const pages = [];
  for (const [index, slide] of slides.entries()) {
    // The relationship id is namespaced; numeric p:sldId/@id is not it.
    const relationshipId = Object.values(slide.attributes).find((entry) => entry.local === "id" && entry.uri)?.value;
    const relationship = presentationRelations.get(relationshipId);
    if (!relationship?.type.endsWith("/slide")) fail("PowerPoint slide order contains an invalid relationship.");
    const root = xml(parts.get(relationship.target));
    let text = drawingText(root);
    let extraction = text ? "text" : "empty";
    const related = relations(parts, relationship.target);
    const note = [...related.values()].find((entry) => entry.type.endsWith("/notesSlide"));
    const notes = note ? drawingText(xml(parts.get(note.target))) : undefined;
    const images = [];
    let processed = 0;
    for (const blip of descendants(root, "blip")) {
      const imageRelation = related.get(attribute(blip, "embed"));
      if (!imageRelation?.type.endsWith("/image")) continue;
      if (++processed > 8) { warn(`Slide ${index + 1} has more than eight embedded images; remaining images were omitted.`); break; }
      const imageBytes = parts.get(imageRelation.target);
      const isPng = imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg = imageBytes[0] === 255 && imageBytes[1] === 216 && imageBytes[2] === 255;
      if (!isPng && !isJpeg) { warn("Only embedded PNG/JPEG images are previewed. Export the deck as PDF for full slide visuals, charts, SVG, or other image formats."); continue; }
      const dimensions = imageDimensions(imageBytes, isPng);
      if (!dimensions || !dimensions[0] || !dimensions[1] || dimensions[0] * dimensions[1] > 16_000_000) { warn("An invalid or oversized embedded image was omitted before decoding."); continue; }
      try {
        const { loadImage, createCanvas } = await canvasLibrary();
        const image = await loadImage(imageBytes);
        if (!image.width || !image.height || image.width * image.height > 16_000_000) { warn("An oversized embedded image was omitted."); continue; }
        const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
        const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = canvas.toBuffer("image/png");
        // OCR images even when other slide text exists; label that text explicitly.
        if (options.ocr) {
          const recognized = await recognize(png, options);
          if (recognized) { text += `${text ? "\n" : ""}[Embedded image OCR]\n${recognized}`; if (extraction === "empty") extraction = "ocr"; }
        }
        const retained = retainImage(png, `Embedded image ${processed} from slide ${index + 1}; not a full slide rendering`, options);
        if (retained) images.push(retained);
      } catch { warn(`An embedded image on slide ${index + 1} could not be decoded.`); }
    }
    if (!text) warn(`Slide ${index + 1} has no extractable body text. Review its notes and images or export as PDF.`);
    pages.push({ number: index + 1, text: textBudget(text), extraction, ...(notes ? { notes: textBudget(notes) } : {}), ...(images.length ? { images } : {}) });
  }
  warn("PPTX preserves slide order, text, speaker notes, and embedded PNG/JPEG images. Layout, charts, SmartArt, equations, animations, and master slides are not rendered; export to PDF for faithful slide previews.");
  return pages;
}

process.once("message", async (options) => {
  try {
    const bytes = Buffer.from(options.bytes);
    const pages = options.kind === "pdf" ? await pdf(bytes, options) : await pptx(bytes, options);
    await ocrWorker?.terminate();
    process.send({ pages, warnings }, () => process.exit(0));
  } catch (error) {
    await ocrWorker?.terminate().catch(() => {});
    const missing = error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND";
    process.send({ error: missing ? "Learn document dependencies are missing. Run npm ci --ignore-scripts in the installed neura directory or reinstall Neura from source." : String(error?.message ?? "Document extraction failed.").slice(0, 400) }, () => process.exit(1));
  }
});
