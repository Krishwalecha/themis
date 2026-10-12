import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Assertion, ExecutionResult, Monitor, RequestSpec, Schedule } from "../lib/types";
import { splitUrl } from "../lib/urlParams";
import { Select } from "./ui";

const PRESETS: { label: string; schedule: Schedule }[] = [
  { label: "Every 30 seconds", schedule: { type: "interval", seconds: 30 } },
  { label: "Every minute", schedule: { type: "interval", seconds: 60 } },
  { label: "Every 5 minutes", schedule: { type: "interval", seconds: 300 } },
  { label: "Every 15 minutes", schedule: { type: "interval", seconds: 900 } },
  { label: "Every hour", schedule: { type: "interval", seconds: 3600 } },
];

// Monitors identify an endpoint by method + URL without its query string (params are stored separately)
const endpointKey = (method: string, url: string): string => {
  return `${method.toUpperCase()} ${splitUrl(url.trim()).base}`;
};

// Starter rules derived from the last response: same status, and latency within a generous budget
const baselineRules = (result: ExecutionResult | null): Assertion[] => {
  if (!result || result.status === 0) return [];
  const budget = Math.max(1000, Math.ceil((result.timings.totalMs * 3) / 100) * 100);
  return [
    { source: "status", path: "", operator: "eq", expected: String(result.status), enabled: true, severity: "critical" },
    { source: "latency", path: "", operator: "lt", expected: String(budget), enabled: true, severity: "warning" },
  ];
};

interface Props {
  spec: RequestSpec;
  name: string;
  environmentId: string | null;
  lastResult: ExecutionResult | null;
}

// In the workspace header: a live dot when this endpoint is monitored, otherwise a Monitor button with a quick-create popover
export const WorkspaceMonitor = ({ spec, name, environmentId, lastResult }: Props) => {
  const navigate = useNavigate();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(1);
  const [cron, setCron] = useState("");
  const [useBaseline, setUseBaseline] = useState(true);
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setMonitors((await api.monitors.list()).items);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const key = endpointKey(spec.method, spec.url);
  const existing = useMemo(() => monitors.find((m) => !m.collectionId && endpointKey(m.request.method, m.request.url) === key), [monitors, key]);
  const rules = baselineRules(lastResult);

  if (!spec.url.trim()) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    const schedule: Schedule = cron.trim() ? { type: "cron", expression: cron.trim() } : PRESETS[preset].schedule;
    const { base, hash } = splitUrl(spec.url);
    try {
      await api.monitors.create({
        name: name.trim() || `${spec.method} ${base.replace(/^https?:\/\//, "")}`.slice(0, 120),
        request: { ...spec, url: base + hash },
        environmentId,
        schedule,
        assertions: useBaseline ? rules : [],
        failureThreshold: 1,
        enabled: true,
        alerts: { webhookUrl: webhook.trim(), notifyOnRecovery: true },
        tags: [],
      });
      await refresh();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (existing) {
    const uptime = existing.last24h?.uptimePct != null ? ` · ${Number(existing.last24h.uptimePct.toFixed(2))}% uptime 24h` : "";
    return (
      <Link
        to={`/monitors/${existing._id}`}
        className={`ws-live ${existing.enabled ? existing.state.status : "paused"}`}
        title={`Monitored ${existing.scheduleLabel}${uptime}. Open the monitor`}
      >
        <i aria-hidden />
        {existing.enabled ? `Monitored ${existing.scheduleLabel}` : "Monitoring paused"}
      </Link>
    );
  }

  return (
    <div className="ws-monitor" ref={panelRef}>
      <button type="button" className="btn ghost small" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Monitor this endpoint">
        <Activity size={13} />
        Monitor this endpoint
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Enable monitoring">
          <h3>Enable monitoring</h3>
          <p className="hint">
            Themis will call{" "}
            <span className="mono">
              {spec.method} {splitUrl(spec.url).base}
            </span>{" "}
            on a schedule and track uptime and latency.
          </p>
          <div className="field">
            <span>Check</span>
            <Select
              block
              label="Check frequency"
              disabled={Boolean(cron.trim())}
              value={String(preset)}
              options={PRESETS.map((p, i) => ({ value: String(i), label: p.label }))}
              onChange={(v) => setPreset(Number(v))}
            />
          </div>
          <label className="field">
            <span>Or cron expression (optional)</span>
            <input className="input mono" placeholder="*/5 * * * *" value={cron} onChange={(e) => setCron(e.target.value)} />
          </label>
          {rules.length > 0 ? (
            <label className="field checkbox-field">
              <input type="checkbox" checked={useBaseline} onChange={(e) => setUseBaseline(e.target.checked)} />
              <span>
                Expect status {rules[0].expected} and response under {rules[1].expected} ms (from the last response)
              </span>
            </label>
          ) : (
            <p className="hint">Send the request first to add rules based on its response. Otherwise any 2xx/3xx counts as up.</p>
          )}
          <label className="field">
            <span>Alert webhook (optional)</span>
            <input className="input mono" placeholder="https://hooks.slack.com/…" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          </label>
          {error && <div className="banner error">{error}</div>}
          <div className="popover-actions">
            <button type="button" className="link-btn" onClick={() => navigate("/monitors/new", { state: { request: spec, name: name.trim() } })}>
              More options
            </button>
            <button type="button" className="btn primary small" disabled={busy} onClick={() => void create()}>
              {busy ? "Starting…" : "Start monitoring"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
