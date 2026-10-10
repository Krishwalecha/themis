import { Cron } from "croner";
import { z } from "zod";

const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 7 * 24 * 3600;

export const scheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    seconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(MAX_INTERVAL_SECONDS),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().trim().min(1).max(120),
    timezone: z.string().trim().max(64).optional(),
  }),
]);
type Schedule = z.infer<typeof scheduleSchema>;

const cronFor = (expression: string, timezone?: string): Cron => {
  return new Cron(expression, { paused: true, timezone });
};

// Returns a problem description, or null when the schedule is usable
export const scheduleProblem = (schedule: Schedule): string | null => {
  if (schedule.type === "interval") return null;
  let job: Cron | undefined;
  try {
    job = cronFor(schedule.expression, schedule.timezone);
    const [a, b] = job.nextRuns(2);
    if (!a) return "Cron expression never fires";
    if (b && b.getTime() - a.getTime() < MIN_INTERVAL_SECONDS * 1000) {
      return `Cron schedule fires more often than every ${MIN_INTERVAL_SECONDS}s`;
    }
    return null;
  } catch (e) {
    return `Invalid cron expression: ${(e as Error).message}`;
  } finally {
    job?.stop();
  }
};

// Next run strictly after `from` (interval schedules count from the last run, or run immediately)
export const nextRunAt = (schedule: Schedule, from: Date, lastRunAt?: Date | null): Date | null => {
  if (schedule.type === "interval") {
    if (!lastRunAt) return from;
    const next = new Date(lastRunAt.getTime() + schedule.seconds * 1000);
    return next < from ? from : next;
  }
  const job = cronFor(schedule.expression, schedule.timezone);
  try {
    return job.nextRun(from);
  } finally {
    job.stop();
  }
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "M H * * D" schedules (what the form's "At set times" builds) read as "weekdays at 09:30 UTC"
const describeTimeOfDay = (expression: string, timezone?: string): string | null => {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/.exec(expression.trim());
  if (!m) return null;
  const at = `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  const days = m[3] === "*" ? [] : [...new Set(m[3].split(",").map(Number))].sort();
  const when =
    !days.length || days.length === 7
      ? "daily"
      : days.join() === "1,2,3,4,5"
        ? "weekdays"
        : days.join() === "0,6"
          ? "weekends"
          : days.map((d) => DAYS[d]).join(", ");
  return `${when} at ${at}${timezone ? ` ${timezone}` : ""}`;
};

// Short human label, e.g. "every 5m", "weekdays at 09:30 UTC" or "cron 0 * * * *".
export const describeSchedule = (schedule: Schedule): string => {
  if (schedule.type === "cron") return describeTimeOfDay(schedule.expression, schedule.timezone) ?? `cron ${schedule.expression}`;
  const s = schedule.seconds;
  if (s % 3600 === 0) return `every ${s / 3600}h`;
  if (s % 60 === 0) return `every ${s / 60}m`;
  return `every ${s}s`;
};
