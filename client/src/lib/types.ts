export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

// an attached file, base64; history keeps only name and size (data "")
export interface FileData {
  name: string;
  type: string;
  size: number;
  data: string;
}

// one field of a multipart form: text, or a file
export interface FormPart {
  key: string;
  enabled: boolean;
  kind: "text" | "file";
  value: string;
  file?: FileData | null;
}

export type RequestBody =
  | { mode: "none" }
  | { mode: "json"; content: string }
  | { mode: "text"; content: string }
  | { mode: "form-urlencoded"; form: KeyValue[] }
  | { mode: "multipart"; parts: FormPart[] }
  | { mode: "binary"; file?: FileData | null };

export type RequestAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; key: string; value: string; in: "header" | "query" };

export interface RequestSpec {
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: RequestAuth;
  timeoutMs?: number;
  followRedirects: boolean;
}

export interface HeaderPair {
  key: string;
  value: string;
}

export interface ExecutionResult {
  request: { method: string; url: string; headers: HeaderPair[]; body?: string };
  status: number;
  statusText: string;
  headers: HeaderPair[];
  contentType: string;
  body: string;
  bodyEncoding: "utf8" | "base64";
  sizeBytes: number;
  truncated: boolean;
  timings: { ttfbMs: number; totalMs: number };
  redirected: boolean;
  finalUrl: string;
  error?: { code: string; message: string };
}

export interface RunOutcome {
  historyId: string | null;
  result: ExecutionResult;
  unresolvedVariables: string[];
  // Present when the request was sent with a contract to validate against
  contract?: (ContractValidation & { contractId: string; name: string }) | null;
}

export interface HistoryListItem {
  _id: string;
  name?: string;
  method: HttpMethod;
  url: string;
  resolvedUrl: string;
  status: number;
  latencyMs: number;
  sizeBytes: number;
  errorCode?: string;
  environmentId?: string;
  rerunOf?: string;
  createdAt: string;
}

export interface HistoryEntry extends HistoryListItem {
  request: RequestSpec;
  requestHeaders: HeaderPair[];
  unresolvedVariables: string[];
  response: {
    statusText: string;
    headers: HeaderPair[];
    contentType: string;
    body: string;
    bodyEncoding: "utf8" | "base64";
    truncated: boolean;
    storedBodyTruncated: boolean;
    ttfbMs: number;
    redirected: boolean;
    finalUrl: string;
    error?: { code: string; message: string };
  };
}

export interface EnvironmentVariable extends KeyValue {
  secret: boolean;
}

export interface Environment {
  _id: string;
  name: string;
  variables: EnvironmentVariable[];
  createdAt: string;
  updatedAt: string;
}

export type StatusFilter = "2xx" | "3xx" | "4xx" | "5xx" | "error";

// Converts a stored history entry back into the ExecutionResult shape the response viewer renders
export const historyToResult = (entry: HistoryEntry): ExecutionResult => {
  return {
    request: { method: entry.method, url: entry.resolvedUrl, headers: entry.requestHeaders ?? [] },
    status: entry.status,
    statusText: entry.response.statusText,
    headers: entry.response.headers,
    contentType: entry.response.contentType,
    body: entry.response.body,
    bodyEncoding: entry.response.bodyEncoding,
    sizeBytes: entry.sizeBytes,
    truncated: entry.response.truncated || entry.response.storedBodyTruncated,
    timings: { ttfbMs: entry.response.ttfbMs, totalMs: entry.latencyMs },
    redirected: entry.response.redirected,
    finalUrl: entry.response.finalUrl,
    error: entry.response.error?.code ? entry.response.error : undefined,
  };
};

export const emptyRequest = (): RequestSpec => {
  return {
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: { mode: "none" },
    auth: { type: "none" },
    followRedirects: true,
  };
};

/* ---------- Monitoring ---------- */

