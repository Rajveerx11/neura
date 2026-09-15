import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { learnPathInside, readLearnRegular, realLearnDirectory, writeLearnExclusive } from "./learn-files.ts";
import { redactSensitiveText } from "./redaction.ts";

const MANAGED = "Neura";
const SYSTEM = "_System";
const EVENTS = "events";
const MARKER = "neura-learn-vault-v1\n";
const OWNER = ".neura-owner";
const CONFIG_LIMIT = 4096;
const EVENT_LIMIT = 32 * 1024;
export const MAX_LEARN_VAULT_EVENTS = 2000;
const EVENT_NAME = /^(\d{4})\.json$/;

export const LEARN_PREFERENCE_VALUES = Object.freeze({
  explanation: ["short", "balanced", "detailed"],
  exampleTiming: ["first", "after-theory"],
  diagrams: ["prefer", "when-useful", "minimal"],
  hintStyle: ["progressive", "direct", "question-led"],
  pace: ["slower", "balanced", "faster"],
} as const);

export type LearnPreferenceKey = keyof typeof LEARN_PREFERENCE_VALUES;
export type LearnPreferenceValue = (typeof LEARN_PREFERENCE_VALUES)[LearnPreferenceKey][number];
type BaseInput = { lessonId: string; title: string; topic?: string; lessonRevision?: string };
export type LearnVaultInput =
  | (BaseInput & { type: "concept"; goal: string; bullets: string[]; example: string; nextStep: string })
  | (BaseInput & { type: "practice"; correct: boolean | null; assisted: boolean; revealed: boolean; exerciseKind: string })
  | (BaseInput & { type: "finding"; finding?: string; nextStep?: string })
  | (BaseInput & { type: "preference"; key: LearnPreferenceKey; value: LearnPreferenceValue; evidenceDigest: string });

