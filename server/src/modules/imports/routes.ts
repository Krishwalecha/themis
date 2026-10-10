import { Router } from "express";
import { z } from "zod";
import { checkDocument } from "../../lib/contracts/validate";
import { isOpenApi } from "../../lib/contracts/openapi";
import { HttpError } from "../../lib/errors";
import { parseCurl } from "../../lib/importers/curl";
import { parseOpenApi } from "../../lib/importers/openapi";
import { isPostman, parsePostman, type ImportedCollection } from "../../lib/importers/postman";
import { Collection } from "../../models/Collection";
import { Contract, ContractVersion } from "../../models/Contract";
import { Environment } from "../../models/Environment";
import { parseDocument } from "../contracts/service";

const importBody = z.object({
  content: z.union([z.string().min(1).max(5_000_000), z.record(z.unknown())]),
  name: z.string().trim().min(1).max(100).optional(),
});

type NamedModel = { find: (filter: object, projection: object) => { lean: () => Promise<unknown> } };

// "Orders API", then "Orders API (2)", … since names are unique per account (case-insensitively)
const uniqueName = async (model: NamedModel, base: string): Promise<string> => {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}( \\(\\d+\\))?$`, "i");
  const taken = new Set(((await model.find({ name: pattern }, { name: 1 }).lean()) as { name: string }[]).map((d) => d.name.toLowerCase()));
  const free = (name: string) => !taken.has(name.toLowerCase());
  if (free(base)) return base;
  for (let i = 2; ; i++) if (free(`${base} (${i})`)) return `${base} (${i})`;
};

const looksLikeCurl = (v: unknown): v is string => typeof v === "string" && /^\s*curl(\.exe)?\s/i.test(v);

export const importsRouter = Router();

// one entry point: a curl command, a Postman collection, or an OpenAPI / Swagger document (JSON or YAML)
importsRouter.post("/", async (req, res) => {
  const body = importBody.parse(req.body);

  if (looksLikeCurl(body.content)) {
    try {
      const { spec, warnings } = parseCurl(body.content);
      res.json({ kind: "curl", request: spec, warnings });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    return;
  }

  const doc = parseDocument(body.content);
  let parsed: ImportedCollection;
  let kind: "postman" | "openapi";
  try {
    if (isPostman(doc)) {
      kind = "postman";
      parsed = parsePostman(doc as Record<string, unknown>);
    } else if (isOpenApi(doc)) {
      kind = "openapi";
      parsed = parseOpenApi(doc as Record<string, unknown>);
    } else {
      throw new HttpError(400, "Paste a curl command, a Postman collection (v2.x) or an OpenAPI / Swagger document");
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, (e as Error).message);
  }
  if (!parsed.requests.length) throw new HttpError(400, "Nothing to import: the file has no requests");

  const base = body.name ?? parsed.name;
  let contractId = null;
  if (kind === "openapi") {
    const problems = checkDocument("openapi", doc);
    if (!problems.length) {
      const contract = await Contract.create({ name: await uniqueName(Contract, base), kind: "openapi", document: doc, version: 1 });
      await ContractVersion.create({ contractId: contract._id, version: 1, document: doc, note: "Imported" });
      contractId = contract._id;
    } else {
      parsed.warnings.push(`No contract was created: ${problems[0]}`);
    }
  }

  const environment = parsed.variables.length
    ? await Environment.create({ name: await uniqueName(Environment, base), variables: parsed.variables.map((v) => ({ ...v, enabled: true })) })
    : null;

  const collection = await Collection.create({
    name: await uniqueName(Collection, base),
    description: kind === "openapi" ? "Imported from an OpenAPI document" : "Imported from Postman",
    environmentId: environment?._id ?? null,
    requests: parsed.requests.map((r) => ({ name: r.name, request: r.spec, contractId: r.contractRef ? contractId : null })),
  });

  res.status(201).json({
    kind,
    collection: { _id: collection._id, name: collection.name, requestCount: collection.requests.length },
    environment: environment && { _id: environment._id, name: environment.name, variables: environment.variables.length },
    contract: contractId && { _id: contractId },
    warnings: parsed.warnings,
  });
});
