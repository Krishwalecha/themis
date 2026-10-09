import { fullFormats } from "ajv-formats/dist/formats";
import { isObject, type JsonSchema } from "./schema";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URI = /^https?:\/\/\S+$/;

// The same checks the validator runs, so a contract inferred from a response always accepts that response
const accepts = (format: string, s: string): boolean => {
  const f = fullFormats[format as keyof typeof fullFormats] as unknown;
  if (typeof f === "function") return (f as (v: string) => boolean)(s);
  if (f instanceof RegExp) return f.test(s);
  const v = (f as { validate?: unknown } | undefined)?.validate;
  return v instanceof RegExp ? v.test(s) : typeof v === "function" ? Boolean(v(s)) : false;
};

const stringFormat = (s: string): string | undefined => {
  const guess = ISO_DATE_TIME.test(s)
    ? "date-time"
    : DATE.test(s)
      ? "date"
      : UUID.test(s)
        ? "uuid"
        : EMAIL.test(s)
          ? "email"
          : URI.test(s)
            ? // links like GitHub's ".../search/code?q={query}{&page}" are URI templates, not URIs
              /[{}]/.test(s)
              ? "uri-template"
              : "uri"
            : undefined;
  return guess && accepts(guess, s) ? guess : undefined;
};

const typeList = (s: JsonSchema): string[] => {
  return Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === "string" ? [s.type] : [];
};

// Infers a JSON Schema (draft-07) describing a sample value
export const inferSchema = (value: unknown): JsonSchema => {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map(inferSchema);
    return { type: "array", items: items.length ? items.reduce(mergeSchemas) : {} };
  }
  if (isObject(value)) {
    const properties: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(value)) properties[k] = inferSchema(v);
    return { type: "object", properties, required: Object.keys(value) };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  const format = stringFormat(String(value));
  return format ? { type: "string", format } : { type: "string" };
};

// Merges two inferred schemas (e.g
const mergeSchemas = (a: JsonSchema, b: JsonSchema): JsonSchema => {
  const types = new Set([...typeList(a), ...typeList(b)]);
  if (types.has("integer") && types.has("number")) types.delete("integer");

  const out: JsonSchema = { type: types.size === 1 ? [...types][0] : [...types] };

  if (types.has("object")) {
    const pa = (isObject(a.properties) ? a.properties : {}) as Record<string, JsonSchema>;
    const pb = (isObject(b.properties) ? b.properties : {}) as Record<string, JsonSchema>;
    const properties: Record<string, JsonSchema> = {};
    for (const key of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      properties[key] = pa[key] && pb[key] ? mergeSchemas(pa[key], pb[key]) : (pa[key] ?? pb[key]);
    }
    out.properties = properties;
    // A field stays required only if every object shape had it.
    const ra = typeList(a).includes("object") ? new Set((a.required as string[]) ?? []) : null;
    const rb = typeList(b).includes("object") ? new Set((b.required as string[]) ?? []) : null;
    const required = ra && rb ? [...ra].filter((k) => rb.has(k)) : [...(ra ?? rb ?? [])];
    if (required.length) out.required = required;
  }
  if (types.has("array")) {
    const ia = isObject(a.items) && Object.keys(a.items).length ? (a.items as JsonSchema) : null;
    const ib = isObject(b.items) && Object.keys(b.items).length ? (b.items as JsonSchema) : null;
    out.items = ia && ib ? mergeSchemas(ia, ib) : (ia ?? ib ?? {});
  }
  if (a.format && a.format === b.format) out.format = a.format;
  return out;
};

// An inferred schema with a `$schema` header, ready to save as a JSON Schema contract
export const inferContract = (sample: unknown, title?: string): JsonSchema => {
  return { $schema: "http://json-schema.org/draft-07/schema#", ...(title ? { title } : {}), ...inferSchema(sample) };
};