type LearnVaultEvent = LearnVaultInput & { version: 1; id: string; at: string };
type LearnVaultEnvelope = { version: 1; digest: string; event: LearnVaultEvent };
export type LearnVaultContext = {
  enabled: boolean;
  preferences: Partial<Record<LearnPreferenceKey, LearnPreferenceValue>>;
  difficulties: Array<{ lessonId: string; count: number }>;
};

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function bounded(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`${label} must contain 1-${limit} characters.`);
  return value.trim();
}
function stableIdentifier(value: unknown, limit: number, label: string): string {
  const identifier = bounded(value, limit, label);
  // Lesson slugs can legitimately be long and varied, so generic entropy
  // detection would reject ordinary identifiers. Reject credential formats
  // that can survive the slug grammar; other free text is minimized separately.
  if (/^(?:sk-(?:proj-)?[a-z0-9-]{16,}|xox[baprs]-[a-z0-9-]{16,})$/i.test(identifier)) {
    throw new Error(`${label} contains sensitive-looking content.`);
  }
  return identifier;
}
function minimizedText(value: string, limit: number): string {
  return redactSensitiveText(value, limit).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
function safeText(value: string, limit: number): string {
  return minimizedText(value, limit)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/!/g, "\\!").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
function slug(value: string): string {
  const result = value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return result || "general";
}
function isNetworkPath(value: string): boolean { return /^\\\\|^\/\//.test(value); }
function fenced(value: string): string {
  const text = minimizedText(value, 4000);
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

async function configuredVault(): Promise<string | null> {
  let configured = process.env.NEURA_LEARN_VAULT?.trim() ?? "";
  if (!configured) {
    const config = path.join(os.homedir(), ".pi", "agent", "neura", "learn-vault.json");
    try {
      const parsed = JSON.parse(await readLearnRegular(config, CONFIG_LIMIT));
      if (!parsed || parsed.version !== 1 || typeof parsed.vault !== "string" || Object.keys(parsed).some((key) => !["version", "vault"].includes(key))) {
        throw new Error("Learn vault configuration is invalid.");
      }
      configured = parsed.vault.trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  if (!configured) return null;
  if (!path.isAbsolute(configured) || isNetworkPath(configured)) throw new Error("Learn vault must be an absolute path and cannot be a UNC path.");
  const vault = await realLearnDirectory(configured);
  const obsidian = await realLearnDirectory(path.join(vault, ".obsidian"));
  if (path.dirname(obsidian) !== vault) throw new Error("Learn vault marker escaped the configured vault.");
  return vault;
}

async function realChild(root: string, child: string): Promise<string> {
  const canonical = await realLearnDirectory(path.join(root, child));
  if (!learnPathInside(root, canonical) || path.dirname(canonical) !== root) throw new Error("Learn vault path escaped its owned parent.");
  return canonical;
}

async function ensureChild(root: string, child: string): Promise<string> {
  const destination = path.join(root, child);
  try { await fs.mkdir(destination, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return realChild(root, child);
}

async function waitForConcurrentOwner(root: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      const marker = await readLearnRegular(path.join(root, OWNER), 64);
      if (marker === MARKER) return;
      // A concurrent exclusive writer may have created the marker but not yet
      // flushed its bytes. Give that bounded publication window time to finish.
      if (Date.now() >= deadline) throw new Error("Existing Neura vault subtree is not owned by Neura.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const entries = await fs.readdir(root);
      if (entries.length && !(entries.length === 1 && entries[0] === OWNER)) throw new Error("Existing Neura vault subtree is not owned by Neura.");
      if (Date.now() >= deadline) throw new Error("Existing empty Neura vault subtree is not owned by Neura.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function managedRoot(vault: string, create: boolean): Promise<{ root: string; system: string; events: string }> {
  let root: string;
  let createdRoot = false;
  try { root = await realChild(vault, MANAGED); }
  catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { await fs.mkdir(path.join(vault, MANAGED), { mode: 0o700 }); createdRoot = true; }
    catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
    }
    root = await realChild(vault, MANAGED);
  }
  if (createdRoot) await writeLearnExclusive(root, OWNER, MARKER, 64);
  else await waitForConcurrentOwner(root);

  // Ownership is established before any child is created. Concurrent first
  // writers may now share initialization without adopting pre-existing content.
  let system: string;
  try { system = await realChild(root, SYSTEM); }
  catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    system = await ensureChild(root, SYSTEM);
  }
  let events: string;
  try { events = await realChild(system, EVENTS); }
  catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    events = await ensureChild(system, EVENTS);
  }
  return { root, system, events };
}

function validateInput(input: LearnVaultInput): void {
  if (!input || typeof input !== "object") throw new Error("Invalid Learn vault event.");
  const lessonId = stableIdentifier(input.lessonId, 80, "Lesson ID"); bounded(input.title, 160, "Lesson title");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lessonId)) throw new Error("Invalid Learn vault lesson ID.");
  if (input.topic !== undefined) bounded(input.topic, 120, "Topic");
  if (input.lessonRevision !== undefined && !/^[a-f0-9]{64}$/.test(input.lessonRevision)) throw new Error("Invalid lesson revision.");
  if (input.type === "concept") {
    bounded(input.goal, 500, "Learning goal"); bounded(input.example, 4000, "Example"); bounded(input.nextStep, 1000, "Next step");
    if (!Array.isArray(input.bullets) || input.bullets.length < 1 || input.bullets.length > 5) throw new Error("Concept events require 1-5 bullets.");
    input.bullets.forEach((item) => bounded(item, 1000, "Concept bullet"));
  } else if (input.type === "practice") {
    if (![true, false, null].includes(input.correct) || typeof input.assisted !== "boolean" || typeof input.revealed !== "boolean") throw new Error("Invalid practice evidence.");
    bounded(input.exerciseKind, 20, "Exercise kind");
  } else if (input.type === "finding") {
    if (input.finding === undefined && input.nextStep === undefined) throw new Error("Finding events require a finding or next step.");
    if (input.finding !== undefined) bounded(input.finding, 1000, "Finding");
    if (input.nextStep !== undefined) bounded(input.nextStep, 1000, "Next step");
  } else if (input.type === "preference") {
    if (!(input.key in LEARN_PREFERENCE_VALUES) || !(LEARN_PREFERENCE_VALUES[input.key] as readonly string[]).includes(input.value)) throw new Error("Unknown Learn preference.");
    if (!/^[a-f0-9]{64}$/.test(input.evidenceDigest)) throw new Error("Invalid preference evidence.");
  } else throw new Error("Unsupported Learn vault event.");
}

function minimizeInput(input: LearnVaultInput): LearnVaultInput {
  validateInput(input);
  const base = {
    lessonId: input.lessonId,
    title: minimizedText(input.title, 160),
    ...(input.topic === undefined ? {} : { topic: minimizedText(input.topic, 120) }),
    ...(input.lessonRevision === undefined ? {} : { lessonRevision: input.lessonRevision }),
  };
  if (input.type === "concept") return { ...base, type: "concept", goal: minimizedText(input.goal, 500), bullets: input.bullets.map((item) => minimizedText(item, 1000)), example: minimizedText(input.example, 4000), nextStep: minimizedText(input.nextStep, 1000) };
  if (input.type === "practice") return { ...base, type: "practice", correct: input.correct, assisted: input.assisted, revealed: input.revealed, exerciseKind: minimizedText(input.exerciseKind, 20) };
  if (input.type === "finding") return { ...base, type: "finding", ...(input.finding === undefined ? {} : { finding: minimizedText(input.finding, 1000) }), ...(input.nextStep === undefined ? {} : { nextStep: minimizedText(input.nextStep, 1000) }) };
  return { ...base, type: "preference", key: input.key, value: input.value, evidenceDigest: input.evidenceDigest };
}

function validateEvent(value: unknown): LearnVaultEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Learn vault event.");
  const event = value as LearnVaultEvent;
  if (event.version !== 1 || !/^[a-f0-9-]{36}$/.test(event.id) || !Number.isFinite(Date.parse(event.at))) throw new Error("Invalid Learn vault event metadata.");
  validateInput(event);
  return event;
}

function render(event: LearnVaultEvent): string {
  const frontmatter = `---\nneura_event: ${event.id}\nschema: 1\ntype: ${event.type}\ncreated: ${event.at}\n---\n`;
  const title = safeText(event.title, 160);
  if (event.type === "concept") return `${frontmatter}\n# ${title}\n\n## Goal\n${safeText(event.goal, 500)}\n\n## Key ideas\n${event.bullets.map((item) => `- ${safeText(item, 1000)}`).join("\n")}\n\n## Example\n${fenced(event.example)}\n\n## Next practice\n${safeText(event.nextStep, 1000)}\n`;
  if (event.type === "practice") return `${frontmatter}\n# Practice evidence — ${title}\n\n- Result: ${event.correct === null ? "discussion" : event.correct ? "correct attempt" : "incorrect attempt"}\n- Exercise: ${safeText(event.exerciseKind, 20)}\n- Assisted: ${event.assisted ? "yes" : "no"}\n- Answer revealed: ${event.revealed ? "yes" : "no"}\n\nThis is practice evidence, not a mastery claim. Raw answers are not stored.\n`;
  if (event.type === "preference") return `${frontmatter}\n# Learning preference — ${event.key}\n\n- Value: ${event.value}\n- Provenance: inferred from an exact learner message\n- Status: candidate until repeated distinct evidence\n\nThe originating conversation is not stored.\n`;
  return `${frontmatter}\n# Learning finding — ${title}\n${event.finding ? `\n## Observation\n${safeText(event.finding, 1000)}\n` : ""}${event.nextStep ? `\n## Next practice\n${safeText(event.nextStep, 1000)}\n` : ""}`;
}

async function projectionDirectory(root: string, event: LearnVaultEvent): Promise<string> {
  const category = event.type === "concept" ? "Topics" : event.type === "practice" || event.type === "finding" ? "Learner" : "Learner";
  let current = await ensureChild(root, category);
  const parts = event.type === "concept" ? [slug(event.topic ?? event.title)] : event.type === "preference" ? ["Preferences"] : ["Mistakes", slug(event.topic ?? event.title)];
  for (const part of parts) current = await ensureChild(current, part);
  return current;
}

async function project(root: string, event: LearnVaultEvent): Promise<void> {
  const directory = await projectionDirectory(root, event);
  const filename = `${event.at.slice(0, 10)}-${event.id}.md`;
  try { await writeLearnExclusive(directory, filename, render(event), EVENT_LIMIT); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

async function readEvents(eventsDirectory: string): Promise<LearnVaultEvent[]> {
  const entries = (await fs.readdir(eventsDirectory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length > MAX_LEARN_VAULT_EVENTS || entries.some((entry) => !entry.isFile() || !EVENT_NAME.test(entry.name))) throw new Error("Learn vault events contain an unsupported entry or exceed the retention bound.");
  const events: LearnVaultEvent[] = [];
  for (let index = 0; index < entries.length; index++) {
    if (entries[index].name !== `${String(index).padStart(4, "0")}.json`) throw new Error("Learn vault event slots are not contiguous.");
    const text = await readLearnRegular(path.join(eventsDirectory, entries[index].name), EVENT_LIMIT);
    const envelope = JSON.parse(text) as Partial<LearnVaultEnvelope>;
    if (!envelope || envelope.version !== 1 || typeof envelope.digest !== "string" || !envelope.event || Object.keys(envelope).some((key) => !["version", "digest", "event"].includes(key))) throw new Error("Invalid Learn vault event envelope.");
    const canonical = JSON.stringify(envelope.event);
    if (!/^[a-f0-9]{64}$/.test(envelope.digest) || hash(canonical) !== envelope.digest) throw new Error("Learn vault event integrity check failed.");
    events.push(validateEvent(envelope.event));
  }
  return events;
}

async function readEventsForAppend(eventsDirectory: string): Promise<LearnVaultEvent[]> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try { return await readEvents(eventsDirectory); }
    catch (error) {
      // An exclusive slot becomes visible before its checked handle finishes
      // writing and syncing. Retry only during the bounded publication window;
      // persistent corruption still fails closed with the original validation.
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export function learnPreferenceEvidence(text: string): string { return hash(text.normalize("NFKC").replace(/\s+/g, " ").trim()); }

export async function appendLearnVaultEvent(input: LearnVaultInput): Promise<{ enabled: boolean; eventId?: string }> {
  const minimized = minimizeInput(input);
  const vault = await configuredVault();
  if (!vault) return { enabled: false };
  const managed = await managedRoot(vault, true);
  const event: LearnVaultEvent = { ...minimized, version: 1, id: randomUUID(), at: new Date().toISOString() };
  const canonical = JSON.stringify(event);
  const envelope: LearnVaultEnvelope = { version: 1, digest: hash(canonical), event };
  const text = JSON.stringify(envelope);
  for (let attempt = 0; attempt < MAX_LEARN_VAULT_EVENTS; attempt++) {
    const existing = await readEventsForAppend(managed.events);
    for (const saved of existing) await project(managed.root, saved);
    if (existing.length >= MAX_LEARN_VAULT_EVENTS) throw new Error("Learn vault event limit reached; archive the managed subtree before continuing.");
    const slot = `${String(existing.length).padStart(4, "0")}.json`;
    try { await writeLearnExclusive(managed.events, slot, text, EVENT_LIMIT); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    await project(managed.root, event);
    return { enabled: true, eventId: event.id };
  }
  throw new Error("Learn vault event slots remained busy; retry the automatic update.");
}

export async function readLearnVaultContext(): Promise<LearnVaultContext> {
  const vault = await configuredVault();
  if (!vault) return { enabled: false, preferences: {}, difficulties: [] };
  try { await fs.lstat(path.join(vault, MANAGED)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, preferences: {}, difficulties: [] };
    throw error;
  }
  const managed = await managedRoot(vault, false);
  const events = await readEvents(managed.events);
  const preferences: Partial<Record<LearnPreferenceKey, LearnPreferenceValue>> = {};
  for (const key of Object.keys(LEARN_PREFERENCE_VALUES) as LearnPreferenceKey[]) {
    const choices = events.filter((event): event is Extract<LearnVaultEvent, { type: "preference" }> => event.type === "preference" && event.key === key);
    const counts = new Map<string, Set<string>>();
    for (const event of choices) {
      if (!counts.has(event.value)) counts.set(event.value, new Set());
      counts.get(event.value)!.add(event.evidenceDigest);
    }
    const active = [...counts.entries()].filter(([, evidence]) => evidence.size >= 2).sort((a, b) => b[1].size - a[1].size)[0];
    if (active) preferences[key] = active[0] as LearnPreferenceValue;
  }
  const difficulty = new Map<string, { lessonId: string; count: number }>();
  for (const event of events) {
    if (event.type !== "practice" || (event.correct !== false && !event.assisted && !event.revealed)) continue;
    const current = difficulty.get(event.lessonId) ?? { lessonId: event.lessonId, count: 0 };
    current.count++; difficulty.set(event.lessonId, current);
  }
  return { enabled: true, preferences, difficulties: [...difficulty.values()].sort((a, b) => b.count - a.count).slice(0, 8) };
}
