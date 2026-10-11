import { Router } from "express";
import type { Types } from "mongoose";
import { z } from "zod";
import { HttpError, notFound } from "../../lib/errors";
import { objectId } from "../../lib/objectId";
import { runAs, runUnscoped } from "../../lib/tenant";
import { Incident } from "../../models/Incident";
import { Monitor } from "../../models/Monitor";
import { StatusPage } from "../../models/StatusPage";
import { rateLimit } from "../auth/rateLimit";
import { bucketize, loadPoints, summarize } from "../monitors/stats";

const DAY = 24 * 3600_000;
const DAYS = 30;

const pageBody = z.object({
  enabled: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Use 3 to 40 lowercase letters, numbers or dashes"),
  title: z.string().trim().max(80).default(""),
  monitorIds: z.array(objectId).max(50).default([]),
});

// ---- the owner's settings (signed in) ----
export const statusPageRouter = Router();

statusPageRouter.get("/", async (_req, res) => {
  const page = await StatusPage.findOne().lean();
  res.json(page ?? { enabled: false, slug: "", title: "", monitorIds: [] });
});

statusPageRouter.put("/", async (req, res) => {
  const body = pageBody.parse(req.body);
  const taken = await runUnscoped(() => StatusPage.findOne({ slug: body.slug }, { _id: 1 }).lean().exec());
  const page = (await StatusPage.findOne()) ?? new StatusPage();
  if (taken && String(taken._id) !== String(page._id)) throw new HttpError(409, "That address is taken");
  // only monitors this account owns
  const monitorIds = (await Monitor.find({ _id: { $in: body.monitorIds } }, { _id: 1 }).lean()).map((m) => m._id);
  page.set({ ...body, monitorIds: body.monitorIds.filter((id) => monitorIds.some((m) => String(m) === id)) });
  await page.save();
  res.json(page.toObject());
});

// ---- the public page (no sign-in): names, health and incident timing only, never URLs or error details ----
export const publicRouter = Router();
const publicLimiter = rateLimit({ windowMs: 60_000, max: 120, name: "status page" });

publicRouter.get("/status/:slug", publicLimiter, async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  const page = await runUnscoped(() => StatusPage.findOne({ slug, enabled: true }).lean<{ ownerId?: Types.ObjectId | null; title: string; monitorIds: Types.ObjectId[] }>().exec());
  // never run unscoped on behalf of the public: a page without an owner shows nothing
  if (!page?.ownerId) throw notFound("Status page");

  const body = await runAs(page.ownerId, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - DAYS * DAY);
    const monitors = await Monitor.find({ _id: { $in: page.monitorIds } }, { name: 1, enabled: 1, "state.status": 1 }).lean();
    // keep the owner's chosen order
    monitors.sort((a, b) => page.monitorIds.findIndex((id) => String(id) === String(a._id)) - page.monitorIds.findIndex((id) => String(id) === String(b._id)));
    const ids = monitors.map((m) => m._id);
    const [points, incidents] = await Promise.all([
      loadPoints({ monitorId: { $in: ids } }, from),
      Incident.find({ monitorId: { $in: ids }, $or: [{ status: "open" }, { startedAt: { $gte: new Date(to.getTime() - 14 * DAY) } }] })
        .sort({ startedAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const rows = monitors.map((m) => {
      const mine = points.filter((p) => String(p.monitorId) === String(m._id));
      const status = !m.enabled ? "paused" : (m.state?.status ?? "pending");
      return {
        id: String(m._id),
        name: m.name,
        status,
        uptimePct: summarize(mine).uptimePct,
        days: bucketize(mine, from, to, DAYS).map((b) => ({ start: b.start, worst: b.worst, total: b.total, down: b.down, degraded: b.degraded })),
      };
    });
    const live = rows.filter((r) => r.status !== "paused");
    const overall = live.some((r) => r.status === "down") ? "down" : live.some((r) => r.status === "degraded") ? "degraded" : "operational";
    return {
      title: page.title || "Status",
      status: overall,
      updatedAt: to,
      monitors: rows,
      incidents: incidents.map((i) => ({
        id: String(i._id),
        monitorName: i.monitorName,
        severity: i.severity,
        status: i.status,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt ?? null,
        durationMs: i.durationMs ?? null,
      })),
    };
  });
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(body);
});
