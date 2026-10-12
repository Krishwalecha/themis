import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BulkBar, SelectBox, useSelection } from "../components/Bulk";
import { FileDown, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useConfirm, useToast } from "../components/Feedback";
import { ImportPanel, useOpenImport } from "../components/ImportPanel";
import { EmptyState, Eyebrow, Pagination, Select } from "../components/ui";
import { api } from "../lib/api";
import { useFitPageSize } from "../lib/pageSize";
import { environmentOptions, useEnvironments } from "../lib/environments";
import { timeAgo } from "../lib/format";
import type { CollectionSummary } from "../lib/types";

export const CollectionsPage = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { environments, activeId, setActiveId } = useEnvironments();
  const openImport = useOpenImport(setActiveId);
  // ?import=1 (from the workspace's collections panel) opens the import box straight away
  const [importing, setImporting] = useState(() => new URLSearchParams(window.location.search).get("import") === "1");
  const [items, setItems] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [envId, setEnvId] = useState("");
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement>(null);
  // as many rows as fit on screen
  const pageSize = useFitPageSize(tableRef);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const visible = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  const sel = useSelection(useMemo(() => visible.map((c) => c._id), [visible]));

  const removeSelected = async () => {
    const ok = await confirm({
      title: `Delete ${sel.count} collection${sel.count === 1 ? "" : "s"}?`,
      body: "Their saved requests go with them. Your history stays.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const ids = [...sel.selected];
      const { deleted } = await api.collections.bulkDelete(ids);
      setItems((list) => list.filter((c) => !ids.includes(c._id)));
      sel.clear();
      toast(`Deleted ${deleted} collection${deleted === 1 ? "" : "s"}`);
    } catch (e) {
      toast("Couldn't delete", { tone: "error", body: (e as Error).message });
    }
  };

  useEffect(() => {
    api.collections
      .list()
      .then(({ items }) => setItems(items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const openForm = () => {
    setName("");
    setEnvId(activeId ?? "");
    setCreating(true);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const c = await api.collections.create({ name: name.trim(), environmentId: envId || null });
      navigate(`/collections/${c._id}`);
    } catch (err) {
      toast("Couldn't create the collection", { tone: "error", body: (err as Error).message });
    }
  };

  const remove = async (c: CollectionSummary) => {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      body: `Its ${c.requestCount} saved request${c.requestCount === 1 ? "" : "s"} go with it. Your history stays.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.collections.remove(c._id);
      setItems((list) => list.filter((x) => x._id !== c._id));
      toast("Collection deleted", { body: c.name });
    } catch (err) {
      toast("Couldn't delete", { tone: "error", body: (err as Error).message });
    }
  };

  const envName = (id: string | null) => (id ? (environments.find((e) => e._id === id)?.name ?? "deleted env") : "—");

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>API testing</Eyebrow>
          <h1>Collections</h1>
          <p className="muted">Group requests, give them an environment, and run them all at once, here, from the CLI or in CI.</p>
        </div>
        {items.length > 0 && (
          <div className="row-actions">
            <button className="btn ghost" onClick={() => setImporting((v) => !v)} aria-expanded={importing}>
              <FileDown size={15} />
              Import
            </button>
            <button className="btn primary" onClick={openForm}>
              <Plus size={15} />
              New collection
            </button>
          </div>
        )}
      </header>

      {creating && (
        <form className="collection-new" onSubmit={(e) => void create(e)}>
          <input
            className="input"
            autoFocus
            placeholder="Collection name, e.g. Orders API"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <Select label="Environment" value={envId} onChange={setEnvId} options={environmentOptions(environments)} />
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            Create
          </button>
          <button className="btn ghost" type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      {importing && (
        <section className="panel import-inline">
          <span className="eyebrow">Import</span>
          <ImportPanel
            autoFocus
            onImported={openImport}
            actions={
              <button type="button" className="btn ghost" onClick={() => setImporting(false)}>
                Cancel
              </button>
            }
          />
        </section>
      )}

      {error && <div className="banner error">{error}</div>}

      {(items.length > 0 || (!creating && !importing)) && (
        <div className="table-wrap" ref={tableRef}>
          <table className="table">
            <thead>
              <tr>
                <th className="check-cell">
                  <SelectBox label="Select all on this page" checked={sel.all} indeterminate={sel.some} onChange={sel.toggleAll} />
                </th>
                <th>Collection</th>
                <th className="num">Requests</th>
                <th>Environment</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c._id} className={`clickable${sel.has(c._id) ? " selected" : ""}`} onClick={() => navigate(`/collections/${c._id}`)}>
                  <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                    <SelectBox label={`Select ${c.name}`} checked={sel.has(c._id)} onChange={() => sel.toggle(c._id)} />
                  </td>
                  <td className="request-cell">
                    <Link to={`/collections/${c._id}`} className="strong" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    {c.description && <div className="small muted truncate">{c.description}</div>}
                  </td>
                  <td className="num">{c.requestCount}</td>
                  <td className="muted">{envName(c.environmentId)}</td>
                  <td className="muted">{timeAgo(c.updatedAt)}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn danger" title="Delete" aria-label={`Delete ${c.name}`} onClick={() => void remove(c)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && items.length === 0 && !creating && !importing && (
            <EmptyState
              title="Create your first collection"
              action={
                <div className="row-actions">
                  <button className="btn ghost" onClick={() => setImporting(true)}>
                    <FileDown size={15} />
                    Import
                  </button>
                  <button className="btn primary" onClick={openForm}>
                    <Plus size={15} />
                    New collection
                  </button>
                </div>
              }
            >
              Group requests and run them all at once, or import a Postman collection or an OpenAPI file.
            </EmptyState>
          )}
        </div>
      )}
      <BulkBar count={sel.count} noun="collection" onClear={sel.clear}>
        <button className="btn destructive small" onClick={() => void removeSelected()}>
          Delete
        </button>
      </BulkBar>
      <Pagination page={page} pageSize={pageSize} total={items.length} onPage={setPage} />
    </div>
  );
};
