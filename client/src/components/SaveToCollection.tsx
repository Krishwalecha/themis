import { useEffect, useRef, useState } from "react";
import { FolderPlus, Save } from "lucide-react";
import { api } from "../lib/api";
import { useEnvironments } from "../lib/environments";
import type { CollectionSummary, RequestSpec } from "../lib/types";
import { splitUrl } from "../lib/urlParams";
import { useToast } from "./Feedback";
import { Select } from "./ui";

export type RequestSource = { collectionId: string; requestId: string; collectionName: string };
export type CollectionTarget = { collectionId: string; collectionName: string };

const NEW = "__new";

type Props = {
  spec: RequestSpec;
  name: string;
  contractId?: string;
  source?: RequestSource;
  // a new request started from a collection saves straight into it
  target?: CollectionTarget;
  onSaved: (source: RequestSource, name: string) => void;
};

export const SaveToCollection = ({ spec, name, contractId, source, target: into, onSaved }: Props) => {
  const toast = useToast();
  const { activeId } = useEnvironments();
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [reqName, setReqName] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const payload = () => {
    const { base, hash } = splitUrl(spec.url);
    return { request: { ...spec, url: base + hash }, contractId: contractId ?? null };
  };
  // the method already shows as a badge next to the name, so the default is just the address
  const fallbackName = () => (name.trim() || splitUrl(spec.url).base.replace(/^https?:\/\//, "")).slice(0, 200);

  const show = () => {
    setReqName(fallbackName());
    setNewName("");
    setOpen(true);
    api.collections
      .list()
      .then(({ items }) => {
        setCollections(items);
        setTarget(source?.collectionId ?? into?.collectionId ?? items[0]?._id ?? NEW);
      })
      .catch(() => setTarget(NEW));
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const update = async () => {
    if (!source) return;
    setBusy(true);
    try {
      await api.collections.updateRequest(source.collectionId, source.requestId, { name: fallbackName(), ...payload() });
      toast("Saved", { body: `${fallbackName()} · ${source.collectionName}` });
      onSaved(source, fallbackName());
    } catch (e) {
      toast("Couldn't save", { tone: "error", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveNew = async (direct?: CollectionTarget) => {
    setBusy(true);
    try {
      let collectionId = direct?.collectionId ?? target;
      let collectionName = direct?.collectionName ?? collections.find((c) => c._id === target)?.name ?? "";
      if (!direct && target === NEW) {
        const created = await api.collections.create({ name: newName.trim(), environmentId: activeId });
        collectionId = created._id;
        collectionName = created.name;
      }
      const saved = await api.collections.addRequest(collectionId, { name: (!direct && reqName.trim()) || fallbackName(), ...payload() });
      toast(`Saved to ${collectionName}`, { body: saved.name });
      onSaved({ collectionId, requestId: saved._id, collectionName }, saved.name);
      setOpen(false);
    } catch (e) {
      toast("Couldn't save", { tone: "error", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const canSave = Boolean(spec.url.trim()) && (target !== NEW || Boolean(newName.trim()));

  return (
    <div className="save-to" ref={root}>
      {source || into ? (
        <>
          <button
            className="btn ghost small"
            disabled={busy || !spec.url.trim()}
            onClick={() => void (source ? update() : saveNew(into))}
            title={source ? `Update in ${source.collectionName}` : `Save to ${into!.collectionName}`}
          >
            <Save size={13} />
            Save
          </button>
          <button className="btn ghost small" disabled={!spec.url.trim()} onClick={() => (open ? setOpen(false) : show())}>
            Save as…
          </button>
        </>
      ) : (
        <button className="btn ghost small" disabled={!spec.url.trim()} onClick={() => (open ? setOpen(false) : show())} title="Save to a collection">
          <FolderPlus size={13} />
          Save to collection
        </button>
      )}
      {open && (
        <form
          className="popover save-pop"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void saveNew();
          }}
        >
          <h3>Save to collection</h3>
          <label className="field">
            <span>Collection</span>
            <Select
              block
              label="Collection"
              value={target}
              onChange={setTarget}
              options={[...collections.map((c) => ({ value: c._id, label: c.name, hint: `${c.requestCount}` })), { value: NEW, label: "New collection…" }]}
            />
          </label>
          {target === NEW && (
            <label className="field">
              <span>New collection name</span>
              <input className="input" autoFocus placeholder="Orders API" value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Request name</span>
            <input className="input" value={reqName} maxLength={200} onChange={(e) => setReqName(e.target.value)} />
          </label>
          <div className="popover-actions">
            <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary small" disabled={busy || !canSave}>
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
