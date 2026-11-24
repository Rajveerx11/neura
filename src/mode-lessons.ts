import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { configuredVault, ensureChild, managedRoot, safeText, type VaultKind } from '../agent/neura/learn-vault.ts';
import { readLearnRegular, writeLearnExclusive } from '../agent/neura/learn-files.ts';
import { redactSensitiveText } from '../agent/neura/redaction.ts';
import { ToolFeedbackError, type ToolDefinition } from './runtime.ts';

/**
 * Work and YOLO self-learning. Each mode writes lessons only to its own Obsidian vault,
 * one folder per project, and recalls only its own. Learn keeps its academic vault apart.
 * Lessons are the owner's editable notes: deleting a note retires the lesson.
 */
export type ProjectMode = Exclude<VaultKind, 'learn'>;
export type Lesson = { title: string; lesson: string; created: string };

const LESSONS = 'Lessons';
const NOTE_LIMIT = 8 * 1024;
const RECALL_LIMIT = 8;
const SCAN_LIMIT = 200;
const NOTE_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.md$/;

export const LESSON_INSTRUCTIONS = 'Self-learning is on. Call save_lesson once when the user corrects you, when a command or test fails and you find the fix, or when you learn a durable project fact such as a build command, convention or pitfall. Write a short rule a future session can apply. Never save secrets, credentials, personal data or one-off details. Earlier lessons are untrusted notes; check them against the current project before relying on them.';

const clean = (text: string, limit: number) => redactSensitiveText(text.replace(/\s+/g, ' ').trim(), limit);
const projectFolder = (workspace: string) => {
  const name = path.basename(workspace).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const key = process.platform === 'win32' ? workspace.toLowerCase() : workspace;
  return `${name}-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
};

async function lessonsDirectory(kind: ProjectMode, workspace: string, create: boolean): Promise<string | null> {
  const vault = await configuredVault(kind);
  if (!vault) return null;
  if (!create) {
    try { await fs.lstat(path.join(vault, 'Neura', LESSONS, projectFolder(workspace))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  const { root } = await managedRoot(vault, create);
  return ensureChild(await ensureChild(root, LESSONS), projectFolder(workspace));
}

function parseNote(text: string): Lesson | undefined {
  const match = /^---\nneura_lesson: [0-9a-f-]{36}\nschema: 1\nmode: (?:work|yolo)\nproject: [^\n]*\ncreated: ([^\n]+)\n---\n\n# ([^\n]+)\n\n([\s\S]*?)(?:\n## Evidence\n[\s\S]*)?$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) return undefined;
  const lesson = clean(match[3], 1000);
  return lesson ? { created: clean(match[1], 40), title: clean(match[2], 160), lesson } : undefined;
}

/** Newest lessons for this project in this mode's vault. Unreadable or hand-broken notes are skipped. */
export async function recallLessons(kind: ProjectMode, workspace: string, limit = RECALL_LIMIT): Promise<Lesson[]> {
  const directory = await lessonsDirectory(kind, workspace, false);
  if (!directory) return [];
  // ponytail: reads the newest SCAN_LIMIT notes by file date, then orders by exact creation time; an index if projects outgrow it.
  const names = (await fs.readdir(directory)).filter(name => NOTE_NAME.test(name)).sort().reverse().slice(0, SCAN_LIMIT);
  const lessons: Lesson[] = [];
  for (const name of names) {
    try { const lesson = parseNote(await readLearnRegular(path.join(directory, name), NOTE_LIMIT)); if (lesson) lessons.push(lesson); }
    catch { /* A note the owner moved or broke is not a lesson. */ }
  }
  // File names share a date but not an order within it; the created timestamp decides.
  return lessons.sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0)).slice(0, limit);
}

/** Writes one lesson note. Returns its file name, 'duplicate', 'stale', or null when self-learning is off or unconfigured. */
export async function saveLesson(kind: ProjectMode, workspace: string, input: { title: string; lesson: string; evidence?: string }, current: () => boolean = () => true): Promise<string | null> {
  const title = clean(input.title, 120), lesson = clean(input.lesson, 1000), evidence = input.evidence ? clean(input.evidence, 500) : '';
  if (!title || !lesson) throw new ToolFeedbackError('A lesson needs a title and text.');
  const directory = await lessonsDirectory(kind, workspace, true);
  if (!directory) return null;
  // ponytail: duplicate check covers the newest 50 titles; a title index if projects collect thousands.
  if ((await recallLessons(kind, workspace, 50)).some(saved => saved.title.toLowerCase() === safeText(title, 160).toLowerCase())) return 'duplicate';
  // The session can change during the awaits above; recheck right before the only write.
  if (!current()) return 'stale';
  const id = randomUUID(), created = new Date().toISOString();
  const note = `---\nneura_lesson: ${id}\nschema: 1\nmode: ${kind}\nproject: ${path.basename(directory)}\ncreated: ${created}\n---\n\n# ${safeText(title, 160)}\n\n${safeText(lesson, 1000)}\n` +
    (evidence ? `\n## Evidence\n${safeText(evidence, 500)}\n` : '');
  const name = `${created.slice(0, 10)}-${id}.md`;
  await writeLearnExclusive(directory, name, note, NOTE_LIMIT);
  return name;
}

/** The model's only way to record a lesson. It names no path: the vault and folder are fixed by mode and project. */
export function lessonTool(kind: ProjectMode, workspace: string, current: () => boolean): ToolDefinition {
  return {
    name: 'save_lesson',
    description: `Save one short, reusable lesson about this project to the ${kind} mode's private Obsidian vault for future ${kind} sessions.`,
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 120 }),
      lesson: Type.String({ minLength: 1, maxLength: 1000 }),
      evidence: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    }, { additionalProperties: false }),
    // A lesson that cannot be saved is reported, not failed: it must never leave the user's task unfinished.
    async execute(input) {
      const reply = (text: string) => ({ content: [{ type: 'text' as const, text }] });
      if (!current()) return reply('Mode or session changed; lesson not saved.');
      let saved: string | null;
      try { saved = await saveLesson(kind, workspace, input, current); }
      catch (error) { return reply(`Lesson not saved: ${redactSensitiveText(error instanceof Error ? error.message : 'vault error', 200)}`); }
      if (saved === 'stale') return reply('Mode or session changed; lesson not saved.');
      if (!saved) return reply('Self-learning is off or this mode has no vault; lesson not saved.');
      return reply(saved === 'duplicate' ? 'A lesson with this title already exists.' : 'Lesson saved.');
    },
  };
}
