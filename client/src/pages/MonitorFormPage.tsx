import { VarInput, VarScope } from "../components/VarInput";
import { useEffect, useRef, useState } from "react";
import { DateTimeField, NumberField, TimeField } from "../components/Pickers";
import { Plus, X } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AssertionResults, AssertionsEditor, StatusPill } from "../components/MonitorBits";
import { RequestEditor, withUrl } from "../components/RequestEditor";
import { METHOD_OPTIONS } from "../components/Badges";
import { useConfirm, useToast } from "../components/Feedback";
import { DotLoader, Eyebrow, Select } from "../components/ui";
import { api } from "../lib/api";
import { useEnvironments } from "../lib/environments";
import { formatMs } from "../lib/format";
import {
  emptyRequest,
  type CollectionRun,
  type CollectionSummary,
  type ContractListItem,
  type DryRunResult,
  type HttpMethod,
  type MaintenanceWindow,
  type MonitorInput,
  type RequestSpec,
  type Schedule,
} from "../lib/types";
import { splitUrl, urlFromParams } from "../lib/urlParams";

const INTERVALS = [
  { seconds: 30, label: "Every 30 seconds" },
  { seconds: 60, label: "Every minute" },
  { seconds: 300, label: "Every 5 minutes" },
  { seconds: 900, label: "Every 15 minutes" },
  { seconds: 1800, label: "Every 30 minutes" },
  { seconds: 3600, label: "Every hour" },
  { seconds: 21600, label: "Every 6 hours" },
  { seconds: 86400, label: "Every day" },
];

const CRON_EXAMPLES = ["*/5 * * * *", "0 * * * *", "0 9 * * 1-5", "*/30 * * * * *"];

const blankMonitor = (request?: RequestSpec, environmentId?: string | null): MonitorInput => {
  return {
    name: "",
    request: request ?? { ...emptyRequest(), url: "" },
    environmentId: environmentId ?? null,
    schedule: { type: "interval", seconds: 60 },
    assertions: [],
    failureThreshold: 1,
    enabled: true,
    alerts: { webhookUrl: "", notifyOnRecovery: true },
    tags: [],
    collectionId: null,
    maintenance: [],
  };
};

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
// shown Monday first; values are cron day numbers
const WEEK = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 0, label: "Sun" },
];

// "At set times" is a cron of the form "M H * * D", read back into a time and a set of days
type TimeOfDay = { time: string; days: number[]; timezone: string };
const readTimeOfDay = (schedule: Schedule): TimeOfDay | null => {
  if (schedule.type !== "cron") return null;
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/.exec(schedule.expression.trim());
  if (!m) return null;
  return {
    time: `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`,
    days: m[3] === "*" ? WEEK.map((w) => w.d) : [...new Set(m[3].split(",").map(Number))],
    timezone: schedule.timezone || "UTC",
  };
};
const timeOfDaySchedule = ({ time, days, timezone }: TimeOfDay): Schedule => {
  const [h, m] = time.split(":").map(Number);
  const every = days.length === 7 ? "*" : [...days].sort().join(",");
  return { type: "cron", expression: `${m || 0} ${h || 0} * * ${every}`, timezone };
};

const nextHour = (): MaintenanceWindow => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString(), note: "" };
};

// The form edits a URL bar that mirrors params; the API stores the URL without its query string
const forSave = (input: MonitorInput): MonitorInput => {
  const { base, hash } = splitUrl(input.request.url);
  const maintenance = (input.maintenance ?? []).filter((w) => w.startsAt && w.endsAt).map((w) => ({ ...w, note: w.note?.trim() || undefined }));
  // a collection monitor's request is filled in by the server from the collection
  if (input.collectionId) {
    const { request: _request, ...rest } = input;
    return { ...rest, maintenance } as MonitorInput;
  }
  return { ...input, collectionId: null, maintenance, request: { ...input.request, url: base + hash } };
};

