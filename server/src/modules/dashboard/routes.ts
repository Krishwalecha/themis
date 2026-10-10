import { Router } from "express";
import { z } from "zod";
import { Contract, ContractValidationLog } from "../../models/Contract";
import { History } from "../../models/History";
import { Incident } from "../../models/Incident";
import { Monitor, MONITOR_STATUSES } from "../../models/Monitor";
import { MonitorCheck } from "../../models/MonitorCheck";
import { bucketize, loadPoints, summarize, WINDOWS, windowRange, type CheckPoint, type WindowKey } from "../monitors/stats";
import { formatDuration } from "../../lib/duration";

const query = z.object({ window: z.enum(Object.keys(WINDOWS) as [WindowKey, ...WindowKey[]]).default("24h") });

const requestActivity = async (from: Date) => {
  const [row] = await History.aggregate<{
    total: number;
    avgLatency: number | null;
    s2: number;
    s3: number;
    s4: number;
    s5: number;
    errors: number;
  }>([
    { $match: { createdAt: { $gte: from } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        avgLatency: { $avg: { $cond: [{ $gt: ["$status", 0] }, "$latencyMs", null] } },
        s2: { $sum: { $cond: [{ $and: [{ $gte: ["$status", 200] }, { $lt: ["$status", 300] }] }, 1, 0] } },
        s3: { $sum: { $cond: [{ $and: [{ $gte: ["$status", 300] }, { $lt: ["$status", 400] }] }, 1, 0] } },
        s4: { $sum: { $cond: [{ $and: [{ $gte: ["$status", 400] }, { $lt: ["$status", 500] }] }, 1, 0] } },
        s5: { $sum: { $cond: [{ $gte: ["$status", 500] }, 1, 0] } },
        errors: { $sum: { $cond: [{ $eq: ["$status", 0] }, 1, 0] } },
      },
    },
  ]);
  return {
    total: row?.total ?? 0,
    avgLatencyMs: row?.avgLatency == null ? null : Math.round(row.avgLatency * 100) / 100,
    statusClasses: { "2xx": row?.s2 ?? 0, "3xx": row?.s3 ?? 0, "4xx": row?.s4 ?? 0, "5xx": row?.s5 ?? 0, error: row?.errors ?? 0 },
  };
};

const contractActivity = async (from: Date) => {
  const [total, [row], recentViolations] = await Promise.all([
    Contract.countDocuments(),
    ContractValidationLog.aggregate<{ total: number; valid: number; drift: number }>([
      { $match: { at: { $gte: from }, skipped: { $in: [null, undefined] } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          valid: { $sum: { $cond: ["$valid", 1, 0] } },
          drift: { $sum: { $cond: [{ $gt: ["$driftCount", 0] }, 1, 0] } },
        },
      },
    ]),
    ContractValidationLog.find({ at: { $gte: from }, valid: false, skipped: { $in: [null, undefined] } }, { errors: { $slice: 2 } })
      .sort({ at: -1 })
      .limit(10)
      .lean(),
  ]);
  const names = new Map(
    (await Contract.find({ _id: { $in: recentViolations.map((v) => v.contractId) } }, { name: 1 }).lean()).map((c) => [
      String(c._id),
      c.name,
    ]),
  );
  return {
    total,
    validations: row?.total ?? 0,
    passRate: row?.total ? Math.round((row.valid / row.total) * 10000) / 100 : null,
    withDrift: row?.drift ?? 0,
    recentViolations: recentViolations.map((v) => ({ ...v, contractName: names.get(String(v.contractId)) ?? "Deleted contract" })),
  };
};

// Checks in [from, to) for the comparison period
const loadRange = async (from: Date, to: Date): Promise<CheckPoint[]> => {
  return MonitorCheck.find(
    { checkedAt: { $gte: from, $lt: to } },
    { monitorId: 1, status: 1, latencyMs: 1, statusCode: 1, checkedAt: 1, _id: 0 },
  ).lean<CheckPoint[]>();
};

const contractPassRate = async (from: Date, to: Date): Promise<number | null> => {
  const [row] = await ContractValidationLog.aggregate<{ total: number; valid: number }>([
    { $match: { at: { $gte: from, $lt: to }, skipped: { $in: [null, undefined] } } },
    { $group: { _id: null, total: { $sum: 1 }, valid: { $sum: { $cond: ["$valid", 1, 0] } } } },
  ]);
  return row?.total ? Math.round((row.valid / row.total) * 10000) / 100 : null;
};

