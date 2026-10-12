import { useState } from "react";
import { Plus, X } from "lucide-react";
import { formatBytes, tryPrettyJson } from "../lib/format";
import type { FormPart, KeyValue, RequestAuth, RequestBody, RequestSpec } from "../lib/types";
import { MAX_FILE_BYTES } from "../lib/files";
import { FilePick } from "./FilePick";
import { NumberField } from "./Pickers";
import { paramsFromUrl, urlFromParams } from "../lib/urlParams";
import { KeyValueEditor } from "./KeyValueEditor";
import { Select } from "./ui";

type Tab = "params" | "headers" | "body" | "auth" | "settings";

const blankKv = (): KeyValue => ({ key: "", value: "", enabled: true });

interface Props {
  spec: RequestSpec;
  onChange: (spec: RequestSpec) => void;
  // extra fields for the Settings tab (the workspace adds its contract picker here)
}

export const RequestEditor = ({ spec, onChange }: Props) => {
  const [tab, setTab] = useState<Tab>("params");
  const set = (patch: Partial<RequestSpec>) => onChange({ ...spec, ...patch });

  const enabledCount = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key).length;
  const tabs: { id: Tab; label: string; badge?: string | number }[] = [
    { id: "params", label: "Params", badge: enabledCount(spec.params) || undefined },
    { id: "headers", label: "Headers", badge: enabledCount(spec.headers) || undefined },
    { id: "body", label: "Body", badge: spec.body.mode === "none" ? undefined : "•" },
    { id: "auth", label: "Auth", badge: spec.auth.type === "none" ? undefined : "•" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="panel request-editor">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge !== undefined && <span className="tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === "params" && (
          <KeyValueEditor
            suggestVars
            rows={spec.params}
            blank={blankKv}
            keyPlaceholder="Parameter"
            onChange={(params) => set({ params, url: urlFromParams(spec.url, params) })}
          />
        )}
        {tab === "headers" && (
          <KeyValueEditor suggestVars rows={spec.headers} blank={blankKv} keyPlaceholder="Header" onChange={(headers) => set({ headers })} />
        )}
        {tab === "body" && <BodyEditor body={spec.body} method={spec.method} onChange={(body) => set({ body })} />}
        {tab === "auth" && <AuthEditor auth={spec.auth} onChange={(auth) => set({ auth })} />}
        {tab === "settings" && (
          <div className="settings-stack">
            <div className="field">
              <span>Timeout (ms)</span>
              <NumberField
                label="Timeout (ms)"
                min={100}
                max={120000}
                step={1000}
                placeholder="30000"
                value={spec.timeoutMs}
                onChange={(timeoutMs) => set({ timeoutMs })}
              />
            </div>
            <label className="field checkbox-field">
              <input type="checkbox" checked={spec.followRedirects} onChange={(e) => set({ followRedirects: e.target.checked })} />
              <span>Follow redirects</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

// URL bar edits resync the params table
export const withUrl = (spec: RequestSpec, url: string): RequestSpec => {
  return { ...spec, url, params: paramsFromUrl(url, spec.params) };
};

const BodyEditor = ({ body, method, onChange }: { body: RequestBody; method: string; onChange: (b: RequestBody) => void }) => {
  const modes: { id: RequestBody["mode"]; label: string }[] = [
    { id: "none", label: "None" },
    { id: "json", label: "JSON" },
    { id: "text", label: "Text" },
    { id: "form-urlencoded", label: "Form URL-encoded" },
    { id: "multipart", label: "Multipart" },
    { id: "binary", label: "File" },
  ];

  const switchMode = (mode: RequestBody["mode"]) => {
    const text = "content" in body ? body.content : "";
    if (mode === "none") onChange({ mode });
    else if (mode === "form-urlencoded") onChange({ mode, form: "form" in body ? body.form : [] });
    else if (mode === "multipart")
      onChange({
        mode,
        parts: "form" in body ? body.form.map((f) => ({ ...f, kind: "text" as const })) : [{ key: "", enabled: true, kind: "text", value: "" }],
      });
    else if (mode === "binary") onChange({ mode, file: null });
    else onChange({ mode, content: text });
  };

  const jsonInvalid = body.mode === "json" && body.content.trim() !== "" && !isJsonLike(body.content);

  return (
    <div className="body-editor">
      <div className="segmented">
        {modes.map((m) => (
          <button key={m.id} className={body.mode === m.id ? "active" : ""} onClick={() => switchMode(m.id)}>
            {m.label}
          </button>
        ))}
        {body.mode === "json" && (
          <button
            className="link-btn"
            onClick={() => {
              const pretty = tryPrettyJson(body.content);
              if (pretty) onChange({ ...body, content: pretty });
            }}
          >
            Beautify
          </button>
        )}
      </div>
      {(method === "GET" || method === "HEAD") && body.mode !== "none" && <p className="hint warn">{method} requests are sent without a body.</p>}
      {body.mode === "none" && <p className="hint">This request has no body.</p>}
      {(body.mode === "json" || body.mode === "text") && (
        <>
          <textarea
            className="input mono code-input"
            spellCheck={false}
            placeholder={body.mode === "json" ? '{\n  "name": "{{username}}"\n}' : "Raw text"}
            value={body.content}
            onChange={(e) => onChange({ ...body, content: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: end, value } = el;
                onChange({ ...body, content: `${value.slice(0, s)}  ${value.slice(end)}` });
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
              }
            }}
          />
          {jsonInvalid && <p className="hint warn">Body isn't valid JSON. It will be sent as-is.</p>}
        </>
      )}
      {body.mode === "form-urlencoded" && (
        <KeyValueEditor suggestVars rows={body.form} blank={blankKv} onChange={(form) => onChange({ mode: body.mode, form })} />
      )}
      {body.mode === "multipart" && <MultipartEditor parts={body.parts} onChange={(parts) => onChange({ mode: "multipart", parts })} />}
      {body.mode === "binary" && (
        <>
          <p className="hint">The file is sent as the whole body, with its own Content-Type unless you set one in Headers.</p>
          <FilePick file={body.file} onChange={(file) => onChange({ mode: "binary", file })} />
        </>
      )}
    </div>
  );
};

// multipart/form-data: text fields and files, sent the way a browser form upload is
const MultipartEditor = ({ parts, onChange }: { parts: FormPart[]; onChange: (p: FormPart[]) => void }) => {
  const set = (i: number, patch: Partial<FormPart>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const total = parts.reduce((n, p) => n + (p.kind === "file" && p.file ? p.file.size : 0), 0);
  return (
    <div className="multipart">
      {parts.map((p, i) => (
        <div key={i} className={`multipart-row${p.enabled ? "" : " off"}`}>
          <input type="checkbox" checked={p.enabled} aria-label="Send this field" onChange={(e) => set(i, { enabled: e.target.checked })} />
          <input
            className="input mono"
            placeholder="field"
            value={p.key}
            spellCheck={false}
            onChange={(e) => set(i, { key: e.target.value })}
            aria-label="Field name"
          />
          <div className="segmented mini">
            <button type="button" className={p.kind === "text" ? "active" : ""} onClick={() => set(i, { kind: "text" })}>
              Text
            </button>
            <button type="button" className={p.kind === "file" ? "active" : ""} onClick={() => set(i, { kind: "file" })}>
              File
            </button>
          </div>
          {p.kind === "text" ? (
            <input
              className="input mono"
              placeholder="value or {{variable}}"
              value={p.value}
              spellCheck={false}
              onChange={(e) => set(i, { value: e.target.value })}
              aria-label="Value"
            />
          ) : (
            <FilePick compact file={p.file} onChange={(file) => set(i, { file })} />
          )}
          <button type="button" className="icon-btn" aria-label="Remove field" onClick={() => onChange(parts.filter((_, j) => j !== i))}>
            <X size={13} />
          </button>
        </div>
      ))}
      <div className="multipart-foot">
        <button
          type="button"
          className="link-btn"
          disabled={parts.length >= 50}
          onClick={() => onChange([...parts, { key: "", enabled: true, kind: "text", value: "" }])}
        >
          <Plus size={12} />
          Add field
        </button>
        {total > 0 && <span className={`small ${total > MAX_FILE_BYTES ? "warn-text" : "muted"}`}>{formatBytes(total)} of 5 MB attached</span>}
      </div>
    </div>
  );
};

// JSON check that tolerates `{{variables}}` used as values
const isJsonLike = (text: string): boolean => {
  try {
    JSON.parse(text.replace(/\{\{\s*[A-Za-z0-9_.\-]+\s*\}\}/g, "0"));
    return true;
  } catch {
    return false;
  }
};

const AuthEditor = ({ auth, onChange }: { auth: RequestAuth; onChange: (a: RequestAuth) => void }) => {
  const [reveal, setReveal] = useState(false);
  const secretType = reveal ? "text" : "password";

  return (
    <div className="form-grid">
      <div className="field">
        <span>Type</span>
        <Select
          block
          label="Auth type"
          value={auth.type}
          options={[
            { value: "none", label: "No auth" },
            { value: "bearer", label: "Bearer token" },
            { value: "basic", label: "Basic auth" },
            { value: "apiKey", label: "API key" },
          ]}
          onChange={(type) => {
            if (type === "none") onChange({ type });
            else if (type === "bearer") onChange({ type, token: "" });
            else if (type === "basic") onChange({ type, username: "", password: "" });
            else onChange({ type, key: "X-API-Key", value: "", in: "header" });
          }}
        />
      </div>

      {auth.type === "bearer" && (
        <label className="field wide">
          <span>Token</span>
          <input
            className="input mono"
            type={secretType}
            placeholder="{{token}}"
            value={auth.token}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
          />
        </label>
      )}
      {auth.type === "basic" && (
        <>
          <label className="field">
            <span>Username</span>
            <input className="input mono" value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input mono" type={secretType} value={auth.password} onChange={(e) => onChange({ ...auth, password: e.target.value })} />
          </label>
        </>
      )}
      {auth.type === "apiKey" && (
        <>
          <label className="field">
            <span>Key</span>
            <input className="input mono" value={auth.key} onChange={(e) => onChange({ ...auth, key: e.target.value })} />
          </label>
          <label className="field">
            <span>Value</span>
            <input className="input mono" type={secretType} value={auth.value} onChange={(e) => onChange({ ...auth, value: e.target.value })} />
          </label>
          <div className="field">
            <span>Add to</span>
            <Select
              block
              label="Send API key in"
              value={auth.in}
              options={[
                { value: "header", label: "Header" },
                { value: "query", label: "Query params" },
              ]}
              onChange={(v) => onChange({ ...auth, in: v })}
            />
          </div>
        </>
      )}
      {auth.type !== "none" && (
        <label className="field checkbox-field">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          <span>Show secrets</span>
        </label>
      )}
      {auth.type === "none" && <p className="hint">No authorization will be added. Headers you set manually still apply.</p>}
    </div>
  );
};
