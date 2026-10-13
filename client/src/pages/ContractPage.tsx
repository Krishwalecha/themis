import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MethodBadge } from "../components/Badges";
import { useConfirm, useToast } from "../components/Feedback";
import { ChangeList, ContractResult, ContractStatus } from "../components/ContractBits";
import { StatusPill } from "../components/MonitorBits";
import { Eyebrow, Pagination, Select } from "../components/ui";
import { api } from "../lib/api";
import { PANEL_PAGE_SIZE } from "../lib/pageSize";
import { timeAgo } from "../lib/format";
import type { Contract, ContractChange, ContractValidation, ContractValidationLogItem, ContractVersionInfo, HistoryListItem } from "../lib/types";

const SAMPLE = `openapi: 3.0.3
info:
  title: My API
  version: "1.0"
servers:
  - url: https://api.example.com
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [status]
                properties:
                  status: { type: string, enum: [ok] }
`;

export const ContractPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const toast = useToast();
  const prefill = location.state as { document?: object; name?: string } | null;

  const [contract, setContract] = useState<Contract | null>(null);
  const [name, setName] = useState(prefill?.name ?? "");
  const [description, setDescription] = useState("");
  const [text, setText] = useState(prefill?.document ? JSON.stringify(prefill.document, null, 2) : id ? "" : SAMPLE);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ changes: ContractChange[]; breakingCount: number } | null>(null);
  const [lastSave, setLastSave] = useState<{
    changes: ContractChange[];
    breakingCount: number;
    versioned: boolean;
    verdict: "match" | "mismatch" | null;
  } | null>(null);
  const [versions, setVersions] = useState<ContractVersionInfo[]>([]);
  const [validations, setValidations] = useState<ContractValidationLogItem[]>([]);
  const [vPage, setVPage] = useState(1);
  const [versionPage, setVersionPage] = useState(1);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [vTotal, setVTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, v, logs] = await Promise.all([api.contracts.get(id), api.contracts.versions(id), api.contracts.validations(id, 1, PANEL_PAGE_SIZE)]);
      setContract(c);
      setName(c.name);
      setDescription(c.description ?? "");
      setText(JSON.stringify(c.document, null, 2));
      setVersions(v.items);
      setVersionPage(1);
      setValidations(logs.items);
      setVTotal(logs.total);
      setVPage(1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const showValidations = (page: number) => {
    if (!id) return;
    setVPage(page);
    api.contracts
      .validations(id, page, PANEL_PAGE_SIZE)
      .then((r) => {
        setValidations(r.items);
        setVTotal(r.total);
      })
      .catch((e: Error) => setError(e.message));
  };

  const dirty = contract ? text !== JSON.stringify(contract.document, null, 2) : true;

  const runPreview = async () => {
    if (!contract) return;
    setError(null);
    try {
      setPreview(await api.contracts.preview(contract.document, text, contract.kind));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!id) {
        const created = await api.contracts.create({ name, description: description || undefined, document: text });
        toast("Contract created", { body: created.name });
        navigate(`/contracts/${created._id}`, { replace: true });
        return;
      }
      const res = await api.contracts.update(id, { name, description, document: dirty ? text : undefined, note: note || undefined });
      const v = res.contract.lastValidation;
      const checked = v && v.contractVersion === res.contract.version;
      setLastSave({ ...res, verdict: !res.versioned || !checked ? null : v.valid ? "match" : "mismatch" });
      toast(res.versioned ? "New contract version saved" : "Contract saved", {
        tone: res.breakingCount > 0 ? "info" : "success",
        body: res.breakingCount > 0 ? `${res.breakingCount} breaking change${res.breakingCount === 1 ? "" : "s"}` : undefined,
      });
      setPreview(null);
      setNote("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    const ok = await confirm({
      title: "Delete this contract?",
      body: (
        <>
          <strong>{name}</strong> and its version history will be removed. Monitors using it will stop validating.
        </>
      ),
      confirmLabel: "Delete contract",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.contracts.remove(id);
      toast("Contract deleted", { body: name });
      navigate("/contracts");
    } catch (e) {
      toast("Couldn't delete contract", { tone: "error", body: (e as Error).message });
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>Contract validation</Eyebrow>
          <h1>{id ? name || "Contract" : "New contract"}</h1>
          {contract && (
            <p className="muted small">
              {contract.kind === "openapi" ? "OpenAPI" : "JSON Schema"} · v{contract.version} · updated {timeAgo(contract.updatedAt)}
            </p>
          )}
          {contract && (
            <div className="contract-status">
              <ContractStatus verdict={contract.lastValidation} version={contract.version} />
            </div>
          )}
        </div>
        {id && (
          <button className="btn ghost danger small" onClick={() => void remove()}>
            Delete
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}
      {lastSave && (
        <div className={`banner ${lastSave.verdict === "mismatch" ? "error" : "info"}`}>
          {lastSave.versioned
            ? `Saved as v${contract?.version}: ${lastSave.changes.length} change${lastSave.changes.length === 1 ? "" : "s"}${lastSave.breakingCount ? `, ${lastSave.breakingCount} of them breaking for clients built on v${(contract?.version ?? 2) - 1}` : ""}. ${
                lastSave.verdict === "match"
                  ? "Your latest response matches it."
                  : lastSave.verdict === "mismatch"
                    ? "Your latest response doesn't match it yet."
                    : "Send a request to check the API against it."
              }`
            : "Saved. The document didn't change, so no new version was created."}
        </div>
      )}

      <div className="contract-layout">
        <section className="panel form-section">
          <div className="form-grid">
            <label className="field">
              <span>Name</span>
              <input className="input" value={name} placeholder="Users API" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Description</span>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Document: OpenAPI 3.x / Swagger 2 or JSON Schema, as JSON or YAML</span>
            <textarea className="input mono code-input contract-doc" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {id && dirty && (
            <label className="field">
              <span>Version note (optional)</span>
              <input className="input" value={note} placeholder="Removed legacy fields" onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {preview && (
            <div className="stack">
              <h2>
                Changes if saved · <span className={preview.breakingCount ? "tone-bad" : "tone-good"}>{preview.breakingCount} breaking</span>
              </h2>
              <ChangeList changes={preview.changes} />
            </div>
          )}
          <div className="editor-footer">
            {id && dirty && (
              <button className="btn ghost" onClick={() => void runPreview()}>
                Preview changes
              </button>
            )}
            <button className="btn primary" disabled={saving || !name.trim() || !text.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : id ? (dirty ? "Save new version" : "Save") : "Create contract"}
            </button>
          </div>
        </section>

        {id && contract && (
          <div className="stack">
            <ValidatePanel contractId={id} onValidated={() => void load()} />

            {contract.kind === "openapi" && (
              <section className="panel card">
                <h2>Operations ({contract.operations.length})</h2>
                <ul className="op-list">
                  {contract.operations.map((op) => (
                    <li key={`${op.method} ${op.path}`}>
                      <MethodBadge method={op.method} />
                      <span className="mono small">{op.path}</span>
                      <span className="muted small">{op.responses.join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="panel card">
              <h2>Monitors using this contract</h2>
              {contract.linkedMonitors?.length ? (
                <ul className="op-list">
                  {contract.linkedMonitors.map((m) => (
                    <li key={m._id}>
                      <StatusPill status={m.state.status} />
                      <Link to={`/monitors/${m._id}`}>{m.name}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">None yet. Pick this contract in a monitor's settings to validate every check.</p>
              )}
            </section>
          </div>
        )}
      </div>

      {id && (
        <div className="two-col">
          <section className="panel card contract-log">
            <h2>Versions</h2>
            <p className="muted small contract-log-hint">
              Each version is checked against real responses: requests you send with this contract, monitors that use it, and responses you validate above.
            </p>
            <ul className="version-list">
              {versions.slice((versionPage - 1) * PANEL_PAGE_SIZE, versionPage * PANEL_PAGE_SIZE).map((v) => (
                <li key={v._id}>
                  <button
                    type="button"
                    className={`version-row${openVersion === v.version ? " open" : ""}`}
                    aria-expanded={openVersion === v.version}
                    disabled={!v.changes.length}
                    onClick={() => setOpenVersion((o) => (o === v.version ? null : v.version))}
                  >
                    <span className="version-num">v{v.version}</span>
                    {v.verdict ? (
                      <span
                        className={`pill ${v.verdict.valid ? "pill-up" : "pill-down"}`}
                        title={`Newest check against v${v.version}, ${timeAgo(v.verdict.at)}`}
                      >
                        <span className="pill-dot" aria-hidden />
                        {v.verdict.valid ? "Passes" : `${v.verdict.errorCount} error${v.verdict.errorCount === 1 ? "" : "s"}`}
                      </span>
                    ) : (
                      <span className="pill pill-pending" title="No response has been checked against this version">
                        <span className="pill-dot" aria-hidden />
                        Not checked
                      </span>
                    )}
                    {v.version === contract?.version && <span className="version-current">current</span>}
                    <span className="version-meta muted small">
                      {v.version === 1 ? "first version" : `${v.changes.length} change${v.changes.length === 1 ? "" : "s"} from v${v.version - 1}`}
                      {" · "}
                      <span title={new Date(v.createdAt).toLocaleString()}>{timeAgo(v.createdAt)}</span>
                    </span>
                    {v.changes.length > 0 && <ChevronRight size={13} className="version-chevron" />}
                  </button>
                  {openVersion === v.version && (
                    <div className="version-changes">
                      {v.note && v.note !== "Initial version" && <p className="small muted">{v.note}</p>}
                      <ChangeList changes={v.changes} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {versions.length > PANEL_PAGE_SIZE && <Pagination page={versionPage} pageSize={PANEL_PAGE_SIZE} total={versions.length} onPage={setVersionPage} />}
          </section>
          <section className="panel card contract-log">
            <h2>Recent validations</h2>
            {validations.length === 0 ? (
              <p className="muted small">No validations yet.</p>
            ) : (
              <table className="table">
                <tbody>
                  {validations.map((v) => (
                    <tr key={v._id}>
                      <td>
                        <span className={`pill ${v.skipped ? "pill-pending" : v.valid ? "pill-up" : "pill-down"}`}>
                          <span className="pill-dot" aria-hidden />
                          {v.skipped ? "Skipped" : v.valid ? "Pass" : `${v.errorCount} error${v.errorCount === 1 ? "" : "s"}`}
                        </span>
                      </td>
                      <td className="small validation-req">
                        <div className="mono truncate">
                          {v.method} {v.url}
                        </div>
                        {v.errors?.[0] && (
                          <div className="muted">
                            {v.errors[0].path || "(root)"} {v.errors[0].message}
                            {v.errorCount > 1 && <> · +{v.errorCount - 1} more</>}
                          </div>
                        )}
                        {v.skipped && <div className="muted">{v.skipped}</div>}
                      </td>
                      <td className="muted small nowrap">{SOURCE_LABEL[v.source] ?? v.source}</td>
                      <td className="muted small nowrap" title={new Date(v.at).toLocaleString()}>
                        {timeAgo(v.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {vTotal > PANEL_PAGE_SIZE && <Pagination page={vPage} pageSize={PANEL_PAGE_SIZE} total={vTotal} onPage={showValidations} />}
          </section>
        </div>
      )}
    </div>
  );
};

// where a validation came from, in words
const SOURCE_LABEL: Record<string, string> = { workspace: "Workspace", history: "From history", monitor: "Monitor", manual: "Pasted" };

// Validate a recent request from history against this contract
const ValidatePanel = ({ contractId, onValidated }: { contractId: string; onValidated: () => void }) => {
  const [history, setHistory] = useState<HistoryListItem[]>([]);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<ContractValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.history
      .list({ limit: 30 })
      .then(({ items }) => {
        setHistory(items);
        if (items[0]) setSelected(items[0]._id);
      })
      .catch(() => undefined);
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.contracts.validate(contractId, { historyId: selected }));
      onValidated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel card">
      <h2>Validate a response</h2>
      {history.length === 0 ? (
        <p className="muted small">Send a request from the workspace first, then validate it here.</p>
      ) : (
        <div className="validate-row">
          <Select
            block
            mono
            label="Response to validate"
            value={selected}
            onChange={setSelected}
            options={history.map((h) => ({ value: h._id, label: `${h.method} ${h.resolvedUrl}`, hint: String(h.status || h.errorCode) }))}
          />
          <button className="btn ghost" disabled={busy || !selected} onClick={() => void run()}>
            {busy ? "Checking…" : "Validate"}
          </button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {result && <ContractResult result={result} />}
    </section>
  );
};
