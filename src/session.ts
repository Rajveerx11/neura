import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const MAX_SESSION_MESSAGES = 200;
export const MAX_SESSION_BYTES = 1024 * 1024;
export type Session = { version: 1; id: string; createdAt: string; updatedAt: string; messages: any[] };
export type SessionSummary = Pick<Session, "id" | "createdAt" | "updatedAt">;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function checkDirectory(directory: string) {
  if (!path.isAbsolute(directory) || directory.split(/[\\/]/).some((part) => part.replace(/[ .]+$/, "").toLowerCase() === ".pi")) {
    throw new Error("Sessions require an explicit Neura-owned absolute directory outside .pi");
  }
}

async function sessionDirectory(directory: string, create = false): Promise<string> {
  checkDirectory(directory);
  let ancestor = path.resolve(directory);
  while (true) {
    try {
      const canonicalAncestor = await realpath(ancestor);
      checkDirectory(canonicalAncestor);
      // Refuse linked existing ancestors before mkdir can publish beneath their targets.
      if (path.relative(ancestor, canonicalAncestor) !== "") throw new Error("Linked session directory denied");
      break;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  checkDirectory(canonical);
  if (path.relative(path.resolve(directory), canonical) !== "") throw new Error("Linked session directory denied");
  if (!(await lstat(canonical)).isDirectory()) throw new Error("Session directory is not a directory");
  return canonical;
}

function sessionPath(directory: string, id: string) {
  if (!idPattern.test(id)) throw new Error("Invalid session id");
  return path.join(directory, `${id}.json`);
}

function validateMessages(messages: any[]): any[] {
  if (!Array.isArray(messages)) throw new Error("Invalid session messages");
  const pending = new Map<string, string>();
  const history = messages.map((message) => {
    if (!message || !["user", "assistant", "tool"].includes(message.role)) throw new Error("Invalid session message role");
    if (message.role !== "tool" && pending.size) throw new Error("Incomplete tool exchange cannot be resumed");
    if (typeof message.content !== "string" && !Array.isArray(message.content)) throw new Error("Invalid session message content");
    if (typeof message.content === "string" && message.role === "tool") throw new Error("Invalid tool result");
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!part || typeof part !== "object") throw new Error("Invalid session content part");
        if (part.type === "tool-call") {
          if (message.role !== "assistant" || typeof part.toolCallId !== "string" || typeof part.toolName !== "string" || pending.has(part.toolCallId)) throw new Error("Invalid tool call history");
          pending.set(part.toolCallId, part.toolName);
        } else if (part.type === "tool-result") {
          if (message.role !== "tool" || pending.get(part.toolCallId) !== part.toolName) throw new Error("Unmatched tool result history");
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

function normalizedSession(session: Session, trim: boolean): Session {
  if (session.version !== 1 || !idPattern.test(session.id) || !Number.isFinite(Date.parse(session.createdAt)) || !Number.isFinite(Date.parse(session.updatedAt))) throw new Error("Invalid session envelope");
  const result: Session = { version: 1, id: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt, messages: validateMessages(session.messages) };
  while (result.messages.length > MAX_SESSION_MESSAGES || Buffer.byteLength(JSON.stringify(result)) > MAX_SESSION_BYTES) {
    if (!trim) throw new Error("Session exceeds history limits");
    const nextTurn = result.messages.findIndex((message, index) => index > 0 && message.role === "user");
    if (nextTurn < 0) throw new Error("Current turn exceeds session limits");
    result.messages.splice(0, nextTurn);
  }
  return result;
}

async function rejectLinkedFile(filename: string) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Session must be an unlinked regular file");
  if (stat.size > MAX_SESSION_BYTES) throw new Error("Session exceeds history limits");
}

/** Creates only a new empty history; never loads framework or machine profiles. */
export async function createSession(directory: string): Promise<Session> {
  const root = await sessionDirectory(directory, true);
  const now = new Date().toISOString();
  const session: Session = { version: 1, id: randomUUID(), createdAt: now, updatedAt: now, messages: [] };
  const file = await open(sessionPath(root, session.id), "wx", 0o600);
  try { await file.writeFile(JSON.stringify(session)); await file.sync(); } finally { await file.close(); }
  return session;
}

export async function resumeSession(directory: string, id: string): Promise<Session> {
  const filename = sessionPath(await sessionDirectory(directory), id);
  await rejectLinkedFile(filename);
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_SESSION_BYTES) throw new Error("Unsafe session file");
    const buffer = Buffer.alloc(MAX_SESSION_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_SESSION_BYTES) throw new Error("Session exceeds history limits");
    const session = normalizedSession(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")), false);
    if (session.id !== id) throw new Error("Session id mismatch");
    return session;
  } finally { await file.close(); }
}

/** Single-writer history replacement. Tools and approval authority are never serialized. */
export async function saveSession(directory: string, session: Session): Promise<Session> {
  const root = await sessionDirectory(directory);
  const filename = sessionPath(root, session.id);
  await rejectLinkedFile(filename);
  const saved = normalizedSession({ ...session, updatedAt: new Date().toISOString() }, true);
  const temporary = path.join(root, `.${session.id}.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try { await file.writeFile(JSON.stringify(saved)); await file.sync(); } finally { await file.close(); }
    await rejectLinkedFile(filename);
    await rename(temporary, filename);
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
