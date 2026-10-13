import { useId, useMemo, useState, type CSSProperties } from "react";
import { formatMs } from "../lib/format";
import type { SeriesBucket, StatsWindow } from "../lib/types";


export const tipStyle = (frac: number, top?: number, above = true): CSSProperties => {
  const x = frac > 0.72 ? "calc(-100% - 10px)" : frac < 0.28 ? "10px" : "-50%";
  return { left: `${frac * 100}%`, ...(top !== undefined ? { top } : {}), transform: `translate(${x}, ${above ? "-100%" : "0"})` };
};

export const bucketLabel = (iso: string, window: StatsWindow): string => {
  const d = new Date(iso);
  if (window === "1h" || window === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (window === "7d") return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", hour12: false });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

const niceMax = (v: number): number => {
  if (v <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
};

// Smooth path through points (monotone-ish cubic), breaking on gaps
const smoothPath = (points: ({ x: number; y: number } | null)[]): string => {
  let d = "";
  let prev: { x: number; y: number } | null = null;
  for (const p of points) {
    if (!p) {
      prev = null;
      continue;
    }
    if (!prev) d += `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    else {
      const cx = (prev.x + p.x) / 2;
      d += `C${cx.toFixed(1)},${prev.y.toFixed(1)} ${cx.toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
    prev = p;
  }
  return d;
};

const W = 640;
const H = 200;
const PAD = { top: 10, right: 8, bottom: 24, left: 44 };

// Average latency as a smooth area; p95 as a dashed line
export const LatencyChart = ({ series, window }: { series: SeriesBucket[]; window: StatsWindow }) => {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => niceMax(Math.max(0, ...series.map((b) => Math.max(b.p95LatencyMs ?? 0, b.avgLatencyMs ?? 0)))), [series]);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = series.length > 1 ? innerW / (series.length - 1) : innerW;
  const x = (i: number) => PAD.left + i * step;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const avgPts = series.map((b, i) => (b.avgLatencyMs === null ? null : { x: x(i), y: y(b.avgLatencyMs) }));
  const p95Pts = series.map((b, i) => (b.p95LatencyMs === null ? null : { x: x(i), y: y(b.p95LatencyMs) }));
  const hasData = avgPts.some(Boolean);
  const avgLine = smoothPath(avgPts);
  const firstIdx = avgPts.findIndex(Boolean);
  const lastIdx = avgPts.length - 1 - [...avgPts].reverse().findIndex(Boolean);
  const h = hover !== null ? series[hover] : null;

  return (
    <div className="chart">
      <div className="chart-legend">
        <span className="legend-item">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" className="series-avg" />
          </svg>
          Average
        </span>
        <span className="legend-item">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" className="series-p95" />
          </svg>
          p95
        </span>
      </div>
      <div className="chart-frame">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Latency over time" onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--chart)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(max * t)} y2={y(max * t)} className="grid" />
              <text x={PAD.left - 8} y={y(max * t) + 4} className="axis-label" textAnchor="end">
                {formatMs(max * t)}
              </text>
            </g>
          ))}
          {series.length > 0 &&
            [0, Math.floor((series.length - 1) / 2), series.length - 1].map((i) => (
              <text key={i} x={x(i)} y={H - 6} className="axis-label" textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}>
                {bucketLabel(series[i].start, window)}
              </text>
            ))}
          {hasData && (
            <>
              {firstIdx !== lastIdx && (
                <path d={`${avgLine}L${x(lastIdx)},${PAD.top + innerH}L${x(firstIdx)},${PAD.top + innerH}Z`} fill={`url(#${gid})`} />
              )}
              <path d={smoothPath(p95Pts)} className="series-p95" fill="none" />
              <path d={avgLine} className="series-avg" fill="none" />
              {avgPts.map((p, i) =>
                p && !avgPts[i - 1] && !avgPts[i + 1] ? <circle key={i} cx={p.x} cy={p.y} r="3" className="dot-avg" /> : null,
              )}
            </>
          )}
          {h && hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="crosshair" />
              {h.avgLatencyMs !== null && <circle cx={x(hover)} cy={y(h.avgLatencyMs)} r="4" className="dot-avg" />}
            </>
          )}
          {series.map((_, i) => (
            <rect key={i} x={x(i) - step / 2} y={PAD.top} width={Math.max(step, 4)} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {!hasData && <div className="chart-empty muted small">No checks in this period yet</div>}
        {h && hover !== null && (
          <div className="tooltip" style={tipStyle(x(hover) / W, undefined, false)}>
            <div className="tooltip-title">{bucketLabel(h.start, window)}</div>
            <div className="tooltip-row">
              <span className="muted">Average</span>
              <span>{h.avgLatencyMs === null ? "–" : formatMs(h.avgLatencyMs)}</span>
            </div>
            <div className="tooltip-row">
              <span className="muted">p95</span>
              <span>{h.p95LatencyMs === null ? "–" : formatMs(h.p95LatencyMs)}</span>
            </div>
            <div className="tooltip-row">
              <span className="muted">Checks</span>
              <span>{h.total}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */

const STATUS_TEXT = { up: "Operational", degraded: "Degraded", down: "Down", none: "No data" } as const;

// Status bars: one bar per time slot, coloured by the worst status in it
export const StatusTimeline = ({
  buckets,
  window,
  compact = false,
}: {
  buckets: { start: string; worst: keyof typeof STATUS_TEXT; total?: number }[];
  window: StatsWindow;
  compact?: boolean;
}) => {
  return (
    <div className={`timeline${compact ? " compact" : ""}`} role="img" aria-label="Status over time">
      {buckets.map((b, i) => (
        <span
          key={i}
          className={`tl-bar tl-${b.worst}`}
          style={{ "--i": i } as CSSProperties}
          title={`${bucketLabel(b.start, window)} · ${STATUS_TEXT[b.worst]}${b.total ? ` · ${b.total} checks` : ""}`}
        />
      ))}
    </div>
  );
};

// Stacked success / degraded / failure counts per bucket
export const ChecksChart = ({ series, window }: { series: SeriesBucket[]; window: StatsWindow }) => {
  const max = Math.max(1, ...series.map((b) => b.total));
  return (
    <div className="chart">
      <div className="chart-legend">
        <span className="legend-item">
          <span className="swatch tl-up" />
          Success
        </span>
        <span className="legend-item">
          <span className="swatch tl-degraded" />
          Degraded
        </span>
        <span className="legend-item">
          <span className="swatch tl-down" />
          Failure
        </span>
      </div>
      <div className="stack-bars">
        {series.map((b, i) => (
          <div key={i} className="stack-col" title={`${bucketLabel(b.start, window)} · ${b.up} ok, ${b.degraded} degraded, ${b.down} failed`}>
            {b.down > 0 && <span className="tl-down" style={{ height: `${(b.down / max) * 100}%` }} />}
            {b.degraded > 0 && <span className="tl-degraded" style={{ height: `${(b.degraded / max) * 100}%` }} />}
            {b.up > 0 && <span className="tl-up" style={{ height: `${(b.up / max) * 100}%` }} />}
          </div>
        ))}
      </div>
      <div className="stack-axis">
        <span>{series[0] ? bucketLabel(series[0].start, window) : ""}</span>
        <span>{series.length ? bucketLabel(series[series.length - 1].start, window) : ""}</span>
      </div>
    </div>
  );
};
