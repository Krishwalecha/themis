import { VarInput } from "./VarInput";
import { X } from "lucide-react";
import type { KeyValue } from "../lib/types";

interface Props<T extends KeyValue> {
  rows: T[];
  onChange: (rows: T[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  // Builds a blank row; lets callers add extra fields (e.g
  blank: () => T;
  // Extra per-row control rendered in its own fixed column, before the delete button
  renderExtra?: (row: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  valueType?: (row: T) => "text" | "password";
  // Column headers, e.g
  headers?: [string, string, string?];
  // suggest the active environment's variables while typing values
  suggestVars?: boolean;
}

// Editable table of key/value rows with an always-present trailing blank row
export const KeyValueEditor = <T extends KeyValue>({
  rows,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  blank,
  renderExtra,
  valueType,
  headers,
  suggestVars = false,
}: Props<T>) => {
  const display = [...rows, blank()];

  const update = (index: number, patch: Partial<T>) => {
    if (index === rows.length) {
      onChange([...rows, { ...blank(), ...patch }]);
      return;
    }
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className={`kv${renderExtra ? " has-extra" : ""}`}>
      {headers && (
        <div className="kv-head">
          <span />
          <span>{headers[0]}</span>
          <span>{headers[1]}</span>
          {renderExtra && <span className="kv-extra">{headers[2] ?? ""}</span>}
          <span />
        </div>
      )}
      {display.map((row, i) => {
        const isGhost = i === rows.length;
        return (
          <div className={`kv-row${row.enabled ? "" : " kv-disabled"}${isGhost ? " kv-ghost" : ""}`} key={i}>
            <input
              type="checkbox"
              aria-label="Enabled"
              checked={row.enabled}
              disabled={isGhost}
              onChange={(e) => update(i, { enabled: e.target.checked } as Partial<T>)}
            />
            <input
              className="input mono"
              placeholder={keyPlaceholder}
              value={row.key}
              spellCheck={false}
              onChange={(e) => update(i, { key: e.target.value } as Partial<T>)}
            />
            {suggestVars ? (
              <VarInput
                className="input mono"
                placeholder={valuePlaceholder}
                value={row.value}
                spellCheck={false}
                type={valueType?.(row) ?? "text"}
                onChange={(value) => update(i, { value } as Partial<T>)}
              />
            ) : (
              <input
                className="input mono"
                placeholder={valuePlaceholder}
                value={row.value}
                spellCheck={false}
                type={valueType?.(row) ?? "text"}
                onChange={(e) => update(i, { value: e.target.value } as Partial<T>)}
              />
            )}
            {renderExtra && <span className="kv-extra">{isGhost ? null : renderExtra(row, (patch) => update(i, patch))}</span>}
            <button type="button" className="icon-btn" aria-label="Remove row" disabled={isGhost} onClick={() => remove(i)}>
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
