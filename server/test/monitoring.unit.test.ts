import { describe, expect, it } from "vitest";
import { evaluateAssertions, runExtractions } from "../src/lib/assertions";
import type { ExecutionResult } from "../src/lib/executor";
import { get, JsonPathError } from "../src/lib/jsonPath";
import { formatDuration } from "../src/lib/duration";
import { describeSchedule, nextRunAt, scheduleProblem } from "../src/lib/schedule";
import { evaluateCheck } from "../src/modules/monitors/evaluate";
import { bucketize, percentile, summarize, type CheckPoint } from "../src/modules/monitors/stats";
import { assertionSchema } from "../src/schemas/testing";

const response = (partial: Partial<ExecutionResult> = {}): ExecutionResult => {
  return {
    request: { method: "GET", url: "http://x/", headers: [] },
    status: 200,
    statusText: "OK",
    headers: [{ key: "content-type", value: "application/json" }],
    contentType: "application/json",
    body: JSON.stringify({ status: "ok", items: [{ id: 1, tags: ["a"] }, { id: 2, tags: [] }], meta: { "x.y": true } }),
    bodyEncoding: "utf8",
    sizeBytes: 120,
    truncated: false,
    timings: { ttfbMs: 40, totalMs: 120 },
    redirected: false,
    finalUrl: "http://x/",
    ...partial,
  };
};

const rule = (input: Record<string, unknown>) => assertionSchema.parse(input);

describe("jsonPath", () => {
  const data = { a: { b: [10, 20, 30] }, list: [{ id: 1 }, { id: 2 }], "we.ird": 5 };
  it("resolves properties, indexes, quoted keys and wildcards", () => {
    expect(get(data, "$.a.b[1]")).toEqual({ found: true, value: 20 });
    expect(get(data, "$.a.b[-1]").value).toBe(30);
    expect(get(data, "$['we.ird']").value).toBe(5);
    expect(get(data, "$.list[*].id").value).toEqual([1, 2]);
    expect(get(data, "$.a.b.length").value).toBe(3);
    expect(get(data, "$.missing").found).toBe(false);
  });
  it("rejects malformed paths", () => {
    expect(() => get(data, "a.b")).toThrow(JsonPathError);
    expect(() => get(data, "$.a[?(@.x)]")).toThrow(JsonPathError);
  });
});

describe("assertions", () => {
  it("evaluates every source and operator", () => {
    const results = evaluateAssertions(
      [
        rule({ source: "status", operator: "eq", expected: "2xx" }),
        rule({ source: "status", operator: "in", expected: "[200, 201]" }),
        rule({ source: "latency", operator: "lt", expected: "500" }),
        rule({ source: "header", path: "Content-Type", operator: "contains", expected: "json" }),
        rule({ source: "jsonPath", path: "$.status", operator: "eq", expected: "ok" }),
        rule({ source: "jsonPath", path: "$.items", operator: "lengthEq", expected: "2" }),
        rule({ source: "jsonPath", path: "$.items[0].id", operator: "type", expected: "integer" }),
        rule({ source: "jsonPath", path: "$.items[*].id", operator: "contains", expected: "2" }),
        rule({ source: "jsonPath", path: "$.nope", operator: "notExists" }),
        rule({ source: "body", operator: "matches", expected: "/STATUS/i" }),
      ],
      response(),
    );
    expect(results.filter((r) => !r.passed).map((r) => r.message)).toEqual([]);
  });

  it("explains failures", () => {
    const [status, json, missing] = evaluateAssertions(
      [
        rule({ source: "status", operator: "eq", expected: "201" }),
        rule({ source: "jsonPath", path: "$.status", operator: "eq", expected: "down" }),
        rule({ source: "jsonPath", path: "$.nothing", operator: "eq", expected: "1" }),
      ],
      response(),
    );
    expect(status.message).toBe("Expected status to equal 201, got 200");
    expect(json.message).toBe('Expected $.status to equal "down", got "ok"');
    expect(missing.message).toMatch(/not found/);
  });

  it("extracts variables", () => {
    const out = runExtractions(
      [
        { variable: "first", source: "jsonPath", path: "$.items[0].id", enabled: true },
        { variable: "ct", source: "header", path: "content-type", enabled: true },
        { variable: "missing", source: "jsonPath", path: "$.x", enabled: true },
      ],
      response(),
    );
    expect(out.map((o) => o.value)).toEqual(["1", "application/json", null]);
  });
});

