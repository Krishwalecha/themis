import { performance } from "node:perf_hooks";
import { config } from "../config";
import type { FileData, RequestSpec } from "../schemas/requestSpec";
import { assertPublicUrl, BlockedAddress } from "./netguard";

type ExecutionErrorCode =
  | "INVALID_URL"
  | "TIMEOUT"
  | "DNS_LOOKUP_FAILED"
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "TLS_ERROR"
  | "NETWORK_ERROR"
  | "MISSING_FILE"
  | "BLOCKED_ADDRESS";

interface HeaderPair {
  key: string;
  value: string;
}

interface PreparedRequest {
  method: string;
  url: string;
  headers: HeaderPair[];
  // what was sent, readable: multipart and binary bodies are described rather than dumped
  body?: string;
}

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const blobOf = (f: FileData) => new Blob([Buffer.from(f.data, "base64")], { type: f.type || "application/octet-stream" });

// the bytes that actually go on the wire for file bodies; fetch adds the multipart boundary itself
const wireBody = (spec: RequestSpec): FormData | Buffer | undefined => {
  if (NO_BODY_METHODS.has(spec.method)) return undefined;
  const b = spec.body;
  if (b.mode === "multipart") {
    const form = new FormData();
    for (const p of b.parts) {
      if (!p.enabled || !p.key) continue;
      if (p.kind === "file" && p.file) form.append(p.key, blobOf(p.file), p.file.name);
      else if (p.kind === "text") form.append(p.key, p.value);
    }
    return form;
  }
  if (b.mode === "binary" && b.file) return Buffer.from(b.file.data, "base64");
  return undefined;
};

export interface ExecutionResult {
  request: PreparedRequest;
  // 0 when the request never produced an HTTP response
  status: number;
  statusText: string;
  headers: HeaderPair[];
  contentType: string;
  body: string;
  bodyEncoding: "utf8" | "base64";
  sizeBytes: number;
  truncated: boolean;
  timings: { ttfbMs: number; totalMs: number };
  redirected: boolean;
  finalUrl: string;
  error?: { code: ExecutionErrorCode; message: string };
}

const TEXTUAL_CONTENT = /json|text|xml|javascript|html|x-www-form-urlencoded|graphql|yaml|csv|problem/i;
const NO_BODY_METHODS = new Set(["GET", "HEAD"]);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const hasHeader = (headers: HeaderPair[], name: string): boolean => {
  const lower = name.toLowerCase();
  return headers.some((h) => h.key.toLowerCase() === lower);
};

const normalizeUrl = (raw: string): URL => {
  const url = new URL(HAS_SCHEME.test(raw) ? raw : `http://${raw}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Unsupported protocol "${url.protocol}". Only http and https are allowed`);
  }
  return url;
};

class MissingFile extends Error {
  constructor(name: string) {
    super(`Attach ${name} again: files aren't kept in history`);
  }
}

