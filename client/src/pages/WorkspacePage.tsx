import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCheck2, Plus, SquareTerminal } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { METHOD_OPTIONS } from "../components/Badges";
import { RequestEditor, withUrl } from "../components/RequestEditor";
import { ResponsePanel } from "../components/ResponsePanel";
import { SaveToCollection, type CollectionTarget, type RequestSource } from "../components/SaveToCollection";
import { Split } from "../components/Split";
import { CollectionsPane } from "../components/CollectionsPane";
import { VarInput } from "../components/VarInput";
import { useToast } from "../components/Feedback";
import { toCurl } from "../lib/curl";
import { withoutFileData } from "../lib/files";
import { preferredShell, SHELLS } from "../lib/shell";
import { WorkspaceMonitor } from "../components/WorkspaceMonitor";
import { Select, WaveLoader } from "../components/ui";
import { api } from "../lib/api";
import { referencedVariables, useEnvironments } from "../lib/environments";
import { storage } from "../lib/storage";
import { splitUrl, urlFromParams } from "../lib/urlParams";
import {
  emptyRequest,
  historyToResult,
  type ContractListItem,
  type ExecutionResult,
  type RunOutcome,
  type HistoryListItem,
  type HttpMethod,
  type RequestSpec,
} from "../lib/types";

const DRAFT_KEY = "themis.draft";
const CURL = /^\s*curl(\.exe)?\s/i;

interface Draft {
  spec: RequestSpec;
  name: string;
  // Contract to validate every response against
  contractId?: string;
  // set when the request was opened from (or saved to) a collection
  source?: RequestSource;
  // a new request started from a collection: Save adds it there
  target?: CollectionTarget;
}

const loadDraft = (): Draft => {
  const saved = storage.getJson<Draft>(DRAFT_KEY);
  return saved?.spec
    ? {
        spec: { ...emptyRequest(), ...saved.spec },
        name: saved.name ?? "",
        contractId: saved.contractId,
        source: saved.source,
        target: saved.target,
      }
    : { spec: emptyRequest(), name: "" };
};