describe("evaluateCheck", () => {
  it("treats 2xx/3xx as up when no status rule is given", () => {
    expect(evaluateCheck(response(), []).status).toBe("up");
    const bad = evaluateCheck(response({ status: 503, statusText: "Service Unavailable" }), []);
    expect(bad.status).toBe("down");
    expect(bad.failures).toEqual(["Unexpected status 503 Service Unavailable"]);
  });

  it("marks warning failures as degraded and critical ones as down", () => {
    const slow = evaluateCheck(response({ timings: { ttfbMs: 900, totalMs: 1200 } }), [
      rule({ source: "latency", operator: "lt", expected: "500" }),
    ]);
    expect(slow.status).toBe("degraded");
    const critical = evaluateCheck(response(), [
      rule({ source: "jsonPath", path: "$.status", operator: "eq", expected: "healthy", severity: "critical" }),
    ]);
    expect(critical.status).toBe("down");
  });

  it("reports network errors as down", () => {
    const res = evaluateCheck(response({ status: 0, error: { code: "TIMEOUT", message: "Request timed out" } }), []);
    expect(res).toMatchObject({ status: "down", failures: ["timeout: Request timed out"] });
  });
});

describe("schedules", () => {
  it("validates cron expressions and minimum frequency", () => {
    expect(scheduleProblem({ type: "cron", expression: "*/5 * * * *" })).toBeNull();
    expect(scheduleProblem({ type: "cron", expression: "nope" })).toMatch(/Invalid cron/);
    expect(scheduleProblem({ type: "cron", expression: "* * * * * *" })).toMatch(/more often/);
  });

  it("computes next runs", () => {
    const now = new Date("2026-01-01T10:02:30Z");
    expect(nextRunAt({ type: "interval", seconds: 60 }, now, null)).toEqual(now);
    expect(nextRunAt({ type: "interval", seconds: 60 }, now, new Date("2026-01-01T10:02:00Z"))).toEqual(new Date("2026-01-01T10:03:00Z"));
    expect(nextRunAt({ type: "cron", expression: "*/5 * * * *", timezone: "UTC" }, now)).toEqual(new Date("2026-01-01T10:05:00Z"));
    expect(describeSchedule({ type: "interval", seconds: 300 })).toBe("every 5m");
  });

  it("runs time-of-day schedules in the chosen timezone", () => {
    const now = new Date("2026-01-05T00:00:00Z"); // a Monday
    // 10:00 in Kolkata is 04:30 UTC
    expect(nextRunAt({ type: "cron", expression: "0 10 * * 1", timezone: "Asia/Kolkata" }, now)).toEqual(new Date("2026-01-05T04:30:00Z"));
    expect(describeSchedule({ type: "cron", expression: "0 10 * * *", timezone: "UTC" })).toBe("daily at 10:00 UTC");
    expect(describeSchedule({ type: "cron", expression: "30 9 * * 1,2,3,4,5", timezone: "Asia/Kolkata" })).toBe("weekdays at 09:30 Asia/Kolkata");
    expect(describeSchedule({ type: "cron", expression: "0 18 * * 1,5" })).toBe("Mon, Fri at 18:00");
    expect(describeSchedule({ type: "cron", expression: "*/5 * * * *" })).toBe("cron */5 * * * *");
    expect(scheduleProblem({ type: "cron", expression: "0 10 * * *", timezone: "Mars/Olympus" })).toMatch(/Invalid/);
  });
});

describe("stats", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min));
  const points: CheckPoint[] = [
    { status: "up", latencyMs: 100, statusCode: 200, checkedAt: at(0) },
    { status: "up", latencyMs: 200, statusCode: 200, checkedAt: at(10) },
    { status: "degraded", latencyMs: 900, statusCode: 200, checkedAt: at(20) },
    { status: "down", latencyMs: 30000, statusCode: 0, checkedAt: at(30) },
  ];

  it("computes uptime, error rate and latency percentiles", () => {
    const s = summarize(points);
    expect(s).toMatchObject({ total: 4, up: 2, degraded: 1, down: 1, uptimePct: 75, successRate: 50, errorRate: 25 });
    // The timed-out check (status 0) is excluded from latency.
    expect(s.latency).toMatchObject({ min: 100, max: 900, p50: 200, p95: 900 });
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it("buckets by time with the worst status per bucket", () => {
    const series = bucketize(points, at(0), at(40), 2);
    expect(series.map((b) => [b.total, b.worst])).toEqual([
      [2, "up"],
      [2, "down"],
    ]);
  });
});

describe("durations", () => {
  it("reads in minutes and hours, not seconds", () => {
    expect(formatDuration(20_000)).toBe("under a minute");
    expect(formatDuration(754_000)).toBe("13 min");
    expect(formatDuration(2 * 3600_000 + 5 * 60_000)).toBe("2 h 5 min");
    expect(formatDuration(3 * 3600_000)).toBe("3 h");
    expect(formatDuration(27 * 3600_000)).toBe("1 d 3 h");
  });
});
