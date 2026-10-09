
type Segment = { kind: "key"; key: string } | { kind: "index"; index: number } | { kind: "wildcard" };

export class JsonPathError extends Error {}

const parsePath = (path: string): Segment[] => {
  const src = path.trim();
  if (!src.startsWith("$")) throw new JsonPathError(`Path must start with "$": ${path}`);
  const segments: Segment[] = [];
  let i = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ".") {
      i++;
      if (src[i] === "*") {
        segments.push({ kind: "wildcard" });
        i++;
        continue;
      }
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$\-]/.test(src[j])) j++;
      if (j === i) throw new JsonPathError(`Expected property name at position ${i} in ${path}`);
      segments.push({ kind: "key", key: src.slice(i, j) });
      i = j;
    } else if (ch === "[") {
      const close = findClosingBracket(src, i);
      const inner = src.slice(i + 1, close).trim();
      if (inner === "*") segments.push({ kind: "wildcard" });
      else if (/^-?\d+$/.test(inner)) segments.push({ kind: "index", index: Number(inner) });
      else if (/^(['"]).*\1$/.test(inner)) segments.push({ kind: "key", key: inner.slice(1, -1) });
      else throw new JsonPathError(`Unsupported bracket expression "[${inner}]" in ${path}`);
      i = close + 1;
    } else {
      throw new JsonPathError(`Unexpected "${ch}" at position ${i} in ${path}`);
    }
  }
  return segments;
};

const findClosingBracket = (src: string, open: number): number => {
  let quote: string | null = null;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "]") return i;
  }
  throw new JsonPathError(`Unclosed "[" in ${src}`);
};

const step = (values: unknown[], seg: Segment): unknown[] => {
  const out: unknown[] = [];
  for (const v of values) {
    if (seg.kind === "wildcard") {
      if (Array.isArray(v)) out.push(...v);
      else if (v && typeof v === "object") out.push(...Object.values(v));
    } else if (seg.kind === "index") {
      if (Array.isArray(v)) {
        const idx = seg.index < 0 ? v.length + seg.index : seg.index;
        if (idx >= 0 && idx < v.length) out.push(v[idx]);
      }
    } else if (v !== null && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, seg.key)) {
      out.push((v as Record<string, unknown>)[seg.key]);
    } else if (seg.key === "length" && (Array.isArray(v) || typeof v === "string")) {
      out.push(v.length);
    }
  }
  return out;
};

export const query = (data: unknown, path: string): unknown[] => {
  return parsePath(path).reduce<unknown[]>((values, seg) => step(values, seg), [data]);
};

interface PathResult {
  found: boolean;
  value: unknown;
}

// Resolves a path
export const get = (data: unknown, path: string): PathResult => {
  const segments = parsePath(path);
  const matches = segments.reduce<unknown[]>((values, seg) => step(values, seg), [data]);
  const multi = segments.some((s) => s.kind === "wildcard");
  if (multi) return { found: matches.length > 0, value: matches };
  return matches.length ? { found: true, value: matches[0] } : { found: false, value: undefined };
};
