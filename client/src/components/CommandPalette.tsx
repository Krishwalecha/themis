import { Activity, CornerDownLeft, FileCheck2, FolderOpen, Search, Send, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { NAV_ITEMS } from "./nav";

interface Item {
  group: string;
  label: string;
  to: string;
  icon: LucideIcon;
  hint?: string;
}

// ⌘K / Ctrl+K: jump to any page, monitor or contract
export const CommandPalette = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [dynamic, setDynamic] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    Promise.all([api.monitors.list(), api.contracts.list(), api.collections.list()])
      .then(([m, c, cols]) =>
        setDynamic([
          ...cols.items.map((x) => ({
            group: "Collections",
            label: x.name,
            to: `/collections/${x._id}`,
            icon: FolderOpen,
            hint: `${x.requestCount} requests`,
          })),
          ...cols.items.flatMap((x) =>
            x.requests.map((r) => ({
              group: "Saved requests",
              label: r.name,
              to: `/workspace?collection=${x._id}&request=${r._id}`,
              icon: Send,
              hint: `${r.method} ${r.url}`,
            })),
          ),
          ...m.items.map((x) => ({
            group: "Monitors",
            label: x.name,
            to: `/monitors/${x._id}`,
            icon: Activity,
            hint: x.collectionId ? `Collection · ${x.collectionName ?? "deleted"}` : x.request.url,
          })),
          ...c.items.map((x) => ({ group: "Contracts", label: x.name, to: `/contracts/${x._id}`, icon: FileCheck2, hint: `v${x.version}` })),
        ]),
      )
      .catch(() => undefined);
  }, [open]);

  const items = useMemo(() => {
    const all: Item[] = [...NAV_ITEMS.map((n) => ({ group: "Pages", label: n.label, to: n.to, icon: n.icon })), ...dynamic];
    const q = query.trim().toLowerCase();
    return q ? all.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(q)) : all;
  }, [dynamic, query]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const go = (item: Item | undefined) => {
    if (!item) return;
    navigate(item.to);
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search pages, collections, requests, monitors…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") go(items[index]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        {items.length === 0 ? (
          <div className="palette-empty">No results for "{query}"</div>
        ) : (
          <ul className="palette-list">
            {items.map((item, i) => (
              <li key={`${item.group}-${item.to}`}>
                {(i === 0 || items[i - 1].group !== item.group) && <div className="palette-group">{item.group}</div>}
                <button className={`palette-item${i === index ? " active" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => go(item)}>
                  <item.icon size={16} />
                  <span className="truncate">{item.label}</span>
                  {item.hint && <span className="hint mono truncate small">{item.hint}</span>}
                  {i === index && <CornerDownLeft size={14} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
