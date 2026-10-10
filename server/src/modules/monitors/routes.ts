import { Router } from "express";
import { z } from "zod";
import { config } from "../../config";
import { HttpError, notFound } from "../../lib/errors";
import { executeRequest } from "../../lib/executor";
import { interpolateSpec } from "../../lib/interpolate";
import { objectId } from "../../lib/objectId";
import { describeSchedule, scheduleProblem, scheduleSchema } from "../../lib/schedule";
import { Collection } from "../../models/Collection";
import { Incident } from "../../models/Incident";
import { Monitor } from "../../models/Monitor";
import { MonitorCheck } from "../../models/MonitorCheck";
import { requestSpecSchema } from "../../schemas/requestSpec";
import { assertionSchema } from "../../schemas/testing";
import { loadVariables } from "../requests/service";
import { evaluateCheck } from "./evaluate";
import { scheduler } from "./scheduler";
import { closeOpenIncident, runCheck } from "./service";
import { bucketize, loadPoints, monitorStats, WINDOWS, windowRange, type CheckPoint, type WindowKey } from "./stats";

const webhookUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Webhook must be an http(s) URL")
  .optional();

const maintenanceWindow = z
  .object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), note: z.string().trim().max(200).optional() })
  .refine((w) => w.endsAt > w.startsAt, "A maintenance window must end after it starts");

const monitorBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  // a monitor checks one request, or runs a whole collection
  request: requestSpecSchema.optional(),
  collectionId: objectId.nullish(),
  environmentId: objectId.nullish(),
  schedule: scheduleSchema,
  assertions: z.array(assertionSchema).max(50).default([]),
  failureThreshold: z.number().int().min(1).max(10).default(1),
  enabled: z.boolean().default(true),
  alerts: z.object({ webhookUrl, notifyOnRecovery: z.boolean().default(true) }).default({}),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  contractId: objectId.nullish(),
  contractSeverity: z.enum(["warning", "critical"]).default("warning"),
  maintenance: z.array(maintenanceWindow).max(20).default([]),
});
type MonitorBody = z.infer<typeof monitorBody>;

