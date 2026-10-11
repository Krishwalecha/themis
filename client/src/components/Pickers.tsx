import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { Select } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: pad(h), label: pad(h) }));
const MINUTES = Array.from({ length: 12 }, (_, i) => ({ value: pad(i * 5), label: pad(i * 5) }));

// "HH:MM" as two of the app's own dropdowns; minutes step by 5, but an existing odd minute is kept
export const TimeField = ({ value, onChange, label = "Time" }: { value: string; onChange: (v: string) => void; label?: string }) => {
  const [h = "00", m = "00"] = value.split(":");
  const minutes = MINUTES.some((o) => o.value === m) ? MINUTES : [...MINUTES, { value: m, label: m }].sort((a, b) => a.value.localeCompare(b.value));
  return (
    <div className="time-field" role="group" aria-label={label}>
      <Select mono label={`${label}: hour`} value={h} options={HOURS} onChange={(v) => onChange(`${v}:${m}`)} />
      <span className="time-sep" aria-hidden>
        :
      </span>
      <Select mono label={`${label}: minute`} value={m} options={minutes} onChange={(v) => onChange(`${h}:${v}`)} />
    </div>
  );
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// a date and a time in the viewer's timezone, stored as an ISO string
export const DateTimeField = ({ value, onChange, label }: { value: string; onChange: (iso: string) => void; label: string }) => {
  const at = value ? new Date(value) : new Date();
  const [open, setOpen] = useState(false);
  // open upward when the calendar wouldn't fit below (e.g. near the form's sticky footer)
  const [up, setUp] = useState(false);
  const [month, setMonth] = useState(() => new Date(at.getFullYear(), at.getMonth(), 1));
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMonth(new Date(at.getFullYear(), at.getMonth(), 1));
    const r = root.current?.getBoundingClientRect();
    if (r) setUp(window.innerHeight - r.bottom < 380 && r.top > window.innerHeight - r.bottom);
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (day: Date, time = `${pad(at.getHours())}:${pad(at.getMinutes())}`) => {
    const [h, m] = time.split(":").map(Number);
    onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString());
  };

  // Monday-first grid, padded with the neighbouring months' days
  const first = (month.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i - first + 1));
  const today = new Date();

  return (
    <div className="datetime-field" ref={root}>
      <button type="button" className="input date-trigger" aria-label={`${label}: date`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={14} />
        {at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
      </button>
      <TimeField label={label} value={`${pad(at.getHours())}:${pad(at.getMinutes())}`} onChange={(t) => set(at, t)} />
      {open && (
        <div className={`popover calendar${up ? " up" : ""}`} role="dialog" aria-label={`${label}: choose a date`}>
          <div className="calendar-head">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="strong">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="calendar-grid">
            {WEEKDAYS.map((d) => (
              <span key={d} className="calendar-dow">
                {d}
              </span>
            ))}
            {days.map((d) => (
              <button
                key={d.toISOString()}
                type="button"
                className={`calendar-day${d.getMonth() !== month.getMonth() ? " outside" : ""}${sameDay(d, at) ? " selected" : ""}${sameDay(d, today) ? " today" : ""}`}
                onClick={() => {
                  set(d);
                  setOpen(false);
                }}
              >
                {d.getDate()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// a number input with the app's own up/down steppers instead of the browser's spinner
export const NumberField = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  label,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  label?: string;
}) => {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const bump = (dir: 1 | -1) => onChange(clamp((value ?? (placeholder ? Number(placeholder) : (min ?? 0))) + dir * step));
  return (
    <div className="number-field">
      <input
        className="input"
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        onBlur={() => value !== undefined && value !== clamp(value) && onChange(clamp(value))}
      />
      <span className="number-steps">
        <button type="button" tabIndex={-1} aria-label="Increase" disabled={max !== undefined && (value ?? -Infinity) >= max} onClick={() => bump(1)}>
          <ChevronUp size={12} />
        </button>
        <button type="button" tabIndex={-1} aria-label="Decrease" disabled={min !== undefined && (value ?? Infinity) <= min} onClick={() => bump(-1)}>
          <ChevronDown size={12} />
        </button>
      </span>
    </div>
  );
};
