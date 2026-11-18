const MAX_DELAY = 365 * 24 * 60 * 60 * 1000;
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

type Timing = { due: number; interval?: number; task: string };
type Schedule = Timing & { id: number };

function delay(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  const ms = match ? Number(match[1]) * UNITS[match[2] as keyof typeof UNITS] : 0;
  if (ms < 1000 || ms > MAX_DELAY) throw new Error('Use a duration from 1s to 365d, such as 15m.');
  return ms;
}

function timestamp(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('Use an ISO timestamp with a time zone, such as 2027-01-15T09:30+05:30.');
  const local = `${match[1]}:${match[2] ?? '00'}`;
  const utc = new Date(local + 'Z');
  if (!Number.isFinite(+utc) || !utc.toISOString().startsWith(local)) throw new Error('Invalid date or time.');
  return Date.parse(local + match[3]);
}

export function parseSchedule(request: string, now = Date.now()): Timing {
  const match = /^(in|at|every)\s+(\S+)\s+([\s\S]+)$/.exec(request);
  if (!match || !match[3].trim() || match[3].length > 32_000 || /^[/$]/.test(match[3].trimStart())) {
    throw new Error('Use /schedule in DURATION TASK, /schedule at TIMESTAMP TASK, or /schedule every DURATION TASK. Enter a plain Work task.');
  }
  const [, kind, time, task] = match;
  const due = kind === 'at' ? timestamp(time) : now + delay(time);
  if (!Number.isFinite(due) || due <= now || due - now > MAX_DELAY) throw new Error('Choose a time in the next 365 days.');
  if (kind !== 'every') return { due, task };
  const interval = due - now;
  if (interval < 60_000) throw new Error('Repeat intervals must be at least 1m.');
  return { due, interval, task };
}

export function createSchedules() {
  const jobs = new Map<number, Schedule>();
  let nextId = 0;
  const list = () => [...jobs.values()].sort((a, b) => a.due - b.due || a.id - b.id);
  return {
    list,
    add(timing: Timing) {
      if (jobs.size >= 16) throw new Error('This terminal already has 16 schedules.');
      const job = { ...timing, id: ++nextId };
      jobs.set(job.id, job);
      return job;
    },
    remove: (id: number) => jobs.delete(id),
    clear: () => jobs.clear(),
    takeDue(now = Date.now()) {
      const job = list()[0];
      if (!job || job.due > now) return;
      jobs.delete(job.id);
      return job;
    },
    repeat(job: Schedule, now = Date.now()) {
      if (!job.interval) return;
      const elapsedIntervals = Math.floor(Math.max(0, now - job.due) / job.interval);
      jobs.set(job.id, { ...job, due: job.due + (elapsedIntervals + 1) * job.interval });
    },
    wake(onDue: () => boolean) {
      const job = list()[0];
      if (!job) return () => {};
      let timer: NodeJS.Timeout;
      const wait = (minimum: number) => {
        timer = setTimeout(() => {
          if (job.due > Date.now() || !onDue()) wait(1000);
        }, Math.min(2_147_483_647, Math.max(minimum, job.due - Date.now())));
      };
      wait(0);
      return () => clearTimeout(timer);
    },
  };
}
