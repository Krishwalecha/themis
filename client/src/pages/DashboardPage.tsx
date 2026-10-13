import { DotLoader } from "../components/ui";
import { AlertTriangle, CheckCircle2, FileWarning, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AiSummaryCard } from "../components/AiSummaryCard";
import { StatusTimeline } from "../components/Charts";
import { Delta, formatPct, Kpi, StatusPill } from "../components/MonitorBits";
import { LiveTail, PulseStrip, Seismograph } from "../components/Pulse";
import { api } from "../lib/api";
import { formatDuration, formatMs, timeAgo } from "../lib/format";
import type { Dashboard, StatsWindow } from "../lib/types";
import { WindowPicker } from "./MonitorDetailPage";

const WINDOW_TEXT: Record<StatsWindow, string> = { "1h": "last hour", "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };

const clock = (iso: string): string => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

// A plain-English headline for the current state, plus a muted detail line
const headline = (d: Dashboard): { title: string; detail: string; tone: "good" | "warn" | "bad" } => {
  const { monitors, incidents, checks } = d;
  if (monitors.total === 0) return { title: "Nothing is being watched yet.", detail: "Create a monitor to start tracking uptime and latency.", tone: "good" };
  const problems = monitors.down + monitors.degraded;
  if (problems === 0 && incidents.openCount === 0) {
    return {
      title: "All systems normal.",
      detail: `${monitors.total} APIs monitored · ${checks.total.toLocaleString()} checks · no open incidents`,
      tone: "good",
    };
  }
  const parts = [
    monitors.down ? `${monitors.down} down` : "",
    monitors.degraded ? `${monitors.degraded} degraded` : "",
    incidents.openCount ? `${incidents.openCount} open incident${incidents.openCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return {
    title: problems === 1 ? "1 service needs attention." : problems ? `${problems} services need attention.` : "Incidents are still open.",
    detail: parts.join(" · "),
    tone: monitors.down ? "bad" : "warn",
  };
};

export const DashboardPage = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("window");
  const window: StatsWindow = fromUrl === "1h" || fromUrl === "7d" || fromUrl === "30d" ? fromUrl : "24h";
  const setWindow = (w: StatsWindow) => setParams(w === "24h" ? {} : { window: w }, { replace: true });
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard(window));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [window]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) {
    return <div className="page">{error ? <div className="banner error">{error}</div> : <DotLoader large />}</div>;
  }

  const { checks, incidents, contracts, previous } = data;
  const head = headline(data);
  const [whole, frac] = (checks.uptimePct === null ? "–" : checks.uptimePct.toFixed(2)).split(".");

  return (
    <div className="page">
      <header className="hero-head">
        <div>
          <span className="eyebrow">
            <span className={`live-dot ${head.tone === "bad" ? "bad" : head.tone === "warn" ? "warn" : ""}`} />
            Live · {WINDOW_TEXT[window]}
          </span>
          <h1 className="hero-title">{head.title}</h1>
          <p className="hero-sub">{head.detail}</p>
        </div>
        <div className="row-actions">
          <WindowPicker value={window} onChange={setWindow} />
          <Link to="/monitors/new" className="btn primary">
            <Plus size={15} />
            New monitor
          </Link>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <section className="panel pulse-card" aria-label="Uptime">
        <div className="pulse-top">
          <div>
            <div className="fact-label">Uptime</div>
            <div className="pulse-figure">
              {whole}
              {frac !== undefined && <small>.{frac}%</small>}
            </div>
          </div>
          <div className="pulse-facts">
            <div className="fact">
              <span className="fact-label">Checks</span>
              <span className="fact-value">{checks.total.toLocaleString()}</span>
            </div>
            <div className="fact">
              <span className="fact-label">Failed</span>
              <span className={`fact-value ${checks.down ? "tone-bad" : ""}`}>{checks.down}</span>
            </div>
            <div className="fact">
              <span className="fact-label">Degraded</span>
              <span className={`fact-value ${checks.degraded ? "tone-warn" : ""}`}>{checks.degraded}</span>
            </div>
            <div className="fact">
              <span className="fact-label">vs previous</span>
              <span className="fact-value">
                <Delta current={checks.uptimePct} previous={previous.uptimePct} goodWhen="up" mode="points" unit="pp" />
              </span>
            </div>
          </div>
        </div>
        <PulseStrip slots={data.pulse} window={window} />
      </section>

      <section className="kpis mono-kpis" aria-label="Key metrics">
        <Kpi
          label="p95 response"
          value={checks.latency.p95 === null ? "–" : formatMs(checks.latency.p95)}
          foot={
            <>
              <Delta current={checks.latency.p95} previous={previous.p95LatencyMs} goodWhen="down" />
              <span>avg {checks.latency.avg === null ? "–" : formatMs(checks.latency.avg)}</span>
            </>
          }
        />
        <Kpi
          label="Error rate"
          value={formatPct(checks.errorRate, 2)}
          foot={
            <span>
              {checks.down} of {checks.total} checks failed
            </span>
          }
        />
        <Kpi
          label="Open incidents"
          value={<span className={incidents.openCount ? "tone-bad" : ""}>{incidents.openCount}</span>}
          foot={<span>MTTR {formatDuration(incidents.mttrMs)}</span>}
        />
        <Kpi
          label="Contract pass rate"
          value={formatPct(contracts.passRate, 1)}
          foot={
            contracts.validations ? (
              <>
                <Delta current={contracts.passRate} previous={previous.contractPassRate} goodWhen="up" mode="points" unit="pp" />
                <span>{contracts.validations} validations</span>
              </>
            ) : (
              <span>No validations yet</span>
            )
          }
        />
      </section>

      <div className="grid-main">
        <section className="panel card">
          <div className="card-header">
            <h2>Response time</h2>
            <span className="eyebrow">avg per slot</span>
          </div>
          <Seismograph slots={data.pulse} p50={checks.latency.p50} p95={checks.latency.p95} window={window} />
        </section>

        <section className="panel card">
          <div className="card-header">
            <h2>Live tail</h2>
            <span className="eyebrow">
              <span className="live-dot" />
              streaming
            </span>
          </div>
          <LiveTail checks={data.latestChecks.slice(0, 9)} onOpen={(id) => navigate(`/monitors/${id}`)} />
        </section>
      </div>

      <section className="panel card card-flush">
        <div className="card-header">
          <h2>
            Monitors<span className="sub">{WINDOW_TEXT[window]}</span>
          </h2>
          <Link to="/monitors" className="link-btn">
            View all
          </Link>
        </div>
        {data.monitorRows.length === 0 ? (
          <div className="empty-state">
            <p className="strong">No monitors yet</p>
            <p className="muted small">Monitors call your endpoints on a schedule and record uptime and latency.</p>
            <Link to="/monitors/new" className="btn ghost small">
              Create monitor
            </Link>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Monitor</th>
                <th className="hide-sm">Status</th>
                <th className="timeline-cell">History</th>
                <th className="num">Uptime</th>
                <th className="num hide-sm">p95</th>
                <th className="num hide-sm">Last check</th>
              </tr>
            </thead>
            <tbody>
              {data.monitorRows.map((m) => (
                <tr key={m._id} className="clickable" onClick={() => navigate(`/monitors/${m._id}`)}>
                  <td className="request-cell">
                    <div className="strong truncate">{m.name}</div>
                    <div className="mono small muted truncate">{m.url}</div>
                  </td>
                  <td className="hide-sm">
                    <StatusPill status={m.status} />
                  </td>
                  <td className="timeline-cell">
                    <StatusTimeline buckets={m.timeline} window={window} compact />
                  </td>
                  <td className={`num ${m.uptimePct !== null && m.uptimePct < 99 ? "tone-bad" : ""}`}>{formatPct(m.uptimePct)}</td>
                  <td className="num hide-sm">{m.p95LatencyMs === null ? "–" : formatMs(m.p95LatencyMs)}</td>
                  <td className="num muted hide-sm">{m.lastCheckedAt ? timeAgo(m.lastCheckedAt) : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid-main">
        <section className="panel card">
          <div className="card-header">
            <h2>Incidents and violations</h2>
            <Link to="/incidents" className="link-btn">
              View all
            </Link>
          </div>
          {data.activity.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={20} className="tone-good" />
              <p className="muted small">Nothing notable in the {WINDOW_TEXT[window]}.</p>
            </div>
          ) : (
            <ul className="feed">
              {data.activity.slice(0, 5).map((a, i) => (
                <li key={i}>
                  <span className={`feed-icon ${a.severity}`}>
                    {a.kind === "incident_resolved" ? (
                      <CheckCircle2 size={15} />
                    ) : a.kind === "contract_violation" ? (
                      <FileWarning size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                  </span>
                  <div className="feed-body">
                    <Link to={a.link} className="feed-title">
                      {a.title}
                    </Link>
                    <div className="feed-detail truncate" title={a.detail}>
                      {a.detail}
                    </div>
                  </div>
                  <span className="time-chip">{clock(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <AiSummaryCard target={{ targetType: "ops", window }} title="Ops brief" auto />
      </div>
    </div>
  );
};
