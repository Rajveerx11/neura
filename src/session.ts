import { randomUUID } from "node:crypto";
import { constants, renameSync, type Stats } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { assertUnlinkedDirectoryAncestors } from "../agent/neura/directory-path.ts";
import { COMMIT_ID, type TreeSnapshot } from "../agent/neura/verification.ts";
import { redactSensitiveText } from "../agent/neura/redaction.ts";

export const MAX_SESSION_MESSAGES = 200;
export const MAX_SESSION_BYTES = 1024 * 1024;
export const MAX_RECOVERY_BYTES = 256 * 1024;
export type TaskRecovery = {
  version: 1; taskId: string; workspaceKey: string;
  stage: "running" | "unfinished" | "completed" | "reconcile";
  baseHead: string | null; baseline: TreeSnapshot | null;
  failedChecks?: string[];
};
export type Session = { version: 1; id: string; createdAt: string; updatedAt: string; messages: any[]; recovery?: TaskRecovery; modelRoute?: string; earlierTurns?: string[] };
export type SessionSummary = Pick<Session, "id" | "createdAt" | "updatedAt">;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateRecovery(value: TaskRecovery): TaskRecovery {
  const keys = ["version", "taskId", "workspaceKey", "stage", "baseHead", "baseline"];
  if (!record(value) || !keys.every(key => Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && key !== 'failedChecks') ||
      value.version !== 1 || typeof value.taskId !== "string" || !idPattern.test(value.taskId) ||
      typeof value.workspaceKey !== "string" || !hashPattern.test(value.workspaceKey) ||
      !["running", "unfinished", "completed", "reconcile"].includes(value.stage) ||
      (value.baseHead !== null && (typeof value.baseHead !== "string" || !COMMIT_ID.test(value.baseHead)))) throw new Error("Invalid task recovery metadata");
  if (value.failedChecks !== undefined && (!Array.isArray(value.failedChecks) || value.failedChecks.length > 64 ||
      value.failedChecks.some(id => typeof id !== 'string' || !hashPattern.test(id)) ||
      new Set(value.failedChecks).size !== value.failedChecks.length || (value.stage === 'completed' && value.failedChecks.length))) throw new Error('Invalid unresolved regression checks');
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_RECOVERY_BYTES) throw new Error("Task recovery metadata exceeds limits");
  const baseline = value.baseline;
  if (baseline !== null) {
    if (!record(baseline) || Object.keys(baseline).sort().join(",") !== "files,fingerprint,head,root" ||
        typeof baseline.root !== "string" || !path.isAbsolute(baseline.root) || baseline.root.length > 4096 ||
        typeof baseline.head !== "string" || !COMMIT_ID.test(baseline.head) || baseline.head !== value.baseHead ||
        typeof baseline.fingerprint !== "string" || !hashPattern.test(baseline.fingerprint) ||
        !record(baseline.files) || Object.keys(baseline.files).length > 50_000) throw new Error("Invalid task recovery baseline");
    for (const [name, hash] of Object.entries(baseline.files)) {
      if (!name || name.length > 4096 || path.isAbsolute(name) || (process.platform === "win32" && name.includes("\\")) || name.includes("\0") ||
          name.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git") ||
          typeof hash !== "string" || (hash !== "missing" && !hashPattern.test(hash))) throw new Error("Invalid task recovery file hash");
    }
  }
  return value;
}

/** Hashes only; large snapshots keep the original HEAD but cannot support historical review. */
export function taskRecovery(workspaceKey: string, baseline: TreeSnapshot | null): TaskRecovery {
  const recovery: TaskRecovery = { version: 1, taskId: randomUUID(), workspaceKey, stage: "running", baseHead: baseline?.head ?? null, baseline };
  if (Buffer.byteLength(JSON.stringify(recovery)) > MAX_RECOVERY_BYTES) recovery.baseline = null;
  return validateRecovery(recovery);
}

