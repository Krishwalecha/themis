import { clip, redactBody, redactHeaders, redactUrl } from "../../lib/ai/redact";
import type { Level, Summary, SummaryTask } from "../../lib/ai/types";
import type { HistoryDoc } from "../../models/History";
import type { IncidentDoc } from "../../models/Incident";
import type { MonitorDoc } from "../../models/Monitor";
import type { MonitorCheckDoc } from "../../models/MonitorCheck";
import type { DashboardData } from "../dashboard/routes";
import { inMaintenance } from "../monitors/evaluate";
import type { monitorStats } from "../monitors/stats";
import { describeSchedule } from "../../lib/schedule";

const BODY_LIMIT = 6000;

const ms = (n: number | null | undefined) => (n == null ? "n/a" : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);
const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${Number(n.toFixed(2))}%`);
const worst = (...levels: Level[]): Level =>
  (["critical", "warning", "info", "ok"] as const).find((l) => levels.includes(l)) ?? "ok";

/* -------------------------------------------------------------------------- */
/* Response explainer                                                          */
/* -------------------------------------------------------------------------- */

const STATUS_HINTS: Record<number, { text: string; fix: string }> = {
  400: { text: "the server rejected the request as malformed", fix: "Check the request body and query parameters against the API docs." },
  401: {
    text: "the request isn't authenticated",
    fix: "Check the Authorization header or token; it may be missing, expired or for the wrong environment. APIs that require sign-in everywhere also answer 401 for paths that don't exist, so check the URL for typos.",
  },
  403: { text: "the credentials are valid but lack permission", fix: "Verify the token's scopes/roles for this resource." },
  404: { text: "the resource or route doesn't exist", fix: "Double-check the path, IDs and base URL for this environment." },
  405: { text: "this method isn't allowed on the route", fix: "Use the HTTP method the endpoint supports (see the Allow header)." },
  409: { text: "the request conflicts with the current state", fix: "Re-fetch the resource and retry with up-to-date data." },
  415: { text: "the content type isn't supported", fix: "Set the correct Content-Type (usually application/json)." },
  422: { text: "the payload failed validation", fix: "Read the validation errors in the body and fix those fields." },
  429: { text: "the client is being rate limited", fix: "Back off and retry after the Retry-After interval; reduce request frequency." },
  500: { text: "the server hit an unhandled error", fix: "Check the server logs for this request; it's a server-side bug." },
  502: { text: "a gateway got a bad response from upstream", fix: "Check the upstream service behind the gateway/load balancer." },
  503: { text: "the service is unavailable or overloaded", fix: "Check whether the service is down, deploying or out of capacity." },
  504: { text: "a gateway timed out waiting for upstream", fix: "Raise the gateway's upstream timeout or speed up the upstream call it waits on." },
};

const ERROR_INFO: Record<string, { title: string; why: string; steps: string[] }> = {
  TIMEOUT: { title: "Request timed out", why: "the server did not respond in time", steps: ["Check whether the server is overloaded or the endpoint does slow work", "Raise the request timeout if the work is expected to be slow"] },
  DNS_LOOKUP_FAILED: { title: "DNS lookup failed", why: "the hostname did not resolve, so the request never reached a server", steps: ["Check the hostname for typos", "Confirm a DNS record exists (nslookup <host>)", "Use the right environment's base URL"] },
  CONNECTION_REFUSED: { title: "Connection refused", why: "nothing is listening on that host and port", steps: ["Start the service or check that it's running", "Verify the port in the URL"] },
  CONNECTION_RESET: { title: "Connection reset", why: "the connection dropped mid-request", steps: ["Check proxy and load balancer logs", "Check the server for crashes or restarts"] },
  TLS_ERROR: { title: "TLS handshake failed", why: "the certificate was rejected", steps: ["Check the certificate is valid, not expired and matches the hostname"] },
  INVALID_URL: { title: "Invalid URL", why: "the URL could not be parsed or uses a blocked port", steps: ["Fix the scheme, host and port in the URL"] },
  NETWORK_ERROR: { title: "Network error", why: "the request failed before a response arrived", steps: ["Check network connectivity to the host"] },
};

const describeShape = (body: string): { shape: string; errorMessage?: string } | null => {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data)) return { shape: `a JSON array with ${data.length} item${data.length === 1 ? "" : "s"}` };
    if (data && typeof data === "object") {
      const keys = Object.keys(data);
      const err = (data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message ?? (data as Record<string, unknown>).detail;
      const errorMessage = typeof err === "string" ? err : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : undefined;
      return { shape: `a JSON object with ${keys.length} field${keys.length === 1 ? "" : "s"} (${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", …" : ""})`, errorMessage };
    }
    return { shape: `a JSON ${typeof data}` };
  } catch {
    return null;
  }
};

// a contract check recorded for this run, if one was made
interface RunContract {
  name: string;
  valid: boolean;
  skipped?: string | null;
  errors: { path?: string | null; message?: string | null }[];
  drift: { path?: string | null; message?: string | null }[];
}

export const historyTask = (entry: HistoryDoc, contract?: RunContract | null): SummaryTask => {
  const response = entry.response ?? ({} as NonNullable<HistoryDoc["response"]>);
  const body = response.bodyEncoding === "base64" ? "" : (response.body ?? "");
  const clipped = clip(redactBody(body), BODY_LIMIT);
  const headers = redactHeaders(response.headers as { key: string; value: string }[]);
  const header = (name: string) => headers.find((h) => h.key.toLowerCase() === name)?.value;

  const facts = {
    request: { method: entry.method, url: redactUrl(entry.resolvedUrl) },
    status: entry.status,
    statusText: response.statusText,
    error: response.error?.code ? response.error : undefined,
    latencyMs: entry.latencyMs,
    timeToFirstByteMs: response.ttfbMs,
    sizeBytes: entry.sizeBytes,
    contentType: response.contentType,
    responseHeaders: headers.slice(0, 40),
    redirected: response.redirected,
    bodyTruncatedByThemis: Boolean(response.truncated || response.storedBodyTruncated),
    unresolvedVariables: entry.unresolvedVariables ?? [],
    // the response was also checked against this contract; a broken contract fails the run even on a 200
    contract: contract
      ? {
          name: contract.name,
          result: contract.skipped ? `not checked: ${contract.skipped}` : contract.valid ? "matches" : "broken",
          violations: contract.errors.slice(0, 6).map((e) => `${e.path || "(root)"} ${e.message ?? ""}`.trim()),
          undocumentedFields: contract.drift.slice(0, 6).map((d) => d.path ?? d.message ?? ""),
        }
      : null,
  };

  const fallback = (): Summary => {
    const highlights: Summary["highlights"] = [];
    const recommendations: string[] = [];
    const levels: Level[] = [];
    let headline: string;
    let summary: string;

    if (response.error?.code) {
      const info = ERROR_INFO[response.error.code] ?? ERROR_INFO.NETWORK_ERROR;
      let host = "the host";
      try {
        host = new URL(entry.resolvedUrl).host || host;
      } catch {
        /* unparseable URL */
      }
      headline = `${info.title} for ${host}`;
      summary = `${info.why[0].toUpperCase()}${info.why.slice(1)}.`;
      levels.push("critical");
      highlights.push({ level: "critical", text: `Error: ${response.error.code}` }, { level: "info", text: `Time spent: ${ms(entry.latencyMs)}` });
      recommendations.push(...info.steps.map((s) => s.replace("<host>", host)));
    } else {
      const s = entry.status;
      const hint = STATUS_HINTS[s];
      const level: Level = s >= 500 ? "critical" : s >= 400 ? "warning" : s >= 300 ? "info" : "ok";
      levels.push(level);
      headline =
        s < 300 ? `${s} ${response.statusText || "OK"} in ${ms(entry.latencyMs)}` : `${s} ${response.statusText || ""}: ${hint?.text ?? (s >= 500 ? "server error" : s >= 400 ? "client error" : "redirect")}`.trim();
      const shape = body ? describeShape(body) : null;
      summary = `${entry.method} returned ${s}${response.statusText ? ` ${response.statusText}` : ""} after ${ms(entry.latencyMs)} with ${
        entry.sizeBytes ? `${entry.sizeBytes} bytes` : "an empty body"
      }${shape ? `, ${shape.shape}` : ""}.`;
      if (shape?.errorMessage) highlights.push({ level, text: `Error message in body: "${shape.errorMessage.slice(0, 200)}"` });
      if (hint) recommendations.push(hint.fix);
      if (s === 429 && header("retry-after")) highlights.push({ level: "warning", text: `Retry-After: ${header("retry-after")}` });
      if (s >= 300 && s < 400 && header("location")) highlights.push({ level: "info", text: `Redirects to ${redactUrl(header("location")!)}` });
    }

    if (entry.latencyMs > 2000) {
      levels.push("warning");
      highlights.push({ level: "warning", text: `Slow response: ${ms(entry.latencyMs)} total, ${ms(response.ttfbMs)} to first byte` });
      recommendations.push(
        response.ttfbMs && response.ttfbMs > entry.latencyMs * 0.8
          ? "Most of the time is server processing (time to first byte); profile the endpoint or its database queries."
          : "Most of the time is spent transferring the body; consider pagination or compression.",
      );
    } else if (!response.error?.code) {
      highlights.push({ level: "ok", text: `Latency ${ms(entry.latencyMs)} (first byte after ${ms(response.ttfbMs)})` });
    }
    if (entry.sizeBytes > 1024 * 1024) {
      levels.push("warning");
      highlights.push({ level: "warning", text: `Large payload: ${(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB` });
      recommendations.push("Paginate or filter the response to reduce payload size.");
    }
    if (!response.error?.code && entry.status !== 204 && body && !describeShape(body) && /json/i.test(response.contentType ?? "")) {
      levels.push("warning");
      highlights.push({ level: "warning", text: "Content-Type says JSON but the body doesn't parse as JSON" });
    }
    if (contract && !contract.skipped && !contract.valid) {
      levels.push("critical");
      const first = contract.errors[0];
      headline = `Response breaks the ${contract.name} contract`;
      summary = `The request succeeded, but the response doesn't match ${contract.name}${first ? `: ${first.path || "(root)"} ${first.message ?? ""}`.trimEnd() : ""}.`;
      highlights.unshift(...contract.errors.slice(0, 2).map((e) => ({ level: "critical" as Level, text: `Contract: ${e.path || "(root)"} ${e.message ?? ""}`.trim() })));
      recommendations.unshift(
        `Fix the API so ${first?.path || "the response"} matches ${contract.name}, or, if the change is intended, publish a new version of the contract.`,
      );
    } else if (contract?.valid && contract.drift.length) {
      highlights.push({ level: "info", text: `${contract.drift.length} field(s) not documented in ${contract.name}` });
    }
    if (entry.unresolvedVariables?.length) {
      levels.push("warning");
      highlights.push({ level: "warning", text: `Unresolved variables were sent literally: ${entry.unresolvedVariables.join(", ")}` });
      recommendations.push("Select an environment that defines those variables, or add them to the active one.");
    }
    if (!header("cache-control") && entry.method === "GET" && entry.status === 200) {
      highlights.push({ level: "info", text: "No Cache-Control header on a successful GET" });
    }

    return { headline: headline.slice(0, 200), severity: worst(...levels), summary, highlights: highlights.slice(0, 5), recommendations: recommendations.slice(0, 4) };
  };

  return {
    targetType: "history",
    focus:
      'Explain this single API response for the developer who just sent it: what the status and body mean, anything unusual (errors, slowness, size, headers, mismatched content type), and the most useful next steps. If facts.contract.result is "broken", the run fails even with a 2xx status: use a headline like "Response breaks the <contract name> contract", name the violated fields in the summary, and recommend fixing the API, or publishing a new contract version if the change was intended.',
    facts,
    untrusted: body ? { label: `Response body${clipped.truncated ? " (truncated)" : ""}`, content: clipped.text } : undefined,
    fallback,
  };
};