// Contract pass rate per time bucket, for the KPI sparkline
const contractSeries = async (from: Date, to: Date, buckets: number) => {
  const logs = await ContractValidationLog.find(
    { at: { $gte: from }, skipped: { $in: [null, undefined] } },
    { at: 1, valid: 1, _id: 0 },
  ).lean();
  const size = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / buckets));
  const out = Array.from({ length: buckets }, (_, i) => ({ start: new Date(from.getTime() + i * size), total: 0, valid: 0 }));
  for (const l of logs) {
    const idx = Math.floor((new Date(l.at).getTime() - from.getTime()) / size);
    if (idx >= 0 && idx < buckets) {
      out[idx].total++;
      if (l.valid) out[idx].valid++;
    }
  }
  return out.map((b) => ({ start: b.start, total: b.total, passRate: b.total ? Math.round((b.valid / b.total) * 10000) / 100 : null }));
};

type ActivityItem = {
  kind: "incident_opened" | "incident_resolved" | "contract_violation";
  at: Date;
  title: string;
  detail: string;
  severity: "down" | "degraded" | "ok" | "warning";
  link: string;
};

// One feed of notable events: incidents opening/resolving and contract violations
const recentActivity = async (from: Date, violations: { _id: unknown; contractId: unknown; contractName: string; at: Date; errorCount?: number | null; errors?: { path?: string | null; message?: string | null }[] }[]): Promise<ActivityItem[]> => {
  const incidents = await Incident.find({ $or: [{ startedAt: { $gte: from } }, { resolvedAt: { $gte: from } }, { status: "open" }] })
    .sort({ startedAt: -1 })
    .limit(20)
    .lean();
  const items: ActivityItem[] = [];
  for (const i of incidents) {
    if (i.startedAt >= from || i.status === "open") {
      items.push({
        kind: "incident_opened",
        at: i.startedAt,
        title: `${i.monitorName} ${i.severity === "down" ? "went down" : "degraded"}`,
        detail: i.cause,
        severity: i.severity,
        link: `/monitors/${i.monitorId}`,
      });
    }
    if (i.status === "resolved" && i.resolvedAt && i.resolvedAt >= from) {
      items.push({
        kind: "incident_resolved",
        at: i.resolvedAt,
        title: `${i.monitorName} recovered`,
        detail: `after ${formatDuration(i.durationMs ?? 0)}`,
        severity: "ok",
        link: `/monitors/${i.monitorId}`,
      });
    }
  }
  for (const v of violations) {
    const first = v.errors?.[0];
    items.push({
      kind: "contract_violation",
      at: v.at,
      title: `${v.contractName}: ${v.errorCount ?? 0} violation${v.errorCount === 1 ? "" : "s"}`,
      detail: first ? `${first.path} ${first.message}` : "",
      severity: "warning",
      link: `/contracts/${String(v.contractId)}`,
    });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 12);
};

export const dashboardRouter = Router();

// The profile card's `themis whoami`: monitors, the last 14 days of checks, pass rate and requests judged
dashboardRouter.get("/whoami", async (_req, res) => {
  const DAYS = 14;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = new Date(today.getTime() - (DAYS - 1) * 86_400_000);
  const [monitors, perDay, requests] = await Promise.all([
    Monitor.find({}, { enabled: 1, "state.status": 1 }).lean(),
    MonitorCheck.aggregate<{ _id: string; total: number; failed: number }>([
      { $match: { checkedAt: { $gte: from } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$checkedAt" } },
          total: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ["$status", "up"] }, 0, 1] } },
        },
      },
    ]),
    History.countDocuments({}),
  ]);
  const byDay = new Map(perDay.map((d) => [d._id, d.total]));
  const daily = Array.from({ length: DAYS }, (_, i) => byDay.get(new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10)) ?? 0);
  const checks = perDay.reduce((n, d) => n + d.total, 0);
  const failed = perDay.reduce((n, d) => n + d.failed, 0);
  const active = monitors.filter((m) => m.enabled);
  const count = (status: string) => active.filter((m) => m.state?.status === status).length;
  res.json({
    monitors: { total: monitors.length, active: active.length, up: count("up"), degraded: count("degraded"), down: count("down") },
    checks,
    daily,
    passRate: checks ? (checks - failed) / checks : null,
    requests,
  });
});

// One call that powers the whole dashboard
dashboardRouter.get("/", async (req, res) => {
  const { window } = query.parse(req.query);
  res.json(await buildDashboard(window));
});

export type DashboardData = Awaited<ReturnType<typeof buildDashboard>>;