function checkDirectory(directory: string) {
  if (!path.isAbsolute(directory) || directory.split(/[\\/]/).some((part) => part.replace(/[ .]+$/, "").toLowerCase() === ".pi")) {
    throw new Error("Sessions require an explicit Neura-owned absolute directory outside .pi");
  }
}

export async function sessionDirectory(directory: string, create = false): Promise<string> {
  checkDirectory(directory);
  let ancestor = path.resolve(directory);
  while (true) {
    try {
      await assertUnlinkedDirectoryAncestors(ancestor, "Linked session directory denied");
      const canonicalAncestor = await realpath(ancestor);
      checkDirectory(canonicalAncestor);
      break;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertUnlinkedDirectoryAncestors(directory, "Linked session directory denied");
  const canonical = await realpath(directory);
  checkDirectory(canonical);
  return canonical;
}

function sessionPath(directory: string, id: string) {
  if (typeof id !== "string" || !idPattern.test(id)) throw new Error("Invalid session id");
  return path.join(directory, `${id}.json`);
}

function validateMessages(messages: any[]): any[] {
  if (!Array.isArray(messages)) throw new Error("Invalid session messages");
  const pending = new Map<string, string>();
  const history = messages.map((message) => {
    if (!record(message) || !Object.hasOwn(message, "role") || !["user", "assistant", "tool"].includes(message.role as string)) throw new Error("Invalid session message role");
    if (message.role !== "tool" && pending.size) throw new Error("Incomplete tool exchange cannot be resumed");
    if (!Object.hasOwn(message, "content") || (typeof message.content !== "string" && !Array.isArray(message.content))) throw new Error("Invalid session message content");
    if (typeof message.content === "string" && message.role === "tool") throw new Error("Invalid tool result");
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!record(part) || !Object.hasOwn(part, "type")) throw new Error("Invalid session content part");
        if (part.type === "tool-call") {
          if (message.role !== "assistant" || typeof part.toolCallId !== "string" || typeof part.toolName !== "string" || pending.has(part.toolCallId)) throw new Error("Invalid tool call history");
          pending.set(part.toolCallId, part.toolName);
        } else if (part.type === "tool-result") {
          if (message.role !== "tool" || typeof part.toolCallId !== "string" || typeof part.toolName !== "string" || !pending.has(part.toolCallId) || pending.get(part.toolCallId) !== part.toolName) throw new Error("Unmatched tool result history");
          pending.delete(part.toolCallId);
        } else if (part.type === "text") {
          if (message.role === "tool" || typeof part.text !== "string") throw new Error("Invalid text history");
        } else if (part.type === "reasoning") {
          if (message.role !== "assistant" || typeof part.text !== "string") throw new Error("Invalid reasoning history");
        } else if (part.type === "image") {
          if (message.role !== "user" || typeof part.image !== "string") throw new Error("Invalid image history");
        } else throw new Error("Unsupported session content part");
      }
    }
    return { role: message.role, content: message.content };
  });
  if (pending.size) throw new Error("Incomplete tool exchange cannot be resumed");
  return history;
}

const scrubImages = (value: any): any => {
  if (Array.isArray(value)) return value.map(scrubImages);
  if (!value || typeof value !== "object") return value;
  if (["image", "media"].includes(value.type) && typeof value.data === "string") return { type: "text", text: "[Image removed from history after its turn. Read the page again if you need it.]" };
  // A pasted image would overflow the session cap; the model keeps its own earlier answer about it.
  if (value.type === "image" && typeof value.image === "string") return { type: "text", text: "[Pasted image removed from history after its turn. Paste it again if you need it.]" };
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scrubImages(child)]));
};

/** Tool images stay for their own turn only: one page can exceed the whole session cap, and tools can re-read it. */
export function withoutToolImages(messages: any[]): any[] {
  // Sessions saved by the retired Mastra runtime also copy tool output into the provider options of the call and its result.
  return messages.map((message) => Array.isArray(message.content) ? { ...message, content: scrubImages(message.content) } : message);
}

