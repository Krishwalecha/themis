import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { StatusTimeline } from "../components/Charts";
import { formatPct, StatusPill } from "../components/MonitorBits";
import { DotLoader } from "../components/ui";
import { api } from "../lib/api";
import { setPageMeta } from "../lib/meta";
import { formatDuration } from "../lib/format";
import type { PublicStatus } from "../lib/types";

const HEADLINE = { operational: "All systems operational", degraded: "Some systems degraded", down: "Some systems down" } as const;

// the public page: no sign-in, refreshes itself every minute
export const StatusPage = () => {
  const { slug = "" } = useParams();
  const [data, setData] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .publicStatus(slug)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setPageMeta(`${d.title} · status`, true, `Live status, 30-day uptime and recent incidents for ${d.title}.`);
        })
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [slug]);

  if (error && !data)
    return (
      <main className="status-public">
        <div className="status-missing">
          <h1>Status page not found</h1>
          <p className="muted">This page doesn't exist or has been turned off.</p>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="status-public">
        <DotLoader large />
      </main>
    );

  return (
    <main className="status-public">
      <header className="status-public-head">
        <h1>{data.title}</h1>
        <div className={`status-banner ${data.status}`}>
          <span className="pill-dot" aria-hidden />
          {HEADLINE[data.status]}
        </div>
      </header>

      <section className="status-public-list" aria-label="Services">
        {data.monitors.length === 0 && <p className="muted">No services listed yet.</p>}
        {data.monitors.map((m) => (
          <div key={m.id} className="status-public-row">
            <div className="status-public-name">
              <span className="strong">{m.name}</span>
              <span className="mono small muted">{formatPct(m.uptimePct)} uptime</span>
              <StatusPill status={m.status} />
            </div>
            <StatusTimeline buckets={m.days} window="30d" />
            <div className="status-public-axis mono">
              <span>30 days ago</span>
              <span>Today</span>
            </div>
          </div>
        ))}
      </section>

      <section className="status-public-incidents" aria-label="Recent incidents">
        <h2 className="eyebrow">Last 14 days</h2>
        {data.incidents.length === 0 ? (
          <p className="muted">No incidents.</p>
        ) : (
          <ul>
            {data.incidents.map((i) => (
              <li key={i.id}>
                <StatusPill status={i.status === "open" ? i.severity : "up"} />
                <span className="strong truncate">{i.monitorName}</span>
                <span className="muted small">
                  {i.status === "open" ? "Ongoing since" : i.severity === "down" ? "Outage on" : "Degraded on"} {new Date(i.startedAt).toLocaleString()}
                  {i.durationMs !== null && ` · ${formatDuration(i.durationMs)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="status-public-foot mono">
        Updated {new Date(data.updatedAt).toLocaleTimeString()} · <Link to="/">Powered by themis.</Link>
      </footer>
    </main>
  );
};
