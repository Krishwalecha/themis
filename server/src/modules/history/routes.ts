import { Router } from "express";
import type { FilterQuery } from "mongoose";
import { z } from "zod";
import { notFound } from "../../lib/errors";
import { objectId } from "../../lib/objectId";
import { History, type HistoryDoc } from "../../models/History";
import { HTTP_METHODS, requestSpecSchema } from "../../schemas/requestSpec";
import { runRequest } from "../requests/service";

const STATUS_RANGES = {
  "2xx": { $gte: 200, $lt: 300 },
  "3xx": { $gte: 300, $lt: 400 },
  "4xx": { $gte: 400, $lt: 500 },
  "5xx": { $gte: 500, $lt: 600 },
  error: 0,
} as const;

const listQuery = z.object({
  q: z.string().trim().max(500).optional(),
  method: z.enum(HTTP_METHODS).optional(),
  status: z.enum(["2xx", "3xx", "4xx", "5xx", "error"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Cursor: id of the last item from the previous page
  before: objectId.optional(),
  // Page number (1-based)
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});

const idParams = z.object({ id: objectId });
const rerunBody = z.object({ environmentId: objectId.nullish() }).default({});
const patchBody = z.object({ name: z.string().trim().max(200) });

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Fields returned by the list endpoint (everything except response bodies and raw request)
const LIST_PROJECTION = {
  name: 1,
  method: 1,
  url: 1,
  resolvedUrl: 1,
  status: 1,
  latencyMs: 1,
  sizeBytes: 1,
  errorCode: 1,
  environmentId: 1,
  rerunOf: 1,
  createdAt: 1,
} as const;

export const historyRouter = Router();

historyRouter.get("/", async (req, res) => {
  const { q, method, status, limit, before, page: pageNo } = listQuery.parse(req.query);
  const filter: FilterQuery<HistoryDoc> = {};
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ url: pattern }, { resolvedUrl: pattern }, { name: pattern }];
  }
  if (method) filter.method = method;
  if (status) filter.status = STATUS_RANGES[status];
  if (pageNo) {
    const [items, total] = await Promise.all([
      History.find(filter, LIST_PROJECTION)
        .sort({ _id: -1 })
        .skip((pageNo - 1) * limit)
        .limit(limit)
        .lean(),
      History.countDocuments(filter),
    ]);
    res.json({ items, total, page: pageNo, pageSize: limit, nextCursor: null });
    return;
  }
  if (before) filter._id = { $lt: before };

  const items = await History.find(filter, LIST_PROJECTION)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  res.json({ items: page, nextCursor: hasMore ? String(page[page.length - 1]._id) : null });
});

historyRouter.get("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const entry = await History.findById(id).lean();
  if (!entry) throw notFound("History entry");
  res.json(entry);
});

// Re-executes a stored request, optionally against a different environment, as a new history entry
historyRouter.post("/:id/rerun", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { environmentId } = rerunBody.parse(req.body ?? {});
  const entry = await History.findById(id).lean();
  if (!entry) throw notFound("History entry");

  const outcome = await runRequest({
    spec: requestSpecSchema.parse(entry.request),
    // `undefined` reuses the original environment; `null` explicitly runs without one.
    environmentId:
      environmentId === undefined ? entry.environmentId?.toString() : (environmentId ?? undefined),
    name: entry.name ?? undefined,
    rerunOf: entry._id,
  });
  res.json(outcome);
});

historyRouter.patch("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { name } = patchBody.parse(req.body);
  const entry = await History.findByIdAndUpdate(id, { name: name || undefined }, { new: true, projection: LIST_PROJECTION }).lean();
  if (!entry) throw notFound("History entry");
  res.json(entry);
});

historyRouter.delete("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const deleted = await History.findByIdAndDelete(id);
  if (!deleted) throw notFound("History entry");
  res.status(204).end();
});

historyRouter.post("/bulk-delete", async (req, res) => {
  const { ids } = z.object({ ids: z.array(objectId).min(1).max(500) }).parse(req.body);
  const { deletedCount } = await History.deleteMany({ _id: { $in: ids } });
  res.json({ deleted: deletedCount });
});

historyRouter.delete("/", async (_req, res) => {
  const { deletedCount } = await History.deleteMany({});
  res.json({ deleted: deletedCount });
});
