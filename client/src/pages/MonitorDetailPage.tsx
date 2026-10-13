import { DotLoader, Eyebrow, Pagination } from "../components/ui";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MethodBadge } from "../components/Badges";
import { ChecksChart, LatencyChart, StatusTimeline } from "../components/Charts";
import { AiSummaryCard } from "../components/AiSummaryCard";
import { ContractResult } from "../components/ContractBits";
import { AssertionResults, formatPct, Kpi, StatusPill } from "../components/MonitorBits";
import { api } from "../lib/api";
import { PANEL_PAGE_SIZE } from "../lib/pageSize";
import { formatDuration, formatMs, timeAgo } from "../lib/format";
import type { Incident, Monitor, MonitorCheck, MonitorStats, StatsWindow } from "../lib/types";

const WINDOWS: StatsWindow[] = ["1h", "24h", "7d", "30d"];

export const WindowPicker = ({ value, onChange }: { value: StatsWindow; onChange: (w: StatsWindow) => void }) => {
  return (
    <div className="segmented">
      {WINDOWS.map((w) => (
        <button key={w} className={value === w ? "active" : ""} onClick={() => onChange(w)}>
          {w}
        </button>
      ))}
    </div>
  );
};

export const MonitorDetailPage = () => {
  const { id = "" } = useParams();
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [checks, setChecks] = useState<MonitorCheck[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [window, setWindow] = useState<StatsWindow>("24h");
  const [onlyFailing, setOnlyFailing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // both lists page at the shared in-page size; checks are paged here, incidents on the server
  const [checkPage, setCheckPage] = useState(1);
  const [incPage, setIncPage] = useState(1);
  const [incTotal, setIncTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, s, c, inc] = await Promise.all([
        api.monitors.get(id),
        api.monitors.stats(id, window),
        api.monitors.checks(id, { limit: 200, status: onlyFailing ? "failing" : undefined }),
        api.incidents.list({ monitorId: id, limit: PANEL_PAGE_SIZE, page: incPage }),
      ]);
      setMonitor(m);
      setStats(s);
      setChecks(c.items);
      setIncidents(inc.items);
      setIncTotal(inc.total ?? inc.items.length);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, window, onlyFailing, incPage]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!monitor) return <div className="page">{error ? <div className="banner error">{error}</div> : <DotLoader large />}</div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>Monitor</Eyebrow>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <h1>{monitor.name}</h1>
            <StatusPill status={monitor.state.status} />
          </div>
          <p className="muted mono small">
            {monitor.collectionId ? (
              <>Runs collection {monitor.collectionName ? <Link to={`/collections/${monitor.collectionId}`}>{monitor.collectionName}</Link> : "(deleted)"}</>
            ) : (
              <>
                <MethodBadge method={monitor.request.method} /> {monitor.request.url}
              </>
            )}{" "}
            · {monitor.scheduleLabel}
            {monitor.state.nextRunAt && monitor.enabled && <> · next {new Date(monitor.state.nextRunAt).toLocaleTimeString()}</>}
          </p>
        </div>
        <div className="row-actions">
          <WindowPicker value={window} onChange={setWindow} />
          <button className="btn ghost" disabled={busy} onClick={() => act(() => api.monitors.run(id))}>
            Run now
          </button>
          {monitor.enabled ? (
            <button className="btn ghost" disabled={busy} onClick={() => act(() => api.monitors.pause(id))}>
              Pause
            </button>
          ) : (
            <button className="btn ghost" disabled={busy} onClick={() => act(() => api.monitors.resume(id))}>
              Resume
            </button>
          )}
          <Link className="btn ghost" to={`/monitors/${id}/edit`}>
            Edit
          </Link>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {monitor.state.lastError && monitor.state.status !== "up" && <div className="banner error">{monitor.state.lastError}</div>}

      {stats && (
        <>
          <section className="kpis" aria-label="Key metrics">
            <Kpi label="Uptime" value={formatPct(stats.uptimePct, 2)} foot={<span>{stats.total} checks</span>} />
            <Kpi
              label="Success rate"
              value={formatPct(stats.successRate, 1)}
              foot={
                <span>
                  {stats.up} ok · {stats.degraded} degraded
                </span>
              }
            />
            <Kpi
              label="Failures"
              value={<span className={stats.down ? "tone-bad" : ""}>{stats.down}</span>}
              foot={<span>error rate {formatPct(stats.errorRate)}</span>}
            />
            <Kpi
              label="p95 response"
              value={stats.latency.p95 === null ? "–" : formatMs(stats.latency.p95)}
              foot={
                <span>
                  avg {stats.latency.avg === null ? "–" : formatMs(stats.latency.avg)} · p99 {stats.latency.p99 === null ? "–" : formatMs(stats.latency.p99)}
                </span>
              }
            />
          </section>

          <section className="panel card">
            <div className="card-header">
              <h2>Status</h2>
              <span className="muted small">{stats.series.filter((b) => b.worst === "down").length} slots with failures</span>
            </div>
            <StatusTimeline buckets={stats.series} window={window} />
          </section>

          <div className="grid-main">
            <section className="panel card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">Response time</div>
                  <div className="chart-value">{stats.latency.avg === null ? "–" : formatMs(stats.latency.avg)}</div>
                </div>
              </div>
              <LatencyChart series={stats.series} window={window} />
            </section>
            <section className="panel card checks-card">
              <h2>Checks</h2>
              <ChecksChart series={stats.series} window={window} />
              <dl className="checks-kpis">
                {(
                  [
                    ["Total", stats.total, null],
                    ["Success", stats.up, "up"],
                    ["Degraded", stats.degraded, "degraded"],
                    ["Failure", stats.down, "down"],
                  ] as const
                ).map(([label, n, tone]) => (
                  <div key={label} className="checks-kpi">
                    <dt>
                      {tone && <span className={`swatch tl-${tone}`} />}
                      {label}
                    </dt>
                    <dd>
                      {n.toLocaleString()}
                      {tone && stats.total > 0 && <span className="muted small"> {Math.round((n / stats.total) * 1000) / 10}%</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <AiSummaryCard target={{ targetType: "monitor", targetId: id, window }} title={`Health report · ${window}`} />
        </>
      )}

      <section className="panel card">
        <div className="card-header">
          <h2>
            Recent checks <span className="sub">{checks.length >= 200 ? "latest 200" : "newest first"}</span>
          </h2>
          <label className="checkbox-field small">
            <input
              type="checkbox"
              checked={onlyFailing}
              onChange={(e) => {
                setOnlyFailing(e.target.checked);
                setCheckPage(1);
              }}
            />
            <span>Only failures</span>
          </label>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Result</th>
              <th>HTTP</th>
              <th className="num">Latency</th>
              <th>Reason</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {checks.slice((checkPage - 1) * PANEL_PAGE_SIZE, checkPage * PANEL_PAGE_SIZE).map((c) => (
              <Fragment key={c._id}>
                <tr className="clickable" onClick={() => setExpanded(expanded === c._id ? null : c._id)}>
                  <td>
                    <StatusPill status={c.status} />
                  </td>
                  <td className="mono">{c.statusCode || c.error?.code || "–"}</td>
                  <td className="num">{formatMs(c.latencyMs)}</td>
                  <td className="small truncate reason-cell" title={c.failures.join("\n")}>
                    {c.failures[0] ?? <span className="muted">All rules passed</span>}
                    {c.failures.length > 1 && <span className="muted"> · +{c.failures.length - 1} more</span>}
                  </td>
                  <td className="muted" title={new Date(c.checkedAt).toLocaleString()}>
                    {timeAgo(c.checkedAt)}
                    {c.trigger === "manual" && <span className="chip">manual</span>}
                    {c.maintenance && (
                      <span className="chip" title="Ran during a maintenance window: no incident, no alert, not counted in uptime">
                        maintenance
                      </span>
                    )}
                  </td>
                </tr>
                {expanded === c._id && (
                  <tr>
                    <td colSpan={5}>
                      <AssertionResults items={c.assertions} />
                      {c.contract && <ContractResult result={{ ...c.contract, validationId: c.contract.validationId, matched: undefined }} />}
                      {c.error?.message && <p className="error-text small">{c.error.message}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {checks.length === 0 && <p className="muted pad">No checks yet.</p>}
        {checks.length > PANEL_PAGE_SIZE && <Pagination page={checkPage} pageSize={PANEL_PAGE_SIZE} total={checks.length} onPage={setCheckPage} />}
      </section>

      <section className="panel card">
        <h2>Incidents</h2>
        {incidents.length === 0 ? <p className="muted">No incidents.</p> : <IncidentList incidents={incidents} />}
        {incTotal > PANEL_PAGE_SIZE && <Pagination page={incPage} pageSize={PANEL_PAGE_SIZE} total={incTotal} onPage={setIncPage} />}
      </section>
    </div>
  );
};

const IncidentList = ({ incidents, showMonitor = false }: { incidents: Incident[]; showMonitor?: boolean }) => {
  return (
    <ul className="incident-list">
      {incidents.map((i) => (
        <li key={i._id} className={`incident incident-${i.status}`}>
          <div className="incident-head">
            <span className={`pill pill-${i.status === "open" ? i.severity : "up"}`}>
              <span className="pill-dot" aria-hidden />
              {i.status === "open" ? (i.severity === "down" ? "Down" : "Degraded") : "Resolved"}
            </span>
            {showMonitor ? (
              <Link to={`/monitors/${i.monitorId}`} className="strong">
                {i.monitorName}
              </Link>
            ) : null}
            <span className="small">{i.cause}</span>
          </div>
          <div className="muted small">
            Started {new Date(i.startedAt).toLocaleString()} ·{" "}
            {i.status === "open" ? `ongoing for ${formatDuration(Date.now() - new Date(i.startedAt).getTime())}` : `lasted ${formatDuration(i.durationMs)}`}
            {" · "}
            {i.failedChecks} failed check{i.failedChecks === 1 ? "" : "s"}
          </div>
        </li>
      ))}
    </ul>
  );
};
