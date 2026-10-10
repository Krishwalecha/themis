import { Router } from "express";
import { z } from "zod";
import { config } from "../../config";
import { generate, getAiProvider } from "../../lib/ai/provider";
import type { SummaryTask, TargetType } from "../../lib/ai/types";
import { notFound } from "../../lib/errors";
import { objectId } from "../../lib/objectId";
import { AiSummary } from "../../models/AiSummary";
import { Contract, ContractValidationLog } from "../../models/Contract";
import { History, type HistoryDoc } from "../../models/History";
import { Incident, type IncidentDoc } from "../../models/Incident";
import { Monitor, type MonitorDoc } from "../../models/Monitor";
import { MonitorCheck, type MonitorCheckDoc } from "../../models/MonitorCheck";
import { buildDashboard } from "../dashboard/routes";
import { monitorStats, WINDOWS, type WindowKey } from "../monitors/stats";
import { historyTask, monitorTask, opsTask, validationTask } from "./tasks";
import { rateLimit } from "../auth/rateLimit";

const windowSchema = z.enum(Object.keys(WINDOWS) as [WindowKey, ...WindowKey[]]).default("24h");

const body = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("history"), targetId: objectId, refresh: z.boolean().default(false) }),
  z.object({ targetType: z.literal("contractValidation"), targetId: objectId, refresh: z.boolean().default(false) }),
  z.object({ targetType: z.literal("monitor"), targetId: objectId, window: windowSchema, refresh: z.boolean().default(false) }),
  z.object({ targetType: z.literal("ops"), window: windowSchema, refresh: z.boolean().default(false) }),
]);
type Body = z.infer<typeof body>;

// Live data goes stale; fixed records (a stored response, a validation) never change
const MAX_AGE_MS: Record<TargetType, number> = {
  history: Infinity,
  contractValidation: Infinity,
  monitor: 10 * 60_000,
  ops: 10 * 60_000,
};

const targetKey = (b: Body): string => {
  switch (b.targetType) {
    case "history":
    case "contractValidation":
      return b.targetId;
    case "monitor":
      return `${b.targetId}:${b.window}`;
    case "ops":
      return `ops:${b.window}`;
  }
};

const buildTask = async (b: Body): Promise<SummaryTask> => {
  switch (b.targetType) {
    case "history": {
      const entry = await History.findById(b.targetId).lean<HistoryDoc>();
      if (!entry) throw notFound("History entry");
      // the contract check made on this run, so a broken contract shows up in the summary
      const check = await ContractValidationLog.findOne({ sourceId: entry._id }).sort({ at: -1 }).lean();
      const contract = check && (await Contract.findById(check.contractId, { name: 1 }).lean());
      return historyTask(
        entry,
        check && {
          name: contract?.name ?? "the contract",
          valid: Boolean(check.valid),
          skipped: check.skipped,
          errors: check.errors ?? [],
          drift: check.drift ?? [],
        },
      );
    }
    case "contractValidation": {
      const log = await ContractValidationLog.findById(b.targetId).lean();
      if (!log) throw notFound("Contract validation");
      const contract = await Contract.findById(log.contractId, { name: 1, kind: 1, version: 1 }).lean();
      return validationTask(log, {
        name: contract?.name ?? "Deleted contract",
        kind: contract?.kind ?? "jsonschema",
        version: log.contractVersion ?? contract?.version ?? 1,
      });
    }
    case "monitor": {
      const monitor = await Monitor.findById(b.targetId).lean<MonitorDoc>();
      if (!monitor) throw notFound("Monitor");
      const since = new Date(Date.now() - WINDOWS[b.window]);
      const [stats, failing, incidents] = await Promise.all([
        monitorStats(monitor._id, b.window),
        MonitorCheck.find({ monitorId: monitor._id, status: { $ne: "up" }, checkedAt: { $gte: since } })
          .sort({ checkedAt: -1 })
          .limit(200)
          .lean<MonitorCheckDoc[]>(),
        Incident.find({ monitorId: monitor._id, $or: [{ status: "open" }, { startedAt: { $gte: since } }] })
          .sort({ startedAt: -1 })
          .limit(20)
          .lean<IncidentDoc[]>(),
      ]);
      return monitorTask(monitor, stats, failing, incidents);
    }
    case "ops":
      return opsTask(await buildDashboard(b.window));
  }
};

export const aiRouter = Router();

aiRouter.get("/status", (_req, res) => {
  const provider = getAiProvider();
  res.json({
    provider: "groq",
    enabled: Boolean(provider),
    model: provider?.model ?? config.ai.model,
    fallback: "rule-based summaries are used when Groq is unavailable",
  });
});

// Returns a cached summary when fresh, otherwise generates (and caches) a new one
// each fresh summary is a paid model call
const summaryLimiter = rateLimit({ windowMs: 10 * 60_000, max: 30, name: "AI summary" });

aiRouter.post("/summaries", summaryLimiter, async (req, res) => {
  const b = body.parse(req.body);
  const key = targetKey(b);

  if (!b.refresh) {
    const cached = await AiSummary.findOne({ targetType: b.targetType, targetKey: key }).sort({ createdAt: -1 }).lean();
    // Don't keep serving a fallback once a model is configured.
    const usable = cached && !(cached.source === "heuristic" && getAiProvider());
    if (usable && Date.now() - new Date(cached.createdAt).getTime() < MAX_AGE_MS[b.targetType]) {
      res.json({ ...cached, cached: true });
      return;
    }
  }

  const task = await buildTask(b);
  const generated = await generate(task);
  const doc = await AiSummary.create({ targetType: b.targetType, targetKey: key, ...generated });
  res.json({ ...doc.toObject(), cached: false });
});
