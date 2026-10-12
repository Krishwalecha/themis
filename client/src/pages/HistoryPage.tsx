import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { METHOD_OPTIONS, MethodBadge, StatusBadge } from "../components/Badges";
import { BulkBar, SelectBox, useSelection } from "../components/Bulk";
import { useConfirm, useToast } from "../components/Feedback";
import { DotLoader, EmptyState, Eyebrow, Pagination, Select } from "../components/ui";
import { api } from "../lib/api";
import { useFitPageSize } from "../lib/pageSize";
import { useEnvironments } from "../lib/environments";
import { formatBytes, formatMs, timeAgo } from "../lib/format";
import { type HistoryListItem, type HttpMethod, type StatusFilter } from "../lib/types";

export const HistoryPage = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { environments } = useEnvironments();
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);
  // as many rows as fit on screen
  const pageSize = useFitPageSize(tableRef);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [method, setMethod] = useState<HttpMethod | "">("");
  const [status, setStatus] = useState<StatusFilter | "">("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change starts again from page 1.
  useEffect(() => setPage(1), [debouncedQ, method, status, pageSize]);

  // only the newest request may update the table: an older, slower one would overwrite it
  const latest = useRef(0);
  const load = useCallback(async () => {
    const seq = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.history.list({
        q: debouncedQ || undefined,
        method: method || undefined,
        status: status || undefined,
        limit: pageSize,
        page,
      });
      if (seq !== latest.current) return;
      // Deleting the last row of the last page: step back a page.
      if (res.items.length === 0 && page > 1) {
        setPage(page - 1);
        return;
      }
      setItems(res.items);
      setTotal(res.total ?? res.items.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, method, status, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const rerun = async (item: HistoryListItem) => {
    setBusyId(item._id);
    try {
      const outcome = await api.history.rerun(item._id);
      if (outcome.historyId) {
        if (page === 1) void load();
        else setPage(1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const pageIds = useMemo(() => items.map((i) => i._id), [items]);
  const sel = useSelection(pageIds);

  const clearAll = async () => {
    const ok = await confirm({
      title: `Delete all ${total} requests?`,
      body: "Every recorded request and response will be deleted. This can't be undone.",
      confirmLabel: "Delete all",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.history.clear();
      setItems([]);
      setTotal(0);
      setPage(1);
      sel.clear();
      toast("History cleared");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeSelected = async () => {
    const ok = await confirm({
      title: `Delete ${sel.count} request${sel.count === 1 ? "" : "s"}?`,
      body: "They're removed from your history for good.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const { deleted } = await api.history.bulkDelete([...sel.selected]);
      sel.clear();
      toast(`Deleted ${deleted} request${deleted === 1 ? "" : "s"}`);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const envName = (id?: string) => (id ? (environments.find((e) => e._id === id)?.name ?? "deleted env") : "—");
  const filtersActive = Boolean(debouncedQ || method || status);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>API testing</Eyebrow>
          <h1>History</h1>
          <p className="muted">Every request you send, ready to inspect or re-run.</p>
        </div>
      </header>

      <div className="filters">
        <input className="input search" type="search" placeholder="Search URL or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          mono
          label="Filter by method"
          value={method}
          onChange={(v) => setMethod(v as HttpMethod | "")}
          options={[{ value: "", label: "All methods" }, ...METHOD_OPTIONS]}
        />
        <Select
          label="Filter by status"
          align="right"
          value={status}
          onChange={(v) => setStatus(v as StatusFilter | "")}
          options={[
            { value: "", label: "All statuses" },
            { value: "2xx", label: "2xx success", className: "tone-good" },
            { value: "3xx", label: "3xx redirect" },
            { value: "4xx", label: "4xx client error", className: "tone-warn" },
            { value: "5xx", label: "5xx server error", className: "tone-bad" },
            { value: "error", label: "Network error", className: "tone-bad" },
          ]}
        />
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="table-wrap" ref={tableRef}>
        <table className="table history-table">
          <thead>
            <tr>
              <th className="check-cell">
                <SelectBox label="Select all on this page" checked={sel.all} indeterminate={sel.some} onChange={sel.toggleAll} />
              </th>
              <th>Method</th>
              <th>Request</th>
              <th>Status</th>
              <th className="num">Time</th>
              <th className="num">Size</th>
              <th>Environment</th>
              <th>When</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id} className={`clickable${sel.has(item._id) ? " selected" : ""}`} onClick={() => navigate(`/workspace?load=${item._id}`)}>
                <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                  <SelectBox label={`Select ${item.url}`} checked={sel.has(item._id)} onChange={() => sel.toggle(item._id)} />
                </td>
                <td>
                  <MethodBadge method={item.method} />
                </td>
                <td className="request-cell">
                  {item.name && <div className="strong">{item.name}</div>}
                  <div className="mono small truncate" title={item.resolvedUrl}>
                    {item.resolvedUrl}
                  </div>
                </td>
                <td>
                  <StatusBadge status={item.status} errorCode={item.errorCode} />
                </td>
                <td className="num">{formatMs(item.latencyMs)}</td>
                <td className="num">{formatBytes(item.sizeBytes)}</td>
                <td className="muted">{envName(item.environmentId)}</td>
                <td className="muted" title={new Date(item.createdAt).toLocaleString()}>
                  {timeAgo(item.createdAt)}
                </td>
                <td className="actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost small" disabled={busyId === item._id} onClick={() => void rerun(item)}>
                    {busyId === item._id ? "…" : "Re-run"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading &&
          items.length === 0 &&
          (filtersActive ? (
            <EmptyState title="Nothing matches these filters">Try a different method, status or search.</EmptyState>
          ) : (
            <EmptyState
              title="Send your first request"
              action={
                <Link className="btn primary" to="/workspace">
                  Open workspace
                </Link>
              }
            >
              Every request you send from the workspace lands here, ready to inspect or re-run.
            </EmptyState>
          ))}
      </div>

      {loading && items.length === 0 ? (
        <div className="load-more">
          <DotLoader large />
        </div>
      ) : (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}

      <BulkBar count={sel.count} noun="request" onClear={sel.clear}>
        {sel.all && total > sel.count && !filtersActive && (
          <button className="btn ghost small" onClick={() => void clearAll()}>
            Delete all {total}
          </button>
        )}
        <button className="btn destructive small" onClick={() => void removeSelected()}>
          Delete
        </button>
      </BulkBar>
    </div>
  );
};
