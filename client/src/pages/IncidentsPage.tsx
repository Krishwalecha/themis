import { DotLoader, EmptyState, Eyebrow, Pagination } from "../components/ui";
import { useCallback, useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useFitPageSize } from "../lib/pageSize";
import type { Incident } from "../lib/types";
import { formatDuration } from "../lib/format";

type Filter = "all" | "open" | "resolved";

export const IncidentsPage = () => {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<Incident[]>([]);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);
  // as many rows as fit on screen
  const pageSize = useFitPageSize(tableRef);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPage(1), [filter, pageSize]);

  // only the newest request may update the table: an older, slower one would overwrite it
  const latest = useRef(0);
  const load = useCallback(async () => {
    const seq = ++latest.current;
    setLoading(true);
    try {
      const res = await api.incidents.list({ status: filter === "all" ? undefined : filter, limit: pageSize, page });
      if (seq !== latest.current) return;
      setItems(res.items);
      setTotal(res.total ?? res.items.length);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>Monitoring</Eyebrow>
          <h1>Incidents</h1>
          <p>Opened automatically when a monitor fails and resolved when it recovers.</p>
        </div>
        <div className="segmented">
          {(["all", "open", "resolved"] as const).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "open" ? "Open" : "Resolved"}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="table-wrap" ref={tableRef}>
        <table className="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Monitor</th>
              <th>Cause</th>
              <th className="num">Duration</th>
              <th className="num hide-sm">Failed checks</th>
              <th className="num">Started</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i._id}>
                <td>
                  <span className={`pill pill-${i.status === "open" ? i.severity : "up"}`}>
                    <span className="pill-dot" aria-hidden />
                    {i.status === "open" ? (i.severity === "down" ? "Down" : "Degraded") : "Resolved"}
                  </span>
                </td>
                <td>
                  <Link to={`/monitors/${i.monitorId}`} className="strong" style={{ textDecoration: "none" }}>
                    {i.monitorName}
                  </Link>
                </td>
                <td className="reason-cell small truncate" title={i.cause}>
                  {i.cause}
                </td>
                <td className="num">{i.status === "open" ? formatDuration(Date.now() - new Date(i.startedAt).getTime()) : formatDuration(i.durationMs)}</td>
                <td className="num hide-sm">{i.failedChecks}</td>
                <td className="num muted">
                  {new Date(i.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <EmptyState title="No incidents">
            {filter === "open" ? "Nothing is failing right now." : "Your monitors haven't recorded any incidents yet."}
          </EmptyState>
        )}
      </div>
      {loading && items.length === 0 ? (
        <div className="load-more">
          <DotLoader large />
        </div>
      ) : (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}
    </div>
  );
};
