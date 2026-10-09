import { z } from "zod";

const ASSERTION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "notContains",
  "matches",
  "exists",
  "notExists",
  "in",
  "type",
  "lengthEq",
] as const;
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

export const assertionSchema = z.object({
  // What is being checked
  source: z.enum(["status", "latency", "header", "jsonPath", "body", "contract", "size"]),
  // Header name or JSONPath expression; unused for other sources
  path: z.string().trim().max(500).default(""),
  operator: z.enum(ASSERTION_OPERATORS).default("eq"),
  // Expected value as typed by the user
  expected: z.string().max(10_000).default(""),
  enabled: z.boolean().default(true),
  // Monitors: a failed critical assertion marks the check down; warnings mark it degraded
  severity: z.enum(["critical", "warning"]).optional(),
});
export type Assertion = z.infer<typeof assertionSchema>;

export const extractionSchema = z.object({
  variable: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_.\-]+$/, "Use letters, numbers, _ . or -"),
  source: z.enum(["jsonPath", "header", "status", "body"]),
  path: z.string().trim().max(500).default(""),
  enabled: z.boolean().default(true),
});
export type Extraction = z.infer<typeof extractionSchema>;
