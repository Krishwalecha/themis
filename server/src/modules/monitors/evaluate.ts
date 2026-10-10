import { evaluateAssertions, type AssertionResult } from "../../lib/assertions";
import type { ExecutionResult } from "../../lib/executor";
import type { Assertion } from "../../schemas/testing";

export type CheckStatus = "up" | "degraded" | "down";

interface CheckEvaluation {
  status: CheckStatus;
  failures: string[];
  assertions: (AssertionResult & { severity: "critical" | "warning" })[];
}

// Status rules are critical by default; everything else (latency, body, headers) only degrades
const severityOf = (a: Assertion): "critical" | "warning" => {
  return a.severity ?? (a.source === "status" ? "critical" : "warning");
};

// When the user hasn't written a status rule, any 2xx/3xx response counts as success
const DEFAULT_STATUS_RULE: Assertion = {
  source: "status",
  path: "",
  operator: "lt",
  expected: "400",
  enabled: true,
  severity: "critical",
};

export const evaluateCheck = (result: ExecutionResult, rules: Assertion[]): CheckEvaluation => {
  if (result.error) {
    return {
      status: "down",
      failures: [`${result.error.code.replace(/_/g, " ").toLowerCase()}: ${result.error.message}`],
      assertions: [],
    };
  }

  const enabled = rules.filter((r) => r.enabled);
  const effective = enabled.some((r) => r.source === "status") ? enabled : [DEFAULT_STATUS_RULE, ...enabled];
  const assertions = evaluateAssertions(effective, result).map((r) => ({ ...r, severity: severityOf(r.assertion) }));

  const failed = assertions.filter((a) => !a.passed);
  const status: CheckStatus = failed.some((f) => f.severity === "critical")
    ? "down"
    : failed.length
      ? "degraded"
      : "up";

  return {
    status,
    failures: failed.map((f) =>
      f.assertion === DEFAULT_STATUS_RULE ? `Unexpected status ${result.status} ${result.statusText}`.trim() : f.message,
    ),
    assertions,
  };
};

// true while any of the monitor's maintenance windows is in progress
export const inMaintenance = (monitor: { maintenance?: { startsAt?: Date | null; endsAt?: Date | null }[] }, at = new Date()) =>
  (monitor.maintenance ?? []).some((w) => w.startsAt && w.endsAt && w.startsAt <= at && at < w.endsAt);
