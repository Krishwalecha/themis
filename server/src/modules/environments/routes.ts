import { Router } from "express";
import { z } from "zod";
import { HttpError, notFound } from "../../lib/errors";
import { objectId } from "../../lib/objectId";
import { Environment } from "../../models/Environment";

const VARIABLE_NAME = /^[A-Za-z0-9_.\-]+$/;

const variableSchema = z.object({
  key: z.string().trim().min(1).max(200).regex(VARIABLE_NAME, "Use letters, numbers, _ . or -"),
  value: z.string().max(64 * 1024).default(""),
  enabled: z.boolean().default(true),
  secret: z.boolean().default(false),
});

const environmentBody = z.object({
  name: z.string().trim().min(1).max(100),
  variables: z
    .array(variableSchema)
    .max(500)
    .default([])
    .refine((vars) => new Set(vars.map((v) => v.key)).size === vars.length, "Variable names must be unique"),
});

const idParams = z.object({ id: objectId });

const MASK = "••••••";

const mask = <T extends { variables: { secret?: boolean | null; value?: string | null }[] }>(env: T): T => {
  return { ...env, variables: env.variables.map((v) => (v.secret ? { ...v, value: MASK } : v)) };
};

const assertUniqueName = async (name: string, excludeId?: string) => {
  const existing = await Environment.findOne({ name }).collation({ locale: "en", strength: 2 }).lean();
  if (existing && String(existing._id) !== excludeId) {
    throw new HttpError(409, `An environment named "${name}" already exists`);
  }
};

export const environmentsRouter = Router();

environmentsRouter.get("/", async (_req, res) => {
  const envs = await Environment.find().sort({ name: 1 }).lean();
  res.json({ items: envs.map(mask) });
});

// Secrets are write-only: once saved, their values never leave the server
environmentsRouter.get("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const env = await Environment.findById(id).lean();
  if (!env) throw notFound("Environment");
  res.json(mask(env));
});

environmentsRouter.post("/", async (req, res) => {
  const body = environmentBody.parse(req.body);
  await assertUniqueName(body.name);
  const env = await Environment.create(body);
  res.status(201).json(mask(env.toObject()));
});

environmentsRouter.put("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = environmentBody.parse(req.body);
  await assertUniqueName(body.name, id);

  const existing = await Environment.findById(id);
  if (!existing) throw notFound("Environment");

  // A masked secret sent back unchanged keeps its stored value, and stays secret: un-ticking "secret" without
  // typing a new value can't be used to reveal it.
  const previous = new Map(existing.variables.filter((v) => v.secret).map((v) => [v.key, v.value]));
  existing.name = body.name;
  existing.set(
    "variables",
    body.variables.map((v) => (v.value === MASK && previous.has(v.key) ? { ...v, value: previous.get(v.key) ?? "", secret: true } : v)),
  );
  await existing.save();
  res.json(mask(existing.toObject()));
});

environmentsRouter.post("/:id/duplicate", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const env = await Environment.findById(id).lean();
  if (!env) throw notFound("Environment");
  let name = `${env.name} copy`;
  for (let n = 2; await Environment.exists({ name }); n++) name = `${env.name} copy ${n}`;
  const copy = await Environment.create({ name, variables: env.variables });
  res.status(201).json(mask(copy.toObject()));
});

environmentsRouter.delete("/:id", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const deleted = await Environment.findByIdAndDelete(id);
  if (!deleted) throw notFound("Environment");
  res.status(204).end();
});
