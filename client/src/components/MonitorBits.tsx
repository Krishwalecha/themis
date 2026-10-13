import { Select, CountUp } from "./ui";
import { ASSERTION_OPERATORS, ASSERTION_SOURCES, type Assertion, type AssertionOutcome, type MonitorStatus } from "../lib/types";

const STATUS_LABEL: Record<MonitorStatus, string> = {
  up: "Up",
  degraded: "Degraded",
  down: "Down",
  pending: "Pending",
  paused: "Paused",
};

// Status is always shown as icon-dot + word, never color alone
export const StatusPill = ({ status }: { status: MonitorStatus }) => {
  return (
    <span className={`pill pill-${status}`}>
      <span className="pill-dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
};

export const formatPct = (v: number | null | undefined, digits = 2): string => {
  return v === null || v === undefined ? "–" : `${Number(v.toFixed(digits))}%`;
};

export const uptimeTone = (v: number | null | undefined): "good" | "warn" | "bad" | undefined => {
  if (v === null || v === undefined) return undefined;
  return v >= 99.5 ? "good" : v >= 95 ? "warn" : "bad";
};

const SOURCE_LABEL: Record<(typeof ASSERTION_SOURCES)[number], string> = {
  status: "Status code",
  latency: "Response time (ms)",
  header: "Header",
  jsonPath: "JSON field",
  body: "Body text",
  size: "Size (bytes)",
};

const OPERATOR_LABEL: Record<(typeof ASSERTION_OPERATORS)[number], string> = {
  eq: "equals",
  neq: "not equals",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  notContains: "doesn't contain",
  matches: "matches regex",
  exists: "exists",
  notExists: "doesn't exist",
  in: "is one of",
  type: "is type",
  lengthEq: "length is",
};

const PLACEHOLDER: Partial<Record<(typeof ASSERTION_SOURCES)[number], string>> = {
  status: "200 or 2xx",
  latency: "500",
  jsonPath: '"ok"',
  header: "application/json",
  body: "healthy",
  size: "10000",
};

const blankAssertion = (): Assertion => {
  return { source: "status", path: "", operator: "eq", expected: "200", enabled: true };
};

// Editor for success rules
export const AssertionsEditor = ({ rows, onChange }: { rows: Assertion[]; onChange: (rows: Assertion[]) => void }) => {
  const update = (i: number, patch: Partial<Assertion>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="rules">
      {rows.length === 0 && <p className="hint">No rules: any 2xx/3xx response within the timeout counts as up.</p>}
      {rows.map((r, i) => {
        const needsPath = r.source === "header" || r.source === "jsonPath";
        const needsValue = r.operator !== "exists" && r.operator !== "notExists";
        const severity = r.severity ?? (r.source === "status" ? "critical" : "warning");
        return (
          <div className="rule-row" key={i}>
            <input type="checkbox" aria-label="Enabled" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
            <Select
              block
              label="Rule source"
              value={r.source as (typeof ASSERTION_SOURCES)[number]}
              options={ASSERTION_SOURCES.map((src) => ({ value: src, label: SOURCE_LABEL[src] }))}
              onChange={(source) => update(i, { source, operator: source === "latency" || source === "size" ? "lt" : r.operator, path: "" })}
            />
            {needsPath ? (
              <input
                className="input mono"
                placeholder={r.source === "jsonPath" ? "$.status" : "Content-Type"}
                value={r.path}
                onChange={(e) => update(i, { path: e.target.value })}
              />
            ) : (
              <span />
            )}
            <Select
              block
              label="Operator"
              value={r.operator}
              options={ASSERTION_OPERATORS.map((o) => ({ value: o, label: OPERATOR_LABEL[o] }))}
              onChange={(operator) => update(i, { operator })}
            />
            {needsValue ? (
              <input
                className="input mono"
                placeholder={PLACEHOLDER[r.source as keyof typeof PLACEHOLDER] ?? "value"}
                value={r.expected}
                onChange={(e) => update(i, { expected: e.target.value })}
              />
            ) : (
              <span />
            )}
            <Select
              block
              label="Severity"
              title="A failing Down rule marks the check down; a Degraded rule marks it degraded"
              value={severity}
              options={[
                { value: "critical", label: <span className="pill pill-down"><span className="pill-dot" />Down</span>, text: "Down" },
                { value: "warning", label: <span className="pill pill-degraded"><span className="pill-dot" />Degraded</span>, text: "Degraded" },
              ]}
              onChange={(v) => update(i, { severity: v })}
            />
            <button type="button" className="icon-btn" aria-label="Remove rule" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className="btn ghost small" onClick={() => onChange([...rows, blankAssertion()])}>
        Add rule
      </button>
    </div>
  );
};

export const AssertionResults = ({ items }: { items: AssertionOutcome[] }) => {
  if (!items.length) return null;
  return (
    <ul className="assertion-results">
      {items.map((a, i) => (
        <li key={i} className={a.passed ? "pass" : a.severity === "critical" ? "fail" : "warn"}>
          <span aria-hidden>{a.passed ? "✓" : "✗"}</span>
          <span className="sr-only">{a.passed ? "Passed" : "Failed"}:</span>
          {a.message}
        </li>
      ))}
    </ul>
  );
};

// Change versus the previous period
export const Delta = ({
  current,
  previous,
  goodWhen,
  unit = "%",
  mode = "relative",
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  goodWhen: "up" | "down";
  unit?: string;
  // relative: % change; points: absolute difference (for percentages like uptime)
  mode?: "relative" | "points";
}) => {
  if (current == null || previous == null) return <span className="delta flat">–</span>;
  const diff = mode === "points" ? current - previous : previous === 0 ? 0 : ((current - previous) / previous) * 100;
  if (Math.abs(diff) < 0.05) return <span className="delta flat">0{unit}</span>;
  const up = diff > 0;
  const good = goodWhen === "up" ? up : !up;
  const shown = Math.abs(diff) >= 100 ? Math.round(Math.abs(diff)) : Number(Math.abs(diff).toFixed(1));
  return (
    <span className={`delta ${good ? "good" : "bad"}`}>
      {up ? "↑" : "↓"} {shown}
      {unit}
    </span>
  );
};

// One cell of the KPI strip
export const Kpi = ({ label, value, foot, children }: { label: string; value: React.ReactNode; foot?: React.ReactNode; children?: React.ReactNode }) => {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span>{label}</span>
      </div>
      <div className="kpi-value">{typeof value === "string" || typeof value === "number" ? <CountUp value={value} /> : value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
      {children}
    </div>
  );
};
