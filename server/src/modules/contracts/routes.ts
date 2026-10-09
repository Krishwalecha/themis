import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { diffContracts } from "../../lib/contracts/diff";
import { inferContract } from "../../lib/contracts/infer";
import { listOperations, isOpenApi } from "../../lib/contracts/openapi";
import { checkDocument, type ContractKind } from "../../lib/contracts/validate";
import { HttpError, notFound } from "../../lib/errors";
import { objectId } from "../../lib/objectId";
import { Contract, ContractValidationLog, ContractVersion, type ContractDoc } from "../../models/Contract";
import { History } from "../../models/History";
import { Monitor } from "../../models/Monitor";
import { detectKind, loadContract, parseDocument, validateAndLog } from "./service";

const kindSchema = z.enum(["openapi", "jsonschema"]);
const idParams = z.object({ id: objectId });

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  kind: kindSchema.optional(),
  document: z.union([z.string().max(5_000_000), z.record(z.unknown())]),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  document: z.union([z.string().max(5_000_000), z.record(z.unknown())]).optional(),
  note: z.string().trim().max(500).optional(),
});

const sampleSchema = z.object({
  method: z.string().min(1).max(10),
  url: z.string().min(1).max(8192),
  status: z.number().int().min(0).max(999),
  body: z.string().max(10_000_000),
});

const validateBody = z.union([
  z.object({ historyId: objectId }),
  z.object({ response: sampleSchema, source: z.enum(["workspace", "manual"]).default("manual") }),
]);

const inferBody = z.union([
  z.object({ historyId: objectId, title: z.string().max(200).optional() }),
  z.object({ body: z.union([z.string().max(10_000_000), z.unknown()]), title: z.string().max(200).optional() }),
]);

const prepareDocument = (raw: unknown, kind?: ContractKind): { document: Record<string, unknown>; kind: ContractKind } => {
  const document = parseDocument(raw);
  const resolvedKind = kind ?? detectKind(document);
  const problems = checkDocument(resolvedKind, document);
  if (problems.length) throw new HttpError(400, problems[0], problems);
  return { document: document as Record<string, unknown>, kind: resolvedKind };
};

const summary = (contract: { kind: string; document: unknown }) => {
  if (contract.kind !== "openapi" || !isOpenApi(contract.document)) return { operations: [] };
  return { operations: listOperations(contract.document) };
};

