import { useMemo, useState, type CSSProperties } from "react";
import { formatMs } from "../lib/format";
import type { CheckStatus, Dashboard, StatsWindow } from "../lib/types";
import { bucketLabel, tipStyle } from "./Charts";

type Slot = { start: string; worst: CheckStatus | "none"; total: number; avgLatencyMs: number | null };

// The signature "barcode": one thin tick per time slot
export const PulseStrip = ({ slots, window }: { slots: Slot[]; window: StatsWindow }) => {
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? slots[hover] : null;
  return (
    <div className="pulse">
      <div className="pulse-strip" onMouseLeave={() => setHover(null)} role="img" aria-label="Status across the period">
        {slots.map((s, i) => (
          <span key={i} className={`tick tick-${s.worst}${hover === i ? " on" : ""}`} style={{ "--i": i } as CSSProperties} onMouseEnter={() => setHover(i)} />
        ))}
        {h && hover !== null && (
          <div className="tooltip" style={tipStyle((hover + 0.5) / slots.length, -10)}>
            <div className="tooltip-title">{bucketLabel(h.start, window)}</div>
            <div className="tooltip-row">
              <span className="muted">Status</span>
              <span>{h.worst === "none" ? "No checks" : h.worst === "up" ? "Healthy" : h.worst === "degraded" ? "Degraded" : "Failing"}</span>
            </div>
            {h.total > 0 && (
              <>
                <div className="tooltip-row">
                  <span className="muted">Checks</span>
                  <span>{h.total}</span>
                </div>
                <div className="tooltip-row">
                  <span className="muted">Avg response</span>
                  <span>{h.avgLatencyMs === null ? "–" : formatMs(h.avgLatencyMs)}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="pulse-axis">
        <span>{slots[0] ? bucketLabel(slots[0].start, window) : ""}</span>
        <span>now</span>
      </div>
    </div>
  );
};

// Latency as a seismograph: one thin tick per slot, with p50 and p95 reference lines
export const Seismograph = ({ slots, p50, p95, window }: { slots: Slot[]; p50: number | null; p95: number | null; window: StatsWindow }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, p95 ?? 0, ...slots.map((s) => s.avgLatencyMs ?? 0)) * 1.1, [slots, p95]);
  const h = hover !== null ? slots[hover] : null;
  const empty = slots.every((s) => s.avgLatencyMs === null);
  return (
    <div className="seismo-wrap">
      <div className="seismo" onMouseLeave={() => setHover(null)}>
        {p95 !== null && (
          <div className="ref-line p95" style={{ bottom: `${(p95 / max) * 100}%` }}>
            <span>p95 {formatMs(p95)}</span>
          </div>
        )}
        {p50 !== null && (
          <div className="ref-line faint" style={{ bottom: `${(p50 / max) * 100}%` }}>
            <span>p50 {formatMs(p50)}</span>
          </div>
        )}
        {slots.map((s, i) => (
          <span key={i} className="seismo-col" onMouseEnter={() => setHover(i)}>
            {s.avgLatencyMs !== null && <span className={`seismo-tick tick-${s.worst}`} style={{ height: `${Math.max(2, (s.avgLatencyMs / max) * 100)}%`, "--i": i } as CSSProperties} />}
          </span>
        ))}
        {empty && <div className="chart-empty muted small">No checks in this period yet</div>}
        {h && hover !== null && h.avgLatencyMs !== null && (
          <div className="tooltip" style={tipStyle((hover + 0.5) / slots.length, -10)}>
            <div className="tooltip-title">{bucketLabel(h.start, window)}</div>
            <div className="tooltip-row">
              <span className="muted">Avg response</span>
              <span>{formatMs(h.avgLatencyMs)}</span>
            </div>
            <div className="tooltip-row">
              <span className="muted">Checks</span>
              <span>{h.total}</span>
            </div>
          </div>
        )}
      </div>
      <div className="pulse-axis">
        <span>{slots[0] ? bucketLabel(slots[0].start, window) : ""}</span>
        <span>now</span>
      </div>
    </div>
  );
};

const hhmmss = (iso: string): string => {
  return new Date(iso).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Log-style stream of the latest checks across every monitor
export const LiveTail = ({ checks, onOpen }: { checks: Dashboard["latestChecks"]; onOpen: (monitorId: string) => void }) => {
  if (!checks.length) return <p className="muted small tail-empty">Waiting for the first check…</p>;
  return (
    <ol className="tail">
      {checks.map((c) => (
        <li key={c._id} onClick={() => onOpen(c.monitorId)} className={`tail-row tail-${c.status}`}>
          <span className="tail-time">{hhmmss(c.checkedAt)}</span>
          <span className="tail-name truncate">{c.monitorName}</span>
          <span className={`tail-code code-${c.statusCode === 0 ? "err" : Math.floor(c.statusCode / 100)}xx`}>
            {c.statusCode === 0 ? (c.errorCode ?? "ERR").replace(/_.*/, "") : c.statusCode}
          </span>
          <span className="tail-ms">{formatMs(c.latencyMs)}</span>
        </li>
      ))}
    </ol>
  );
};
