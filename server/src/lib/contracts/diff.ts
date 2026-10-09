import {
  HTTP_OPERATIONS,
  isOpenApi,
  jsonSchemaOf,
  requestBodySchemaOf,
} from "./openapi";
import { dereference, flattenAllOf, isObject, normalizeOpenApiSchema, typesOf, type JsonSchema } from "./schema";
import type { ContractKind } from "./validate";

interface ContractChange {
  // Where in the API the change applies, e.g
  location: string;
  // JSON-pointer-ish path inside the payload, e.g
  path: string;
  type:
    | "operation-removed"
    | "operation-added"
    | "response-removed"
    | "response-added"
    | "parameter-added"
    | "parameter-removed"
    | "parameter-required"
    | "property-removed"
    | "property-added"
    | "required-added"
    | "required-removed"
    | "type-changed"
    | "enum-changed"
    | "format-changed";
  breaking: boolean;
  message: string;
}

// Payload direction decides what breaks clients
type Direction = "response" | "request";

const MAX_DEPTH = 30;

const prepare = (schema: unknown, root?: unknown): JsonSchema => {
  if (!isObject(schema)) return {};
  return flattenAllOf(normalizeOpenApiSchema(dereference(schema, root ?? schema)) as JsonSchema);
};

const diffSchema = (a: JsonSchema, b: JsonSchema, path: string, dir: Direction, location: string, out: ContractChange[], depth = 0): void => {
  if (depth > MAX_DEPTH) return;
  a = flattenAllOf(a);
  b = flattenAllOf(b);
  const at = path || "/";
  const push = (c: Omit<ContractChange, "location" | "path">) => out.push({ location, path: at, ...c });

  // Types
  const ta = new Set(typesOf(a));
  const tb = new Set(typesOf(b));
  if (ta.size && tb.size) {
    const added = [...tb].filter((t) => !ta.has(t) && !(t === "integer" && ta.has("number")));
    const removed = [...ta].filter((t) => !tb.has(t) && !(t === "integer" && tb.has("number")));
    if (added.length || removed.length) {
      const breaking = dir === "response" ? added.length > 0 : removed.length > 0;
      push({ type: "type-changed", breaking, message: `type changed from ${[...ta].join("|")} to ${[...tb].join("|")}` });
    }
  }

  // Enums
  if (Array.isArray(a.enum) || Array.isArray(b.enum)) {
    const ea = Array.isArray(a.enum) ? a.enum.map((v) => JSON.stringify(v)) : null;
    const eb = Array.isArray(b.enum) ? b.enum.map((v) => JSON.stringify(v)) : null;
    const added = ea && eb ? eb.filter((v) => !ea.includes(v)) : !ea ? [] : null; // null = enum removed entirely (open set)
    const removed = ea && eb ? ea.filter((v) => !eb.includes(v)) : !eb ? [] : ea ?? [];
    if (added === null) {
      push({ type: "enum-changed", breaking: dir === "response", message: "enum restriction removed (any value now allowed)" });
    } else if (!ea && eb) {
      push({ type: "enum-changed", breaking: dir === "request", message: `now restricted to ${eb.join(", ")}` });
    } else {
      if (added.length) push({ type: "enum-changed", breaking: dir === "response", message: `new enum value(s) ${added.join(", ")}` });
      if (removed.length) push({ type: "enum-changed", breaking: dir === "request", message: `enum value(s) removed: ${removed.join(", ")}` });
    }
  }

  // Formats
  if (typeof a.format === "string" && a.format !== b.format) {
    push({ type: "format-changed", breaking: true, message: `format changed from ${a.format} to ${String(b.format ?? "none")}` });
  }

  // Object properties
  const pa = isObject(a.properties) ? (a.properties as Record<string, JsonSchema>) : null;
  const pb = isObject(b.properties) ? (b.properties as Record<string, JsonSchema>) : null;
  if (pa || pb) {
    const propsA = pa ?? {};
    const propsB = pb ?? {};
    const ra = new Set<string>(Array.isArray(a.required) ? (a.required as string[]) : []);
    const rb = new Set<string>(Array.isArray(b.required) ? (b.required as string[]) : []);
    for (const key of Object.keys(propsA)) {
      const child = `${path}/${key}`;
      if (!(key in propsB)) {
        const breaking = dir === "response" ? true : b.additionalProperties === false;
        out.push({ location, path: child, type: "property-removed", breaking, message: `property "${key}" removed` });
        continue;
      }
      if (ra.has(key) && !rb.has(key)) {
        out.push({ location, path: child, type: "required-removed", breaking: dir === "response", message: `"${key}" is no longer required (may be missing)` });
      } else if (!ra.has(key) && rb.has(key)) {
        out.push({ location, path: child, type: "required-added", breaking: dir === "request", message: `"${key}" is now required` });
      }
      diffSchema(propsA[key], propsB[key], child, dir, location, out, depth + 1);
    }
    for (const key of Object.keys(propsB)) {
      if (key in propsA) continue;
      const required = rb.has(key);
      out.push({
        location,
        path: `${path}/${key}`,
        type: "property-added",
        breaking: dir === "request" && required,
        message: `property "${key}" added${required ? " (required)" : ""}`,
      });
    }
  }

  // Array items
  if (isObject(a.items) && isObject(b.items)) {
    diffSchema(a.items as JsonSchema, b.items as JsonSchema, `${path}[]`, dir, location, out, depth + 1);
  }
};