const passRates = async (): Promise<Map<string, { total: number; valid: number }>> => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await ContractValidationLog.aggregate<{ _id: unknown; total: number; valid: number }>([
    { $match: { at: { $gte: since }, skipped: { $in: [null, undefined] } } },
    { $group: { _id: "$contractId", total: { $sum: 1 }, valid: { $sum: { $cond: ["$valid", 1, 0] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { total: r.total, valid: r.valid }]));
};

// The contract's current verdict: its newest real check (skipped ones say nothing about the API)
type Verdict = { valid: boolean; errorCount: number; at: Date; contractVersion: number | null };
const latestVerdicts = async (ids?: unknown[]): Promise<Map<string, Verdict>> => {
  const rows = await ContractValidationLog.aggregate<Verdict & { _id: unknown }>([
    { $match: { skipped: { $in: [null, undefined] }, ...(ids ? { contractId: { $in: ids } } : {}) } },
    { $sort: { at: -1 } },
    { $group: { _id: "$contractId", valid: { $first: "$valid" }, errorCount: { $first: "$errorCount" }, at: { $first: "$at" }, contractVersion: { $first: "$contractVersion" } } },
  ]);
  return new Map(rows.map(({ _id, ...v }) => [String(_id), { ...v, contractVersion: v.contractVersion ?? null }]));
};

// After a new version, re-check the newest response we still have against it, so the verdict is current straight away
const recheckLatest = async (contract: ContractDoc): Promise<void> => {
  const last = await ContractValidationLog.findOne({ contractId: contract._id, source: { $in: ["workspace", "history"] }, sourceId: { $ne: null } })
    .sort({ at: -1 })
    .lean();
  const entry = last?.sourceId ? await History.findById(last.sourceId).lean() : null;
  if (!entry?.response || entry.response.bodyEncoding !== "utf8") return;
  await validateAndLog(contract, { method: entry.method, url: entry.resolvedUrl ?? entry.url, status: entry.status, body: entry.response.body ?? "" }, "history", entry._id);
};

export const contractsRouter = Router();

contractsRouter.get("/", async (_req, res) => {
  const [contracts, rates, verdicts] = await Promise.all([Contract.find().sort({ updatedAt: -1 }).lean(), passRates(), latestVerdicts()]);
  res.json({
    items: contracts.map((c) => {
      const r = rates.get(String(c._id));
      const { document, ...rest } = c;
      return {
        ...rest,
        operationCount: summary(c).operations.length,
        title: (document as { info?: { title?: string }; title?: string }).info?.title ?? (document as { title?: string }).title,
        last24h: r ? { validations: r.total, passRate: Math.round((r.valid / r.total) * 10000) / 100 } : { validations: 0, passRate: null },
        lastValidation: verdicts.get(String(c._id)) ?? null,
      };
    }),
  });
});

// Generates a JSON Schema contract from a sample response body
contractsRouter.post("/infer", async (req, res) => {
  const input = inferBody.parse(req.body);
  let raw: unknown;
  let title = input.title;
  if ("historyId" in input) {
    const entry = await History.findById(input.historyId).lean();
    if (!entry) throw notFound("History entry");
    raw = entry.response?.body ?? "";
    title ??= entry.name ?? `${entry.method} ${entry.url}`;
  } else {
    raw = input.body;
  }
  let sample: unknown = raw;
  if (typeof raw === "string") {
    try {
      sample = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Sample body is not valid JSON");
    }
  }
  res.json({ kind: "jsonschema", document: inferContract(sample, title) });
});

// Preview what would change between two documents, without saving
contractsRouter.post("/diff", async (req, res) => {
  const { kind, before, after } = z.object({ kind: kindSchema.optional(), before: z.unknown(), after: z.unknown() }).parse(req.body);
  const a = prepareDocument(before, kind);
  const b = prepareDocument(after, kind ?? a.kind);
  const changes = diffContracts(a.kind, a.document, b.document);
  res.json({ changes, breakingCount: changes.filter((c) => c.breaking).length });
});

contractsRouter.post("/", async (req, res) => {
  const body = createBody.parse(req.body);
  const { document, kind } = prepareDocument(body.document, body.kind);
  const contract = await Contract.create({ name: body.name, description: body.description, kind, document, version: 1 });
  await ContractVersion.create({ contractId: contract._id, version: 1, document, note: "Initial version" });
  res.status(201).json({ ...contract.toObject(), ...summary(contract) });
});

contractsRouter.get("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const contract = await loadContract(id);
  const [linkedMonitors, verdicts] = await Promise.all([
    Monitor.find({ contractId: contract._id }, { name: 1, "state.status": 1 }).lean(),
    latestVerdicts([contract._id]),
  ]);
  res.json({ ...contract, ...summary(contract), linkedMonitors, lastValidation: verdicts.get(String(contract._id)) ?? null });
});

// Updating the document creates a new version and reports what changed (and what breaks clients)
contractsRouter.put("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = updateBody.parse(req.body);
  const contract = await Contract.findById(id);
  if (!contract) throw notFound("Contract");

  if (body.name !== undefined) contract.name = body.name;
  if (body.description !== undefined) contract.description = body.description;

  let changes: ReturnType<typeof diffContracts> = [];
  let versioned = false;
  if (body.document !== undefined) {
    const { document } = prepareDocument(body.document, contract.kind as ContractKind);
    if (JSON.stringify(document) !== JSON.stringify(contract.document)) {
      changes = diffContracts(contract.kind as ContractKind, contract.document, document);
      contract.version += 1;
      contract.document = document;
      contract.markModified("document");
      await ContractVersion.create({
        contractId: contract._id,
        version: contract.version,
        document,
        note: body.note,
        changes,
        breakingCount: changes.filter((c) => c.breaking).length,
      });
      versioned = true;
    }
  }
  await contract.save();
  if (versioned) await recheckLatest(contract.toObject() as ContractDoc).catch(() => undefined);
  const verdicts = await latestVerdicts([contract._id]);
  res.json({
    contract: { ...contract.toObject(), ...summary(contract), lastValidation: verdicts.get(String(contract._id)) ?? null },
    versioned,
    changes,
    breakingCount: changes.filter((c) => c.breaking).length,
  });
});

