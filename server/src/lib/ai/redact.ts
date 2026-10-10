// Removes credentials before anything leaves the server for an AI provider

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token)$/i;
const SENSITIVE_NAME = /(token|secret|password|passwd|api[_-]?key|apikey|auth|session|signature|sig|credential|private)/i;
const REDACTED = "[redacted]";

export const redactHeaders = (headers: { key: string; value: string }[] | undefined | null): { key: string; value: string }[] => {
  return (headers ?? []).map((h) =>
    SENSITIVE_HEADER.test(h.key) || SENSITIVE_NAME.test(h.key) ? { key: h.key, value: REDACTED } : h,
  );
};

// Masks sensitive query parameter values and any userinfo (user:pass@) in a URL
export const redactUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = url.username ? "redacted" : "";
      url.password = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_NAME.test(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return raw.replace(/([?&][^=&]*(?:token|secret|password|key|auth)[^=&]*=)[^&#]*/gi, `$1${REDACTED}`);
  }
};

// Masks values of sensitive-looking keys anywhere in a JSON body; returns text unchanged if it isn't JSON
export const redactBody = (text: string): string => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return text.replace(/("?(?:access_token|refresh_token|id_token|password|secret|api_?key)"?\s*[:=]\s*)"[^"]*"/gi, `$1"${REDACTED}"`);
  }
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [k, SENSITIVE_NAME.test(k) && typeof val !== "object" ? REDACTED : walk(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(data), null, 1);
};

// Truncates long text with an explicit marker so the model knows it only saw part of it
export const clip = (text: string, max: number): { text: string; truncated: boolean } => {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n…[truncated: ${text.length - max} more characters not shown]`, truncated: true };
};