// Aggregates everything on the dashboard
export const buildDashboard = async (window: WindowKey) => {
  const { from, to, buckets } = windowRange(window);

  const [monitors, points, openIncidents, resolvedInWindow, recentFailures, requests] = await Promise.all([
    Monitor.find({}, { name: 1, enabled: 1, state: 1, schedule: 1, "request.url": 1, "request.method": 1 }).lean(),
    loadPoints({}, from),
    Incident.find({ status: "open" }).sort({ startedAt: -1 }).limit(20).lean(),
    Incident.find({ status: "resolved", resolvedAt: { $gte: from } }, { durationMs: 1 }).lean(),
    MonitorCheck.find({ checkedAt: { $gte: from }, status: { $ne: "up" } })
      .sort({ checkedAt: -1 })
      .limit(15)
      .lean(),
    requestActivity(from),
  ]);
  const span = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span);
  const [contracts, prevPoints, prevPassRate, contractTrend] = await Promise.all([
    contractActivity(from),
    loadRange(prevFrom, from),
    contractPassRate(prevFrom, from),
    contractSeries(from, to, buckets),
  ]);
  const prev = summarize(prevPoints);
  const [activity, latestChecks] = await Promise.all([
    recentActivity(from, contracts.recentViolations),
    MonitorCheck.find({}, { monitorId: 1, status: 1, statusCode: 1, latencyMs: 1, checkedAt: 1, "error.code": 1 })
      .sort({ checkedAt: -1 })
      .limit(16)
      .lean(),
  ]);

  const names = new Map(monitors.map((m) => [String(m._id), m.name]));
  const counts = Object.fromEntries(MONITOR_STATUSES.map((s) => [s, 0])) as Record<(typeof MONITOR_STATUSES)[number], number>;
  for (const m of monitors) counts[(m.state?.status ?? "pending") as keyof typeof counts]++;

  const byMonitor = new Map<string, CheckPoint[]>();
  for (const p of points) {
    const key = String(p.monitorId);
    if (!byMonitor.has(key)) byMonitor.set(key, []);
    byMonitor.get(key)!.push(p);
  }

  const durations = resolvedInWindow.map((i) => i.durationMs ?? 0).filter((d) => d > 0);

  return {
    window,
    from,
    to,
    monitors: { total: monitors.length, ...counts },
    checks: summarize(points),
    series: bucketize(points, from, to, buckets),
    incidents: {
      open: openIncidents,
      openCount: openIncidents.length,
      resolvedInWindow: resolvedInWindow.length,
      mttrMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    },
    recentFailures: recentFailures.map((c) => ({ ...c, monitorName: names.get(String(c.monitorId)) ?? "Deleted monitor" })),
    monitorRows: monitors.map((m) => {
      const own = byMonitor.get(String(m._id)) ?? [];
      const s = summarize(own);
      return {
        _id: m._id,
        name: m.name,
        method: (m.request as { method?: string })?.method ?? "GET",
        url: (m.request as { url?: string })?.url ?? "",
        status: m.state?.status ?? "pending",
        lastCheckedAt: m.state?.lastCheckedAt ?? null,
        lastLatencyMs: m.state?.lastLatencyMs ?? null,
        uptimePct: s.uptimePct,
        p95LatencyMs: s.latency.p95,
        checks: s.total,
        timeline: bucketize(own, from, to, 24).map((b) => ({ start: b.start, worst: b.worst, avgLatencyMs: b.avgLatencyMs })),
      };
    }),
    requests,
    contracts: { ...contracts, series: contractTrend },
    // Same metrics for the preceding window of equal length, for change indicators
    previous: {
      uptimePct: prev.uptimePct,
      p95LatencyMs: prev.latency.p95,
      avgLatencyMs: prev.latency.avg,
      checks: prev.total,
      failures: prev.down,
      contractPassRate: prevPassRate,
    },
    activity,
    // Fine-grained strip for the "pulse" band (worst status per slot)
    pulse: bucketize(points, from, to, 120).map((b) => ({ start: b.start, worst: b.worst, total: b.total, avgLatencyMs: b.avgLatencyMs })),
    // Latest checks across all monitors, for the live tail
    latestChecks: latestChecks.map((c) => {
      const m = monitors.find((x) => String(x._id) === String(c.monitorId));
      return {
        _id: c._id,
        monitorId: c.monitorId,
        monitorName: m?.name ?? "Deleted monitor",
        method: (m?.request as { method?: string } | undefined)?.method ?? "GET",
        status: c.status,
        statusCode: c.statusCode,
        errorCode: c.error?.code,
        latencyMs: c.latencyMs,
        checkedAt: c.checkedAt,
      };
    }),
  };
};
