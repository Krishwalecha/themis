import { randomInt, randomUUID } from "node:crypto";
import type { KeyValue, RequestSpec } from "../schemas/requestSpec";

const VARIABLE = /\{\{\s*(\$?[A-Za-z0-9_.\-]+)\s*\}\}/g;

type Variables = Record<string, string>;

// Built-in `{{$name}}` generators, evaluated fresh on every reference
const DYNAMIC: Record<string, () => string> = {
  $uuid: () => randomUUID(),
  $guid: () => randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $timestampMs: () => String(Date.now()),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(randomInt(0, 1000)),
  $randomEmail: () => `user${randomInt(100000, 999999)}@example.com`,
  $randomString: () => randomUUID().replace(/-/g, "").slice(0, 12),
  $randomBoolean: () => String(randomInt(0, 2) === 1),
};

class Interpolator {
  readonly unresolved = new Set<string>();

  constructor(private readonly vars: Variables) {}

  text(input: string): string {
    return input.replace(VARIABLE, (match, name: string) => {
      if (Object.prototype.hasOwnProperty.call(this.vars, name)) return this.vars[name];
      const dynamic = DYNAMIC[name];
      if (dynamic) return dynamic();
      this.unresolved.add(name);
      return match;
    });
  }

  list(items: KeyValue[]): KeyValue[] {
    return items.map((kv) => ({ ...kv, key: this.text(kv.key), value: this.text(kv.value) }));
  }
}

export const variablesFrom = (items: { key: string; value?: string | null; enabled?: boolean | null }[] | undefined): Variables => {
  const vars: Variables = {};
  for (const kv of items ?? []) if (kv.enabled !== false && kv.key) vars[kv.key] = kv.value ?? "";
  return vars;
};

// Resolves every `{{var}}` reference in a request spec
export const interpolateSpec = (spec: RequestSpec, vars: Variables): { spec: RequestSpec; unresolved: string[] } => {
  const i = new Interpolator(vars);
  const body: RequestSpec["body"] =
    spec.body.mode === "json" || spec.body.mode === "text"
      ? { ...spec.body, content: i.text(spec.body.content) }
      : spec.body.mode === "form-urlencoded"
        ? { ...spec.body, form: i.list(spec.body.form) }
        : spec.body.mode === "multipart"
          ? { ...spec.body, parts: spec.body.parts.map((p) => ({ ...p, key: i.text(p.key), value: p.kind === "text" ? i.text(p.value) : p.value })) }
          : spec.body;

  let auth: RequestSpec["auth"] = spec.auth;
  switch (auth.type) {
    case "bearer":
      auth = { ...auth, token: i.text(auth.token) };
      break;
    case "basic":
      auth = { ...auth, username: i.text(auth.username), password: i.text(auth.password) };
      break;
    case "apiKey":
      auth = { ...auth, key: i.text(auth.key), value: i.text(auth.value) };
      break;
  }

  return {
    spec: {
      ...spec,
      url: i.text(spec.url),
      params: i.list(spec.params),
      headers: i.list(spec.headers),
      body,
      auth,
    },
    unresolved: [...i.unresolved],
  };
};

const MASK = "••••";

// Replaces secret values with •••• in text the user gets back (the URL, headers and body that were sent), including
// inside Basic auth, where they're base64-encoded. Values under 3 characters are left alone: too common to mask safely.
export const maskSecrets = (text: string, secrets: string[]): string => {
  const real = secrets.filter((s) => s.length >= 3);
  if (!real.length || !text) return text;
  const basic = /^(Basic\s+)([A-Za-z0-9+/=]+)$/i.exec(text);
  if (basic && real.some((s) => Buffer.from(basic[2], "base64").toString("utf8").includes(s))) return `${basic[1]}${MASK}`;
  let out = text;
  for (const s of [...real].sort((a, b) => b.length - a.length)) out = out.split(s).join(MASK).split(encodeURIComponent(s)).join(MASK);
  return out;
};
