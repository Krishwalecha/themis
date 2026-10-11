import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

// selection over the rows currently shown; ids that disappear (new page, filter, delete) drop out
export const useSelection = (ids: string[]) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const key = ids.join(",");
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => ids.includes(id)));
      return next.size === s.size ? s : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    const all = ids.length > 0 && ids.every((id) => selected.has(id));
    return {
      selected,
      count: selected.size,
      all,
      some: selected.size > 0 && !all,
      has: (id: string) => selected.has(id),
      toggle: (id: string) =>
        setSelected((s) => {
          const next = new Set(s);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
      toggleAll: () => setSelected(all ? new Set() : new Set(ids)),
      clear: () => setSelected(new Set()),
    };
  }, [ids, selected]);
};

export const SelectBox = ({ checked, indeterminate = false, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="select-box"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
};

// floats at the bottom of the page while anything is selected
export const BulkBar = ({ count, noun, onClear, children }: { count: number; noun: string; onClear: () => void; children: ReactNode }) => {
  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClear();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, onClear]);
  return count === 0 ? null : (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-count">
        <b>{count}</b> {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      {children}
      <button type="button" className="icon-btn" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClear}>
        <X size={14} />
      </button>
    </div>
  );
};
