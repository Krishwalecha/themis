import { isObject, type JsonSchema } from "./schema";

export const HTTP_OPERATIONS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

interface OperationMatch {
  path: string;
  method: string;
  operation: Record<string, unknown>;
  params: Record<string, string>;
}

export const isOpenApi = (doc: unknown): doc is Record<string, unknown> => {
  return isObject(doc) && (typeof doc.openapi === "string" || typeof doc.swagger === "string") && isObject(doc.paths);
};

export const openApiVersion = (doc: Record<string, unknown>): string => {
  return String(doc.openapi ?? doc.swagger ?? "");
};

// Path prefixes from `servers[].url` (e.g
const serverBasePaths = (doc: Record<string, unknown>): string[] => {
  const bases = new Set<string>([""]);
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  for (const s of servers) {
    if (!isObject(s) || typeof s.url !== "string") continue;
    try {
      const u = new URL(s.url.replace(/\{[^}]+\}/g, "x"), "http://placeholder");
      const p = u.pathname.replace(/\/+$/, "");
      if (p) bases.add(p);
    } catch {
      /* ignore malformed server urls */
    }
  }
  if (typeof doc.basePath === "string") bases.add(doc.basePath.replace(/\/+$/, "")); // Swagger 2
  return [...bases];
};

const templateRegex = (template: string): { regex: RegExp; names: string[] } => {
  const names: string[] = [];
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => {
      const m = /^\{([^}]+)\}$/.exec(part);
      if (m) {
        names.push(m[1]);
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return { regex: new RegExp(`^${pattern}/?$`), names };
};

// Finds the operation for a concrete request
export const matchOperation = (doc: Record<string, unknown>, method: string, url: string): OperationMatch | null => {
  let pathname: string;
  try {
    pathname = decodeURI(new URL(url, "http://placeholder").pathname);
  } catch {
    return null;
  }
  const paths = doc.paths as Record<string, unknown>;
  const m = method.toLowerCase();
  let best: (OperationMatch & { score: number }) | null = null;

  for (const base of serverBasePaths(doc)) {
    if (base && !pathname.startsWith(base)) continue;
    const rel = pathname.slice(base.length) || "/";
    for (const [template, item] of Object.entries(paths)) {
      if (!isObject(item) || !isObject(item[m])) continue;
      const { regex, names } = templateRegex(template);
      const hit = regex.exec(rel);
      if (!hit) continue;
      const params: Record<string, string> = {};
      names.forEach((n, i) => (params[n] = hit[i + 1]));
      const score = template.length - names.length * 100;
      if (!best || score > best.score) best = { path: template, method: m, operation: item[m] as Record<string, unknown>, params, score };
    }
  }
  if (!best) return null;
  const { score: _score, ...match } = best;
  return match;
};

// Picks the response object for a status: exact code, then "4XX"-style range, then "default"
export const responseFor = (operation: Record<string, unknown>, status: number): { key: string; response: Record<string, unknown> } | null => {
  const responses = isObject(operation.responses) ? operation.responses : {};
  const candidates = [String(status), `${Math.floor(status / 100)}XX`, `${Math.floor(status / 100)}xx`, "default"];
  for (const key of candidates) {
    const r = responses[key];
    if (isObject(r)) return { key, response: r };
  }
  return null;
};

// JSON schema from a response (OpenAPI 3 `content` or Swagger 2 `schema`)
export const jsonSchemaOf = (response: Record<string, unknown>): JsonSchema | null => {
  if (isObject(response.schema)) return response.schema; // Swagger 2
  const content = isObject(response.content) ? response.content : null;
  if (!content) return null;
  const key =
    Object.keys(content).find((k) => /^application\/json/i.test(k)) ??
    Object.keys(content).find((k) => /json/i.test(k)) ??
    Object.keys(content).find((k) => k === "*/*");
  const media = key ? content[key] : null;
  return isObject(media) && isObject(media.schema) ? media.schema : null;
};

export const requestBodySchemaOf = (operation: Record<string, unknown>): JsonSchema | null => {
  const body = operation.requestBody;
  return isObject(body) ? jsonSchemaOf(body) : null;
};

interface OperationSummary {
  path: string;
  method: string;
  summary?: string;
  operationId?: string;
  responses: string[];
}

export const listOperations = (doc: Record<string, unknown>): OperationSummary[] => {
  const out: OperationSummary[] = [];
  for (const [path, item] of Object.entries(doc.paths as Record<string, unknown>)) {
    if (!isObject(item)) continue;
    for (const method of HTTP_OPERATIONS) {
      const op = item[method];
      if (!isObject(op)) continue;
      out.push({
        path,
        method: method.toUpperCase(),
        summary: typeof op.summary === "string" ? op.summary : undefined,
        operationId: typeof op.operationId === "string" ? op.operationId : undefined,
        responses: isObject(op.responses) ? Object.keys(op.responses) : [],
      });
    }
  }
  return out;
};
