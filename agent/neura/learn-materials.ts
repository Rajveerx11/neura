import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface LearningImage {
  mimeType: "image/png";
  data: string;
  description: string;
}
export interface LearningPage {
  number: number;
  text: string;
  notes?: string;
  images?: LearningImage[];
  extraction: "text" | "ocr" | "empty";
}
export interface LearningMaterial {
  id: string;
  name: string;
  kind: "pdf" | "pptx";
  pages: LearningPage[];
  warnings: string[];
}
export interface LearningMaterialOptions {
  workspace: string;
  path: string;
  /** English OCR for pages/images without extractable text. Default true. */
  ocr?: boolean;
  /** Retain previews in returned material. OCR can still render privately. */
  includeImages?: boolean;
  /** Reject larger documents rather than silently omit pages. Maximum 100. */
  maxPages?: number;
}
export const LEARNING_MATERIAL_LIMITS = Object.freeze({
  inputBytes: 25 * 1024 * 1024,
  pages: 100,
  outputBytes: 16 * 1024 * 1024,
  timeoutMs: 120_000,
});

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Read one contained regular file; no links, UNC/device paths, URLs, or ADS. */
async function readSource(options: LearningMaterialOptions): Promise<{ bytes: Buffer; name: string; kind: "pdf" | "pptx" }> {
  const supplied = options.path;
  if (typeof supplied !== "string" || !supplied || supplied.length > 4096 || /[\x00-\x1f]/.test(supplied)
    || /^[\\/]{2}/.test(supplied) || /^[a-z][a-z0-9+.-]*:\/\//i.test(supplied)
    || /:/.test(supplied.replace(/^[a-z]:[\\/]/i, ""))) {
    throw new Error("Learning material must be a local workspace file, without URLs, device paths, or alternate streams.");
  }
  const root = await fs.realpath(options.workspace);
  const candidate = path.resolve(root, supplied);
  if (!inside(root, candidate)) throw new Error("Learning material must remain inside the workspace.");
  if (path.relative(root, candidate).split(path.sep).some((component) => component.startsWith(".") || /^(?:node_modules|sessions|approvals)$/i.test(component))) {
    throw new Error("Learning materials cannot be imported from hidden, dependency, session, or approval directories.");
  }
  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep)) {
    current = path.join(current, component);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Linked learning materials or linked parent directories are not allowed.");
  }
  const canonical = await fs.realpath(candidate);
  if (!inside(root, canonical)) throw new Error("Learning material resolves outside the workspace.");
  const extension = path.extname(candidate).toLowerCase();
  if (extension === ".ppt") throw new Error("Legacy .ppt is unsupported. Export it as .pptx or PDF in PowerPoint or LibreOffice, then import that file.");
  if (extension !== ".pdf" && extension !== ".pptx") throw new Error("Supported learning materials: .pdf and .pptx.");
  const before = await fs.lstat(candidate);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1) throw new Error("Learning material must be an ordinary, unlinked file.");
  if (!before.size || before.size > LEARNING_MATERIAL_LIMITS.inputBytes) throw new Error("Learning material must be nonempty and at most 25 MiB.");
  const handle = await fs.open(candidate, "r");
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size || opened.nlink > 1) {
      throw new Error("Learning material changed during import; try again.");
    }
    // An explicit bounded read also protects against a file growing after stat.
    const buffer = Buffer.alloc(opened.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(buffer, count, buffer.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    const after = await handle.stat();
    if (count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || await fs.realpath(candidate) !== canonical) throw new Error("Learning material changed during import; try again.");
    return { bytes: buffer.subarray(0, count), name: path.basename(candidate), kind: extension.slice(1) as "pdf" | "pptx" };
  } finally { await handle.close(); }
}

/** Parse captured bytes in a disposable worker. Never execute document scripts or office software. */
export async function importLearningMaterial(options: LearningMaterialOptions, signal?: AbortSignal): Promise<LearningMaterial> {
  signal?.throwIfAborted();
  const maxPages = options.maxPages ?? LEARNING_MATERIAL_LIMITS.pages;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > LEARNING_MATERIAL_LIMITS.pages) throw new Error("maxPages must be between 1 and 100.");
  const { bytes, name, kind } = await readSource(options);
  signal?.throwIfAborted();
  const id = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const result = await new Promise<{ pages: LearningPage[]; warnings: string[] }>((resolve, reject) => {
    const worker = fork(fileURLToPath(new URL("./learn-materials-worker.mjs", import.meta.url)), [], {
      execArgv: ["--max-old-space-size=384"],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      // Node passes this through to spawn, although ForkOptions omits its type.
      ...{ windowsHide: true },
      // Avoid passing credentials or runtime hooks to parsers and OCR workers.
      env: { ...Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP"].filter((key) => process.env[key]).map((key) => [key, process.env[key]!])), DISABLE_SYSTEM_FONTS_LOAD: "1" },
    });
    let done = false;
    const finish = (error?: Error, value?: { pages: LearningPage[]; warnings: string[] }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.kill();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new Error("Learning material import cancelled."));
    const timer = setTimeout(() => finish(new Error("Learning material exceeded the 120-second parsing limit. Split the document or disable OCR.")), LEARNING_MATERIAL_LIMITS.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("error", () => finish(new Error("Learning document worker could not start.")));
    worker.on("exit", () => finish(new Error("Learning document worker stopped before completing. Check Learn runtime dependencies or simplify the document.")));
    worker.on("message", (message: any) => {
      if (message?.error) return finish(new Error(String(message.error).slice(0, 500)));
      if (!Array.isArray(message?.pages) || !Array.isArray(message?.warnings)
        || Buffer.byteLength(JSON.stringify(message)) > LEARNING_MATERIAL_LIMITS.outputBytes) {
        return finish(new Error("Learning material extraction exceeded its output limit."));
      }
      finish(undefined, message);
    });
    if (signal?.aborted) abort();
    else worker.send({ bytes, kind, maxPages, ocr: options.ocr !== false, includeImages: options.includeImages !== false });
  });
  return { id, name, kind, ...result };
}

/** Validate exact source identity, page/slide, and quoted excerpt; this does not prove a claim's interpretation. */
export function validateLearningCitation(material: LearningMaterial, citation: { sourceId: string; filename: string; unit: "page" | "slide"; number: number; excerpt: string }): boolean {
  if (citation.sourceId !== material.id || citation.filename !== material.name
    || citation.unit !== (material.kind === "pdf" ? "page" : "slide") || !Number.isInteger(citation.number)
    || typeof citation.excerpt !== "string" || !citation.excerpt.trim() || citation.excerpt.length > 4000) return false;
  const page = material.pages.find((entry) => entry.number === citation.number);
  if (!page) return false;
  const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
  const excerpt = normalized(citation.excerpt);
  return [page.text, page.notes ?? ""].some((text) => normalized(text).includes(excerpt));
}
