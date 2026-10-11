export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export const formatMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

export const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return "–";
  // seconds only while it's under a minute; after that, minutes and hours
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${Math.floor(h / 24)}d ${h % 24}h`;
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const timeAgo = (iso: string): string => {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString();
};

type StatusTone = "success" | "redirect" | "client" | "server" | "error";

export const statusTone = (status: number): StatusTone => {
  if (status === 0) return "error";
  if (status < 300) return "success";
  if (status < 400) return "redirect";
  if (status < 500) return "client";
  return "server";
};

// Pretty-prints JSON when possible; returns null for non-JSON text
export const tryPrettyJson = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed || (!'[{"'.includes(trimmed[0]) && !/^(true|false|null|-?\d)/.test(trimmed))) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
};
