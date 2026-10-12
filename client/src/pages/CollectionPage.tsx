import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, Braces, Play, Plus, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MethodBadge, StatusBadge } from "../components/Badges";
import { AiSummaryCard } from "../components/AiSummaryCard";
import { ExtractEditor } from "../components/ExtractEditor";
import { useConfirm, useToast } from "../components/Feedback";
import { DotLoader, EmptyState, Eyebrow, Select, WaveLoader, Pagination } from "../components/ui";
import { api } from "../lib/api";
import { useFitPageSize } from "../lib/pageSize";
import { environmentOptions, useEnvironments } from "../lib/environments";
import { formatMs } from "../lib/format";
import type { Collection, CollectionRun, CollectionRunResult, Extraction } from "../lib/types";

// a first, plain-language read of why a request in a run failed; "Explain" goes deeper with the response itself
const failureHint = (r: CollectionRunResult): string | null => {
  if (r.verdict === "pass") return null;
  if (r.unresolvedVariables?.length) return "A {{variable}} it uses wasn't set by an earlier request or the environment, so it was sent as-is.";
  if (r.error)
    return r.error.code === "TIMEOUT" ? "The server didn't answer in time." : "The request never got a response: check the host and that the server is up.";
  if (r.contract && !r.contract.valid) return "The response arrived but doesn't match its contract.";
  const s = r.status;
  if (s === 401) return "Not authenticated: add or refresh the token. Some APIs also answer 401 for paths that don't exist, so check the URL for typos.";
  if (s === 403) return "Signed in but not allowed: the token lacks access to this resource.";
  if (s === 404) return "Nothing at this address: check the path and any IDs in it.";
  if (s === 405) return "This path doesn't accept that method.";
  if (s === 400 || s === 422) return "The server rejected the input: check the body and query parameters.";
  if (s === 429) return "Rate limited: slow down or authenticate the request.";
  if (s >= 500) return "The server failed while handling it: check its logs.";
  return null;
};

const needsPathLabel = (x: Extraction) => (x.source === "jsonPath" || x.source === "header" ? x.path : x.source === "status" ? "the status code" : "the body");