/* -------------------------------------------------------------------------- */
/* Monitor health report                                                       */
/* -------------------------------------------------------------------------- */

type Stats = Awaited<ReturnType<typeof monitorStats>>;

const topReasons = (checks: MonitorCheckDoc[]): { reason: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const c of checks) {
    const reason = (c.failures?.[0] ?? c.error?.message ?? `status ${c.statusCode}`).replace(/\d+(\.\d+)? ?ms/g, "N ms").slice(0, 160);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
};

// Compares average latency in the first and second half of the window
const latencyTrend = (stats: Stats): { firstHalfMs: number | null; secondHalfMs: number | null; changePct: number | null } => {
  const half = Math.floor(stats.series.length / 2);
  const avg = (bs: Stats["series"]) => {
    const vals = bs.filter((b) => b.avgLatencyMs !== null);
    if (!vals.length) return null;
    const total = vals.reduce((s, b) => s + b.total, 0);
    return vals.reduce((s, b) => s + (b.avgLatencyMs ?? 0) * b.total, 0) / Math.max(1, total);
  };
  const a = avg(stats.series.slice(0, half));
  const b = avg(stats.series.slice(half));
  return {
    firstHalfMs: a === null ? null : Math.round(a),
    secondHalfMs: b === null ? null : Math.round(b),
    changePct: a && b ? Math.round(((b - a) / a) * 100) : null,
  };
};

