import type { Types } from "mongoose";
import { executeRequest } from "../../lib/executor";
import { interpolateSpec, variablesFrom } from "../../lib/interpolate";
import { Environment } from "../../models/Environment";
import { Collection } from "../../models/Collection";
import { Incident } from "../../models/Incident";
import { Monitor, type MonitorDoc } from "../../models/Monitor";
import { MonitorCheck, type MonitorCheckDoc } from "../../models/MonitorCheck";
import { requestSpecSchema } from "../../schemas/requestSpec";
import { assertionSchema } from "../../schemas/testing";
import { Contract, type ContractDoc } from "../../models/Contract";
import { runCollection } from "../collections/service";
import { validateAndLog } from "../contracts/service";
import { sendWebhook, type AlertKind } from "./alerts";
import { evaluateCheck, inMaintenance, type CheckStatus } from "./evaluate";
import { currentOwner, runAs, runUnscoped } from "../../lib/tenant";

type CheckTrigger = "scheduled" | "manual";

const variablesFor = async (environmentId?: Types.ObjectId | null): Promise<Record<string, string>> => {
  if (!environmentId) return {};
  const env = await Environment.findById(environmentId).lean();
  return env ? variablesFrom(env.variables) : {};
};

// A collection monitor runs every request in order (with chaining); the check is down if any of them fails
const runCollectionCheck = async (monitor: MonitorDoc, trigger: CheckTrigger): Promise<MonitorCheckDoc> => {
  const c = await Collection.findById(monitor.collectionId).lean();
  const run = c?.requests.length ? await runCollection(c, { environmentId: monitor.environmentId ? String(monitor.environmentId) : undefined, save: false }) : null;
  const failing = run?.results.filter((r) => r.verdict === "fail") ?? [];
  const first = failing[0] ?? run?.results[run.results.length - 1];
  const check = await MonitorCheck.create({
    monitorId: monitor._id,
    status: !run || failing.length ? "down" : "up",
    statusCode: first?.status ?? 0,
    latencyMs: run?.durationMs ?? 0,
    error: first?.error ?? undefined,
    // each failure names the request and where it points (as authored, query left off so no secrets ride along)
    failures: !c
      ? ["The collection was deleted"]
      : !run
        ? ["The collection has no requests"]
        : failing.map((r) => {
            const saved = c.requests.find((x) => String(x._id) === String(r.requestId));
            const url = String((saved?.request as { url?: string } | undefined)?.url ?? r.url).split("?")[0];
            return `${r.name} (${r.method} ${url}): ${r.reason || "failed"}`;
          }),
    maintenance: inMaintenance(monitor),
    trigger,
    checkedAt: new Date(),
  });
  await applyResult(monitor._id, check.toObject() as MonitorCheckDoc);
  return check.toObject() as MonitorCheckDoc;
};

// Executes one check for a monitor, records it, and updates monitor state and incidents
const runCheckNow = async (monitorId: Types.ObjectId | string, trigger: CheckTrigger): Promise<MonitorCheckDoc | null> => {
  const monitor = await Monitor.findById(monitorId).lean<MonitorDoc>();
  if (!monitor) return null;
  if (monitor.collectionId) return runCollectionCheck(monitor, trigger);

  const spec = requestSpecSchema.parse(monitor.request);
  const rules = (monitor.assertions ?? []).map((a) => assertionSchema.parse(a));
  const { spec: resolved, unresolved } = interpolateSpec(spec, await variablesFor(monitor.environmentId));
  const result = await executeRequest(resolved);
  const evaluation = evaluateCheck(result, rules);
  if (unresolved.length) evaluation.failures.push(`Unresolved variables: ${unresolved.join(", ")}`);

  // Contract guard: only meaningful when we actually got a response.
  let contractRecord: Record<string, unknown> | undefined;
  if (monitor.contractId && !result.error) {
    const contract = await Contract.findById(monitor.contractId).lean<ContractDoc>();
    if (contract) {
      const v = await validateAndLog(
        contract,
        {
          method: result.request.method,
          url: result.request.url,
          status: result.status,
          body: result.bodyEncoding === "utf8" ? result.body : "",
        },
        "monitor",
        monitor._id,
      );
      contractRecord = {
        contractId: contract._id,
        validationId: v.validationId,
        version: contract.version,
        valid: v.valid,
        skipped: v.skipped,
        errorCount: v.errors.length,
        driftCount: v.drift.length,
        errors: v.errors.slice(0, 10),
        drift: v.drift.slice(0, 10),
      };
      if (!v.valid && !v.skipped) {
        const first = v.errors.slice(0, 2).map((e) => `${e.path} ${e.message}`).join("; ");
        evaluation.failures.push(`Contract "${contract.name}": ${v.errors.length} violation(s): ${first}`);
        const severe = monitor.contractSeverity === "critical" ? "down" : "degraded";
        if (evaluation.status === "up" || (severe === "down" && evaluation.status === "degraded")) evaluation.status = severe;
      }
    }
  }

  const check = await MonitorCheck.create({
    monitorId: monitor._id,
    status: evaluation.status,
    statusCode: result.status,
    latencyMs: result.timings.totalMs,
    ttfbMs: result.timings.ttfbMs,
    sizeBytes: result.sizeBytes,
    error: result.error,
    failures: evaluation.failures,
    assertions: evaluation.assertions.map((a) => ({
      source: a.assertion.source,
      path: a.assertion.path,
      operator: a.assertion.operator,
      expected: a.assertion.expected,
      severity: a.severity,
      passed: a.passed,
      message: a.message,
    })),
    contract: contractRecord,
    maintenance: inMaintenance(monitor),
    trigger,
    checkedAt: new Date(),
  });

  await applyResult(monitor._id, check.toObject() as MonitorCheckDoc);
  return check.toObject() as MonitorCheckDoc;
};

