// Schema helpers shared by validation, inference and diffing

export type JsonSchema = Record<string, unknown>;

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const decodePointer = (token: string): string => {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
};

const resolvePointer = (root: unknown, ref: string): unknown => {
  if (!ref.startsWith("#")) return undefined;
  const parts = ref.slice(1).split("/").filter(Boolean).map((p) => decodePointer(decodeURIComponent(p)));
  let cur: unknown = root;
  for (const p of parts) {
    if (Array.isArray(cur)) cur = cur[Number(p)];
    else if (isObject(cur)) cur = cur[p];
    else return undefined;
  }
  return cur;
};

// Inlines local `$ref`s ("#/components/schemas/User")
export const dereference = <T>(node: T, root: unknown = node, stack: string[] = []): T => {
  if (Array.isArray(node)) return node.map((n) => dereference(n, root, stack)) as T;
  if (!isObject(node)) return node;

  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (stack.includes(ref)) return {} as T;
    const target = resolvePointer(root, ref);
    if (target === undefined) return {} as T;
    const { $ref: _ignored, ...siblings } = node;
    const resolved = dereference(target, root, [...stack, ref]);
    return (isObject(resolved) ? { ...resolved, ...dereference(siblings, root, stack) } : resolved) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = dereference(v, root, stack);
  return out as T;
};

// OpenAPI 3.0 `nullable: true` → JSON Schema `type: [t, "null"]`, recursively
export const normalizeOpenApiSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(normalizeOpenApiSchema);
  if (!isObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = normalizeOpenApiSchema(v);
  if (out.nullable === true) {
    delete out.nullable;
    if (typeof out.type === "string") out.type = [out.type, "null"];
    else if (Array.isArray(out.type) && !out.type.includes("null")) out.type = [...out.type, "null"];
    else if (out.enum && Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
};

export const typesOf = (schema: JsonSchema): string[] => {
  const t = schema.type;
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.map(String);
  if (isObject(schema.properties)) return ["object"];
  if (schema.items) return ["array"];
  return [];
};

// Flattens allOf into a single schema (properties/required merged)
export const flattenAllOf = (schema: JsonSchema): JsonSchema => {
  if (!Array.isArray(schema.allOf)) return schema;
  const { allOf, ...rest } = schema;
  const merged: JsonSchema = { ...rest };
  const properties: Record<string, unknown> = { ...(isObject(rest.properties) ? rest.properties : {}) };
  const required = new Set<string>(Array.isArray(rest.required) ? (rest.required as string[]) : []);
  for (const part of allOf as unknown[]) {
    if (!isObject(part)) continue;
    const flat = flattenAllOf(part);
    if (isObject(flat.properties)) Object.assign(properties, flat.properties);
    if (Array.isArray(flat.required)) for (const r of flat.required) required.add(String(r));
    for (const [k, v] of Object.entries(flat)) {
      if (k !== "properties" && k !== "required" && merged[k] === undefined) merged[k] = v;
    }
  }
  if (Object.keys(properties).length) merged.properties = properties;
  if (required.size) merged.required = [...required];
  if (!merged.type && Object.keys(properties).length) merged.type = "object";
  return merged;
};
