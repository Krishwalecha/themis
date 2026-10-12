import type { KeyValue } from "./types";

// Two-way sync between the URL bar and the Params table

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

const encode = (s: string): string => {
  // Keep variable braces readable in the URL bar.
  return encodeURIComponent(s).replace(/%7B%7B/gi, "{{").replace(/%7D%7D/gi, "}}");
};

export const splitUrl = (url: string): { base: string; query: string; hash: string } => {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const q = withoutHash.indexOf("?");
  return q >= 0
    ? { base: withoutHash.slice(0, q), query: withoutHash.slice(q + 1), hash }
    : { base: withoutHash, query: "", hash };
};

// URL bar changed: rebuild enabled params from its query string, keeping disabled rows in place
export const paramsFromUrl = (url: string, current: KeyValue[]): KeyValue[] => {
  const { query } = splitUrl(url);
  const parsed: KeyValue[] = query
    ? query
        .split("&")
        .filter((part) => part.length > 0)
        .map((part) => {
          const eq = part.indexOf("=");
          return eq >= 0
            ? { key: decode(part.slice(0, eq)), value: decode(part.slice(eq + 1)), enabled: true }
            : { key: decode(part), value: "", enabled: true };
        })
    : [];
  return [...parsed, ...current.filter((p) => !p.enabled)];
};

// Params table changed: rewrite the URL's query string from enabled params
export const urlFromParams = (url: string, params: KeyValue[]): string => {
  const { base, hash } = splitUrl(url);
  const query = params
    .filter((p) => p.enabled && p.key)
    .map((p) => (p.value ? `${encode(p.key)}=${encode(p.value)}` : encode(p.key)))
    .join("&");
  return `${base}${query ? `?${query}` : ""}${hash}`;
};
