import type { KeyValue, RequestSpec } from "../../schemas/requestSpec";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export interface ImportedCollection {
  name: string;
  requests: { name: string; spec: RequestSpec; contractRef?: boolean }[];
  variables: { key: string; value: string; secret?: boolean }[];
  warnings: string[];
}

export const isPostman = (doc: unknown): boolean =>
  isObj(doc) && isObj(doc.info) && Array.isArray(doc.item) && (str(doc.info.schema).includes("getpostman.com") || "_postman_id" in doc.info);

const kv = (list: unknown): KeyValue[] =>
  Array.isArray(list) ? list.filter(isObj).filter((p) => str(p.key)).map((p) => ({ key: str(p.key), value: str(p.value), enabled: p.disabled !== true })) : [];

// Postman auth stores values as [{ key, value }] lists
const authOf = (auth: unknown): RequestSpec["auth"] | undefined => {
  if (!isObj(auth)) return undefined;
  const type = str(auth.type);
  const fields = (name: string): Obj =>
    Object.fromEntries((Array.isArray(auth[name]) ? (auth[name] as unknown[]) : []).filter(isObj).map((f) => [str(f.key), f.value]));
  if (type === "noauth") return { type: "none" };
  if (type === "bearer") return { type: "bearer", token: str(fields("bearer").token) };
  if (type === "basic") {
    const f = fields("basic");
    return { type: "basic", username: str(f.username), password: str(f.password) };
  }
  if (type === "apikey") {
    const f = fields("apikey");
    return { type: "apiKey", key: str(f.key) || "X-API-Key", value: str(f.value), in: str(f.in) === "query" ? "query" : "header" };
  }
  return undefined;
};

const urlOf = (url: unknown): string => {
  if (typeof url === "string") return url;
  if (!isObj(url)) return "";
  if (str(url.raw)) return str(url.raw);
  const host = Array.isArray(url.host) ? url.host.join(".") : str(url.host);
  const path = Array.isArray(url.path) ? url.path.join("/") : str(url.path);
  const query = kv(url.query).filter((q) => q.enabled).map((q) => `${q.key}=${q.value}`).join("&");
  return `${url.protocol ? `${str(url.protocol)}://` : ""}${host}${path ? `/${path}` : ""}${query ? `?${query}` : ""}`;
};

const bodyOf = (body: unknown, warnings: string[], name: string): RequestSpec["body"] => {
  if (!isObj(body)) return { mode: "none" };
  const mode = str(body.mode);
  if (mode === "raw") {
    const raw = str(body.raw);
    const lang = isObj(body.options) && isObj(body.options.raw) ? str(body.options.raw.language) : "";
    if (!raw) return { mode: "none" };
    if (lang === "json") return { mode: "json", content: raw };
    try {
      JSON.parse(raw);
      return { mode: "json", content: raw };
    } catch {
      return { mode: "text", content: raw };
    }
  }
  if (mode === "urlencoded") return { mode: "form-urlencoded", form: kv(body.urlencoded) };
  if (mode === "graphql" && isObj(body.graphql)) {
    let variables: unknown = {};
    try {
      variables = JSON.parse(str(body.graphql.variables) || "{}");
    } catch {
      /* keep empty variables */
    }
    return { mode: "json", content: JSON.stringify({ query: str(body.graphql.query), variables }, null, 2) };
  }
  if (mode === "formdata") warnings.push(`"${name}": multipart form-data isn't supported yet; the body was skipped`);
  if (mode === "file") warnings.push(`"${name}": file bodies aren't supported; the body was skipped`);
  return { mode: "none" };
};

export const parsePostman = (doc: Obj): ImportedCollection => {
  const warnings: string[] = [];
  const requests: ImportedCollection["requests"] = [];
  const info = doc.info as Obj;

  // folders nest; requests inherit the closest auth above them
  const walk = (items: unknown[], prefix: string, inherited: RequestSpec["auth"] | undefined) => {
    for (const item of items) {
      if (!isObj(item)) continue;
      const name = str(item.name) || "Untitled";
      if (Array.isArray(item.item)) {
        walk(item.item, prefix ? `${prefix} / ${name}` : name, authOf(item.auth) ?? inherited);
        continue;
      }
      if (!isObj(item.request) && typeof item.request !== "string") continue;
      const req = (typeof item.request === "string" ? { url: item.request } : item.request) as Obj;
      const full = (prefix ? `${prefix} / ${name}` : name).slice(0, 200);
      const method = str(req.method).toUpperCase() || "GET";
      if (!METHODS.includes(method)) {
        warnings.push(`"${full}": ${method} requests aren't supported and were skipped`);
        continue;
      }
      const url = urlOf(req.url);
      if (!url) {
        warnings.push(`"${full}" has no URL and was skipped`);
        continue;
      }
      requests.push({
        name: full,
        spec: {
          method: method as RequestSpec["method"],
          url,
          params: [],
          headers: kv(req.header),
          body: bodyOf(req.body, warnings, full),
          auth: authOf(req.auth) ?? inherited ?? { type: "none" },
          followRedirects: true,
        },
      });
    }
  };
  walk(doc.item as unknown[], "", authOf(doc.auth));

  const variables = (Array.isArray(doc.variable) ? doc.variable : [])
    .filter(isObj)
    .filter((v) => str(v.key))
    .map((v) => ({ key: str(v.key), value: str(v.value), secret: /token|secret|password|key/i.test(str(v.key)) }));

  if (requests.length > 200) {
    warnings.push(`Only the first 200 of ${requests.length} requests were imported`);
    requests.length = 200;
  }
  return { name: str(info.name).slice(0, 100) || "Postman collection", requests, variables, warnings };
};
