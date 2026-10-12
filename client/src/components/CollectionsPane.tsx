import { useEffect, useState } from "react";
import { ChevronRight, FileDown, FolderOpen, FolderPlus, PanelLeftClose, PanelLeftOpen, Play, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { useEnvironments } from "../lib/environments";
import type { CollectionSummary } from "../lib/types";
import type { CollectionTarget } from "./SaveToCollection";
import { MethodBadge } from "./Badges";
import { useConfirm, useToast } from "./Feedback";
import { DotLoader } from "./ui";

const OPEN_KEY = "themis.ws.collections";
const EXPANDED_KEY = "themis.ws.expanded";

// the workspace's left panel: every collection and its requests, one click to open one
export const CollectionsPane = ({
  activeRequestId,
  refreshKey,
  onOpen,
  onRun,
  onNew,
  onLoaded,
}: {
  activeRequestId?: string;
  refreshKey: number;
  onOpen: (collectionId: string, requestId: string) => void;
  onRun: (collectionId: string, requestId: string) => void;
  // starts a blank request that saves into this collection
  onNew: (target: CollectionTarget) => void;
  // every fresh list, so the editor can drop links to anything deleted
  onLoaded: (items: CollectionSummary[]) => void;
}) => {
  const { activeId } = useEnvironments();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const confirm = useConfirm();
  const toast = useToast();
  // last "Run all" verdict per request, shown as a dot
  const [verdicts, setVerdicts] = useState<Record<string, "pass" | "fail">>({});
  const [running, setRunning] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(() => storage.get(OPEN_KEY) !== "closed");
  const [items, setItems] = useState<CollectionSummary[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(storage.getJson<string[]>(EXPANDED_KEY) ?? []));

  useEffect(() => storage.set(OPEN_KEY, open ? "open" : "closed"), [open]);
  useEffect(() => storage.setJson(EXPANDED_KEY, [...expanded]), [expanded]);

  useEffect(() => {
    let alive = true;
    api.collections
      .list()
      .then(({ items }) => {
        if (!alive) return;
        setItems(items);
        onLoaded(items);
        // first visit: open the first collection so there's something to click
        setExpanded((s) => (s.size || !items[0] ? s : new Set([items[0]._id])));
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [refreshKey, reload]);

  const runAll = async (c: CollectionSummary) => {
    setRunning(c._id);
    setExpanded((s) => new Set(s).add(c._id));
    try {
      const r = await api.collections.run(c._id);
      setVerdicts((v) => ({ ...v, ...Object.fromEntries(r.results.map((x) => [x.requestId, x.verdict])) }));
      toast(r.failed ? `${r.failed} of ${r.results.length} failed` : `All ${r.results.length} passed`, { tone: r.failed ? "error" : "success", body: c.name });
    } catch (e) {
      toast("Run failed", { tone: "error", body: (e as Error).message });
    } finally {
      setRunning(null);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return setCreating(false);
    try {
      const c = await api.collections.create({ name, environmentId: activeId });
      setCreating(false);
      setNewName("");
      setExpanded((s) => new Set(s).add(c._id));
      setReload((n) => n + 1);
    } catch (e) {
      toast("Couldn't create the collection", { tone: "error", body: (e as Error).message });
    }
  };

  const removeCollection = async (c: CollectionSummary) => {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      body: `Its ${c.requestCount} saved request${c.requestCount === 1 ? "" : "s"} go with it. Your history stays.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.collections.remove(c._id);
      setReload((n) => n + 1);
      toast("Collection deleted", { body: c.name });
    } catch (e) {
      toast("Couldn't delete", { tone: "error", body: (e as Error).message });
    }
  };

  const remove = async (c: CollectionSummary, r: CollectionSummary["requests"][number]) => {
    const ok = await confirm({
      title: `Remove "${r.name}"?`,
      body: `It's removed from ${c.name}. Past runs stay in history.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.collections.removeRequest(c._id, r._id);
      setReload((n) => n + 1);
    } catch (e) {
      toast("Couldn't remove", { tone: "error", body: (e as Error).message });
    }
  };

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <aside className={`ws-collections${open ? "" : " closed"}`} aria-label="Collections">
      <button className="ws-collections-rail" onClick={() => setOpen(true)} title="Show collections" aria-label="Show collections" tabIndex={open ? -1 : 0}>
        <PanelLeftOpen size={15} strokeWidth={1.6} />
        <span>Collections</span>
      </button>
      <div className="ws-collections-body" inert={!open}>
        <div className="ws-collections-head">
          <span className="eyebrow">Collections</span>
          <button className="icon-btn" title="New collection" aria-label="New collection" onClick={() => setCreating(true)}>
            <FolderPlus size={14} strokeWidth={1.6} />
          </button>
          <button className="icon-btn" onClick={() => setOpen(false)} title="Hide collections" aria-label="Hide collections">
            <PanelLeftClose size={14} strokeWidth={1.6} />
          </button>
        </div>
        {creating && (
          <form
            className="ws-tree-new"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              className="input"
              autoFocus
              placeholder="Collection name"
              value={newName}
              maxLength={100}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setCreating(false), setNewName(""))}
              onBlur={() => !newName.trim() && setCreating(false)}
            />
          </form>
        )}
        {items === null ? null : items.length === 0 && !creating ? (
          <div className="ws-collections-empty">
            <span className="ws-empty-icon" aria-hidden>
              <FolderOpen size={16} strokeWidth={1.6} />
            </span>
            <p className="strong">No collections yet</p>
            <p className="muted">Group requests to run them together, or bring in a Postman collection or an OpenAPI file.</p>
            <button className="btn primary small" onClick={() => setCreating(true)}>
              <Plus size={13} />
              New collection
            </button>
            <Link to="/collections?import=1" className="btn ghost small">
              <FileDown size={13} />
              Import
            </Link>
          </div>
        ) : (
          <ul className="ws-tree">
            {items.map((c) => {
              const isOpen = expanded.has(c._id);
              return (
                <li key={c._id}>
                  <div className="ws-tree-row">
                    <button className={`ws-tree-collection${isOpen ? " open" : ""}`} onClick={() => toggle(c._id)} aria-expanded={isOpen}>
                      <ChevronRight size={13} className="ws-tree-chevron" />
                      <span className="truncate">{c.name}</span>
                      <span className="ws-tree-count">{running === c._id ? <DotLoader /> : c.requestCount}</span>
                    </button>
                    <span className="ws-tree-actions">
                      <button
                        className="icon-btn"
                        title="New request"
                        aria-label={`New request in ${c.name}`}
                        onClick={() => {
                          setExpanded((s) => new Set(s).add(c._id));
                          onNew({ collectionId: c._id, collectionName: c.name });
                        }}
                      >
                        <Plus size={12} />
                      </button>
                      {c.requestCount > 0 && (
                        <button
                          className="icon-btn"
                          title="Run all"
                          aria-label={`Run all in ${c.name}`}
                          disabled={running !== null}
                          onClick={() => void runAll(c)}
                        >
                          <Play size={12} />
                        </button>
                      )}
                      <button className="icon-btn danger" title="Delete collection" aria-label={`Delete ${c.name}`} onClick={() => void removeCollection(c)}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                  {isOpen && (
                    <ul>
                      {c.requests.length === 0 && <li className="ws-tree-none">No requests yet</li>}
                      {c.requests.map((r) => (
                        <li key={r._id} className="ws-tree-row">
                          <button className={`ws-tree-request${r._id === activeRequestId ? " active" : ""}`} onClick={() => onOpen(c._id, r._id)} title={r.url}>
                            <MethodBadge method={r.method} />
                            <span className="truncate">{r.name}</span>
                            {verdicts[r._id] && (
                              <i className={`ws-tree-verdict ${verdicts[r._id]}`} aria-label={verdicts[r._id] === "pass" ? "Passed" : "Failed"} />
                            )}
                          </button>
                          <span className="ws-tree-actions">
                            <button className="icon-btn" title="Run" aria-label={`Run ${r.name}`} onClick={() => onRun(c._id, r._id)}>
                              <Play size={12} />
                            </button>
                            <button
                              className="icon-btn danger"
                              title="Remove from collection"
                              aria-label={`Remove ${r.name}`}
                              onClick={() => void remove(c, r)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};
