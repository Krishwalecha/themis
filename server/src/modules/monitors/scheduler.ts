import type { Types } from "mongoose";
import { nextRunAt, scheduleSchema } from "../../lib/schedule";
import { runAs, runUnscoped } from "../../lib/tenant";
import { Monitor } from "../../models/Monitor";
import { runCheck } from "./service";

// setTimeout's maximum delay (~24.8 days); longer waits are chained
const MAX_DELAY_MS = 2 ** 31 - 1;

interface SchedulableMonitor {
  _id: Types.ObjectId;
  enabled: boolean;
  schedule: unknown;
  state?: { lastCheckedAt?: Date | null } | null;
}

class MonitorScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private started = false;

  constructor(private readonly maxConcurrent = 10) {}

  get isRunning(): boolean {
    return this.started;
  }

  async start(): Promise<number> {
    this.started = true;
    const monitors = await runUnscoped(() => Monitor.find({ enabled: true }, { enabled: 1, schedule: 1, "state.lastCheckedAt": 1 }).lean().exec());
    for (const m of monitors) this.schedule(m as SchedulableMonitor);
    return monitors.length;
  }

  stop(): void {
    this.started = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // Re-reads a monitor and (re)schedules or unschedules it
  async refresh(id: Types.ObjectId | string): Promise<void> {
    this.unschedule(String(id));
    if (!this.started) return;
    const m = await runUnscoped(() => Monitor.findById(id, { enabled: 1, schedule: 1, "state.lastCheckedAt": 1 }).lean().exec());
    if (m) this.schedule(m as SchedulableMonitor);
  }

  unschedule(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  private schedule(m: SchedulableMonitor): void {
    const id = String(m._id);
    this.unschedule(id);
    if (!this.started || !m.enabled) return;

    const parsed = scheduleSchema.safeParse(m.schedule);
    if (!parsed.success) {
      console.warn(`[scheduler] monitor ${id} has an invalid schedule; skipping`);
      return;
    }
    const now = new Date();
    const next = nextRunAt(parsed.data, now, m.state?.lastCheckedAt ?? null);
    if (!next) return;

    void runUnscoped(() => Monitor.updateOne({ _id: m._id }, { $set: { "state.nextRunAt": next } }).exec());
    const delay = Math.max(0, next.getTime() - now.getTime());
    const timer = setTimeout(
      () => runUnscoped(() => (delay > MAX_DELAY_MS ? this.refresh(id) : this.fire(id))),
      Math.min(delay, MAX_DELAY_MS),
    );
    timer.unref?.();
    this.timers.set(id, timer);
  }

  private async fire(id: string): Promise<void> {
    this.timers.delete(id);
    if (this.running.has(id)) return;
    this.running.add(id);
    await this.acquire();
    try {
      // Timers outlive the request that scheduled them: re-enter the owner's scope explicitly.
      const owner = await runUnscoped(() => Monitor.findById(id, { ownerId: 1 }).lean<{ ownerId?: unknown }>().exec());
      if (owner) await runAs(owner.ownerId ? String(owner.ownerId) : null, () => runCheck(id, "scheduled"));
    } catch (e) {
      console.error(`[scheduler] check failed for monitor ${id}`, e);
    } finally {
      this.release();
      this.running.delete(id);
    }
    await this.refresh(id).catch((e) => console.error(`[scheduler] reschedule failed for ${id}`, e));
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => (this.active++, resolve())));
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

export const scheduler = new MonitorScheduler();