export const ASSERTION_SOURCES = ["status", "latency", "header", "jsonPath", "body", "size"] as const;
type AssertionSource = (typeof ASSERTION_SOURCES)[number] | "contract";
export const ASSERTION_OPERATORS = [
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
type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

export interface Assertion {
  source: AssertionSource;
  path: string;
  operator: AssertionOperator;
  expected: string;
  enabled: boolean;
  severity?: "critical" | "warning";
}

export type Schedule = { type: "interval"; seconds: number } | { type: "cron"; expression: string; timezone?: string };
export type MonitorStatus = "pending" | "up" | "degraded" | "down" | "paused";
export type CheckStatus = "up" | "degraded" | "down";

// planned downtime: checks still run but open no incidents and send no alerts
export interface MaintenanceWindow {
  startsAt: string;
  endsAt: string;
  note?: string;
}

export interface MonitorInput {
  name: string;
  description?: string;
  request: RequestSpec;
  // set when the monitor runs a whole collection instead of one request
  collectionId?: string | null;
  maintenance?: MaintenanceWindow[];
  environmentId?: string | null;
  schedule: Schedule;
  assertions: Assertion[];
  failureThreshold: number;
  enabled: boolean;
  alerts: { webhookUrl?: string; notifyOnRecovery: boolean };
  tags: string[];
  contractId?: string | null;
  contractSeverity?: "warning" | "critical";
}

export interface Monitor extends MonitorInput {
  _id: string;
  collectionName?: string | null;
  scheduleLabel?: string;
  createdAt: string;
  updatedAt: string;
  state: {
    status: MonitorStatus;
    lastCheckedAt?: string;
    lastStatusCode?: number;
    lastLatencyMs?: number;
    lastError?: string | null;
    consecutiveFailures: number;
    nextRunAt?: string | null;
    openIncidentId?: string | null;
  };
  last24h?: { checks: number; uptimePct: number | null; avgLatencyMs: number | null };
  timeline?: { start: string; worst: CheckStatus | "none"; total: number }[];
}

export interface AssertionOutcome extends Partial<Assertion> {
  passed: boolean;
  message: string;
  severity?: "critical" | "warning";
}

export interface MonitorCheck {
  _id: string;
  monitorId: string;
  maintenance?: boolean;
  status: CheckStatus;
  statusCode: number;
  latencyMs: number;
  ttfbMs?: number;
  sizeBytes?: number;
  error?: { code?: string; message?: string };
  failures: string[];
  assertions: AssertionOutcome[];
  trigger: "scheduled" | "manual";
  checkedAt: string;
  contract?: {
    contractId: string;
    validationId?: string;
    version: number;
    valid: boolean;
    skipped?: string;
    errorCount: number;
    driftCount: number;
    errors: ContractError[];
    drift: DriftItem[];
  };
}

interface LatencyStats {
  avg: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

interface CheckStats {
  total: number;
  up: number;
  degraded: number;
  down: number;
  uptimePct: number | null;
  successRate: number | null;
  errorRate: number | null;
  latency: LatencyStats;
}

export interface SeriesBucket {
  start: string;
  total: number;
  up: number;
  degraded: number;
  down: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  worst: CheckStatus | "none";
}

export type StatsWindow = "1h" | "24h" | "7d" | "30d";

export interface MonitorStats extends CheckStats {
  window: StatsWindow;
  from: string;
  to: string;
  series: SeriesBucket[];
}

export interface Incident {
  _id: string;
  monitorId: string;
  monitorName: string;
  status: "open" | "resolved";
  severity: "degraded" | "down";
  cause: string;
  startedAt: string;
  resolvedAt?: string;
  durationMs?: number;
  failedChecks: number;
  timeline: { at: string; type: string; message: string }[];
}

export interface DryRunResult {
  status: CheckStatus;
  failures: string[];
  assertions: AssertionOutcome[];
  statusCode: number;
  latencyMs: number;
  error?: { code: string; message: string };
  unresolvedVariables: string[];
}

export interface Dashboard {
  window: StatsWindow;
  from: string;
  to: string;
  monitors: Record<MonitorStatus, number> & { total: number };
  checks: CheckStats;
  series: SeriesBucket[];
  incidents: { open: Incident[]; openCount: number; resolvedInWindow: number; mttrMs: number | null };
  recentFailures: (MonitorCheck & { monitorName: string })[];
  monitorRows: {
    _id: string;
    name: string;
    method: string;
    url: string;
    status: MonitorStatus;
    lastCheckedAt: string | null;
    lastLatencyMs: number | null;
    uptimePct: number | null;
    p95LatencyMs: number | null;
    checks: number;
    timeline: { start: string; worst: CheckStatus | "none"; avgLatencyMs: number | null }[];
  }[];
  requests: { total: number; avgLatencyMs: number | null; statusClasses: Record<string, number> };
  contracts: {
    total: number;
    validations: number;
    passRate: number | null;
    withDrift: number;
    recentViolations: (ContractValidationLogItem & { contractId: string; contractName: string })[];
    series: { start: string; total: number; passRate: number | null }[];
  };
  previous: {
    uptimePct: number | null;
    p95LatencyMs: number | null;
    avgLatencyMs: number | null;
    checks: number;
    failures: number;
    contractPassRate: number | null;
  };
  pulse: { start: string; worst: CheckStatus | "none"; total: number; avgLatencyMs: number | null }[];
  latestChecks: {
    _id: string;
    monitorId: string;
    monitorName: string;
    method: string;
    status: CheckStatus;
    statusCode: number;
    errorCode?: string;
    latencyMs: number;
    checkedAt: string;
  }[];
  activity: {
    kind: "incident_opened" | "incident_resolved" | "contract_violation";
    at: string;
    title: string;
    detail: string;
    severity: "down" | "degraded" | "ok" | "warning";
    link: string;
  }[];
}

/* ---------- Contracts ---------- */

export type ContractKind = "openapi" | "jsonschema";

interface ContractError {
  path: string;
  message: string;
  keyword: string;
}

interface DriftItem {
  path: string;
  kind: "undocumented";
  message: string;
}

export interface ContractValidation {
  // Log entry id (present when the validation was recorded)
  validationId?: string;
  valid: boolean;
  skipped?: string;
  matched?: { path: string; method: string; status: string };
  errors: ContractError[];
  drift: DriftItem[];
}

export interface ContractChange {
  location: string;
  path: string;
  type: string;
  breaking: boolean;
  message: string;
}

interface OperationSummary {
  path: string;
  method: string;
  summary?: string;
  operationId?: string;
  responses: string[];
}

export interface ContractListItem {
  _id: string;
  name: string;
  description?: string;
  kind: ContractKind;
  version: number;
  title?: string;
  operationCount: number;
  last24h: { validations: number; passRate: number | null };
  lastValidation?: ContractVerdict | null;
  updatedAt: string;
}

// the newest real check of a contract: its current verdict on the API
export interface ContractVerdict {
  valid: boolean;
  errorCount: number;
  at: string;
  contractVersion: number | null;
}

export interface Contract {
  _id: string;
  name: string;
  description?: string;
  kind: ContractKind;
  version: number;
  document: Record<string, unknown>;
  operations: OperationSummary[];
  linkedMonitors?: { _id: string; name: string; state: { status: MonitorStatus } }[];
  lastValidation?: ContractVerdict | null;
  updatedAt: string;
}

export interface ContractVersionInfo {
  _id: string;
  version: number;
  note?: string;
  changes: ContractChange[];
  breakingCount: number;
  createdAt: string;
  // the newest real check against this version, if any
  verdict?: { valid: boolean; errorCount: number; at: string } | null;
}

export interface ContractValidationLogItem extends ContractValidation {
  _id: string;
  source: "workspace" | "history" | "monitor" | "manual";
  method?: string;
  url?: string;
  status?: number;
  errorCount: number;
  driftCount: number;
  at: string;
}

/* ---------- AI summaries ---------- */

export type AiLevel = "ok" | "info" | "warning" | "critical";

export interface AiSummary {
  _id: string;
  targetType: "history" | "monitor" | "contractValidation" | "ops";
  source: "groq" | "heuristic";
  model?: string | null;
  note?: string;
  cached: boolean;
  createdAt: string;
  summary: {
    headline: string;
    severity: AiLevel;
    summary: string;
    highlights: { level: AiLevel; text: string }[];
    recommendations: string[];
  };
}

export type AiTarget =
  | { targetType: "history"; targetId: string }
  | { targetType: "contractValidation"; targetId: string }
  | { targetType: "monitor"; targetId: string; window: StatsWindow }
  | { targetType: "ops"; window: StatsWindow };

// a value captured from a response into a variable for the requests after it
export interface Extraction {
  variable: string;
  source: "jsonPath" | "header" | "status" | "body";
  path: string;
  enabled: boolean;
}

export interface SavedRequest {
  _id: string;
  name: string;
  request: RequestSpec;
  contractId: string | null;
  extract?: Extraction[];
  updatedAt: string;
}

export interface CollectionSummary {
  _id: string;
  name: string;
  description: string;
  environmentId: string | null;
  requestCount: number;
  requests: Array<{ _id: string; name: string; method: HttpMethod; url: string }>;
  updatedAt: string;
}

export interface Collection {
  _id: string;
  name: string;
  description: string;
  environmentId: string | null;
  requests: SavedRequest[];
  updatedAt: string;
}

export interface CollectionRunResult {
  requestId: string;
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  latencyMs: number;
  error: { code: string; message: string } | null;
  contract: { name: string; valid: boolean; errors: Array<{ path: string; message: string }> } | null;
  historyId: string | null;
  unresolvedVariables?: string[];
  extracted?: { variable: string; captured: boolean; error: string | null }[];
  reason?: string | null;
  verdict: "pass" | "fail";
}

export interface CollectionRun {
  collectionId: string;
  name: string;
  environmentId: string | null;
  passed: number;
  failed: number;
  durationMs: number;
  verdict: "pass" | "fail";
  results: CollectionRunResult[];
}

// the account's public status page settings
export interface StatusPageSettings {
  enabled: boolean;
  slug: string;
  title: string;
  monitorIds: string[];
}

// what anyone can see at /status/:slug
export interface PublicStatus {
  title: string;
  status: "operational" | "degraded" | "down";
  updatedAt: string;
  monitors: {
    id: string;
    name: string;
    status: MonitorStatus;
    uptimePct: number | null;
    days: { start: string; worst: CheckStatus | "none"; total: number }[];
  }[];
  incidents: {
    id: string;
    monitorName: string;
    severity: "degraded" | "down";
    status: "open" | "resolved";
    startedAt: string;
    resolvedAt: string | null;
    durationMs: number | null;
  }[];
}