// Turns a (fully interpolated) request spec into the concrete URL, headers and body that go on the wire
export const prepareRequest = (spec: RequestSpec): PreparedRequest => {
  const url = normalizeUrl(spec.url);
  for (const p of spec.params) if (p.enabled && p.key) url.searchParams.append(p.key, p.value);

  const headers: HeaderPair[] = spec.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => ({ key: h.key.trim(), value: h.value }));

  const auth = spec.auth;
  if (auth.type === "bearer" && auth.token && !hasHeader(headers, "authorization")) {
    headers.push({ key: "Authorization", value: `Bearer ${auth.token}` });
  } else if (auth.type === "basic" && !hasHeader(headers, "authorization")) {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    headers.push({ key: "Authorization", value: `Basic ${encoded}` });
  } else if (auth.type === "apiKey") {
    if (auth.in === "query") url.searchParams.set(auth.key, auth.value);
    else if (!hasHeader(headers, auth.key)) headers.push({ key: auth.key, value: auth.value });
  }

  let body: string | undefined;
  if (!NO_BODY_METHODS.has(spec.method)) {
    const b = spec.body;
    if (b.mode === "json" && b.content.trim()) {
      body = b.content;
      if (!hasHeader(headers, "content-type")) headers.push({ key: "Content-Type", value: "application/json" });
    } else if (b.mode === "text" && b.content) {
      body = b.content;
      if (!hasHeader(headers, "content-type")) headers.push({ key: "Content-Type", value: "text/plain" });
    } else if (b.mode === "form-urlencoded") {
      const form = new URLSearchParams();
      for (const f of b.form) if (f.enabled && f.key) form.append(f.key, f.value);
      body = form.toString();
      if (!hasHeader(headers, "content-type")) {
        headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded" });
      }
    } else if (b.mode === "multipart") {
      const missing = b.parts.find((p) => p.enabled && p.kind === "file" && (!p.file || !p.file.data) && p.key);
      if (missing) throw new MissingFile(missing.file?.name ?? missing.key);
      // a hand-set multipart Content-Type has no boundary and would break the body
      for (let i = headers.length - 1; i >= 0; i--) if (headers[i].key.toLowerCase() === "content-type") headers.splice(i, 1);
      body = b.parts
        .filter((p) => p.enabled && p.key)
        .map((p) => (p.kind === "file" && p.file ? `${p.key}: ${p.file.name} (${p.file.type}, ${kb(p.file.size)})` : `${p.key}=${p.value}`))
        .join("\n");
    } else if (b.mode === "binary") {
      if (!b.file?.data) throw new MissingFile(b.file?.name ?? "the body file");
      body = `${b.file.name} (${b.file.type}, ${kb(b.file.size)})`;
      if (!hasHeader(headers, "content-type")) headers.push({ key: "Content-Type", value: b.file.type || "application/octet-stream" });
    }
  }

  if (!hasHeader(headers, "user-agent")) headers.push({ key: "User-Agent", value: "Themis/0.2" });
  if (!hasHeader(headers, "accept")) headers.push({ key: "Accept", value: "*/*" });

  return { method: spec.method, url: url.toString(), headers, body };
};

const classifyError = (err: unknown, timedOut: boolean): { code: ExecutionErrorCode; message: string } => {
  if (timedOut) return { code: "TIMEOUT", message: "Request timed out" };
  const e = err as {
    message?: string;
    cause?: { code?: string; message?: string; errors?: { message?: string }[] };
  };
  const causeCode = e?.cause?.code ?? "";
  // `localhost` resolves to both IPv4 and IPv6; those failures arrive as an AggregateError with an empty message.
  const detail =
    e?.cause?.message || e?.cause?.errors?.[0]?.message || e?.message || "Unknown network error";
  if (detail === "bad port") {
    return { code: "INVALID_URL", message: "This port is blocked by the Fetch standard (unsafe port)" };
  }
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") return { code: "DNS_LOOKUP_FAILED", message: detail };
  if (causeCode === "ECONNREFUSED") return { code: "CONNECTION_REFUSED", message: detail };
  if (causeCode === "ECONNRESET" || causeCode === "UND_ERR_SOCKET") return { code: "CONNECTION_RESET", message: detail };
  if (/CERT|SSL|TLS/i.test(causeCode) || /certificate|ssl|tls/i.test(detail)) return { code: "TLS_ERROR", message: detail };
  return { code: "NETWORK_ERROR", message: detail };
};