export const WorkspacePage = () => {
  const { active } = useEnvironments();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [contractResult, setContractResult] = useState<RunOutcome["contract"]>(null);
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<HistoryListItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  // bumped after a save so the collections panel picks up the new request
  const [collectionsKey, setCollectionsKey] = useState(0);
  // "Run" in the collections panel: send as soon as that request has loaded
  const runOnLoad = useRef<string | null>(null);

  const { spec, name, contractId } = draft;

  useEffect(() => {
    api.contracts
      .list()
      .then(({ items }) => setContracts(items))
      .catch(() => undefined);
  }, []);
  const setSpec = (next: RequestSpec) => setDraft((d) => ({ ...d, spec: next }));

  // file contents stay in memory only: browser storage holds ~5 MB, and one upload could fill it
  useEffect(() => storage.setJson(DRAFT_KEY, { ...draft, spec: withoutFileData(draft.spec) }), [draft]);

  const refreshRecent = useCallback(async () => {
    try {
      const { items } = await api.history.list({ limit: 30 });
      setRecent(items);
    } catch {
      /* sidebar is best-effort */
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  const openHistory = useCallback(async (id: string) => {
    setError(null);
    try {
      const entry = await api.history.get(id);
      const request = { ...emptyRequest(), ...entry.request };
      // Stored URLs carry no query string; rebuild it from the params table for the URL bar.
      setDraft((d) => ({
        ...d,
        spec: { ...request, url: urlFromParams(request.url, request.params) },
        name: entry.name ?? "",
        source: undefined,
        target: undefined,
      }));
      setContractResult(null);
      setResult(historyToResult(entry));
      setUnresolved(entry.unresolvedVariables ?? []);
      setSelectedHistoryId(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const openSaved = useCallback(async (collectionId: string, requestId: string) => {
    setError(null);
    try {
      const c = await api.collections.get(collectionId);
      const saved = c.requests.find((r) => r._id === requestId);
      if (!saved) throw new Error("That request is no longer in the collection");
      const request = { ...emptyRequest(), ...saved.request };
      setDraft({
        spec: { ...request, url: urlFromParams(request.url, request.params) },
        name: saved.name,
        contractId: saved.contractId ?? undefined,
        source: { collectionId, requestId, collectionName: c.name },
      });
      setResult(null);
      setContractResult(null);
      setUnresolved([]);
      setSelectedHistoryId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // deep links: ?load=<historyId>, ?collection=<id>&request=<id>, ?newIn=<collectionId>
  useEffect(() => {
    const load = searchParams.get("load");
    const collection = searchParams.get("collection");
    const request = searchParams.get("request");
    const target = searchParams.get("newIn");
    if (!load && !(collection && request) && !target) return;
    if (load) void openHistory(load);
    else if (collection && request) void openSaved(collection, request);
    else if (target)
      void api.collections
        .get(target)
        .then((c) => newRequest({ collectionId: c._id, collectionName: c.name }))
        .catch((e: Error) => setError(e.message));
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, openHistory, openSaved]);

  const send = useCallback(async () => {
    if (!spec.url.trim() || sending) {
      urlRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    try {
      // The params table mirrors the URL's query string, so send it once (via params) to avoid duplicates.
      const { base, hash } = splitUrl(spec.url);
      const outcome = await api.execute({
        request: { ...spec, url: base + hash },
        environmentId: active?._id,
        name: name.trim() || undefined,
        contractId: contracts.some((c) => c._id === contractId) ? contractId : undefined,
      });
      setResult(outcome.result);
      setContractResult(outcome.contract ?? null);
      setUnresolved(outcome.unresolvedVariables);
      setSelectedHistoryId(outcome.historyId);
      void refreshRecent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }, [spec, name, contractId, contracts, active, sending, refreshRecent]);

  const createContract = async () => {
    if (!selectedHistoryId) return;
    try {
      const { document } = await api.contracts.infer({
        historyId: selectedHistoryId,
        title: name.trim() || undefined,
      });
      navigate("/contracts/new", {
        state: {
          document,
          name: name.trim() || `${spec.method} ${splitUrl(spec.url).base}`,
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void send();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  // Renaming a request that came from history also renames that history entry
  // the title names the saved request too; only its name changes, other unsaved edits stay unsaved
  const renameSaved = async () => {
    const source = draft.source;
    const next = name.trim();
    if (!source || !next) return;
    try {
      const c = await api.collections.get(source.collectionId);
      const saved = c.requests.find((r) => r._id === source.requestId);
      if (!saved || saved.name === next) return;
      await api.collections.updateRequest(c._id, saved._id, { name: next, request: saved.request, contractId: saved.contractId ?? null });
      setCollectionsKey((k) => k + 1);
    } catch (e) {
      toast("Couldn't rename", { tone: "error", body: (e as Error).message });
    }
  };

  const renameLoaded = async () => {
    void renameSaved();
    if (!selectedHistoryId) return;
    const current = recent.find((r) => r._id === selectedHistoryId);
    if (!current || (current.name ?? "") === name.trim()) return;
    try {
      await api.history.rename(selectedHistoryId, name.trim());
      void refreshRecent();
    } catch {
      /* non-critical */
    }
  };

  // pasting a curl command into the URL bar fills in the whole request
  const importCurl = async (command: string) => {
    setSpec(withUrl(spec, command));
    try {
      const r = await api.import(command);
      if (r.kind !== "curl") return;
      setDraft((d) => ({
        spec: { ...emptyRequest(), ...r.request },
        name: "",
        contractId: d.contractId,
      }));
      setResult(null);
      setContractResult(null);
      setError(r.warnings.length ? `Imported from curl. ${r.warnings.join(" ")}` : null);
    } catch (e) {
      setError(`Couldn't read that curl command: ${(e as Error).message}`);
    }
  };

  useEffect(() => {
    if (runOnLoad.current && runOnLoad.current === draft.source?.requestId) {
      runOnLoad.current = null;
      void send();
    }
  }, [draft.source?.requestId, send]);

  const toast = useToast();
  // the current request as a curl command for the user's shell; secrets stay as {{variables}}
  const copyCurl = async () => {
    const shell = preferredShell();
    try {
      await navigator.clipboard.writeText(toCurl(spec, active?.variables ?? [], shell));
      toast("Copied as cURL", {
        body: `${SHELLS.find((s) => s.id === shell)?.label} format · secrets kept as {{variables}}`,
      });
    } catch {
      toast("Couldn't copy", {
        tone: "error",
        body: "Your browser blocked clipboard access.",
      });
    }
  };

  const newRequest = (target?: CollectionTarget) => {
    setDraft((d) => ({
      spec: emptyRequest(),
      name: "",
      contractId: d.contractId,
      target,
    }));
    setResult(null);
    setContractResult(null);
    setUnresolved([]);
    setError(null);
    setSelectedHistoryId(null);
    urlRef.current?.focus();
  };

  // Warn before sending about variables the active environment doesn't define.
  const missingVariables = useMemo(() => {
    const texts = [spec.url, ...spec.headers.flatMap((h) => (h.enabled ? [h.key, h.value] : []))];
    if (spec.body.mode === "json" || spec.body.mode === "text") texts.push(spec.body.content);
    if (spec.auth.type === "bearer") texts.push(spec.auth.token);
    if (spec.auth.type === "basic") texts.push(spec.auth.username, spec.auth.password);
    if (spec.auth.type === "apiKey") texts.push(spec.auth.key, spec.auth.value);
    const defined = new Set(active?.variables.filter((v) => v.enabled).map((v) => v.key) ?? []);
    return referencedVariables(...texts).filter((v) => !defined.has(v));
  }, [spec, active]);

  return (
    <div className="workspace">
      <CollectionsPane
        activeRequestId={draft.source?.requestId}
        refreshKey={collectionsKey}
        onOpen={(c, r) => void openSaved(c, r)}
        onRun={(c, r) => {
          runOnLoad.current = r;
          void openSaved(c, r);
        }}
        onNew={newRequest}
        onLoaded={(items) =>
          setDraft((d) => {
            const c = (id?: string) => items.find((x) => x._id === id);
            const sourceGone = d.source && !c(d.source.collectionId)?.requests.some((r) => r._id === d.source!.requestId);
            const targetGone = d.target && !c(d.target.collectionId);
            // the request stays in the editor, it's just no longer saved anywhere
            return sourceGone || targetGone ? { ...d, source: sourceGone ? undefined : d.source, target: targetGone ? undefined : d.target } : d;
          })
        }
      />
      <section className="workspace-main">
        <div className="request-title">
          <input
            className="title-input"
            placeholder="Untitled request"
            value={name}
            maxLength={200}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onBlur={() => void renameLoaded()}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
          {(draft.source ?? draft.target) && (
            <span className="chip" title={draft.source ? "Opened from this collection" : "Saves to this collection"}>
              {(draft.source ?? draft.target)!.collectionName}
            </span>
          )}
          {active && (
            <span className="chip chip-accent" title="Variables resolve from this environment">
              env · {active.name}
            </span>
          )}
          <div className="request-title-actions">
            <button className="btn ghost small" onClick={() => newRequest()} title="New request">
              <Plus size={14} />
              New request
            </button>
          </div>
        </div>

        <form
          className="request-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Select mono label="HTTP method" value={spec.method} options={METHOD_OPTIONS} onChange={(m) => setSpec({ ...spec, method: m as HttpMethod })} />
          <VarInput
            inputRef={urlRef}
            wrapClassName="url-wrap"
            className="url-input mono"
            placeholder="https://api.example.com/users or {{baseUrl}}/users"
            value={spec.url}
            spellCheck={false}
            autoFocus
            onChange={(url) => (CURL.test(url) && url.length - spec.url.length > 8 ? void importCurl(url) : setSpec(withUrl(spec, url)))}
          />
          <button className="btn primary" type="submit" disabled={sending || !spec.url.trim()}>
            {sending ? <WaveLoader label="Sending" /> : "Send"}
            {!sending && <span className="kbd-hint">{/Mac/i.test(navigator.platform) ? "⌘↵" : "Ctrl ↵"}</span>}
          </button>
        </form>
        <div className="workspace-toolbar">
          <WorkspaceMonitor spec={spec} name={name} environmentId={active?._id ?? null} lastResult={result} />
          <div className="workspace-toolbar-actions">
            <div className="ws-contract" title="Every response is checked against this contract">
              <FileCheck2 size={13} />
              <Select
                size="small"
                label="Validate responses against contract"
                value={contracts.some((c) => c._id === contractId) ? (contractId as string) : ""}
                onChange={(v) => setDraft((d) => ({ ...d, contractId: v || undefined }))}
                options={[
                  { value: "", label: contracts.length ? "No contract" : "No contracts yet" },
                  ...contracts.map((c) => ({ value: c._id, label: c.name, hint: `v${c.version}` })),
                ]}
              />
            </div>
            <button
              type="button"
              className="btn ghost small"
              disabled={!spec.url.trim()}
              onClick={() => void copyCurl()}
              title="Copy this request as a curl command"
            >
              <SquareTerminal size={13} />
              Copy as cURL
            </button>
            <SaveToCollection
              spec={spec}
              name={name}
              contractId={contractId}
              source={draft.source}
              target={draft.target}
              onSaved={(source, savedName) => {
                setDraft((d) => ({ ...d, source, target: undefined, name: savedName }));
                setCollectionsKey((k) => k + 1);
              }}
            />
          </div>
        </div>
        {missingVariables.length > 0 && (
          <p className="hint warn">
            {active ? `"${active.name}" doesn't define` : "No environment selected for"} {missingVariables.map((v) => `{{${v}}}`).join(", ")}
          </p>
        )}

        <Split
          id="workspace"
          labels={["Request", "Response"]}
          first={<RequestEditor spec={spec} onChange={setSpec} />}
          second={
            <ResponsePanel
              result={result}
              loading={sending}
              error={error}
              unresolvedVariables={unresolved}
              contract={contractResult}
              onCreateContract={selectedHistoryId ? () => void createContract() : undefined}
              historyId={selectedHistoryId}
            />
          }
        />
      </section>
    </div>
  );
};
