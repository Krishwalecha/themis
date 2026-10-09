import { z } from "zod";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const keyValueSchema = z.object({
  key: z.string().max(1024),
  value: z.string().max(64 * 1024).default(""),
  enabled: z.boolean().default(true),
});
export type KeyValue = z.infer<typeof keyValueSchema>;

const kvList = z.array(keyValueSchema).max(200).default([]);

// Files travel inside the spec as base64. History keeps only the name and size (data ""), so
// re-running an old entry asks for the file again.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const fileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().max(200).default("application/octet-stream"),
  size: z.number().int().min(0),
  data: z
    .string()
    .max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "File data must be base64"),
});
export type FileData = z.infer<typeof fileSchema>;

const partSchema = z.object({
  key: z.string().max(1024),
  enabled: z.boolean().default(true),
  kind: z.enum(["text", "file"]).default("text"),
  value: z.string().max(64 * 1024).default(""),
  file: fileSchema.nullish(),
});

const bodySchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("json"), content: z.string().max(5 * 1024 * 1024).default("") }),
    z.object({ mode: z.literal("text"), content: z.string().max(5 * 1024 * 1024).default("") }),
    z.object({ mode: z.literal("form-urlencoded"), form: kvList }),
    z.object({ mode: z.literal("multipart"), parts: z.array(partSchema).max(50).default([]) }),
    z.object({ mode: z.literal("binary"), file: fileSchema.nullish() }),
  ])
  .default({ mode: "none" })
  .refine((b) => filesIn(b).reduce((n, f) => n + Math.floor((f.data.length * 3) / 4), 0) <= MAX_FILE_BYTES, "Attached files can total at most 5 MB");

// every attached file in a body
const filesIn = (b: { mode: string; parts?: { kind?: string; file?: FileData | null }[]; file?: FileData | null }): FileData[] =>
  b.mode === "multipart" ? (b.parts ?? []).flatMap((p) => (p.kind === "file" && p.file ? [p.file] : [])) : b.mode === "binary" && b.file ? [b.file] : [];

// the spec as history stores it: files keep their name and size, not their contents
export const withoutFileData = (spec: RequestSpec): RequestSpec => {
  const b = spec.body;
  if (b.mode === "multipart") return { ...spec, body: { ...b, parts: b.parts.map((p) => (p.file ? { ...p, file: { ...p.file, data: "" } } : p)) } };
  if (b.mode === "binary" && b.file) return { ...spec, body: { ...b, file: { ...b.file, data: "" } } };
  return spec;
};

const authSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), token: z.string().max(16 * 1024) }),
    z.object({ type: z.literal("basic"), username: z.string().max(1024), password: z.string().max(1024).default("") }),
    z.object({
      type: z.literal("apiKey"),
      key: z.string().min(1).max(1024),
      value: z.string().max(16 * 1024),
      in: z.enum(["header", "query"]).default("header"),
    }),
  ])
  .default({ type: "none" });

export const requestSpecSchema = z.object({
  method: z.enum(HTTP_METHODS).default("GET"),
  url: z.string().trim().min(1, "URL is required").max(8192),
  params: kvList,
  headers: kvList,
  body: bodySchema,
  auth: authSchema,
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  followRedirects: z.boolean().default(true),
});
export type RequestSpec = z.infer<typeof requestSpecSchema>;