const readCapped = async (
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<{ buffer: Buffer; size: number; truncated: boolean }> => {
  if (!stream) return { buffer: Buffer.alloc(0), size: 0, truncated: false };
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = limit - size;
    if (value.byteLength > remaining) {
      chunks.push(Buffer.from(value.subarray(0, remaining)));
      size += remaining;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(Buffer.from(value));
    size += value.byteLength;
  }
  return { buffer: Buffer.concat(chunks), size, truncated };
};

const round = (n: number) => Math.round(n * 100) / 100;

const failedResult = (request: PreparedRequest, totalMs: number, error: ExecutionResult["error"]): ExecutionResult => {
  return {
    request,
    status: 0,
    statusText: "",
    headers: [],
    contentType: "",
    body: "",
    bodyEncoding: "utf8",
    sizeBytes: 0,
    truncated: false,
    timings: { ttfbMs: totalMs, totalMs },
    redirected: false,
    finalUrl: request.url,
    error,
  };
};

// Executes an HTTP request
// `publicOnly` refuses private addresses even when the instance allows them; `maxResponseBytes` lowers the read cap
export const executeRequest = async (spec: RequestSpec, opts: { publicOnly?: boolean; maxResponseBytes?: number } = {}): Promise<ExecutionResult> => {
  let prepared: PreparedRequest;
  try {
    prepared = prepareRequest(spec);
  } catch (err) {
    const fallback: PreparedRequest = { method: spec.method, url: spec.url, headers: [] };
    return failedResult(fallback, 0, { code: err instanceof MissingFile ? "MISSING_FILE" : "INVALID_URL", message: (err as Error).message });
  }

  const timeoutMs = Math.min(spec.timeoutMs ?? config.request.defaultTimeoutMs, config.request.maxTimeoutMs);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const started = performance.now();
  try {
    // redirects are followed by hand, so every hop's address is checked before anything is sent to it
    let url = prepared.url;
    let method = prepared.method;
    let sendHeaders = prepared.headers;
    let body: ReturnType<typeof wireBody> | string | undefined = wireBody(spec) ?? prepared.body;
    let redirected = false;
    let res: Response;
    for (let hop = 0; ; hop++) {
      await assertPublicUrl(url, { always: opts.publicOnly });
      res = await fetch(url, { method, headers: sendHeaders.map((h) => [h.key, h.value] as [string, string]), body, redirect: "manual", signal: controller.signal });
      const location = res.headers.get("location");
      if (!spec.followRedirects || !location || ![301, 302, 303, 307, 308].includes(res.status) || hop >= 10) break;
      await res.body?.cancel();
      const next = new URL(location, url);
      // credentials don't follow a redirect to another host
      if (next.host !== new URL(url).host) sendHeaders = sendHeaders.filter((h) => !/^(authorization|cookie|proxy-authorization)$/i.test(h.key));
      // 303, and 301/302 after a POST, continue as a GET without a body (as browsers do)
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        sendHeaders = sendHeaders.filter((h) => !/^content-(type|length)$/i.test(h.key));
      } else if (body !== undefined) body = wireBody(spec) ?? prepared.body;
      url = next.toString();
      redirected = true;
    }
    const ttfbMs = performance.now() - started;

    const { buffer, size, truncated } = await readCapped(res.body, opts.maxResponseBytes ?? config.request.maxResponseBytes);
    const totalMs = performance.now() - started;

    const headers: HeaderPair[] = [];
    res.headers.forEach((value, key) => {
      if (key !== "set-cookie") headers.push({ key, value });
    });
    for (const cookie of res.headers.getSetCookie()) headers.push({ key: "set-cookie", value: cookie });

    const contentType = res.headers.get("content-type") ?? "";
    const textual = !contentType || TEXTUAL_CONTENT.test(contentType);

    return {
      request: prepared,
      status: res.status,
      statusText: res.statusText,
      headers,
      contentType,
      body: textual ? buffer.toString("utf8") : buffer.toString("base64"),
      bodyEncoding: textual ? "utf8" : "base64",
      sizeBytes: size,
      truncated,
      timings: { ttfbMs: round(ttfbMs), totalMs: round(totalMs) },
      redirected,
      finalUrl: url,
    };
  } catch (err) {
    if (err instanceof BlockedAddress) return failedResult(prepared, round(performance.now() - started), { code: "BLOCKED_ADDRESS", message: err.message });
    return failedResult(prepared, round(performance.now() - started), classifyError(err, timedOut));
  } finally {
    clearTimeout(timer);
  }
};