function condensedTurn(messages: any[]): string {
  const excerpt = (message: any) => {
    const value = message?.content;
    const text = typeof value === 'string' ? value : Array.isArray(value) ? value.filter(p => p.type === 'text').map(p => p.text).join(' ') : '';
    return redactSensitiveText(text, 256).replace(/\s+/g, ' ').trim();
  };
  return [excerpt(messages[0]), excerpt(messages.findLast(m => m.role === 'assistant' && excerpt(m)))].filter(Boolean).join(' | ');
}

function normalizedSession(session: Session, trim: boolean, summarize = false): Session {
  const required = ["version", "id", "createdAt", "updatedAt", "messages"];
  const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!record(session) || !required.every(key => Object.hasOwn(session, key)) || Object.keys(session).some(key => ![...required, "recovery", "modelRoute", "earlierTurns"].includes(key)) ||
      session.version !== 1 || typeof session.id !== "string" || !idPattern.test(session.id) || !timestamp(session.createdAt) || !timestamp(session.updatedAt)) throw new Error("Invalid session envelope");
  const result: Session = { version: 1, id: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt, messages: validateMessages(session.messages) };
  if (session.recovery !== undefined) result.recovery = validateRecovery(session.recovery);
  if (session.earlierTurns !== undefined) {
    if (!Array.isArray(session.earlierTurns) || session.earlierTurns.length > 8 || !session.earlierTurns.every(s => typeof s === 'string' && s.length <= 540)) throw new Error('Invalid session excerpts');
    result.earlierTurns = [...session.earlierTurns];
  }
  if (session.modelRoute !== undefined) {
    if (typeof session.modelRoute !== "string" || !hashPattern.test(session.modelRoute)) throw new Error("Invalid session model route");
    result.modelRoute = session.modelRoute;
  }
  while (result.messages.length > MAX_SESSION_MESSAGES || Buffer.byteLength(JSON.stringify(result)) > MAX_SESSION_BYTES) {
    if (!trim) throw new Error("Session exceeds history limits");
    const nextTurn = result.messages.findIndex((message, index) => index > 0 && message.role === "user");
    if (nextTurn < 0) {
      if (result.earlierTurns) { delete result.earlierTurns; continue; }
      throw new Error("Current turn exceeds session limits");
    }
    const removed = result.messages.splice(0, nextTurn);
    if (summarize) {
      const note = condensedTurn(removed);
      if (note) result.earlierTurns = [...(result.earlierTurns ?? []), note].slice(-8);
    }
  }
  return result;
}

function safeFile(stat: Stats) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Session must be an unlinked regular file");
  if (stat.size > MAX_SESSION_BYTES) throw new Error("Session exceeds history limits");
}

function sameFile(before: Stats, after: Stats) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

async function rejectLinkedFile(filename: string) {
  const stat = await lstat(filename);
  safeFile(stat);
  return stat;
}

/** Creates only a new empty history; never loads framework or machine profiles. */
export async function createSession(directory: string, modelRoute?: string): Promise<Session> {
  const root = await sessionDirectory(directory, true);
  const now = new Date().toISOString();
  const session = normalizedSession({ version: 1, id: randomUUID(), createdAt: now, updatedAt: now, messages: [], modelRoute }, false);
  const filename = sessionPath(root, session.id);
  const temporary = path.join(root, `.${session.id}.${randomUUID()}.tmp`);
  const bytes = JSON.stringify(session);
  const file = await open(temporary, "wx", 0o600);
  let published: Stats | undefined;
  try {
    let written: Stats;
    try { await file.writeFile(bytes); await file.sync(); written = await file.stat(); safeFile(written); }
    finally { await file.close(); }
    if (written.size !== Buffer.byteLength(bytes) || await sessionDirectory(root) !== root || !sameFile(written, await rejectLinkedFile(temporary))) throw new Error("Session changed before publication");
    // Publish complete bytes without replacing an existing name; removing the temporary link leaves nlink === 1.
    try { await link(temporary, filename); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(code ?? "")) {
        throw new Error(`Cannot create session history hardlink (${code}). Check directory permissions or set NEURA_HOME to a filesystem supporting hardlinks. Use --no-history for in-memory history.`, { cause: error });
      }
      throw error;
    }
    published = written;
  } finally {
    await unlink(temporary).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return;
      if (published && await sessionDirectory(root) === root) {
        const current = await lstat(filename).catch((failure: NodeJS.ErrnoException) => { if (failure.code !== "ENOENT") throw failure; });
        // Roll back only our new link; a replacement or edited session belongs to its current owner.
        if (current?.isFile() && current.dev === published.dev && current.ino === published.ino && current.size === published.size && current.mtimeMs === published.mtimeMs) await unlink(filename);
      }
      throw error;
    });
  }
  return session;
}