const idParams = z.object({ id: objectId });
const windowQuery = z.object({ window: z.enum(Object.keys(WINDOWS) as [WindowKey, ...WindowKey[]]).default("24h") });
const checksQuery = z.object({
  status: z.enum(["up", "degraded", "down", "failing"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  before: objectId.optional(),
});

const assertSchedule = (body: MonitorBody) => {
  const problem = scheduleProblem(body.schedule);
  if (problem) throw new HttpError(400, problem);
};

const toDoc = async (body: MonitorBody) => {
  let request = body.request;
  if (body.collectionId) {
    const c = await Collection.findById(body.collectionId, { requests: { $slice: 1 } }).lean();
    if (!c) throw notFound("Collection");
    if (!c.requests[0]) throw new HttpError(400, "That collection has no requests yet");
    request = requestSpecSchema.parse(c.requests[0].request);
  }
  if (!request) throw new HttpError(400, "Choose a request or a collection to monitor");
  return {
    ...body,
    request,
    collectionId: body.collectionId ?? null,
    environmentId: body.environmentId ?? undefined,
    contractId: body.contractId ?? undefined,
    alerts: { webhookUrl: body.alerts.webhookUrl || undefined, notifyOnRecovery: body.alerts.notifyOnRecovery },
  };
};

// 24h uptime + average latency for every monitor, in one aggregation
const recentSummaries = async (): Promise<Map<string, { checks: number; uptimePct: number; avgLatencyMs: number | null }>> => {
  const since = new Date(Date.now() - WINDOWS["24h"]);
  const rows = await MonitorCheck.aggregate<{ _id: unknown; total: number; ok: number; latency: number | null }>([
    { $match: { checkedAt: { $gte: since }, maintenance: { $ne: true } } },
    {
      $group: {
        _id: "$monitorId",
        total: { $sum: 1 },
        ok: { $sum: { $cond: [{ $ne: ["$status", "down"] }, 1, 0] } },
        latency: { $avg: { $cond: [{ $gt: ["$statusCode", 0] }, "$latencyMs", null] } },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [
      String(r._id),
      {
        checks: r.total,
        uptimePct: Math.round((r.ok / r.total) * 100_000) / 1000,
        avgLatencyMs: r.latency === null ? null : Math.round(r.latency * 100) / 100,
      },
    ]),
  );
};

// names of the collections that collection monitors run, for display
const collectionNames = async (monitors: { collectionId?: unknown }[]): Promise<Map<string, string>> => {
  const ids = monitors.flatMap((m) => (m.collectionId ? [m.collectionId] : []));
  if (!ids.length) return new Map();
  const rows = await Collection.find({ _id: { $in: ids } }, { name: 1 }).lean();
  return new Map(rows.map((c) => [String(c._id), c.name]));
};

export const monitorsRouter = Router();

monitorsRouter.get("/", async (_req, res) => {
  const { from, to } = windowRange("24h");
  const [monitors, summaries, points] = await Promise.all([
    Monitor.find().sort({ createdAt: -1 }).lean(),
    recentSummaries(),
    loadPoints({}, from),
  ]);
  const names = await collectionNames(monitors);
  const byMonitor = new Map<string, CheckPoint[]>();
  for (const p of points) {
    const key = String(p.monitorId);
    if (!byMonitor.has(key)) byMonitor.set(key, []);
    byMonitor.get(key)!.push(p);
  }
  res.json({
    items: monitors.map((m) => ({
      ...m,
      collectionName: m.collectionId ? (names.get(String(m.collectionId)) ?? null) : undefined,
      scheduleLabel: describeSchedule(scheduleSchema.parse(m.schedule)),
      last24h: summaries.get(String(m._id)) ?? { checks: 0, uptimePct: null, avgLatencyMs: null },
      // Status bars: worst status per ~48-minute slot over the last 24h.
      timeline: bucketize(byMonitor.get(String(m._id)) ?? [], from, to, 30).map((b) => ({ start: b.start, worst: b.worst, total: b.total })),
    })),
  });
});

// Dry-run an unsaved monitor definition once (nothing is stored)
monitorsRouter.post("/test", async (req, res) => {
  const body = monitorBody.parse(req.body);
  if (!body.request) throw new HttpError(400, "Only a single-request monitor can be tested before saving");
  const { spec, unresolved } = interpolateSpec(body.request, await loadVariables(body.environmentId ?? undefined));
  const result = await executeRequest(spec);
  const evaluation = evaluateCheck(result, body.assertions);
  res.json({
    status: evaluation.status,
    failures: evaluation.failures,
    assertions: evaluation.assertions.map((a) => ({ ...a.assertion, severity: a.severity, passed: a.passed, message: a.message })),
    statusCode: result.status,
    latencyMs: result.timings.totalMs,
    error: result.error,
    unresolvedVariables: unresolved,
  });
});

monitorsRouter.post("/", async (req, res) => {
  const body = monitorBody.parse(req.body);
  assertSchedule(body);
  if ((await Monitor.countDocuments()) >= config.maxMonitors) throw new HttpError(403, `An account can have up to ${config.maxMonitors} monitors`);
  const monitor = await Monitor.create({
    ...(await toDoc(body)),
    state: { status: body.enabled ? "pending" : "paused", consecutiveFailures: 0 },
  });
  await scheduler.refresh(monitor._id);
  res.status(201).json(monitor.toObject());
});

monitorsRouter.get("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const monitor = await Monitor.findById(id).lean();
  if (!monitor) throw notFound("Monitor");
  const names = await collectionNames([monitor]);
  res.json({ ...monitor, collectionName: monitor.collectionId ? (names.get(String(monitor.collectionId)) ?? null) : undefined, scheduleLabel: describeSchedule(scheduleSchema.parse(monitor.schedule)) });
});

monitorsRouter.put("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = monitorBody.parse(req.body);
  assertSchedule(body);
  const existing = await Monitor.findById(id);
  if (!existing) throw notFound("Monitor");

  const wasEnabled = existing.enabled;
  existing.set(await toDoc(body));
  if (wasEnabled && !body.enabled) {
    existing.set("state.status", "paused");
    existing.set("state.openIncidentId", null);
    await closeOpenIncident(existing._id, "Monitor paused");
  } else if (!wasEnabled && body.enabled) {
    existing.set("state.status", "pending");
    existing.set("state.consecutiveFailures", 0);
  }
  await existing.save();
  await scheduler.refresh(existing._id);
  res.json(existing.toObject());
});

const setEnabled = async (id: string, enabled: boolean) => {
  const monitor = await Monitor.findById(id);
  if (!monitor) throw notFound("Monitor");
  if (monitor.enabled === enabled) return monitor;
  monitor.enabled = enabled;
  if (enabled) {
    monitor.set("state.status", "pending");
    monitor.set("state.consecutiveFailures", 0);
  } else {
    monitor.set("state.status", "paused");
    monitor.set("state.openIncidentId", null);
    monitor.set("state.nextRunAt", null);
    await closeOpenIncident(monitor._id, "Monitor paused");
  }
  await monitor.save();
  await scheduler.refresh(monitor._id);
  return monitor;
};

monitorsRouter.post("/:id/pause", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json((await setEnabled(id, false)).toObject());
});

monitorsRouter.post("/:id/resume", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json((await setEnabled(id, true)).toObject());
});

// Runs a check immediately and returns it
monitorsRouter.post("/:id/run", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const strict = ["1", "true"].includes(String(req.query.strict));
  const check = await runCheck(id, "manual");
  if (!check) throw notFound("Monitor");
  await scheduler.refresh(id);
  res.status(strict && check.status !== "up" ? 422 : 200).json(check);
});

monitorsRouter.get("/:id/checks", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { status, limit, before } = checksQuery.parse(req.query);
  const filter: Record<string, unknown> = { monitorId: id };
  if (status === "failing") filter.status = { $ne: "up" };
  else if (status) filter.status = status;
  if (before) filter._id = { $lt: before };
  const items = await MonitorCheck.find(filter).sort({ checkedAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  res.json({ items: page, nextCursor: hasMore ? String(page[page.length - 1]._id) : null });
});

monitorsRouter.get("/:id/stats", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { window } = windowQuery.parse(req.query);
  if (!(await Monitor.exists({ _id: id }))) throw notFound("Monitor");
  res.json(await monitorStats(id, window));
});

monitorsRouter.post("/bulk-delete", async (req, res) => {
  const { ids } = z.object({ ids: z.array(objectId).min(1).max(200) }).parse(req.body);
  const owned = (await Monitor.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((m) => m._id);
  await Monitor.deleteMany({ _id: { $in: owned } });
  for (const id of owned) scheduler.unschedule(String(id));
  await Promise.all([MonitorCheck.deleteMany({ monitorId: { $in: owned } }), Incident.deleteMany({ monitorId: { $in: owned } })]);
  res.json({ deleted: owned.length });
});

monitorsRouter.delete("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const deleted = await Monitor.findByIdAndDelete(id);
  if (!deleted) throw notFound("Monitor");
  scheduler.unschedule(id);
  await Promise.all([MonitorCheck.deleteMany({ monitorId: id }), Incident.deleteMany({ monitorId: id })]);
  res.status(204).end();
});
