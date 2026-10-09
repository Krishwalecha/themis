import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { isOpenApi, jsonSchemaOf, matchOperation, openApiVersion, responseFor } from "./openapi";
import { dereference, flattenAllOf, isObject, normalizeOpenApiSchema, type JsonSchema } from "./schema";

export type ContractKind = "jsonschema" | "openapi";

interface ContractError {
  path: string;
  message: string;
  keyword: string;
}

interface DriftItem {
  path: string;
  kind: "undocumented";
  message: string;
}

export interface ContractValidation {
  valid: boolean;
  // Set when the contract could not be applied (no matching operation, non-JSON body…)
  skipped?: string;
  matched?: { path: string; method: string; status: string };
  errors: ContractError[];
  drift: DriftItem[];
}

export interface ResponseSample {
  method: string;
  url: string;
  status: number;
  body: string;
}

const makeAjv = (draft2020: boolean): Ajv => {
  const ajv = draft2020
    ? new Ajv2020({ allErrors: true, strict: false, logger: false })
    : new Ajv({ allErrors: true, strict: false, logger: false });
  addFormats(ajv);
  // OpenAPI numeric/binary formats aren't part of JSON Schema.
  ajv.addFormat("int32", { type: "number", validate: (n: number) => Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31 });
  ajv.addFormat("int64", { type: "number", validate: (n: number) => Number.isInteger(n) });
  ajv.addFormat("float", { type: "number", validate: () => true });
  ajv.addFormat("double", { type: "number", validate: () => true });
  for (const f of ["byte", "binary", "password"]) ajv.addFormat(f, true);
  return ajv;
};

const ajv07 = makeAjv(false);
const ajv2020 = makeAjv(true);

// Compiled validators keyed by a caller-provided cache key (contract version + operation)
const cache = new Map<string, ValidateFunction>();
const CACHE_LIMIT = 500;

const uses2020 = (schema: JsonSchema, openapi?: string): boolean => {
  if (openapi?.startsWith("3.1")) return true;
  return typeof schema.$schema === "string" && /2020-12|2019-09/.test(schema.$schema);
};

const compile = (schema: JsonSchema, draft2020: boolean, cacheKey?: string): ValidateFunction => {
  const cached = cacheKey ? cache.get(cacheKey) : undefined;
  if (cached) return cached;
  const { $schema: _schema, $id: _id, ...rest } = schema;
  const fn = (draft2020 ? ajv2020 : ajv07).compile(rest);
  if (cacheKey) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, fn);
  }
  return fn;
};

const formatError = (e: ErrorObject): ContractError => {
  const path = e.instancePath || "/";
  const params = e.params as Record<string, unknown>;
  let message = e.message ?? "is invalid";
  if (e.keyword === "additionalProperties") message = `has unexpected property "${String(params.additionalProperty)}"`;
  else if (e.keyword === "required") message = `is missing required property "${String(params.missingProperty)}"`;
  else if (e.keyword === "enum") message = `must be one of ${JSON.stringify(params.allowedValues)}`;
  else if (e.keyword === "type") message = `must be ${String(params.type)}`;
  return { path, message, keyword: e.keyword };
};

const dedupeErrors = (errors: ContractError[]): ContractError[] => {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.path}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Collapse array indices so one undocumented field across 50 items is reported once
const dedupeDrift = (items: DriftItem[]): DriftItem[] => {
  const seen = new Map<string, DriftItem>();
  for (const item of items) {
    const key = item.path.replace(/\/\d+(?=\/|$)/g, "/*");
    if (!seen.has(key)) seen.set(key, { ...item, path: key });
  }
  return [...seen.values()];
};

// Fields present in the data but not described by the schema (when extra properties are allowed)
export const findDrift = (schema: unknown, data: unknown, path = ""): DriftItem[] => {
  if (!isObject(schema)) return [];
  const s = flattenAllOf(schema);
  const out: DriftItem[] = [];
  if (Array.isArray(data)) {
    if (isObject(s.items)) data.slice(0, 50).forEach((item, i) => out.push(...findDrift(s.items, item, `${path}/${i}`)));
  } else if (isObject(data) && isObject(s.properties) && s.additionalProperties !== false) {
    for (const [key, value] of Object.entries(data)) {
      const child = (s.properties as Record<string, unknown>)[key];
      if (child === undefined) {
        out.push({ path: `${path}/${key}`, kind: "undocumented", message: `"${key}" is returned but not documented` });
      } else {
        out.push(...findDrift(child, value, `${path}/${key}`));
      }
    }
  }
  return dedupeDrift(out);
};

// Checks a contract document before it is saved
export const checkDocument = (kind: ContractKind, doc: unknown): string[] => {
  if (!isObject(doc)) return ["Document must be a JSON/YAML object"];
  if (kind === "openapi") {
    return isOpenApi(doc) ? [] : ['Not an OpenAPI document: expected an "openapi" (or "swagger") version and "paths"'];
  }
  try {
    compile(normalizeOpenApiSchema(dereference(doc)) as JsonSchema, uses2020(doc));
    return [];
  } catch (e) {
    return [`Invalid JSON Schema: ${(e as Error).message}`];
  }
};

const runSchema = (schema: JsonSchema, draft2020: boolean, data: unknown, cacheKey?: string) => {
  const validate = compile(schema, draft2020, cacheKey);
  const valid = validate(data) as boolean;
  const errors = valid ? [] : dedupeErrors((validate.errors ?? []).map(formatError));
  return { valid, errors, drift: findDrift(schema, data) };
};

const safePath = (url: string): string => {
  try {
    return new URL(url, "http://placeholder").pathname;
  } catch {
    return url;
  }
};

// Validates a response body against a contract
export const validateResponse = (kind: ContractKind, doc: unknown, sample: ResponseSample, cacheKey?: string): ContractValidation => {
  let data: unknown;
  try {
    data = sample.body.trim() === "" ? null : JSON.parse(sample.body);
  } catch {
    return { valid: false, skipped: "Response body is not JSON", errors: [], drift: [] };
  }

  if (kind === "jsonschema") {
    if (!isObject(doc)) return { valid: false, skipped: "Contract document is not a schema", errors: [], drift: [] };
    const schema = normalizeOpenApiSchema(dereference(doc)) as JsonSchema;
    return runSchema(schema, uses2020(doc), data, cacheKey);
  }

  if (!isOpenApi(doc)) return { valid: false, skipped: "Contract is not a valid OpenAPI document", errors: [], drift: [] };
  const op = matchOperation(doc, sample.method, sample.url);
  if (!op) {
    return {
      valid: false,
      skipped: `No operation for ${sample.method.toUpperCase()} ${safePath(sample.url)} in the spec`,
      errors: [],
      drift: [],
    };
  }
  const response = responseFor(op.operation, sample.status);
  const matched = { path: op.path, method: op.method.toUpperCase(), status: response?.key ?? String(sample.status) };
  if (!response) {
    return {
      valid: false,
      matched,
      errors: [{ path: "/", keyword: "status", message: `status ${sample.status} is not documented for ${matched.method} ${op.path}` }],
      drift: [],
    };
  }
  const raw = jsonSchemaOf(response.response);
  if (!raw) return { valid: true, matched, skipped: "This response has no JSON schema in the spec", errors: [], drift: [] };
  const schema = normalizeOpenApiSchema(dereference(raw, doc)) as JsonSchema;
  const key = cacheKey ? `${cacheKey}|${op.method}|${op.path}|${response.key}` : undefined;
  return { ...runSchema(schema, uses2020({}, openApiVersion(doc)), data, key), matched };
};
