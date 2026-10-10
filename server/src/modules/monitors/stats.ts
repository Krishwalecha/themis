import type { Types } from "mongoose";
import { MonitorCheck } from "../../models/MonitorCheck";

export const WINDOWS = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;
export type WindowKey = keyof typeof WINDOWS;

// Bucket count per window, chosen so charts have useful resolution
const BUCKETS: Record<WindowKey, number> = { "1h": 60, "24h": 48, "7d": 56, "30d": 60 };

export interface CheckPoint {
  monitorId?: Types.ObjectId;
  status: "up" | "degraded" | "down";
  latencyMs: number;
  statusCode: number;
  checkedAt: Date;
}

interface LatencyStats {
  avg: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

interface CheckStats {
  total: number;
  up: number;
  degraded: number;
  down: number;
  // % of checks where the API was reachable and correct enough to serve (up + degraded)
  uptimePct: number | null;
  // % of checks that fully passed
  successRate: number | null;
  errorRate: number | null;
  latency: LatencyStats;
}

interface SeriesBucket {
  start: Date;
  total: number;
  up: number;
  degraded: number;
  down: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  // Worst status in the bucket, for status-timeline bars
  worst: "up" | "degraded" | "down" | "none";
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Nearest-rank percentile over a sorted array
export const percentile = (sorted: number[], p: number): number | null => {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
};

const latencyStats = (values: number[]): LatencyStats => {
  if (!values.length) return { avg: null, min: null, max: null, p50: null, p95: null, p99: null };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    avg: round(sum / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
};

export const summarize = (points: CheckPoint[]): CheckStats => {
  const up = points.filter((p) => p.status === "up").length;
  const degraded = points.filter((p) => p.status === "degraded").length;
  const down = points.length - up - degraded;
  const total = points.length;
  // Latency only counts checks that actually got a response.
  const latencies = points.filter((p) => p.statusCode > 0).map((p) => p.latencyMs);
  return {
    total,
    up,
    degraded,
    down,
    uptimePct: total ? round(((up + degraded) / total) * 100, 3) : null,
    successRate: total ? round((up / total) * 100, 2) : null,
    errorRate: total ? round((down / total) * 100, 2) : null,
    latency: latencyStats(latencies),
  };
};

const SEVERITY = { none: 0, up: 1, degraded: 2, down: 3 } as const;

export const bucketize = (points: CheckPoint[], from: Date, to: Date, buckets: number): SeriesBucket[] => {
  const span = to.getTime() - from.getTime();
  const size = Math.max(1, Math.ceil(span / buckets));
  const groups: CheckPoint[][] = Array.from({ length: buckets }, () => []);
  for (const p of points) {
    const idx = Math.floor((p.checkedAt.getTime() - from.getTime()) / size);
    if (idx >= 0 && idx < buckets) groups[idx].push(p);
  }
  return groups.map((g, i) => {
    const s = summarize(g);
    const worst = g.reduce<SeriesBucket["worst"]>((w, p) => (SEVERITY[p.status] > SEVERITY[w] ? p.status : w), "none");
    return {
      start: new Date(from.getTime() + i * size),
      total: s.total,
      up: s.up,
      degraded: s.degraded,
      down: s.down,
      avgLatencyMs: s.latency.avg,
      p95LatencyMs: s.latency.p95,
      worst,
    };
  });
};

export const windowRange = (key: WindowKey, now = new Date()): { from: Date; to: Date; buckets: number } => {
  return { from: new Date(now.getTime() - WINDOWS[key]), to: now, buckets: BUCKETS[key] };
};

export const loadPoints = async (filter: Record<string, unknown>, from: Date): Promise<CheckPoint[]> => {
  return MonitorCheck.find(
    { ...filter, checkedAt: { $gte: from }, maintenance: { $ne: true } },
    { monitorId: 1, status: 1, latencyMs: 1, statusCode: 1, checkedAt: 1, _id: 0 },
  )
    .sort({ checkedAt: 1 })
    .lean<CheckPoint[]>();
};

export const monitorStats = async (monitorId: Types.ObjectId | string, key: WindowKey) => {
  const { from, to, buckets } = windowRange(key);
  const points = await loadPoints({ monitorId }, from);
  return { window: key, from, to, ...summarize(points), series: bucketize(points, from, to, buckets) };
};
