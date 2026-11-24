import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sessionDirectory } from './session.ts';
import { SECRET_PATH, PROTECTED_CONTROL } from '../agent/neura/action-paths.ts';
import { redactSensitiveText } from '../agent/neura/redaction.ts';
import { authorizePlanPath } from '../agent/neura/plan-files.ts';

export function canonicalLessonPath(root: string, requested: string) {
  return path.relative(root, authorizePlanPath(root, requested).canonical).split(path.sep).join('/');
}

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const lessonPath = z.string().max(240).regex(/^(?:[A-Za-z0-9_][\w.-]*\/)*[A-Za-z0-9_][\w.-]*$/)
  .refine(p => !SECRET_PATH.test('/' + p) && !PROTECTED_CONTROL.test(p) && !/(?:^|\/)(?:node_modules|private|memory|sessions|approvals|secrets)(?:\/|$)/i.test(p) && redactSensitiveText(p, 240) === p);
export const suitePath = lessonPath.refine(p => /\.(?:test|spec)\.[cm]?js$/.test(p));
const lesson = z.strictObject({
  source: lessonPath, suite: suitePath, suiteHash: digest, cases: digest,
  assertion: z.string().min(1).max(160).refine(s => !/[\x00-\x1f\x7f]/.test(s) && redactSensitiveText(s, 160) === s),
  session: z.uuid(), cohort: digest, failedSource: digest, failedAt: digest, passedAt: digest.nullable(),
});
export type Lesson = z.infer<typeof lesson>;
const MAX_LESSONS = 48;
const schema = z.strictObject({ version: z.literal(1), lessons: z.array(lesson).max(MAX_LESSONS) });
const MAX_BYTES = 128 * 1024;

// SQLite holds an OS file lock for the transaction. The empty file carries no lesson data.
function writerFile(root: string) {
  const filename = path.join(root, 'writer.sqlite');
  try { fs.closeSync(fs.openSync(filename, 'wx', 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 0 ||
      ['-journal', '-wal', '-shm'].some(suffix => fs.lstatSync(filename + suffix, { throwIfNoEntry: false }))) throw new Error('Unsafe lesson writer lock.');
  return { filename, stat };
}

function read(root: string): Lesson[] {
  const filename = path.join(root, 'lessons.json');
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat) return [];
  const safe = (s: fs.Stats) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size <= MAX_BYTES
    && s.dev === stat.dev && s.ino === stat.ino && s.size === stat.size && s.ctimeMs === stat.ctimeMs;
  if (!safe(stat)) throw new Error('Unsafe lesson store.');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!safe(fs.fstatSync(fd))) throw new Error('Lesson store changed.');
    const bytes = Buffer.alloc(stat.size + 1);
    if (fs.readSync(fd, bytes, 0, bytes.length, 0) !== stat.size || !safe(fs.fstatSync(fd))) throw new Error('Lesson store changed.');
    return schema.parse(JSON.parse(bytes.toString('utf8', 0, stat.size))).lessons;
  } finally { fs.closeSync(fd); }
}

export async function loadLessons(directory: string): Promise<Lesson[]> {
  try { return read(await sessionDirectory(directory)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function recordLesson(directory: string, previous: Lesson | undefined, next: Lesson, fence: () => void) {
  next = lesson.parse(next);
  const expected = JSON.stringify(previous);
  const { DatabaseSync } = await import('node:sqlite');
  const root = await sessionDirectory(directory, true);
  const parent = fs.lstatSync(root);
  const { filename, stat } = writerFile(root);
  const lease = new DatabaseSync(filename);
  try {
    lease.exec('PRAGMA journal_mode=MEMORY; BEGIN EXCLUSIVE');
    const locked = fs.lstatSync(filename);
    const current = fs.lstatSync(root);
    if (locked.dev !== stat.dev || locked.ino !== stat.ino || locked.nlink !== 1 ||
        current.dev !== parent.dev || current.ino !== parent.ino) throw new Error('Lesson directory or writer lock changed.');
    const rows = read(root);
    const index = rows.findIndex(r => r.source === next.source && r.suite === next.suite);
    if (JSON.stringify(rows[index]) !== expected) throw new Error('Another session updated this lesson. Recheck it.');
    if (index >= 0) rows.splice(index, 1);
    const bytes = JSON.stringify({ version: 1, lessons: [...rows, next].slice(-MAX_LESSONS) });
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('Lesson store exceeds its limit.');
    const tmp = path.join(root, randomUUID() + '.tmp');
    fence();
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, path.join(root, 'lessons.json'));
    } finally { fs.rmSync(tmp, { force: true }); }
  } finally { lease.close(); }
}
