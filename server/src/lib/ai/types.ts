import { z } from "zod";

const LEVELS = ["ok", "info", "warning", "critical"] as const;
export type Level = (typeof LEVELS)[number];

// trims to a limit instead of rejecting, so a wordy model still yields a short summary
const clipped = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s));

// The structured shape every summary takes, whether written by the model or by the rule-based fallback
export const summarySchema = z.object({
  headline: clipped(80),
  severity: z.enum(LEVELS),
  summary: clipped(280),
  highlights: z
    .array(
      // models sometimes send bare strings here; read those as plain info notes
      z.preprocess(
        (h) => (typeof h === "string" ? { level: "info", text: h } : h),
        z.object({ level: z.enum(LEVELS), text: clipped(120) }),
      ),
    )
    .default([])
    .transform((h) => h.slice(0, 3)),
  recommendations: z
    .array(clipped(140))
    .default([])
    .transform((r) => r.slice(0, 2)),
});
export type Summary = z.infer<typeof summarySchema>;

const TARGET_TYPES = ["history", "monitor", "contractValidation", "ops"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

// What a summary is about: the facts sent to the model and the rule-based fallback for the same facts
export interface SummaryTask {
  targetType: TargetType;
  // Instructions specific to this kind of summary
  focus: string;
  // Compact, already-redacted facts
  facts: Record<string, unknown>;
  // Untrusted text (e.g
  untrusted?: { label: string; content: string };
  fallback: () => Summary;
}