contractsRouter.get("/:id/versions", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const [versions, verdicts] = await Promise.all([
    ContractVersion.find({ contractId: id }, { document: 0 }).sort({ version: -1 }).lean(),
    // each version's verdict: the newest real check made against it
    ContractValidationLog.aggregate<{ _id: number; valid: boolean; errorCount: number; at: Date }>([
      { $match: { contractId: new Types.ObjectId(id), skipped: { $in: [null, undefined] } } },
      { $sort: { at: -1 } },
      { $group: { _id: "$contractVersion", valid: { $first: "$valid" }, errorCount: { $first: "$errorCount" }, at: { $first: "$at" } } },
    ]),
  ]);
  const byVersion = new Map(verdicts.map(({ _id, ...v }) => [_id, v]));
  res.json({ items: versions.map((v) => ({ ...v, verdict: byVersion.get(v.version) ?? null })) });
});

contractsRouter.get("/:id/versions/:version", async (req, res) => {
  const { id, version } = z.object({ id: objectId, version: z.coerce.number().int().min(1) }).parse(req.params);
  const v = await ContractVersion.findOne({ contractId: id, version }).lean();
  if (!v) throw notFound("Contract version");
  res.json(v);
});

contractsRouter.get("/:id/diff", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { from, to } = z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }).parse(req.query);
  const contract = await loadContract(id);
  const [a, b] = await Promise.all([
    ContractVersion.findOne({ contractId: id, version: from }).lean(),
    ContractVersion.findOne({ contractId: id, version: to }).lean(),
  ]);
  if (!a || !b) throw notFound("Contract version");
  const changes = diffContracts(contract.kind as ContractKind, a.document, b.document);
  res.json({ from, to, changes, breakingCount: changes.filter((c) => c.breaking).length });
});

// Validates a stored history entry or an ad-hoc response against the contract
contractsRouter.post("/:id/validate", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = validateBody.parse(req.body);
  const contract = await loadContract(id);

  if ("historyId" in input) {
    const entry = await History.findById(input.historyId).lean();
    if (!entry) throw notFound("History entry");
    const result = await validateAndLog(
      contract,
      { method: entry.method, url: entry.resolvedUrl, status: entry.status, body: entry.response?.body ?? "" },
      "history",
      entry._id,
    );
    res.json(result);
    return;
  }
  res.json(await validateAndLog(contract, input.response, input.source));
});

contractsRouter.get("/:id/validations", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { limit, invalidOnly, page } = z
    .object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      invalidOnly: z.coerce.boolean().default(false),
      // 1-based; the response then includes the total
      page: z.coerce.number().int().min(1).optional(),
    })
    .parse(req.query);
  const filter: Record<string, unknown> = { contractId: id };
  if (invalidOnly) filter.valid = false;
  const items = await ContractValidationLog.find(filter)
    .sort({ at: -1 })
    .skip(((page ?? 1) - 1) * limit)
    .limit(limit)
    .lean();
  res.json(page ? { items, total: await ContractValidationLog.countDocuments(filter) } : { items });
});

// deletes several at once; only the caller's own contracts are touched
contractsRouter.post("/bulk-delete", async (req, res) => {
  const { ids } = z.object({ ids: z.array(objectId).min(1).max(200) }).parse(req.body);
  const owned = (await Contract.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((c) => c._id);
  await Contract.deleteMany({ _id: { $in: owned } });
  await Promise.all([
    ContractVersion.deleteMany({ contractId: { $in: owned } }),
    ContractValidationLog.deleteMany({ contractId: { $in: owned } }),
    Monitor.updateMany({ contractId: { $in: owned } }, { $unset: { contractId: 1 } }),
  ]);
  res.json({ deleted: owned.length });
});

contractsRouter.delete("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const deleted = await Contract.findByIdAndDelete(id);
  if (!deleted) throw notFound("Contract");
  await Promise.all([
    ContractVersion.deleteMany({ contractId: id }),
    ContractValidationLog.deleteMany({ contractId: id }),
    Monitor.updateMany({ contractId: id }, { $unset: { contractId: 1 } }),
  ]);
  res.status(204).end();
});
