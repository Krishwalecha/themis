import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type ImportResult } from "../lib/api";
import { storage } from "../lib/storage";
import { useToast } from "./Feedback";
import { WaveLoader } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;

// what to do once something is imported: a curl request opens in the workspace, a collection opens itself
export const useOpenImport = (setActive?: (id: string) => void) => {
  const navigate = useNavigate();
  const toast = useToast();
  return (r: ImportResult) => {
    const note = r.warnings.length ? ` · ${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"}` : "";
    if (r.kind === "curl") {
      storage.setJson("themis.draft", { spec: r.request, name: "" });
      toast("Request imported", { body: `${r.request.method} ${r.request.url}${note}` });
      navigate("/workspace");
      return;
    }
    if (r.environment) {
      if (setActive) setActive(r.environment._id);
      else storage.set("themis.activeEnvironment", r.environment._id);
    }
    const parts = [`${r.collection.requestCount} request${r.collection.requestCount === 1 ? "" : "s"}`];
    if (r.environment) parts.push(`environment "${r.environment.name}"`);
    if (r.contract) parts.push("a contract");
    toast(`Imported ${r.collection.name}`, { body: parts.join(", ") + note });
    for (const w of r.warnings.slice(0, 3)) toast("Import note", { tone: "info", body: w });
    navigate(`/collections/${r.collection._id}`);
  };
};

export const ImportPanel = ({ onImported, actions, autoFocus }: { onImported: (r: ImportResult) => void; actions?: ReactNode; autoFocus?: boolean }) => {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) return setError("That file is over 5 MB.");
    setText(await file.text());
    setFileName(file.name);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onImported(await api.import(text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kind = /^\s*curl(\.exe)?\s/i.test(text) ? "curl command" : /getpostman\.com|_postman_id/.test(text) ? "Postman collection" : /^\s*["']?(openapi|swagger)["']?\s*:|"(openapi|swagger)"\s*:/m.test(text) ? "OpenAPI document" : null;

  return (
    <div className="import-panel">
      <div className={`import-drop${over ? " over" : ""}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <textarea
          className="input mono import-text"
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder={"curl https://api.example.com/v1/orders -H 'Authorization: Bearer …'\n\nor paste a Postman collection / OpenAPI document (JSON or YAML)"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
            setError(null);
          }}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void submit()}
        />
        <div className="import-meta">
          <button type="button" className="btn ghost small" onClick={() => fileInput.current?.click()}>
            <FileUp size={13} />
            Upload a file
          </button>
          <span className="muted small">{fileName ? fileName : kind ? `Looks like a ${kind}` : "or drop a .json / .yaml file here"}</span>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.yaml,.yml,.txt,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {error && <p className="import-error">{error}</p>}
      <div className="import-actions">
        {actions}
        <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
          {busy ? <WaveLoader label="Importing" /> : "Import"}
        </button>
      </div>
    </div>
  );
};
