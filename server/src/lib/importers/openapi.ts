import type { KeyValue, RequestSpec } from "../../schemas/requestSpec";
import { HTTP_OPERATIONS } from "../contracts/openapi";
import { dereference, isObject } from "../contracts/schema";
import type { ImportedCollection } from "./postman";

type Obj = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const SUPPORTED = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

// a small, valid example for a JSON schema: explicit examples first, then a type-shaped placeholder
const sample = (schema: unknown, depth = 0): unknown => {
  if (!isObject(schema) || depth > 6) return null;
  if ("example" in schema) return schema.example;
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const list = schema[key];
    if (Array.isArray(list) && list.length) {
      if (key !== "allOf") return sample(list[0], depth + 1);
      return Object.assign({}, ...list.map((s) => sample(s, depth + 1)).filter((v) => isObject(v)));
    }
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "object" || isObject(schema.properties)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : Object.keys(props));
    return Object.fromEntries(Object.entries(props).filter(([k]) => required.has(k)).slice(0, 25).map(([k, v]) => [k, sample(v, depth + 1)]));
  }
  if (type === "array") return [sample(schema.items, depth + 1)];
  if (type === "integer") return 0;
  if (type === "number") return 0;
  if (type === "boolean") return false;
  const format = str(schema.format);
  if (format === "email") return "user@example.com";
  if (format === "date-time") return new Date(0).toISOString();
  if (format === "date") return "1970-01-01";
  if (format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (format === "uri" || format === "url") return "https://example.com";
  return "string";
};

const paramValue = (p: Obj): string => {
  const v = "example" in p ? p.example : sample(p.schema ?? p);
  return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
};

const baseUrlOf = (doc: Obj): string => {
  if (Array.isArray(doc.servers) && isObject(doc.servers[0])) {
    const s = doc.servers[0];
    let url = str(s.url);
    // fill server variables with their defaults
    if (isObject(s.variables)) for (const [k, v] of Object.entries(s.variables)) if (isObject(v)) url = url.replace(`{${k}}`, str(v.default));
    return url.replace(/\/+$/, "");
  }
  if (doc.host) return `${Array.isArray(doc.schemes) ? str(doc.schemes[0]) : "https"}://${str(doc.host)}${str(doc.basePath).replace(/\/+$/, "")}`; // Swagger 2
  return "";
};

const authFrom = (doc: Obj, op: Obj): { auth: RequestSpec["auth"]; variable?: string } => {
  const schemes = isObject(doc.components) && isObject(doc.components.securitySchemes) ? doc.components.securitySchemes : isObject(doc.securityDefinitions) ? doc.securityDefinitions : {};
  const security = Array.isArray(op.security) ? op.security : Array.isArray(doc.security) ? doc.security : [];
  const first = security.find(isObject);
  const name = first ? Object.keys(first)[0] : undefined;
  const scheme = name ? (schemes as Obj)[name] : undefined;
  if (!isObject(scheme)) return { auth: { type: "none" } };
  const type = str(scheme.type);
  if ((type === "http" && str(scheme.scheme).toLowerCase() === "bearer") || type === "oauth2" || type === "openIdConnect")
    return { auth: { type: "bearer", token: "{{token}}" }, variable: "token" };
  if ((type === "http" && str(scheme.scheme).toLowerCase() === "basic") || type === "basic")
    return { auth: { type: "basic", username: "{{username}}", password: "{{password}}" }, variable: "username" };
  if (type === "apiKey" && str(scheme.in) !== "cookie")
    return { auth: { type: "apiKey", key: str(scheme.name) || "X-API-Key", value: "{{apiKey}}", in: str(scheme.in) === "query" ? "query" : "header" }, variable: "apiKey" };
  return { auth: { type: "none" } };
};

export const parseOpenApi = (raw: Obj): ImportedCollection => {
  const doc = dereference(raw) as Obj;
  const warnings: string[] = [];
  const requests: ImportedCollection["requests"] = [];
  const authVars = new Set<string>();
  const pathVars = new Set<string>();

  for (const [path, item] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    if (!isObject(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters.filter(isObject) : [];
    for (const method of HTTP_OPERATIONS) {
      const op = item[method];
      if (!isObject(op)) continue;
      if (!SUPPORTED.has(method)) {
        warnings.push(`${method.toUpperCase()} ${path} isn't supported and was skipped`);
        continue;
      }
      const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters.filter(isObject) : [])];
      const query: KeyValue[] = [];
      const headers: KeyValue[] = [];
      for (const p of params) {
        const where = str(p.in);
        if (where === "query" && p.required) query.push({ key: str(p.name), value: paramValue(p), enabled: true });
        if (where === "header" && p.required && str(p.name).toLowerCase() !== "authorization") headers.push({ key: str(p.name), value: paramValue(p), enabled: true });
      }
      // {id} in the path becomes {{id}}, filled from the environment
      const url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, (_, n: string) => {
        pathVars.add(n);
        return `{{${n}}}`;
      })}${query.length ? `?${query.map((q) => `${q.key}=${encodeURIComponent(q.value)}`).join("&")}` : ""}`;

      let body: RequestSpec["body"] = { mode: "none" };
      const content = isObject(op.requestBody) && isObject(op.requestBody.content) ? op.requestBody.content : null;
      const swaggerBody = params.find((p) => str(p.in) === "body");
      if (content) {
        const json = Object.entries(content).find(([type]) => type.includes("json"));
        const form = content["application/x-www-form-urlencoded"];
        if (json && isObject(json[1])) {
          const media = json[1];
          const ex = "example" in media ? media.example : isObject(media.examples) ? (Object.values(media.examples).find(isObject) as Obj | undefined)?.value : undefined;
          body = { mode: "json", content: JSON.stringify(ex ?? sample(media.schema), null, 2) };
          headers.push({ key: "Content-Type", value: "application/json", enabled: true });
        } else if (isObject(form) && isObject(form.schema) && isObject(form.schema.properties)) {
          body = { mode: "form-urlencoded", form: Object.entries(form.schema.properties).map(([k, v]) => ({ key: k, value: String(sample(v) ?? ""), enabled: true })) };
        }
      } else if (swaggerBody) {
        body = { mode: "json", content: JSON.stringify(sample(swaggerBody.schema), null, 2) };
        headers.push({ key: "Content-Type", value: "application/json", enabled: true });
      }

      const { auth, variable } = authFrom(doc, op);
      if (variable) authVars.add(variable);
      const name = (str(op.summary) || str(op.operationId) || `${method.toUpperCase()} ${path}`).slice(0, 200);
      requests.push({
        name,
        spec: { method: method.toUpperCase() as RequestSpec["method"], url, params: [], headers, body, auth, followRedirects: true },
        contractRef: true,
      });
    }
  }
  if (!requests.length) throw new Error("The OpenAPI document has no operations to import");
  if (requests.length > 200) {
    warnings.push(`Only the first 200 of ${requests.length} operations were imported`);
    requests.length = 200;
  }

  const variables: ImportedCollection["variables"] = [{ key: "baseUrl", value: baseUrlOf(doc) || "https://api.example.com" }];
  for (const v of pathVars) variables.push({ key: v, value: "" });
  if (authVars.has("token")) variables.push({ key: "token", value: "", secret: true });
  if (authVars.has("apiKey")) variables.push({ key: "apiKey", value: "", secret: true });
  if (authVars.has("username")) variables.push({ key: "username", value: "" }, { key: "password", value: "", secret: true });

  const info = isObject(doc.info) ? doc.info : {};
  return { name: (str(info.title) || "OpenAPI import").slice(0, 100), requests, variables, warnings };
};