export const monitorTask = (monitor: MonitorDoc, stats: Stats, failing: MonitorCheckDoc[], incidents: IncidentDoc[]): SummaryTask => {
  const trend = latencyTrend(stats);
  const reasons = topReasons(failing);
  // for a collection monitor: which saved requests failed, and how often
  const failingRequests = monitor.collectionId
    ? [...failing.flatMap((c) => c.failures ?? []).reduce((m, f) => m.set(f.split(":")[0], (m.get(f.split(":")[0]) ?? 0) + 1), new Map<string, number>())].map(
        ([request, count]) => ({ request, failedChecks: count }),
      )
    : undefined;
  const open = incidents.find((i) => i.status === "open");
  const facts = {
    monitor: {
      name: monitor.name,
      // a collection monitor has no single endpoint: each failure names the request that failed
      endpoint: monitor.collectionId
        ? null
        : `${(monitor.request as { method?: string }).method ?? "GET"} ${redactUrl(String((monitor.request as { url?: string }).url ?? ""))}`,
      checks: monitor.collectionId ? "a whole collection, in order; failures read 'request name (METHOD url): reason'" : "a single request",
      inMaintenanceWindow: inMaintenance(monitor),
      currentStatus: monitor.state?.status,
      enabled: monitor.enabled,
      lastError: monitor.state?.lastError ?? null,
    },
    window: stats.window,
    checks: { total: stats.total, up: stats.up, degraded: stats.degraded, down: stats.down },
    uptimePct: stats.uptimePct,
    successRatePct: stats.successRate,
    errorRatePct: stats.errorRate,
    latencyMs: stats.latency,
    latencyTrend: trend,
    // the monitor's own pass/fail rules, so thresholds can be quoted exactly
    rules: ((monitor.assertions ?? []) as { source?: string; path?: string; operator?: string; expected?: unknown; severity?: string }[]).map((r) => ({
      check: [r.source, r.path].filter(Boolean).join(" "),
      operator: r.operator,
      expected: r.expected,
      onFail: r.severity === "warning" ? "degraded" : "down",
    })),
    schedule: monitor.schedule ? describeSchedule(monitor.schedule as Parameters<typeof describeSchedule>[0]) : null,
    // keyed by the labels the user sees, so advice can name them exactly
    settings: {
      "Open an incident after N consecutive failures": monitor.failureThreshold ?? 1,
      "Timeout (ms)": (monitor.request as { timeoutMs?: number }).timeoutMs ?? null,
    },
    pattern: {
      failingChecks: failing.length,
      totalChecks: stats.total,
      shape: failing.length === 0 ? "none" : failing.length <= 2 && stats.total >= 10 ? "isolated spike" : failing.length / Math.max(1, stats.total) > 0.2 ? "sustained" : "intermittent",
    },
    // where the time went: waiting on the server (ttfb) vs downloading the body
    failingRequests,
    recentFailingChecks: failing.slice(0, 6).map((c) => ({
      at: c.checkedAt,
      status: c.status,
      statusCode: c.statusCode || null,
      totalMs: Math.round(c.latencyMs),
      serverWaitMs: c.ttfbMs == null ? null : Math.round(c.ttfbMs),
      downloadMs: c.ttfbMs == null ? null : Math.max(0, Math.round(c.latencyMs - c.ttfbMs)),
      sizeBytes: c.sizeBytes ?? null,
      error: c.error?.code ?? null,
      reason: c.failures?.[0] ?? c.error?.message ?? null,
    })),
    topFailureReasons: reasons,
    incidents: incidents.slice(0, 10).map((i) => ({
      status: i.status,
      severity: i.severity,
      cause: i.cause,
      startedAt: i.startedAt,
      durationMs: i.durationMs ?? (i.status === "open" ? Date.now() - new Date(i.startedAt).getTime() : null),
      failedChecks: i.failedChecks,
    })),
  };

  const fallback = (): Summary => {
    const highlights: Summary["highlights"] = [];
    const recommendations: string[] = [];
    if (!stats.total) {
      return {
        headline: `${monitor.name}: no checks in the last ${stats.window}`,
        severity: "info",
        summary: monitor.enabled ? "The monitor hasn't run in this window yet." : "The monitor is paused, so there's no recent data.",
        highlights: [],
        recommendations: monitor.enabled ? ["Use Run now to record a first check."] : ["Resume the monitor to start collecting data."],
      };
    }
    const status = monitor.state?.status ?? "pending";
    const severity: Level =
      status === "down" || (stats.uptimePct ?? 100) < 95 ? "critical" : status === "degraded" || (stats.uptimePct ?? 100) < 99.5 || stats.degraded > 0 ? "warning" : "ok";
    const headline =
      severity === "ok"
        ? `${monitor.name} is healthy: ${pct(stats.uptimePct)} uptime over ${stats.window}`
        : `${monitor.name} is ${status === "down" ? "down" : status === "degraded" ? "degraded" : "unstable"}: ${pct(stats.uptimePct)} uptime over ${stats.window}`;

    highlights.push({
      level: severity === "ok" ? "ok" : severity,
      text: `${stats.up} of ${stats.total} checks fully passed; ${stats.degraded} degraded, ${stats.down} failed`,
    });
    highlights.push({ level: "info", text: `Latency avg ${ms(stats.latency.avg)}, p95 ${ms(stats.latency.p95)}, p99 ${ms(stats.latency.p99)}` });
    if (trend.changePct !== null && Math.abs(trend.changePct) >= 25) {
      highlights.push({
        level: trend.changePct > 0 ? "warning" : "ok",
        text: `Average latency ${trend.changePct > 0 ? "rose" : "fell"} ${Math.abs(trend.changePct)}% (${ms(trend.firstHalfMs)} → ${ms(trend.secondHalfMs)}) across the window`,
      });
    }
    if (reasons[0]) highlights.push({ level: "warning", text: `Most common failure (${reasons[0].count}×): ${reasons[0].reason}` });
    if (open) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(open.startedAt).getTime()) / 60_000));
      const age = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
      highlights.push({ level: open.severity === "down" ? "critical" : "warning", text: `Incident open for ${age}: ${open.cause}` });
    }

    const reasonText = reasons.map((r) => r.reason.toLowerCase()).join(" ");
    const spike = facts.pattern.shape === "isolated spike";
    const slow = facts.recentFailingChecks[0];
    const p95 = stats.latency.p95;
    if (spike)
      recommendations.push(
        `Edit the monitor and set "Open an incident after N consecutive failures" to 2: this was ${facts.pattern.failingChecks} bad check out of ${facts.pattern.totalChecks}, so one blip shouldn't open an incident.`,
      );
    if (/response time|latency/.test(reasonText) && p95 != null)
      recommendations.push(
        slow?.serverWaitMs != null && slow.serverWaitMs > slow.totalMs * 0.8
          ? `The server took ${ms(slow.serverWaitMs)} to answer (of ${ms(slow.totalMs)} total), so the delay was upstream, not the download. Set the latency rule just above the normal p95 of ${ms(p95)}, e.g. ${ms(Math.ceil((p95 * 1.5) / 100) * 100)}.`
          : `Set the latency rule just above the normal p95 of ${ms(p95)}, e.g. ${ms(Math.ceil((p95 * 1.5) / 100) * 100)}, so only real slowdowns fail.`,
      );
    if (/timeout|timed out/.test(reasonText)) recommendations.push(`Raise the monitor's "Timeout (ms)" (request Settings tab) above the endpoint's slowest normal response, or add retries if it's a third-party API.`);
    if (/refused|dns|tls|certificate/.test(reasonText)) recommendations.push("Fix the network layer named in the error: start the service if the connection was refused, add the DNS record if lookup failed, or renew the certificate if TLS failed.");
    if (/status 5\d\d|unexpected status 5/.test(reasonText)) recommendations.push("Read the 5xx response bodies in the failing checks; they usually name the failing dependency or exception.");
    if (/status 429|rate limit/.test(reasonText)) recommendations.push("You're being rate limited: authenticate the request or lower the check frequency, and back off using the Retry-After header.");
    if (/contract/.test(reasonText)) recommendations.push("Responses no longer match the contract: confirm whether the API change was intentional and update the contract or fix the API.");
    if (!recommendations.length && severity !== "ok") recommendations.push("Open the failing checks to see their responses and rule results.");

    const summary =
      severity === "ok"
        ? `All ${stats.total} checks in the last ${stats.window} passed or stayed reachable, with p95 latency at ${ms(stats.latency.p95)}.`
        : `${stats.down} of ${stats.total} checks failed and ${stats.degraded} were degraded in the last ${stats.window} (error rate ${pct(stats.errorRate)}).${
            reasons[0] ? ` The main problem is: ${reasons[0].reason}.` : ""
          }`;
    return { headline: headline.slice(0, 200), severity, summary, highlights: highlights.slice(0, 5), recommendations: recommendations.slice(0, 4) };
  };

  return {
    targetType: "monitor",
    focus:
      "Write a health report for this monitored API over the given window. Explain what went wrong and why, using the evidence (pattern shape, server wait vs download time, status codes, the rule that was crossed), then give concrete fixes.",
    facts,
    fallback,
  };
};