export const CollectionPage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { environments } = useEnvironments();
  const [c, setC] = useState<Collection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<CollectionRun | null>(null);
  // the request whose captured variables are being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);
  // as many rows as fit on screen
  const pageSize = useFitPageSize(tableRef);
  // the failed request whose AI explanation is open
  const [explaining, setExplaining] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.collections.get(id);
      setC(data);
      setName(data.name);
      setDescription(data.description);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<Pick<Collection, "name" | "description" | "environmentId">>) => {
    if (!c) return;
    const next = { name: c.name, description: c.description, environmentId: c.environmentId, ...patch };
    if (!next.name.trim()) return setName(c.name);
    try {
      setC(await api.collections.update(c._id, next));
    } catch (e) {
      toast("Couldn't save", { tone: "error", body: (e as Error).message });
      setName(c.name);
    }
  };

  const move = async (index: number, delta: number) => {
    if (!c) return;
    const ids = c.requests.map((r) => r._id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    setC({ ...c, requests: ids.map((rid) => c.requests.find((r) => r._id === rid)!) });
    try {
      setC(await api.collections.reorder(c._id, ids));
    } catch (e) {
      toast("Couldn't reorder", { tone: "error", body: (e as Error).message });
      void load();
    }
  };

  const removeRequest = async (rid: string, rname: string) => {
    if (!c) return;
    const ok = await confirm({
      title: `Remove "${rname}"?`,
      body: "It's removed from this collection. Past runs stay in history.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.collections.removeRequest(c._id, rid);
      setC({ ...c, requests: c.requests.filter((r) => r._id !== rid) });
    } catch (e) {
      toast("Couldn't remove", { tone: "error", body: (e as Error).message });
    }
  };

  const saveExtract = async (rid: string, extract: Extraction[]) => {
    if (!c) return;
    const r = c.requests.find((x) => x._id === rid)!;
    try {
      const saved = await api.collections.updateRequest(c._id, rid, { name: r.name, request: r.request, contractId: r.contractId ?? null, extract });
      setC({ ...c, requests: c.requests.map((x) => (x._id === rid ? saved : x)) });
      setEditing(null);
    } catch (e) {
      toast("Couldn't save", { tone: "error", body: (e as Error).message });
    }
  };

  const removeCollection = async () => {
    if (!c) return;
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      body: "The collection and its saved requests are deleted. Your history stays.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api.collections.remove(c._id);
    toast("Collection deleted", { body: c.name });
    navigate("/collections");
  };

  const runAll = async () => {
    if (!c) return;
    setRunning(true);
    try {
      const r = await api.collections.run(c._id);
      setRun(r);
      setExplaining(null);
      toast(r.failed ? `${r.failed} of ${r.results.length} failed` : `All ${r.results.length} passed`, {
        tone: r.failed ? "error" : "success",
        body: `${c.name} · ${formatMs(r.durationMs)}`,
      });
    } catch (e) {
      toast("Run failed", { tone: "error", body: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  if (error)
    return (
      <div className="page">
        <div className="banner error">{error}</div>
      </div>
    );
  if (!c)
    return (
      <div className="page">
        <div className="load-more">
          <DotLoader large />
        </div>
      </div>
    );

  const resultFor = (rid: string): CollectionRunResult | undefined => run?.results.find((r) => r.requestId === rid);

  return (
    <div className="page">
      <header className="page-header">
        <div className="collection-head">
          <Eyebrow>
            <Link to="/collections">Collections</Link>
          </Eyebrow>
          <input
            className="title-input collection-title"
            value={name}
            maxLength={100}
            aria-label="Collection name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== c.name && void save({ name: name.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <input
            className="collection-desc"
            placeholder="Add a description"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== c.description && void save({ description })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        <div className="collection-actions">
          <Select
            label="Environment"
            value={c.environmentId ?? ""}
            onChange={(v) => void save({ environmentId: v || null })}
            options={environmentOptions(environments)}
          />
          <Link className="btn ghost" to={`/workspace?newIn=${c._id}`} title="Open a new request that saves into this collection">
            <Plus size={14} />
            Add request
          </Link>
          <button
            className="btn ghost"
            disabled={c.requests.length === 0}
            title="Run this collection on a schedule and get alerted when it fails"
            onClick={() => navigate("/monitors/new", { state: { collectionId: c._id, name: c.name } })}
          >
            <Activity size={14} />
            Schedule
          </button>
          <button className="btn primary" disabled={running || c.requests.length === 0} onClick={() => void runAll()}>
            {running ? <WaveLoader label="Running" /> : <Play size={14} />}
            Run all
          </button>
          <button className="icon-btn danger" title="Delete collection" aria-label="Delete collection" onClick={() => void removeCollection()}>
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      {run && (
        <div className={`run-summary ${run.verdict}`}>
          <span className="run-tag">{run.verdict === "pass" ? "PASS" : "FAIL"}</span>
          <span>
            <b>{run.passed}</b> passed · <b>{run.failed}</b> failed
          </span>
          <span className="muted mono small">{formatMs(run.durationMs)} total</span>
          <button className="btn ghost small" onClick={() => setRun(null)}>
            Clear
          </button>
        </div>
      )}

      {c.requests.length === 0 ? (
        <EmptyState
          title="No requests in this collection"
          action={
            <Link className="btn primary" to={`/workspace?newIn=${c._id}`}>
              <Plus size={15} />
              Add a request
            </Link>
          }
        >
          Build a request in the workspace and save it here. Requests run in order, and each can pass values like a login token to the ones after it.
        </EmptyState>
      ) : (
        <div className="table-wrap" ref={tableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="order-cell" aria-label="Order" />
                <th>Request</th>
                <th>Last run</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {c.requests.slice((page - 1) * pageSize, page * pageSize).map((r, j) => {
                // position in the whole collection, so moving works across pages
                const i = (page - 1) * pageSize + j;
                const res = resultFor(r._id);
                const rules = (r.extract ?? []).filter((x) => x.enabled);
                return (
                  <Fragment key={r._id}>
                    <tr className={res ? `run-${res.verdict}` : ""}>
                      <td className="order-cell">
                        <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => void move(i, -1)}>
                          <ArrowUp size={13} />
                        </button>
                        <button className="icon-btn" aria-label="Move down" disabled={i === c.requests.length - 1} onClick={() => void move(i, 1)}>
                          <ArrowDown size={13} />
                        </button>
                      </td>
                      <td className="request-cell">
                        <div className="strong truncate">
                          <MethodBadge method={r.request.method} /> {r.name}
                        </div>
                        <div className="mono small muted truncate">{r.request.url}</div>
                        {rules.length > 0 && (
                          <div className="extract-sets mono">
                            <span className="muted">sets</span>
                            {rules.map((x) => {
                              const got = res?.extracted?.find((e) => e.variable === x.variable);
                              return (
                                <span
                                  key={x.variable}
                                  className={`extract-set${got ? (got.captured ? " ok" : " missing") : ""}`}
                                  title={
                                    got
                                      ? got.captured
                                        ? "Captured in the last run"
                                        : (got.error ?? "Not found in the last response")
                                      : `From ${needsPathLabel(x)}`
                                  }
                                >
                                  {x.variable}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td>
                        {res ? (
                          <span className="run-cell">
                            {res.error ? <span className="status status-bad">{res.error.code}</span> : <StatusBadge status={res.status} />}
                            <span className="mono small muted">{formatMs(res.latencyMs)}</span>
                            {res.reason && !res.error && <span className="small run-contract">{res.reason}</span>}
                            {res.unresolvedVariables && res.unresolvedVariables.length > 0 && (
                              <span className="small run-unset" title="No earlier request or the environment set these">
                                missing {res.unresolvedVariables.map((v) => `{{${v}}}`).join(", ")}
                              </span>
                            )}
                            {res.verdict === "fail" && res.historyId && (
                              <button
                                className="link-btn"
                                aria-expanded={explaining === r._id}
                                onClick={() => setExplaining((e) => (e === r._id ? null : r._id))}
                              >
                                {explaining === r._id ? "Hide" : "Explain"}
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                        {res && failureHint(res) && <p className="run-hint small muted">{failureHint(res)}</p>}
                      </td>
                      <td className="actions">
                        <button
                          className={`btn ghost small${editing === r._id ? " active" : ""}`}
                          title="Pass values from this response to later requests"
                          aria-expanded={editing === r._id}
                          onClick={() => setEditing((e) => (e === r._id ? null : r._id))}
                        >
                          <Braces size={13} />
                          Variables
                          {rules.length > 0 && <span className="btn-count">{rules.length}</span>}
                        </button>
                        <Link className="btn ghost small" to={`/workspace?collection=${c._id}&request=${r._id}`}>
                          <SquareArrowOutUpRight size={13} />
                          Open
                        </Link>
                        <button
                          className="icon-btn"
                          title="Monitor this request"
                          aria-label={`Monitor ${r.name}`}
                          onClick={() => navigate("/monitors/new", { state: { request: r.request, name: r.name } })}
                        >
                          <Activity size={14} />
                        </button>
                        <button className="icon-btn danger" title="Remove" aria-label={`Remove ${r.name}`} onClick={() => void removeRequest(r._id, r.name)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {explaining === r._id && res?.historyId && (
                      <tr className="extract-row-wrap">
                        <td />
                        <td colSpan={3}>
                          <AiSummaryCard target={{ targetType: "history", targetId: res.historyId }} auto title={`Why ${r.name} failed`} />
                        </td>
                      </tr>
                    )}
                    {editing === r._id && (
                      <tr className="extract-row-wrap">
                        <td />
                        <td colSpan={3}>
                          <ExtractEditor rules={r.extract ?? []} onSave={(rules) => saveExtract(r._id, rules)} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {c.requests.length > pageSize && (
            <Pagination page={Math.min(page, Math.ceil(c.requests.length / pageSize))} pageSize={pageSize} total={c.requests.length} onPage={setPage} />
          )}
        </div>
      )}
    </div>
  );
};