// Diffs two JSON Schemas describing a response payload
export const diffSchemas = (before: unknown, after: unknown, dir: Direction = "response", location = ""): ContractChange[] => {
  const out: ContractChange[] = [];
  diffSchema(prepare(before), prepare(after), "", dir, location, out);
  return out;
};

interface Param {
  name: string;
  in: string;
  required: boolean;
}

const paramsOf = (pathItem: Record<string, unknown>, op: Record<string, unknown>): Map<string, Param> => {
  const all = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])];
  const map = new Map<string, Param>();
  for (const p of all) {
    if (isObject(p) && typeof p.name === "string") {
      map.set(`${String(p.in)}:${p.name}`, { name: p.name, in: String(p.in), required: p.required === true || p.in === "path" });
    }
  }
  return map;
};

// Diffs two OpenAPI documents: operations, parameters, request bodies and response schemas
const diffOpenApi = (before: unknown, after: unknown): ContractChange[] => {
  if (!isOpenApi(before) || !isOpenApi(after)) return [];
  const a = dereference(before);
  const b = dereference(after);
  const pathsA = a.paths as Record<string, Record<string, unknown>>;
  const pathsB = b.paths as Record<string, Record<string, unknown>>;
  const out: ContractChange[] = [];

  for (const [path, itemA] of Object.entries(pathsA)) {
    if (!isObject(itemA)) continue;
    const itemB = isObject(pathsB[path]) ? pathsB[path] : null;
    for (const method of HTTP_OPERATIONS) {
      const opA = itemA[method];
      if (!isObject(opA)) continue;
      const location = `${method.toUpperCase()} ${path}`;
      const opB = itemB && isObject(itemB[method]) ? (itemB[method] as Record<string, unknown>) : null;
      if (!opB) {
        out.push({ location, path: "", type: "operation-removed", breaking: true, message: `${location} was removed` });
        continue;
      }

      // Parameters
      const pa = paramsOf(itemA, opA);
      const pb = paramsOf(itemB!, opB);
      for (const [key, p] of pa) {
        if (!pb.has(key)) out.push({ location, path: "", type: "parameter-removed", breaking: false, message: `${p.in} parameter "${p.name}" removed` });
        else if (!p.required && pb.get(key)!.required) {
          out.push({ location, path: "", type: "parameter-required", breaking: true, message: `${p.in} parameter "${p.name}" is now required` });
        }
      }
      for (const [key, p] of pb) {
        if (!pa.has(key)) {
          out.push({
            location,
            path: "",
            type: "parameter-added",
            breaking: p.required,
            message: `${p.required ? "required" : "optional"} ${p.in} parameter "${p.name}" added`,
          });
        }
      }

      // Request body
      const reqA = requestBodySchemaOf(opA);
      const reqB = requestBodySchemaOf(opB);
      if (reqA && reqB) diffSchema(prepare(reqA), prepare(reqB), "", "request", `${location} → request body`, out);

      // Responses
      const respA = isObject(opA.responses) ? (opA.responses as Record<string, unknown>) : {};
      const respB = isObject(opB.responses) ? (opB.responses as Record<string, unknown>) : {};
      for (const [code, rA] of Object.entries(respA)) {
        const rB = respB[code];
        if (!isObject(rB)) {
          out.push({ location, path: "", type: "response-removed", breaking: /^2/.test(code), message: `response ${code} removed` });
          continue;
        }
        const sA = isObject(rA) ? jsonSchemaOf(rA) : null;
        const sB = jsonSchemaOf(rB);
        if (sA && sB) diffSchema(prepare(sA), prepare(sB), "", "response", `${location} → ${code}`, out);
      }
      for (const code of Object.keys(respB)) {
        if (!(code in respA)) out.push({ location, path: "", type: "response-added", breaking: false, message: `response ${code} added` });
      }
    }
  }

  for (const [path, itemB] of Object.entries(pathsB)) {
    if (!isObject(itemB)) continue;
    for (const method of HTTP_OPERATIONS) {
      if (!isObject(itemB[method])) continue;
      const itemA = pathsA[path];
      if (isObject(itemA) && isObject(itemA[method])) continue;
      const location = `${method.toUpperCase()} ${path}`;
      out.push({ location, path: "", type: "operation-added", breaking: false, message: `${location} was added` });
    }
  }
  return out;
};

export const diffContracts = (kind: ContractKind, before: unknown, after: unknown): ContractChange[] => {
  return kind === "openapi" ? diffOpenApi(before, after) : diffSchemas(before, after);
};
