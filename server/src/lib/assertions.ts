import type { ExecutionResult } from "./executor";
import { get as getPath, JsonPathError } from "./jsonPath";
import type { Assertion, AssertionOperator, Extraction } from "../schemas/testing";

interface ContractCheck {
  valid: boolean;
  errors: { path: string; message: string }[];
  skipped?: string;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: unknown;
  message: string;
}

const OPERATOR_TEXT: Record<AssertionOperator, string> = {
  eq: "equal",
  neq: "not equal",
  gt: "be greater than",
  gte: "be at least",
  lt: "be less than",
  lte: "be at most",
  contains: "contain",
  notContains: "not contain",
  matches: "match",
  exists: "exist",
  notExists: "not exist",
  in: "be one of",
  type: "be of type",
  lengthEq: "have length",
};

// Expected values are typed as text; interpret JSON literals ("200", "true", "[1,2]") when they parse
const parseExpected = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
};

const typeOf = (v: unknown): string => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

const canonical = (v: unknown): string => {
  if (v && typeof v === "object") {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    const keys = Object.keys(v as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
};

const looseEqual = (actual: unknown, expected: unknown): boolean => {
  if (typeof actual === "number" && typeof expected === "string" && expected.trim() !== "" && !Number.isNaN(Number(expected))) {
    return actual === Number(expected);
  }
  if (typeof actual === "string" && typeof expected !== "string" && expected !== null && typeof expected !== "object") {
    return actual === String(expected);
  }
  return canonical(actual) === canonical(expected);
};

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

const toRegex = (pattern: string): RegExp => {
  const literal = /^\/(.*)\/([dgimsuy]*)$/s.exec(pattern);
  return literal ? new RegExp(literal[1], literal[2]) : new RegExp(pattern);
};

const lengthOf = (v: unknown): number | null => {
  if (Array.isArray(v) || typeof v === "string") return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return null;
};

// Compares a value using an operator
const compare = (actual: unknown, found: boolean, op: AssertionOperator, expected: unknown): boolean => {
  switch (op) {
    case "exists":
      return found;
    case "notExists":
      return !found;
  }
  if (!found) return op === "neq" || op === "notContains";

  switch (op) {
    case "eq":
      return looseEqual(actual, expected);
    case "neq":
      return !looseEqual(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(actual);
      const e = toNumber(expected);
      if (a === null || e === null) return false;
      return op === "gt" ? a > e : op === "gte" ? a >= e : op === "lt" ? a < e : a <= e;
    }
    case "contains":
    case "notContains": {
      let has = false;
      if (typeof actual === "string") has = actual.includes(String(expected));
      else if (Array.isArray(actual)) has = actual.some((item) => looseEqual(item, expected));
      else if (actual && typeof actual === "object") has = Object.prototype.hasOwnProperty.call(actual, String(expected));
      return op === "contains" ? has : !has;
    }
    case "matches":
      return toRegex(String(expected)).test(typeof actual === "string" ? actual : JSON.stringify(actual));
    case "in":
      return Array.isArray(expected) && expected.some((e) => looseEqual(actual, e));
    case "type": {
      const want = String(expected).toLowerCase();
      if (want === "integer") return Number.isInteger(actual);
      return typeOf(actual) === want;
    }
    case "lengthEq":
      return lengthOf(actual) === toNumber(expected);
  }
};

const describe = (value: unknown): string => {
  if (value === undefined) return "nothing";
  const text = typeof value === "string" ? JSON.stringify(value) : canonical(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

const subject = (a: Assertion): string => {
  switch (a.source) {
    case "status":
      return "status";
    case "latency":
      return "response time (ms)";
    case "size":
      return "response size (bytes)";
    case "header":
      return `header "${a.path}"`;
    case "jsonPath":
      return a.path || "$";
    case "body":
      return "body";
    case "contract":
      return "body";
  }
};

// Lazily parses the response body as JSON once per evaluation
class ResponseView {
  private parsed: { ok: true; value: unknown } | { ok: false; error: string } | null = null;

  constructor(readonly result: ExecutionResult) {}

  json(): { ok: true; value: unknown } | { ok: false; error: string } {
    if (!this.parsed) {
      if (this.result.bodyEncoding !== "utf8") this.parsed = { ok: false, error: "Response body is binary" };
      else {
        try {
          this.parsed = { ok: true, value: JSON.parse(this.result.body) };
        } catch {
          this.parsed = { ok: false, error: "Response body is not valid JSON" };
        }
      }
    }
    return this.parsed;
  }

  header(name: string): string | undefined {
    const lower = name.toLowerCase();
    const values = this.result.headers.filter((h) => h.key.toLowerCase() === lower).map((h) => h.value);
    return values.length ? values.join(", ") : undefined;
  }
}

const evaluateAssertion = (a: Assertion, view: ResponseView, contract?: ContractCheck | null): AssertionResult => {
  const r = view.result;
  const expected = parseExpected(a.expected);
  const fail = (message: string, actual: unknown = undefined): AssertionResult => ({ assertion: a, passed: false, actual, message });

  if (a.source !== "latency" && a.source !== "contract" && r.error) {
    return fail(`No response: ${r.error.message}`);
  }

  if (a.source === "contract") {
    if (!contract) return fail("No contract is linked to this request");
    if (contract.skipped) return fail(`Contract not applied: ${contract.skipped}`);
    const first = contract.errors.slice(0, 3).map((e) => `${e.path || "/"} ${e.message}`);
    return {
      assertion: a,
      passed: contract.valid,
      actual: contract.errors.length,
      message: contract.valid
        ? "Body matches contract"
        : `${contract.errors.length} contract violation(s): ${first.join("; ")}`,
    };
  }

  let actual: unknown;
  let found = true;
  switch (a.source) {
    case "status":
      actual = r.status;
      // "2xx"-style ranges
      if ((a.operator === "eq" || a.operator === "neq") && typeof expected === "string" && /^[1-5]xx$/i.test(expected)) {
        const inRange = Math.floor(r.status / 100) === Number(expected[0]);
        const passed = a.operator === "eq" ? inRange : !inRange;
        return {
          assertion: a,
          passed,
          actual,
          message: passed ? `Status ${r.status} is ${a.operator === "eq" ? "" : "not "}${expected}` : `Expected status to ${OPERATOR_TEXT[a.operator]} ${expected}, got ${r.status}`,
        };
      }
      break;
    case "latency":
      actual = r.timings.totalMs;
      break;
    case "size":
      actual = r.sizeBytes;
      break;
    case "header":
      actual = view.header(a.path);
      found = actual !== undefined;
      break;
    case "body":
      actual = r.body;
      break;
    case "jsonPath": {
      const json = view.json();
      if (!json.ok) return fail(json.error);
      try {
        const res = getPath(json.value, a.path || "$");
        actual = res.value;
        found = res.found;
      } catch (e) {
        if (e instanceof JsonPathError) return fail(e.message);
        throw e;
      }
      break;
    }
  }

  let passed: boolean;
  try {
    passed = compare(actual, found, a.operator, expected);
  } catch (e) {
    return fail(`Invalid assertion: ${(e as Error).message}`, actual);
  }

  const what = subject(a);
  const expectation =
    a.operator === "exists" || a.operator === "notExists"
      ? `Expected ${what} to ${OPERATOR_TEXT[a.operator]}`
      : `Expected ${what} to ${OPERATOR_TEXT[a.operator]} ${describe(expected)}`;
  const message = passed
    ? `${what} ${a.operator === "exists" ? "exists" : a.operator === "notExists" ? "is absent" : `is ${describe(actual)}`}`
    : found
      ? `${expectation}, got ${describe(actual)}`
      : `${expectation}, but it was not found`;

  return { assertion: a, passed, actual, message };
};

export const evaluateAssertions = (
  assertions: Assertion[],
  result: ExecutionResult,
  contract?: ContractCheck | null,
): AssertionResult[] => {
  const view = new ResponseView(result);
  return assertions.filter((a) => a.enabled).map((a) => evaluateAssertion(a, view, contract));
};

interface ExtractionResult {
  variable: string;
  value: string | null;
  error?: string;
}

// Captures values from a response into variables for later requests
export const runExtractions = (extractions: Extraction[], result: ExecutionResult): ExtractionResult[] => {
  const view = new ResponseView(result);
  return extractions
    .filter((x) => x.enabled)
    .map((x) => {
      switch (x.source) {
        case "status":
          return { variable: x.variable, value: String(result.status) };
        case "body":
          return { variable: x.variable, value: result.body };
        case "header": {
          const v = view.header(x.path);
          return v === undefined
            ? { variable: x.variable, value: null, error: `Header "${x.path}" not present` }
            : { variable: x.variable, value: v };
        }
        case "jsonPath": {
          const json = view.json();
          if (!json.ok) return { variable: x.variable, value: null, error: json.error };
          try {
            const { found, value } = getPath(json.value, x.path || "$");
            if (!found) return { variable: x.variable, value: null, error: `${x.path} not found` };
            return { variable: x.variable, value: typeof value === "string" ? value : JSON.stringify(value) };
          } catch (e) {
            return { variable: x.variable, value: null, error: (e as Error).message };
          }
        }
      }
    });
};
