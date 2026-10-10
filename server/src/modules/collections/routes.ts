import { Router } from "express";
import { z } from "zod";
import { HttpError, notFound } from "../../lib/errors";
import { objectId } from "../../lib/objectId";
import { Collection } from "../../models/Collection";
import { requestSpecSchema } from "../../schemas/requestSpec";
import { extractionSchema } from "../../schemas/testing";
import { runCollection } from "./service";

const idParams = z.object({ id: objectId });
const requestParams = z.object({ id: objectId, rid: objectId });

const collectionBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  environmentId: objectId.nullish(),
});

const savedRequestBody = z.object({
  name: z.string().trim().min(1).max(200),
  request: requestSpecSchema,
  contractId: objectId.nullish(),
  // left out, a save keeps the request's existing rules (the workspace doesn't edit them)
  extract: z.array(extractionSchema).max(20).optional(),
});

const runQuery = z.object({ strict: z.enum(["1", "true"]).optional(), environmentId: objectId.optional() });

const summary = (c: { _id: unknown; name: string; description?: string | null; environmentId?: unknown; requests: unknown[]; updatedAt?: Date }) => ({
  _id: c._id,
  name: c.name,
  description: c.description ?? "",
  environmentId: c.environmentId ?? null,
  requestCount: c.requests.length,
  // just enough of each request for search and menus
  requests: (c.requests as { _id: unknown; name: string; request: { method?: string; url?: string } }[]).map((r) => ({
    _id: r._id,
    name: r.name,
    method: r.request?.method ?? "GET",
    url: r.request?.url ?? "",
  })),
  updatedAt: c.updatedAt,
});

const load = async (id: string) => {
  const c = await Collection.findById(id);
  if (!c) throw notFound("Collection");
  return c;
};

const assertUniqueName = async (name: string, excludeId?: string) => {
  const existing = await Collection.findOne({ name }).collation({ locale: "en", strength: 2 }).lean();
  if (existing && String(existing._id) !== excludeId) throw new HttpError(409, `A collection named "${name}" already exists`);
};

export const collectionsRouter = Router();

collectionsRouter.get("/", async (_req, res) => {
  const items = await Collection.find().sort({ name: 1 }).lean();
  res.json({ items: items.map(summary) });
});

collectionsRouter.post("/", async (req, res) => {
  const body = collectionBody.parse(req.body);
  await assertUniqueName(body.name);
  res.status(201).json((await Collection.create(body)).toObject());
});

collectionsRouter.get("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json((await load(id)).toObject());
});

collectionsRouter.put("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = collectionBody.parse(req.body);
  await assertUniqueName(body.name, id);
  const c = await load(id);
  c.set(body);
  await c.save();
  res.json(c.toObject());
});

// deletes several at once; only the caller's own collections are touched
collectionsRouter.post("/bulk-delete", async (req, res) => {
  const { ids } = z.object({ ids: z.array(objectId).min(1).max(200) }).parse(req.body);
  const { deletedCount } = await Collection.deleteMany({ _id: { $in: ids } });
  res.json({ deleted: deletedCount });
});

collectionsRouter.delete("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const deleted = await Collection.findByIdAndDelete(id);
  if (!deleted) throw notFound("Collection");
  res.status(204).end();
});

collectionsRouter.post("/:id/requests", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = savedRequestBody.parse(req.body);
  const c = await load(id);
  if (c.requests.length >= 200) throw new HttpError(400, "A collection holds up to 200 requests");
  c.requests.push(body);
  await c.save();
  res.status(201).json(c.requests[c.requests.length - 1].toObject());
});

collectionsRouter.put("/:id/requests/:rid", async (req, res) => {
  const { id, rid } = requestParams.parse(req.params);
  const body = savedRequestBody.parse(req.body);
  const c = await load(id);
  const r = c.requests.id(rid);
  if (!r) throw notFound("Request");
  r.set(body.extract ? body : { ...body, extract: r.get("extract") });
  await c.save();
  res.json(r.toObject());
});

collectionsRouter.delete("/:id/requests/:rid", async (req, res) => {
  const { id, rid } = requestParams.parse(req.params);
  const c = await load(id);
  const r = c.requests.id(rid);
  if (!r) throw notFound("Request");
  r.deleteOne();
  await c.save();
  res.status(204).end();
});

collectionsRouter.post("/:id/reorder", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { ids } = z.object({ ids: z.array(objectId) }).parse(req.body);
  const c = await load(id);
  const byId = new Map(c.requests.map((r) => [String(r._id), r]));
  if (ids.length !== c.requests.length || ids.some((x) => !byId.has(x))) throw new HttpError(400, "Send every request id exactly once");
  c.set("requests", ids.map((x) => byId.get(x)!.toObject()));
  await c.save();
  res.json(c.toObject());
});

// runs every request in order; ?strict=1 answers 422 when any of them fails
collectionsRouter.post("/:id/run", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { strict, environmentId } = runQuery.parse(req.query);
  const run = await runCollection(await load(id), { environmentId });
  res.status(strict && run.failed > 0 ? 422 : 200).json(run);
});
