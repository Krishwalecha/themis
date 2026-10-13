import { BulkBar, SelectBox, useSelection } from "../components/Bulk";
import { EmptyState, Eyebrow, Pagination } from "../components/ui";
import { useConfirm, useToast } from "../components/Feedback";
import { Pause, Play, Plus, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MethodBadge } from "../components/Badges";
import { StatusTimeline } from "../components/Charts";
import { formatPct, StatusPill } from "../components/MonitorBits";
import { api } from "../lib/api";
import { useFitPageSize } from "../lib/pageSize";
import { formatMs, timeAgo } from "../lib/format";
import type { Monitor } from "../lib/types";

export const MonitorsPage = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);
  // as many rows as fit on screen
  const pageSize = useFitPageSize(tableRef);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const { items } = await api.monitors.list();
      setItems(items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  const visibleIds = useMemo(() => visible.map((m) => m._id), [visible]);
  const sel = useSelection(visibleIds);

  const removeSelected = async () => {
    const ok = await confirm({
      title: `Delete ${sel.count} monitor${sel.count === 1 ? "" : "s"}?`,
      body: "They stop running, and their check history and incidents are removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const ids = [...sel.selected];
      const { deleted } = await api.monitors.bulkDelete(ids);
      setItems((list) => list.filter((m) => !ids.includes(m._id)));
      sel.clear();
      toast(`Deleted ${deleted} monitor${deleted === 1 ? "" : "s"}`);
    } catch (e) {
      toast("Couldn't delete", { tone: "error", body: (e as Error).message });
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const up = items.filter((m) => m.state.status === "up").length;
  const failing = items.filter((m) => m.state.status === "down" || m.state.status === "degraded").length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>Monitoring</Eyebrow>
          <h1>Monitors</h1>
          <p>
            {items.length === 0
              ? "Scheduled checks for uptime, failures and latency."
              : `${items.length} monitor${items.length === 1 ? "" : "s"} · ${up} up${failing ? ` · ${failing} need attention` : ""}`}
          </p>
        </div>
        {(loading || items.length > 0) && (
          <Link className="btn primary" to="/monitors/new">
            <Plus size={15} />
            New monitor
          </Link>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="table-wrap" ref={tableRef}>
        <table className="table">
          <thead>
            <tr>
              <th className="check-cell">
                <SelectBox label="Select all on this page" checked={sel.all} indeterminate={sel.some} onChange={sel.toggleAll} />
              </th>
              <th>Monitor</th>
              <th>Status</th>
              <th className="timeline-cell">Last 24 hours</th>
              <th className="num">Uptime</th>
              <th className="num hide-sm">Avg</th>
              <th className="num hide-sm">Checked</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m._id} className={`clickable${sel.has(m._id) ? " selected" : ""}`} onClick={() => navigate(`/monitors/${m._id}`)}>
                <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                  <SelectBox label={`Select ${m.name}`} checked={sel.has(m._id)} onChange={() => sel.toggle(m._id)} />
                </td>
                <td className="request-cell">
                  <div className="strong truncate">{m.name}</div>
                  <div className="mono small muted truncate">
                    <MethodBadge method={m.collectionId ? "RUN" : m.request.method} />
                    {m.collectionId ? `Collection · ${m.collectionName ?? "deleted"}` : m.request.url} · {m.scheduleLabel}
                  </div>
                </td>
                <td>
                  <StatusPill status={m.state.status} />
                </td>
                <td className="timeline-cell">{m.timeline && <StatusTimeline buckets={m.timeline} window="24h" compact />}</td>
                <td className={`num ${m.last24h?.uptimePct != null && m.last24h.uptimePct < 99 ? "tone-bad" : ""}`}>{formatPct(m.last24h?.uptimePct)}</td>
                <td className="num hide-sm">{m.last24h?.avgLatencyMs == null ? "–" : formatMs(m.last24h.avgLatencyMs)}</td>
                <td className="num muted hide-sm">{m.state.lastCheckedAt ? timeAgo(m.state.lastCheckedAt) : "never"}</td>
                <td className="actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    title="Run now"
                    aria-label="Run now"
                    disabled={busy === m._id}
                    onClick={() => act(m._id, () => api.monitors.run(m._id))}
                  >
                    <RotateCw size={15} strokeWidth={1.75} />
                  </button>
                  {m.enabled ? (
                    <button
                      className="icon-btn"
                      title="Pause"
                      aria-label="Pause"
                      disabled={busy === m._id}
                      onClick={() => act(m._id, () => api.monitors.pause(m._id))}
                    >
                      <Pause size={15} strokeWidth={1.75} />
                    </button>
                  ) : (
                    <button
                      className="icon-btn"
                      title="Resume"
                      aria-label="Resume"
                      disabled={busy === m._id}
                      onClick={() => act(m._id, () => api.monitors.resume(m._id))}
                    >
                      <Play size={15} strokeWidth={1.75} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <EmptyState
            title="Start monitoring your first API"
            action={
              <Link className="btn primary" to="/monitors/new">
                <Plus size={15} />
                New monitor
              </Link>
            }
          >
            Themis checks it on a schedule and tracks uptime, failures and latency.
          </EmptyState>
        )}
      </div>
      <BulkBar count={sel.count} noun="monitor" onClear={sel.clear}>
        <button className="btn destructive small" onClick={() => void removeSelected()}>
          Delete
        </button>
      </BulkBar>
      <Pagination page={page} pageSize={pageSize} total={items.length} onPage={setPage} />
    </div>
  );
};