/* -------------------------------------------------------------------------- */
/* Contract violation explainer                                                */
/* -------------------------------------------------------------------------- */

interface ValidationLike {
  method?: string | null;
  url?: string | null;
  status?: number | null;
  valid?: boolean | null;
  skipped?: string | null;
  matched?: { path?: string | null; method?: string | null; status?: string | null } | null;
  errors?: { path?: string | null; message?: string | null; keyword?: string | null }[];
  drift?: { path?: string | null; message?: string | null }[];
  source?: string | null;
}

export const validationTask = (v: ValidationLike, contract: { name: string; kind: string; version: number }): SummaryTask => {
  const errors = (v.errors ?? []).slice(0, 30);
  const drift = (v.drift ?? []).slice(0, 20);
  const facts = {
    contract: { name: contract.name, kind: contract.kind, version: contract.version },
    response: { method: v.method, url: redactUrl(v.url ?? ""), status: v.status },
    matchedOperation: v.matched ?? null,
    valid: v.valid,
    skipped: v.skipped ?? null,
    violations: errors,
    undocumentedFields: drift,
    source: v.source,
  };

  const fallback = (): Summary => {
    if (v.skipped && !errors.length) {
      return {
        headline: "Contract wasn't applied to this response",
        severity: "info",
        summary: `Themis couldn't validate this response: ${v.skipped}.`,
        highlights: [],
        recommendations: /No operation/.test(v.skipped)
          ? ["Add this path and method to the spec, or check that the request URL matches the spec's server base path."]
          : /not JSON/.test(v.skipped)
            ? ["Contracts validate JSON bodies; check that the endpoint returns application/json."]
            : [],
      };
    }
    if (v.valid) {
      return {
        headline: `Response matches "${contract.name}"`,
        severity: drift.length ? "info" : "ok",
        summary: `The ${v.status} response conforms to the contract${v.matched?.path ? ` for ${v.matched.method} ${v.matched.path}` : ""}.`,
        highlights: drift.length ? [{ level: "info", text: `${drift.length} field(s) returned but not documented: ${drift.map((d) => d.path).join(", ")}` }] : [],
        recommendations: drift.length ? ["Document the extra fields in the contract (or stop returning them) so clients can rely on them."] : [],
      };
    }

    const byKind = (k: string) => errors.filter((e) => e.keyword === k);
    const missing = byKind("required");
    const types = byKind("type");
    const enums = byKind("enum");
    const formats = byKind("format");
    const extra = byKind("additionalProperties");
    const status = byKind("status");
    const highlights: Summary["highlights"] = [];
    const fieldPath = (e: { path?: string | null; message?: string | null }) => {
      const name = /"(.+)"/.exec(e.message ?? "")?.[1];
      const parent = e.path && e.path !== "/" ? e.path : "";
      return name ? `${parent}/${name}` : e.path ?? "/";
    };
    if (missing.length) highlights.push({ level: "critical", text: `Missing required fields: ${missing.map(fieldPath).join(", ")}` });
    if (types.length) highlights.push({ level: "critical", text: `Type mismatches: ${types.map((e) => `${e.path} ${e.message}`).join("; ")}` });
    if (enums.length) highlights.push({ level: "warning", text: `Unexpected enum values at ${enums.map((e) => e.path).join(", ")}` });
    if (formats.length) highlights.push({ level: "warning", text: `Format violations at ${formats.map((e) => e.path).join(", ")}` });
    if (extra.length) highlights.push({ level: "warning", text: `Properties not allowed by the contract: ${extra.map((e) => e.message).join("; ")}` });
    if (status.length) highlights.push({ level: "critical", text: status[0].message ?? "Undocumented status code" });
    if (drift.length) highlights.push({ level: "info", text: `${drift.length} undocumented field(s) also returned` });

    const recommendations = [
      "If the API change was intentional, update the contract (a new version records exactly what changed and what breaks clients).",
      "If it wasn't, treat it as a regression: find the deploy or code change that altered the response shape.",
    ];
    if (missing.length || types.length) recommendations.push("Check client code that reads these fields; it may crash or misbehave on this response.");

    return {
      headline: `${errors.length} contract violation${errors.length === 1 ? "" : "s"} against "${contract.name}"`,
      severity: missing.length || types.length || status.length ? "critical" : "warning",
      summary: `The ${v.status} response${v.matched?.path ? ` for ${v.matched.method} ${v.matched.path}` : ""} doesn't match contract v${contract.version}.${
        missing.length ? " The API stopped returning fields the contract requires." : ""
      }${types.length ? " Some fields changed type." : ""}`,
      highlights: highlights.slice(0, 5),
      recommendations: recommendations.slice(0, 4),
    };
  };

  return {
    targetType: "contractValidation",
    focus:
      "Explain why this response violates (or matches) the API contract, in plain language: what changed in the response compared with the contract, which clients it would break, the most likely cause, and how to fix it (in the API or in the contract).",
    facts,
    fallback,
  };
};