export const MonitorFormPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const toast = useToast();
  const { environments, activeId } = useEnvironments();
  const prefill = (location.state as { request?: RequestSpec; name?: string; collectionId?: string } | null) ?? null;

  const [form, setForm] = useState<MonitorInput>(() => {
    const base = { ...blankMonitor(prefill?.request, activeId), collectionId: prefill?.collectionId ?? null };
    return prefill?.name ? { ...base, name: prefill.name } : base;
  });
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [collectionRun, setCollectionRun] = useState<CollectionRun | null>(null);
  const isCollection = form.collectionId != null;
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [rawCron, setRawCron] = useState(false);
  const resultRef = useRef<HTMLElement>(null);

  // "Test once" answers at the bottom of a long form, so bring the result into view
  useEffect(() => {
    if (dryRun || collectionRun) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [dryRun, collectionRun]);

  // a new monitor starts in the sidebar's environment once that has loaded
  useEffect(() => {
    if (!id && activeId) setForm((f) => (f.environmentId ? f : { ...f, environmentId: activeId }));
  }, [id, activeId]);

  useEffect(() => {
    api.contracts
      .list()
      .then(({ items }) => setContracts(items))
      .catch(() => undefined);
    api.collections
      .list()
      .then(({ items }) => setCollections(items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    api.monitors
      .get(id)
      .then((m) =>
        setForm({
          name: m.name,
          description: m.description,
          request: { ...emptyRequest(), ...m.request, url: urlFromParams(m.request.url, m.request.params ?? []) },
          environmentId: m.environmentId ?? null,
          schedule: m.schedule,
          assertions: m.assertions ?? [],
          failureThreshold: m.failureThreshold ?? 1,
          enabled: m.enabled,
          alerts: { webhookUrl: m.alerts?.webhookUrl ?? "", notifyOnRecovery: m.alerts?.notifyOnRecovery ?? true },
          tags: m.tags ?? [],
          contractId: m.contractId ?? null,
          contractSeverity: m.contractSeverity ?? "warning",
          collectionId: m.collectionId ?? null,
          maintenance: m.maintenance ?? [],
        }),
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (patch: Partial<MonitorInput>) => setForm((f) => ({ ...f, ...patch }));
  const setSchedule = (schedule: Schedule) => set({ schedule });

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      if (form.collectionId) setCollectionRun(await api.collections.run(form.collectionId, form.environmentId));
      else setDryRun(await api.monitors.test(forSave({ ...form, name: form.name || "Test" })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = id ? await api.monitors.update(id, forSave(form)) : await api.monitors.create(forSave(form));
      toast(id ? "Monitor updated" : "Monitor created", { body: saved.name });
      navigate(`/monitors/${saved._id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    const ok = await confirm({
      title: "Delete this monitor?",
      body: (
        <>
          <strong>{form.name}</strong> stops running and all of its check history and incidents are removed.
        </>
      ),
      confirmLabel: "Delete monitor",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.monitors.remove(id);
      toast("Monitor deleted", { body: form.name });
      navigate("/monitors");
    } catch (e) {
      toast("Couldn't delete monitor", { tone: "error", body: (e as Error).message });
    }
  };

  if (loading)
    return (
      <div className="page">
        <DotLoader large />
      </div>
    );

  const timeOfDay = readTimeOfDay(form.schedule);
  // a cron that looks like a time of day still opens in the raw editor if that's where the user put it
  const scheduleMode = form.schedule.type === "interval" ? "interval" : timeOfDay && !rawCron ? "times" : "cron";
  const setTimes = (patch: Partial<TimeOfDay>) =>
    setSchedule(timeOfDaySchedule({ ...(timeOfDay ?? { time: "10:00", days: WEEK.map((w) => w.d), timezone: BROWSER_TZ }), ...patch }));
  const isCustomInterval =
    form.schedule.type === "interval" && !INTERVALS.some((i) => form.schedule.type === "interval" && i.seconds === form.schedule.seconds);

  return (
    <VarScope.Provider value={form.environmentId ?? null}>
      <div className="page wide">
        <header className="page-header">
          <div>
            <Eyebrow>Monitoring</Eyebrow>
            <h1>{id ? "Edit monitor" : "New monitor"}</h1>
            <p className="muted">Themis calls this endpoint, or runs a whole collection, on a schedule and records every result.</p>
          </div>
        </header>

        {error && <div className="banner error">{error}</div>}

        <section className="panel form-section">
          <h2>What to check</h2>
          <label className="field">
            <span>Name</span>
            <input className="input" placeholder="Payments API health" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="field">
            <span>Environment</span>
            <Select
              block
              label="Environment"
              value={form.environmentId ?? ""}
              onChange={(v) => set({ environmentId: v || null })}
              options={[{ value: "", label: "None" }, ...environments.map((env) => ({ value: env._id, label: env.name }))]}
            />
          </div>
          <div className="segmented">
            <button type="button" className={isCollection ? "" : "active"} onClick={() => set({ collectionId: null })}>
              Single request
            </button>
            <button
              type="button"
              className={isCollection ? "active" : ""}
              onClick={() => set({ collectionId: form.collectionId ?? collections.find((c) => c.requestCount)?._id ?? "" })}
            >
              Collection
            </button>
          </div>
          {isCollection ? (
            <div className="field">
              <span>Collection</span>
              <Select
                block
                label="Collection"
                value={form.collectionId ?? ""}
                onChange={(v) => set({ collectionId: v, name: form.name || (collections.find((c) => c._id === v)?.name ?? "") })}
                options={[
                  ...(form.collectionId ? [] : [{ value: "", label: "Choose a collection" }]),
                  ...collections.map((c) => ({ value: c._id, label: c.name, hint: `${c.requestCount}` })),
                ]}
              />
              <p className="hint">
                Every request runs in order, passing captured variables along. The check is down if any request fails or breaks its contract.{" "}
                {collections.length === 0 && <Link to="/collections">Create a collection</Link>}
              </p>
            </div>
          ) : (
            <>
              <div className="request-bar">
                <Select
                  mono
                  label="HTTP method"
                  value={form.request.method}
                  options={METHOD_OPTIONS}
                  onChange={(m) => set({ request: { ...form.request, method: m as HttpMethod } })}
                />
                <VarInput
                  wrapClassName="url-wrap"
                  className="url-input mono"
                  placeholder="https://api.example.com/health or {{baseUrl}}/health"
                  value={form.request.url}
                  spellCheck={false}
                  onChange={(url) => set({ request: withUrl(form.request, url) })}
                />
              </div>
              <RequestEditor spec={form.request} onChange={(request) => set({ request })} />
            </>
          )}
        </section>

        <section className="panel form-section">
          <h2>Schedule</h2>
          <div className="segmented">
            <button type="button" className={scheduleMode === "interval" ? "active" : ""} onClick={() => setSchedule({ type: "interval", seconds: 60 })}>
              Interval
            </button>
            <button
              type="button"
              className={scheduleMode === "times" ? "active" : ""}
              onClick={() => {
                setRawCron(false);
                if (!timeOfDay) setSchedule(timeOfDaySchedule({ time: "10:00", days: WEEK.map((w) => w.d), timezone: BROWSER_TZ }));
              }}
            >
              At set times
            </button>
            <button
              type="button"
              className={scheduleMode === "cron" ? "active" : ""}
              onClick={() => {
                setRawCron(true);
                if (form.schedule.type !== "cron") setSchedule({ type: "cron", expression: "*/5 * * * *" });
              }}
            >
              Cron expression
            </button>
          </div>
          {scheduleMode === "times" && timeOfDay ? (
            <div className="form-grid">
              <div className="field">
                <span>Time</span>
                <TimeField value={timeOfDay.time} onChange={(time) => setTimes({ time })} />
              </div>
              <div className="field">
                <span>Timezone</span>
                <Select
                  block
                  label="Timezone"
                  value={timeOfDay.timezone}
                  onChange={(timezone) => setTimes({ timezone })}
                  options={[
                    { value: BROWSER_TZ, label: BROWSER_TZ, hint: "yours" },
                    ...(BROWSER_TZ === "UTC" ? [] : [{ value: "UTC", label: "UTC" }]),
                    ...([BROWSER_TZ, "UTC"].includes(timeOfDay.timezone) ? [] : [{ value: timeOfDay.timezone, label: timeOfDay.timezone }]),
                  ]}
                />
              </div>
              <div className="field wide">
                <span>On</span>
                <div className="day-picker" role="group" aria-label="Days">
                  {WEEK.map(({ d, label }) => {
                    const on = timeOfDay.days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        className={on ? "on" : ""}
                        // at least one day stays on
                        onClick={() =>
                          on
                            ? timeOfDay.days.length > 1 && setTimes({ days: timeOfDay.days.filter((x) => x !== d) })
                            : setTimes({ days: [...timeOfDay.days, d] })
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                  <span className="day-picker-presets">
                    <button type="button" className="link-btn" onClick={() => setTimes({ days: WEEK.map((w) => w.d) })}>
                      Every day
                    </button>
                    <button type="button" className="link-btn" onClick={() => setTimes({ days: [1, 2, 3, 4, 5] })}>
                      Weekdays
                    </button>
                  </span>
                </div>
              </div>
            </div>
          ) : form.schedule.type === "interval" ? (
            <div className="form-grid">
              <div className="field">
                <span>Run</span>
                <Select
                  block
                  label="Check frequency"
                  value={isCustomInterval ? "custom" : String(form.schedule.seconds)}
                  onChange={(v) => v !== "custom" && setSchedule({ type: "interval", seconds: Number(v) })}
                  options={[
                    ...INTERVALS.map((i) => ({ value: String(i.seconds), label: i.label })),
                    ...(isCustomInterval ? [{ value: "custom", label: "Custom" }] : []),
                  ]}
                />
              </div>
              <div className="field">
                <span>Or every N seconds (min 10)</span>
                <NumberField
                  label="Every N seconds"
                  min={10}
                  max={604800}
                  step={10}
                  value={form.schedule.seconds}
                  onChange={(seconds) => setSchedule({ type: "interval", seconds: seconds ?? 10 })}
                />
              </div>
            </div>
          ) : (
            <div className="form-grid">
              <label className="field">
                <span>Cron (5 fields, or 6 with seconds)</span>
                <input
                  className="input mono"
                  value={form.schedule.expression}
                  onChange={(e) => setSchedule({ ...(form.schedule as Extract<Schedule, { type: "cron" }>), expression: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Timezone (optional)</span>
                <input
                  className="input"
                  placeholder="Asia/Kolkata"
                  value={form.schedule.timezone ?? ""}
                  onChange={(e) => setSchedule({ ...(form.schedule as Extract<Schedule, { type: "cron" }>), timezone: e.target.value || undefined })}
                />
              </label>
              <p className="hint field wide">
                Examples:{" "}
                {CRON_EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="link-btn mono" onClick={() => setSchedule({ type: "cron", expression: ex })}>
                    {ex}
                  </button>
                )).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}
              </p>
            </div>
          )}
        </section>

        <section className="panel form-section">
          <h2>{isCollection ? "Incidents" : "Success rules"}</h2>
          {!isCollection && (
            <>
              <p className="hint">A failing "Down" rule marks the check down; a failing "Degraded" rule marks it degraded.</p>
              <AssertionsEditor rows={form.assertions} onChange={(assertions) => set({ assertions })} />
            </>
          )}
          <div className="field narrow-field">
            <span>Open an incident after N consecutive failures</span>
            <NumberField
              label="Consecutive failures"
              min={1}
              max={10}
              value={form.failureThreshold}
              onChange={(n) => set({ failureThreshold: Math.min(10, Math.max(1, n ?? 1)) })}
            />
          </div>
        </section>

        {!isCollection && (
          <section className="panel form-section">
            <h2>Contract guard</h2>
            <p className="hint">Validate every response against a contract. Violations show up on the monitor and the dashboard.</p>
            <div className="form-grid">
              <div className="field">
                <span>Contract</span>
                <Select
                  block
                  label="Contract"
                  value={form.contractId ?? ""}
                  onChange={(v) => set({ contractId: v || null })}
                  options={[{ value: "", label: "None" }, ...contracts.map((c) => ({ value: c._id, label: c.name, hint: `v${c.version}` }))]}
                />
              </div>
              <div className="field">
                <span>A violation marks the check</span>
                <Select
                  block
                  label="Violation severity"
                  disabled={!form.contractId}
                  value={form.contractSeverity ?? "warning"}
                  onChange={(v) => set({ contractSeverity: v })}
                  options={[
                    {
                      value: "warning",
                      label: (
                        <span className="pill pill-degraded">
                          <span className="pill-dot" />
                          Degraded
                        </span>
                      ),
                      text: "Degraded",
                    },
                    {
                      value: "critical",
                      label: (
                        <span className="pill pill-down">
                          <span className="pill-dot" />
                          Down
                        </span>
                      ),
                      text: "Down",
                    },
                  ]}
                />
              </div>
            </div>
            {contracts.length === 0 && (
              <p className="hint">
                No contracts yet. <Link to="/contracts/new">Create one</Link> to enable this.
              </p>
            )}
          </section>
        )}

        <section className="panel form-section">
          <h2>Alerts</h2>
          <label className="field">
            <span>Webhook URL</span>
            <input
              className="input mono"
              placeholder="https://hooks.slack.com/services/…"
              value={form.alerts.webhookUrl ?? ""}
              onChange={(e) => set({ alerts: { ...form.alerts, webhookUrl: e.target.value } })}
            />
          </label>
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={form.alerts.notifyOnRecovery}
              onChange={(e) => set({ alerts: { ...form.alerts, notifyOnRecovery: e.target.checked } })}
            />
            <span>Also notify when it recovers</span>
          </label>
          <p className="hint">Slack and Discord webhooks get native messages. Any other URL receives the alert as JSON.</p>
        </section>

        <section className="panel form-section">
          <h2>Maintenance windows</h2>
          <p className="hint">During a window, checks still run and are recorded, but they open no incidents, send no alerts and don't count against uptime.</p>
          {(form.maintenance ?? []).map((w, i) => {
            const update = (patch: Partial<MaintenanceWindow>) => set({ maintenance: form.maintenance!.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            const past = Boolean(w.endsAt) && new Date(w.endsAt) < new Date();
            return (
              <div key={i} className={`maintenance-row${past ? " past" : ""}`}>
                <div className="field">
                  <span>Starts</span>
                  <DateTimeField label="Starts" value={w.startsAt} onChange={(startsAt) => update({ startsAt })} />
                </div>
                <div className="field">
                  <span>Ends</span>
                  <DateTimeField label="Ends" value={w.endsAt} onChange={(endsAt) => update({ endsAt })} />
                </div>
                <label className="field">
                  <span>Note</span>
                  <input
                    className="input"
                    placeholder="Database migration"
                    maxLength={200}
                    value={w.note ?? ""}
                    onChange={(e) => update({ note: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove window"
                  title="Remove window"
                  onClick={() => set({ maintenance: form.maintenance!.filter((_, j) => j !== i) })}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          <div>
            <button
              type="button"
              className="btn ghost small"
              disabled={(form.maintenance ?? []).length >= 20}
              onClick={() => set({ maintenance: [...(form.maintenance ?? []), nextHour()] })}
            >
              <Plus size={13} />
              Add window
            </button>
          </div>
        </section>

        {isCollection && collectionRun && (
          <section ref={resultRef} className="panel form-section">
            <h2>Test result</h2>
            <div className="row-actions">
              <StatusPill status={collectionRun.verdict === "pass" ? "up" : "down"} />
              <span>
                {collectionRun.passed} of {collectionRun.results.length} passed
              </span>
              <span className="mono">{formatMs(collectionRun.durationMs)}</span>
            </div>
            <ul className="run-list">
              {collectionRun.results.map((r) => (
                <li key={r.requestId}>
                  <span className={`ws-tree-verdict ${r.verdict}`} />
                  <span className="truncate">{r.name}</span>
                  <span className="mono small muted">{r.reason || `${r.status} · ${formatMs(r.latencyMs)}`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!isCollection && dryRun && (
          <section ref={resultRef} className="panel form-section">
            <h2>Test result</h2>
            <div className="row-actions">
              <StatusPill status={dryRun.status} />
              <span className="mono">{dryRun.statusCode || "no response"}</span>
              <span className="mono">{formatMs(dryRun.latencyMs)}</span>
            </div>
            {dryRun.error && <div className="banner error">{dryRun.error.message}</div>}
            {dryRun.unresolvedVariables.length > 0 && <div className="banner warn">Unresolved variables: {dryRun.unresolvedVariables.join(", ")}</div>}
            <AssertionResults items={dryRun.assertions} />
          </section>
        )}

        <div className="editor-footer sticky-footer">
          {id && (
            <button className="btn ghost danger" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <label className="field checkbox-field grow-right">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span>Enabled</span>
          </label>
          <button className="btn ghost" disabled={testing || (isCollection ? !form.collectionId : !form.request.url.trim())} onClick={() => void test()}>
            {testing ? "Testing…" : "Test once"}
          </button>
          <button
            className="btn primary"
            disabled={saving || !form.name.trim() || (isCollection ? !form.collectionId : !form.request.url.trim())}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : id ? "Save changes" : "Create monitor"}
          </button>
        </div>
      </div>
    </VarScope.Provider>
  );
};
