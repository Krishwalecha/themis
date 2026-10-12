import type { FileData, RequestSpec } from "./types";

// attachments travel inside the request as base64; the server caps a request's files at 5 MB in total
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const readFile = (file: File): Promise<FileData> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, type: file.type || "application/octet-stream", size: file.size, data: String(reader.result).split(",")[1] ?? "" });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// the spec with each file's name and size kept but not its contents
export const withoutFileData = (spec: RequestSpec): RequestSpec => {
  const b = spec.body;
  if (b.mode === "multipart") return { ...spec, body: { ...b, parts: b.parts.map((p) => (p.file ? { ...p, file: { ...p.file, data: "" } } : p)) } };
  if (b.mode === "binary" && b.file) return { ...spec, body: { ...b, file: { ...b.file, data: "" } } };
  return spec;
};
