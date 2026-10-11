import { Check, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Brand                                                                       */
/* -------------------------------------------------------------------------- */

type LedStatus = "up" | "degraded" | "down";


// The mark: a tiled "T" and its orange full stop, which doubles as the status light
export const Logo = ({ size = 22, status, live = false }: { size?: number; status?: LedStatus; live?: boolean }) => {
  return (
    <svg className={`logo${live ? " live" : ""}`} data-status={status} width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g fill="var(--text)"><path d="M20 40A20 20 0 0 1 40 20H60A20 20 0 0 1 80 40H60V80A20 20 0 0 1 40 60V40Z" /></g>
      <rect className="logo-dot" x="64" y="64" width="16" height="16" rx="3" />
    </svg>
  );
};

// Wordmark: "themis" with an orange full stop, which is the status light when `status` is set
export const Wordmark = ({ status, live = false }: { status?: LedStatus; live?: boolean }) => {
  return (
    <span className={`brand-name wordmark${live ? " live" : ""}`} data-status={status}>
      themis<span className="wordmark-dot">.</span>
    </span>
  );
};

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

// Crosshair registration marks at the four corners of a `.framed` parent
export const Marks = () => {
  return (
    <span className="marks" aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
};

// Page numbers to show: always the ends, the current page and its neighbours, gaps as "…"
const pageWindow = (page: number, pages: number): Array<number | "…"> => {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
};

// Shared pager under every list: "21–40 of 213" on the left, page links on the right
export const Pagination = ({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) => {
  if (total <= 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-range">
        {from}–{to} <span>of {total}</span>
      </span>
      {pages > 1 && (
        <span className="pagination-pages">
          <button className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft size={15} />
          </button>
          {pageWindow(page, pages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="pagination-gap">
                …
              </span>
            ) : (
              <button key={p} className={`pagination-num${p === page ? " active" : ""}`} aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)}>
                {p}
              </button>
            ),
          )}
          <button className="icon-btn" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight size={15} />
          </button>
        </span>
      )}
    </nav>
  );
};

// The one empty state used by every list page: a title, a line of help, and at most one action
export const EmptyState = ({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) => {
  return (
    <div className="empty-state">
      <p className="strong">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
};

// mono uppercase label above a page title
export const Eyebrow = ({ children }: { children: ReactNode }) => {
  return (
    <span className="eyebrow">
      {children}
    </span>
  );
};

export const DotLoader = ({ large = false, label = "Loading" }: { large?: boolean; label?: string }) => {
  return (
    <span className={`dm-loader${large ? " lg" : ""}`} role="status" aria-label={label}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ animationDelay: `${((i % 3) + Math.floor(i / 3)) * 0.12}s` }} />
      ))}
    </span>
  );
};

export const WaveLoader = ({ label = "Working" }: { label?: string }) => {
  return (
    <span className="wave-loader" role="status" aria-label={label}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
    </span>
  );
};

/* -------------------------------------------------------------------------- */
/* Select                                                                      */
/* -------------------------------------------------------------------------- */

interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  // Plain text used for type-ahead and the trigger when `label` is rich
  text?: string;
  hint?: string;
  group?: string;
  className?: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  size?: "small" | "default";
  mono?: boolean;
  block?: boolean;
  align?: "left" | "right";
  disabled?: boolean;
  // Accessible name when there is no visible label
  label?: string;
  triggerClassName?: string;
  title?: string;
}

// Custom dropdown: listbox semantics, keyboard navigation, type-ahead, click-outside to close
export const Select = <T extends string>({
  value,
  options,
  onChange,
  placeholder = "Select…",
  size = "default",
  mono = false,
  block = false,
  align = "left",
  disabled = false,
  label,
  triggerClassName = "",
  title,
}: SelectProps<T>) => {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    // open upward when the menu wouldn't fit below (e.g. the sidebar's environment picker)
    const r = rootRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      setUp(below < Math.min(320, 40 + options.length * 34) && r.top > below);
    }
    setActive(Math.max(0, selectedIndex));
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (i: number) => {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => (o.text ?? String(o.label)).toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <div ref={rootRef} className={`select${block ? " block" : ""}`}>
      <button
        type="button"
        className={`select-trigger${size === "small" ? " small" : ""}${mono ? " mono" : ""} ${triggerClassName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value${selected ? "" : " placeholder"} ${selected?.className ?? ""}`}>{selected ? selected.label : placeholder}</span>
        <ChevronsUpDown size={13} className="select-chevron" />
      </button>
      {open && (
        <div ref={listRef} id={`${id}-list`} role="listbox" className={`select-menu${align === "right" ? " right" : ""}${up ? " up" : ""}`} aria-label={label}>
          {options.map((o, i) => (
            <div key={o.value}>
              {o.group && (i === 0 || options[i - 1].group !== o.group) && <div className="select-group">{o.group}</div>}
              <button
                type="button"
                role="option"
                data-index={i}
                aria-selected={o.value === value}
                className={`select-option${i === active ? " active" : ""}${o.value === value ? " selected" : ""} ${o.className ?? ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="opt-hint">{o.hint}</span>}
                {o.value === value && !o.hint && <Check size={13} className="check" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

// Counts a number up from zero on first render, keeping whatever text surrounds it ("33.33%", "502 ms")
export const CountUp = ({ value, ms = 700 }: { value: string | number; ms?: number }) => {
  const text = String(value);
  const match = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(text);
  const [shown, setShown] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!match || done.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current = true;
      setShown(null);
      return;
    }
    const [, pre, num, post] = match;
    const target = Number(num.replace(/,/g, ""));
    const decimals = num.includes(".") ? num.split(".")[1].length : 0;
    const grouped = num.includes(",");
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const n = target * eased;
      const formatted = grouped ? n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : n.toFixed(decimals);
      setShown(`${pre}${formatted}${post}`);
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        done.current = true;
        setShown(null);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Only on mount: live updates shouldn't replay the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{shown ?? text}</>;
};