/* -------------------------------------------------------------------------- */
/* Ops brief                                                                   */
/* -------------------------------------------------------------------------- */

export const opsTask = (d: DashboardData): SummaryTask => {
  const rows = [...d.monitorRows].sort((a, b) => (a.uptimePct ?? 101) - (b.uptimePct ?? 101));
  const facts = {
    window: d.window,
    monitors: d.monitors,
    checks: { total: d.checks.total, up: d.checks.up, degraded: d.checks.degraded, down: d.checks.down },
    uptimePct: d.checks.uptimePct,
    errorRatePct: d.checks.errorRate,
    latencyMs: d.checks.latency,
    incidents: {
      open: d.incidents.open.map((i) => ({ monitor: i.monitorName, severity: i.severity, cause: i.cause, startedAt: i.startedAt })),
      resolvedInWindow: d.incidents.resolvedInWindow,
      mttrMs: d.incidents.mttrMs,
    },
    worstMonitors: rows.slice(0, 5).map((r) => ({ name: r.name, status: r.status, uptimePct: r.uptimePct, p95LatencyMs: r.p95LatencyMs, checks: r.checks })),
    recentFailures: d.recentFailures.slice(0, 8).map((f) => ({ monitor: f.monitorName, status: f.status, reason: f.failures?.[0] ?? null })),
    contracts: {
      total: d.contracts.total,
      validations: d.contracts.validations,
      passRatePct: d.contracts.passRate,
      responsesWithDrift: d.contracts.withDrift,
      recentViolations: d.contracts.recentViolations.slice(0, 5).map((v) => ({ contract: v.contractName, errors: v.errorCount, first: v.errors?.[0] ?? null })),
    },
    apiTesting: d.requests,
  };

  const fallback = (): Summary => {
    const { monitors, checks, incidents, contracts } = d;
    if (!monitors.total && !d.requests.total && !contracts.total) {
      return {
        headline: "Nothing to report yet",
        severity: "info",
        summary: "There are no monitors, contracts or requests in this window.",
        highlights: [],
        recommendations: ["Create a monitor for your most important endpoint to start tracking uptime and latency."],
      };
    }
    const severity: Level = monitors.down > 0 || incidents.open.some((i) => i.severity === "down") ? "critical" : monitors.degraded > 0 || incidents.openCount > 0 || (contracts.passRate ?? 100) < 100 ? "warning" : "ok";
    const highlights: Summary["highlights"] = [];
    if (monitors.total) {
      highlights.push({
        level: monitors.down ? "critical" : monitors.degraded ? "warning" : "ok",
        text: `${monitors.up}/${monitors.total} monitors up${monitors.degraded ? `, ${monitors.degraded} degraded` : ""}${monitors.down ? `, ${monitors.down} down` : ""}; overall uptime ${pct(checks.uptimePct)}`,
      });
      highlights.push({ level: "info", text: `Latency avg ${ms(checks.latency.avg)}, p95 ${ms(checks.latency.p95)} across ${checks.total} checks` });
    }
    for (const i of incidents.open.slice(0, 2)) highlights.push({ level: i.severity === "down" ? "critical" : "warning", text: `${i.monitorName}: ${i.cause}` });
    if (contracts.validations) {
      highlights.push({
        level: (contracts.passRate ?? 100) < 100 ? "warning" : "ok",
        text: `Contract pass rate ${pct(contracts.passRate)} over ${contracts.validations} validations${contracts.withDrift ? `; ${contracts.withDrift} with drift` : ""}`,
      });
    }
    const recommendations: string[] = [];
    const worstRow = rows.find((r) => r.status === "down" || r.status === "degraded");
    if (worstRow) recommendations.push(`Start with "${worstRow.name}" (${worstRow.status}, ${pct(worstRow.uptimePct)} uptime): open its failing checks.`);
    if (contracts.recentViolations[0]) recommendations.push(`Review the latest violation of "${contracts.recentViolations[0].contractName}" and decide whether the API or the contract should change.`);
    if (incidents.mttrMs && incidents.mttrMs > 30 * 60_000) recommendations.push("Incidents take over 30 minutes to recover on average; add a webhook alert so failures are noticed sooner.");

    if (!monitors.total || !checks.total) {
      const activity = d.requests.total
        ? `${d.requests.total} request${d.requests.total === 1 ? "" : "s"} sent from the workspace (avg ${ms(d.requests.avgLatencyMs)})`
        : "no workspace requests";
      return {
        headline: monitors.total ? `No monitor checks in the last ${d.window}` : "No monitors set up yet",
        severity: severity === "ok" ? "info" : severity,
        summary: `${monitors.total ? `${monitors.total} monitor(s) exist but none ran in this window` : "Nothing is being monitored yet"}; ${activity}.${
          contracts.validations ? ` Contract pass rate ${pct(contracts.passRate)} over ${contracts.validations} validations.` : ""
        }`,
        highlights: highlights.filter((h) => !h.text.includes("monitors up")).slice(0, 5),
        recommendations: [
          monitors.total ? "Resume or run your monitors to collect uptime data." : "Turn your most important endpoint into a monitor (Monitor this endpoint in the workspace).",
          ...recommendations,
        ].slice(0, 4),
      };
    }

    const headline =
      severity === "ok"
        ? `All systems operational over the last ${d.window}`
        : `${monitors.down ? `${monitors.down} down` : ""}${monitors.down && monitors.degraded ? ", " : ""}${monitors.degraded ? `${monitors.degraded} degraded` : ""}${
            !monitors.down && !monitors.degraded ? "Attention needed" : ""
          } · ${incidents.openCount} open incident${incidents.openCount === 1 ? "" : "s"}`;
    return {
      headline: headline.slice(0, 200),
      severity,
      summary:
        severity === "ok"
          ? `Every monitor is up with ${pct(checks.uptimePct)} uptime and p95 latency of ${ms(checks.latency.p95)}.`
          : `Over the last ${d.window}, ${checks.down} of ${checks.total} checks failed (error rate ${pct(checks.errorRate)}) and ${incidents.openCount} incident(s) are still open.`,
      highlights: highlights.slice(0, 5),
      recommendations: recommendations.slice(0, 4),
    };
  };

  return {
    targetType: "ops",
    focus:
      "Write a short operations brief for the whole workspace over the window: what's healthy, what's broken or degrading and since when, contract health, and a prioritised list of what to look at first.",
    facts,
    fallback,
  };
};
