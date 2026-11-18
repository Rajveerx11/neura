const MAX_DELAY = 365 * 24 * 60 * 60 * 1000;
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

type Clock = { wall: number; elapsed: number };
type Timing = { due: number; clock: keyof Clock; interval?: number; task: string };
type Schedule = Timing & { id: number };
const readClock = (): Clock => ({ wall: Date.now(), elapsed: performance.now() });

function delay(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  const ms = match ? Number(match[1]) * UNITS[match[2] as keyof typeof UNITS] : 0;
  if (ms < 1000 || ms > MAX_DELAY) throw new Error('Use a duration from 1s to 365d, such as 15m.');
  return ms;
}

function timestamp(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('Use an ISO timestamp with a time zone, such as 2027-01-15T09:30+05:30.');
  const local = `${match[1]}:${match[2] ?? '00'}.${(match[3] ?? '').padEnd(3, '0')}`;
  const utc = new Date(local + 'Z');
  if (!Number.isFinite(+utc) || !utc.toISOString().startsWith(local)) throw new Error('Invalid date or time.');
  return Date.parse(local + match[4]);
}

export function parseSchedule(request: string, now = readClock()): Timing {
  const match = /^(in|at|every)\s+(\S+)\s+([\s\S]+)$/.exec(request);
  if (!match || !match[3].trim() || match[3].length > 32_000 || /^[/$]/.test(match[3].trimStart())) {
    throw new Error('Use /schedule in DURATION TASK, /schedule at TIMESTAMP TASK, or /schedule every DURATION TASK. Enter a plain Work task.');
  }
  const [, kind, time, task] = match;
  if (kind === 'at') {
    const due = timestamp(time);
    if (!Number.isFinite(due) || due <= now.wall || due - now.wall > MAX_DELAY) throw new Error('Choose a time in the next 365 days.');
    return { clock: 'wall', due, task };
  }
  const duration = delay(time);
  if (kind === 'every' && duration < 60_000) throw new Error('Repeat intervals must be at least 1m.');
  return { clock: 'elapsed', due: now.elapsed + duration, task, ...(kind === 'every' ? { interval: duration } : {}) };
}

const remaining = (job: Timing, now: Clock) => job.due - now[job.clock];
export const scheduleTime = (job: Timing, now = readClock()) => new Date(Math.ceil(now.wall + remaining(job, now))).toISOString();

export function createSchedules(clock = readClock) {
  const jobs = new Map<number, Schedule>();
  let nextId = 0;
  const ordered = (now: Clock) => [...jobs.values()].sort((a, b) => remaining(a, now) - remaining(b, now) || a.id - b.id);
  const untilNext = (now: Clock) => Math.min(...[...jobs.values()].map(job => remaining(job, now)));
  return {
    list: () => ordered(clock()),
    add(timing: Timing) {
      if (jobs.size >= 16) throw new Error('This terminal already has 16 schedules.');
      const job = { ...timing, id: ++nextId };
      jobs.set(job.id, job);
      return job;
    },
    remove: (id: number) => jobs.delete(id),
    clear: () => jobs.clear(),
    takeDue() {
      const now = clock();
      const job = ordered(now)[0];
      if (!job || remaining(job, now) > 0) return;
      jobs.delete(job.id);
      return job;
    },
    repeat(job: Schedule) {
      if (!job.interval) return;
      const elapsedIntervals = Math.floor(Math.max(0, -remaining(job, clock())) / job.interval);
      jobs.set(job.id, { ...job, due: job.due + (elapsedIntervals + 1) * job.interval });
    },
    wake(onDue: () => boolean) {
      if (!jobs.size) return () => {};
      // Absolute jobs must notice wall-clock changes even during a long wait.
      const maxWait = [...jobs.values()].some(job => job.clock === 'wall') ? 30_000 : 2_147_483_647;
      let timer: NodeJS.Timeout;
      const wait = (minimum: number) => {
        timer = setTimeout(() => {
          if (untilNext(clock()) > 0 || !onDue()) wait(1000);
        }, Math.min(maxWait, Math.max(minimum, untilNext(clock()))));
      };
      wait(0);
      return () => clearTimeout(timer);
    },
  };
}