export async function resumeSession(directory: string, id: string): Promise<Session> {
  const root = await sessionDirectory(directory);
  const filename = sessionPath(root, id);
  const before = await rejectLinkedFile(filename);
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat(); safeFile(stat);
    if (!sameFile(before, stat)) throw new Error("Session changed while reading");
    const buffer = Buffer.alloc(MAX_SESSION_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_SESSION_BYTES) throw new Error("Session exceeds history limits");
    if (bytesRead !== stat.size || !sameFile(stat, await file.stat()) || await sessionDirectory(root) !== root || !sameFile(before, await rejectLinkedFile(filename))) throw new Error("Session changed while reading");
    const session = normalizedSession(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")), false);
    if (session.id !== id) throw new Error("Session id mismatch");
    return session;
  } finally { await file.close(); }
}

/** Single-writer history replacement. Tools and approval authority are never serialized. */
export async function saveSession(directory: string, session: Session, summarize = false): Promise<Session> {
  // Validate and detach the complete JSON payload before any await; callers retain mutable history objects.
  const bytes = JSON.stringify(normalizedSession({ ...session, updatedAt: new Date().toISOString() }, true, summarize));
  const saved = normalizedSession(JSON.parse(bytes), false);
  const root = await sessionDirectory(directory);
  const filename = sessionPath(root, saved.id);
  const before = await rejectLinkedFile(filename);
  const previous = (await resumeSession(root, saved.id)).recovery;
  if (previous) {
    const next = saved.recovery;
    const sameTask = next?.taskId === previous.taskId;
    if (!next || next.workspaceKey !== previous.workspaceKey ||
        (sameTask && (next.baseHead !== previous.baseHead || JSON.stringify(next.baseline) !== JSON.stringify(previous.baseline) ||
          (previous.stage === "completed" && !["completed", "reconcile"].includes(next.stage)))) ||
        (!sameTask && (previous.stage !== "completed" || next.stage !== "running"))) throw new Error("Original task identity/base cannot be replaced before completion");
  }
  const temporary = path.join(root, `.${saved.id}.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    let written: Stats;
    try { await file.writeFile(bytes); await file.sync(); written = await file.stat(); safeFile(written); }
    finally { await file.close(); }
    if (written.size !== Buffer.byteLength(bytes) || await sessionDirectory(root) !== root || !sameFile(before, await rejectLinkedFile(filename)) || !sameFile(written, await rejectLinkedFile(temporary))) throw new Error("Session changed before publication");
    renameSync(temporary, filename);
  } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
  return saved;
}

export async function appendSession(directory: string, id: string, messages: any[]): Promise<Session> {
  const session = await resumeSession(directory, id);
  return saveSession(directory, { ...session, messages: [...session.messages, ...messages] });
}

export async function listSessions(directory: string): Promise<SessionSummary[]> {
  let root: string;
  try { root = await sessionDirectory(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const summaries: SessionSummary[] = [];
  for (const name of await readdir(root)) {
    if (!name.endsWith(".json") || !idPattern.test(name.slice(0, -5))) continue;
    const { id, createdAt, updatedAt } = await resumeSession(root, name.slice(0, -5));
    summaries.push({ id, createdAt, updatedAt });
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
