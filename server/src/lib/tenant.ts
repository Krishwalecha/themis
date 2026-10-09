import { AsyncLocalStorage } from "node:async_hooks";
import { Schema, Types } from "mongoose";

// Per-user data isolation
interface TenantContext {
  ownerId: Types.ObjectId | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

export const currentOwner = (): Types.ObjectId | null => {
  return storage.getStore()?.ownerId ?? null;
};

export const runAs = <T>(ownerId: Types.ObjectId | string | null | undefined, fn: () => T): T => {
  const id = ownerId ? new Types.ObjectId(String(ownerId)) : null;
  return storage.run({ ownerId: id }, fn);
};

// Runs `fn` with no tenant scope, e.g
export const runUnscoped = <T>(fn: () => T): T => {
  return storage.run({ ownerId: null }, fn);
};

const QUERY_HOOKS = [
  "countDocuments",
  "deleteMany",
  "deleteOne",
  "distinct",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
] as const;

// Adds an indexed `ownerId` and scopes every operation to the current tenant
export const owned = (schema: Schema): void => {
  schema.add({ ownerId: { type: Schema.Types.ObjectId, ref: "User", index: true, default: null } });

  for (const hook of QUERY_HOOKS) {
    schema.pre(hook, function () {
      const owner = currentOwner();
      if (owner) this.where({ ownerId: owner });
    });
  }

  schema.pre("save", function () {
    const owner = currentOwner();
    if (owner && this.isNew && !this.get("ownerId")) this.set("ownerId", owner);
  });

  schema.pre("insertMany", function (next: (err?: Error) => void, docs: unknown) {
    const owner = currentOwner();
    if (owner) {
      for (const d of Array.isArray(docs) ? docs : [docs]) {
        const doc = d as { ownerId?: unknown; set?: (k: string, v: unknown) => void };
        if (doc.ownerId) continue;
        if (typeof doc.set === "function") doc.set("ownerId", owner);
        else doc.ownerId = owner;
      }
    }
    next();
  });

  schema.pre("aggregate", function () {
    const owner = currentOwner();
    if (owner) this.pipeline().unshift({ $match: { ownerId: owner } });
  });
};