// Checks for the same monitor (scheduled or "run now") run one at a time, so state and incidents never race
const chains = new Map<string, Promise<unknown>>();

// Checks always run (and record checks, incidents and validations) as the monitor's owner
const asMonitorOwner = async <T>(monitorId: Types.ObjectId | string, fn: () => Promise<T>): Promise<T> => {
  if (currentOwner()) return fn();
  const m = await runUnscoped(() => Monitor.findById(monitorId, { ownerId: 1 }).lean<{ ownerId?: Types.ObjectId | null }>().exec());
  return runAs(m?.ownerId ?? null, fn);
};

export const runCheck = (monitorId: Types.ObjectId | string, trigger: CheckTrigger = "scheduled"): Promise<MonitorCheckDoc | null> => {
  const key = String(monitorId);
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => asMonitorOwner(monitorId, () => runCheckNow(monitorId, trigger)));
  chains.set(key, next);
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
};

const applyResult = async (monitorId: Types.ObjectId, check: MonitorCheckDoc): Promise<void> => {
  const base = {
    "state.lastCheckedAt": check.checkedAt,
    "state.lastStatusCode": check.statusCode,
    "state.lastLatencyMs": check.latencyMs,
    "state.lastError": check.failures[0] ?? null,
  };
  // Re-read: the monitor may have been paused, edited or deleted while the request was in flight.
  const monitor = await Monitor.findById(monitorId).lean<MonitorDoc>();
  if (!monitor) return;
  // A check on a paused monitor, or one in a maintenance window, is informational: it doesn't move status or incidents.
  if (!monitor.enabled || check.maintenance) {
    await Monitor.updateOne({ _id: monitor._id }, { $set: base });
    return;
  }

  const failing = check.status !== "up";
  const consecutive = failing ? (monitor.state?.consecutiveFailures ?? 0) + 1 : 0;
  const update: Record<string, unknown> = { ...base, "state.status": check.status, "state.consecutiveFailures": consecutive };

  // The incidents collection is the source of truth for "is something open".
  const openIncident = await Incident.findOne({ monitorId: monitor._id, status: "open" }).sort({ startedAt: -1 });
  if (openIncident) update["state.openIncidentId"] = openIncident._id;
  const cause = check.failures[0] ?? `Check ${check.status}`;
  let alert: { kind: AlertKind; incidentId: Types.ObjectId } | null = null;

  if (failing) {
    if (openIncident && openIncident.status === "open") {
      openIncident.failedChecks += 1;
      openIncident.lastCheckAt = check.checkedAt;
      if (openIncident.severity === "degraded" && check.status === "down") {
        openIncident.severity = "down";
        openIncident.cause = cause;
        openIncident.timeline.push({ at: check.checkedAt, type: "escalated", message: cause });
        alert = { kind: "escalated", incidentId: openIncident._id };
      }
      await openIncident.save();
    } else if (consecutive >= (monitor.failureThreshold ?? 1)) {
      const incident = await Incident.create({
        monitorId: monitor._id,
        monitorName: monitor.name,
        severity: check.status as Exclude<CheckStatus, "up">,
        cause,
        startedAt: check.checkedAt,
        lastCheckAt: check.checkedAt,
        failedChecks: consecutive,
        timeline: [{ at: check.checkedAt, type: "opened", message: cause }],
      });
      update["state.openIncidentId"] = incident._id;
      alert = { kind: check.status === "down" ? "down" : "degraded", incidentId: incident._id };
    }
  } else if (openIncident && openIncident.status === "open") {
    openIncident.status = "resolved";
    openIncident.resolvedAt = check.checkedAt;
    openIncident.durationMs = check.checkedAt.getTime() - openIncident.startedAt.getTime();
    openIncident.timeline.push({ at: check.checkedAt, type: "resolved", message: "Monitor recovered" });
    await openIncident.save();
    update["state.openIncidentId"] = null;
    if (monitor.alerts?.notifyOnRecovery !== false) alert = { kind: "recovered", incidentId: openIncident._id };
  }

  await Monitor.updateOne({ _id: monitor._id }, { $set: update });
  if (alert && monitor.alerts?.webhookUrl) void deliverAlert(monitor, alert.kind, alert.incidentId);
};

const deliverAlert = async (monitor: MonitorDoc, kind: AlertKind, incidentId: Types.ObjectId): Promise<void> => {
  const incident = await Incident.findById(incidentId).lean();
  if (!incident || !monitor.alerts?.webhookUrl) return;
  const error = await sendWebhook(monitor.alerts.webhookUrl, {
    kind,
    monitor: { id: String(monitor._id), name: monitor.name, url: String((monitor.request as { url?: string }).url ?? "") },
    incident: {
      id: String(incident._id),
      severity: incident.severity,
      cause: incident.cause,
      startedAt: incident.startedAt,
      durationMs: incident.durationMs ?? undefined,
    },
  });
  await Incident.updateOne(
    { _id: incidentId },
    {
      $push: {
        timeline: error
          ? { at: new Date(), type: "alert_failed", message: error }
          : { at: new Date(), type: "alert_sent", message: `${kind} alert delivered` },
      },
    },
  );
};

// Closes every open incident for a monitor (used when a monitor is paused or deleted)
export const closeOpenIncident = async (monitorId: Types.ObjectId | string, reason: string): Promise<void> => {
  const now = new Date();
  for (const open of await Incident.find({ monitorId, status: "open" })) {
    open.status = "resolved";
    open.resolvedAt = now;
    open.durationMs = now.getTime() - open.startedAt.getTime();
    open.timeline.push({ at: now, type: "resolved", message: reason });
    await open.save();
  }
};
