import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Extraction } from "../lib/types";
import { Select } from "./ui";

const SOURCES: { value: Extraction["source"]; label: string; placeholder: string }[] = [
  { value: "jsonPath", label: "JSON path", placeholder: "$.data.token" },
  { value: "header", label: "Header", placeholder: "X-Request-Id" },
  { value: "status", label: "Status code", placeholder: "the response status" },
  { value: "body", label: "Whole body", placeholder: "the full response body" },
];

const blank = (): Extraction => ({ variable: "", source: "jsonPath", path: "$.", enabled: true });
const VALID = /^[A-Za-z0-9_.-]+$/;
const needsPath = (r: Extraction) => r.source === "jsonPath" || r.source === "header";

// what a request captures from its response for the requests after it in a run
export const ExtractEditor = ({ rules, onSave, onCancel }: { rules: Extraction[]; onSave: (rules: Extraction[]) => Promise<void>; onCancel: () => void }) => {
  const [rows, setRows] = useState<Extraction[]>(rules.length ? rules : [blank()]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Extraction>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const filled = rows.filter((r) => r.variable.trim());
  const invalid = filled.some((r) => !VALID.test(r.variable.trim()) || (needsPath(r) && !r.path.trim()));

  return (
    <div className="extract-editor">
      <div className="extract-head">
        <span className="strong">Pass values to later requests</span>
        <span className="muted small">
          Each value becomes a <span className="mono">{"{{variable}}"}</span> for every request after this one in a run, like a login token.
        </span>
      </div>
      <div className="extract-rules">
        {rows.map((r, i) => {
          const source = SOURCES.find((s) => s.value === r.source)!;
          return (
            <div key={i} className="extract-row">
              <label className="extract-var mono">
                <span aria-hidden>{"{{"}</span>
                <input
                  placeholder="token"
                  value={r.variable}
                  maxLength={60}
                  spellCheck={false}
                  onChange={(e) => set(i, { variable: e.target.value })}
                  aria-label="Variable name"
                />
                <span aria-hidden>{"}}"}</span>
              </label>
              <span className="extract-from muted small">from</span>
              <Select
                label="Capture from"
                value={r.source}
                options={SOURCES.map((s) => ({ value: s.value, label: s.label }))}
                onChange={(v) => set(i, { source: v as Extraction["source"], path: v === "jsonPath" ? "$." : "" })}
              />
              <input
                className="input mono"
                placeholder={source.placeholder}
                value={needsPath(r) ? r.path : ""}
                disabled={!needsPath(r)}
                spellCheck={false}
                onChange={(e) => set(i, { path: e.target.value })}
                aria-label="Path"
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove"
                title="Remove"
                onClick={() => setRows((rs) => (rs.length === 1 ? [blank()] : rs.filter((_, j) => j !== i)))}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="extract-actions">
        <button type="button" className="link-btn" disabled={rows.length >= 20} onClick={() => setRows((r) => [...r, blank()])}>
          <Plus size={12} />
          Add value
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary small"
          disabled={busy || invalid}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(filled.map((r) => ({ ...r, variable: r.variable.trim(), path: r.path.trim() })));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
};
