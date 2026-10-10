import { Router } from "express";
import { z } from "zod";
import { notFound } from "../../lib/errors";
import { objectId } from "../../lib/objectId";
import { Incident } from "../../models/Incident";

const listQuery = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  monitorId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: objectId.optional(),
  // Page number (1-based)
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});

export const incidentsRouter = Router();

incidentsRouter.get("/", async (req, res) => {
  const { status, monitorId, limit, before, page: pageNo } = listQuery.parse(req.query);
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (monitorId) filter.monitorId = monitorId;
  if (pageNo) {
    const [items, total] = await Promise.all([
      Incident.find(filter).sort({ _id: -1 }).skip((pageNo - 1) * limit).limit(limit).lean(),
      Incident.countDocuments(filter),
    ]);
    res.json({ items, total, page: pageNo, pageSize: limit, nextCursor: null });
    return;
  }
  if (before) filter._id = { $lt: before };
  const items = await Incident.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  res.json({ items: page, nextCursor: hasMore ? String(page[page.length - 1]._id) : null });
});

incidentsRouter.get("/:id", async (req, res) => {
  const { id } = z.object({ id: objectId }).parse(req.params);
  const incident = await Incident.findById(id).lean();
  if (!incident) throw notFound("Incident");
  res.json(incident);
});
