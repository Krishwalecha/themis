import type {
  AiSummary,
  AiTarget,
  CheckStatus,
  Contract,
  ContractChange,
  ContractKind,
  Collection,
  CollectionRun,
  CollectionSummary,
  ContractListItem,
  ContractValidation,
  ContractValidationLogItem,
  ContractVersionInfo,
  Dashboard,
  DryRunResult,
  Environment,
  EnvironmentVariable,
  HistoryEntry,
  HistoryListItem,
  HttpMethod,
  Incident,
  Monitor,
  SavedRequest,
  MonitorCheck,
  MonitorInput,
  MonitorStats,
  RequestSpec,
  Extraction,
  RunOutcome,
  StatsWindow,
  StatusFilter,
  PublicStatus,
  StatusPageSettings,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

const call = async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  // anything that changes monitors, incidents or contracts updates the sidebar's counts straight away
  if (res.ok && rest.method && rest.method !== "GET" && /^\/(monitors|incidents|contracts)(\/|$)/.test(path)) {
    window.dispatchEvent(new CustomEvent("themis:counts"));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/")) {
    // The session expired or was revoked: let the auth provider send the user to sign in.
    window.dispatchEvent(new CustomEvent("themis:unauthorized"));
  }
  if (!res.ok) {
    const detail = data.details?.[0];
    const message = detail ? `${data.error}: ${detail.path ? `${detail.path} ` : ""}${detail.message}` : data.error;
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`, data.details);
  }
  return data as T;
};

interface HistoryQuery {
  q?: string;
  method?: HttpMethod;
  status?: StatusFilter;
  limit?: number;
  before?: string;
  // 1-based page number; the response then includes `total`
  page?: number;
}

const qs = (query: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
};

type Page<T> = { items: T[]; nextCursor: string | null; total?: number };

export interface User {
  id: string;
  name: string;
  email: string;
  username: string | null;
  createdAt: string;
  // false for accounts made with Google until they set a password
  hasPassword: boolean;
}

export interface Whoami {
  monitors: { total: number; active: number; up: number; degraded: number; down: number };
  checks: number;
  daily: number[];
  passRate: number | null;
  requests: number;
}

export type ImportResult =
  | { kind: "curl"; request: RequestSpec; warnings: string[] }
  | {
      kind: "postman" | "openapi";
      collection: { _id: string; name: string; requestCount: number };
      environment: { _id: string; name: string; variables: number } | null;
      contract: { _id: string } | null;
      warnings: string[];
    };

export const api = {
  auth: {
    config: () => call<{ allowSignup: boolean; google: boolean; guestRequests: boolean }>("/auth/config"),
    me: () => call<{ user: User }>("/auth/me"),
    // "email" may also be a username
    login: (body: { email: string; password: string }) => call<{ user: User; firstSignIn: boolean }>("/auth/login", { method: "POST", json: body }),
    register: (body: { name: string; email: string; username?: string; password: string }) =>
      call<{ user: User }>("/auth/register", { method: "POST", json: body }),
    logout: () => call<void>("/auth/logout", { method: "POST" }),
    usernameAvailable: (u: string) => call<{ available: boolean; reason: string | null }>(`/auth/username-available?u=${encodeURIComponent(u)}`),
    updateProfile: (body: { name?: string; username?: string }) => call<{ user: User }>("/auth/me", { method: "PATCH", json: body }),
    changePassword: (body: { currentPassword: string; newPassword: string }) => call<void>("/auth/password", { method: "POST", json: body }),
    deleteAccount: (body: { password: string } | { email: string }) => call<void>("/auth/me", { method: "DELETE", json: body }),
  },

  health: () => call<{ status: string; db: string }>("/health"),

  execute: (body: { request: RequestSpec; environmentId?: string; name?: string; save?: boolean; contractId?: string }) =>
    call<RunOutcome>("/requests/execute", { method: "POST", json: body }),

  history: {
    list: (query: HistoryQuery = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
      return call<Page<HistoryListItem>>(`/history?${params}`);
    },
    get: (id: string) => call<HistoryEntry>(`/history/${id}`),
    rerun: (id: string, environmentId?: string | null) =>
      call<RunOutcome>(`/history/${id}/rerun`, { method: "POST", json: environmentId === undefined ? {} : { environmentId } }),
    rename: (id: string, name: string) => call<HistoryListItem>(`/history/${id}`, { method: "PATCH", json: { name } }),
    remove: (id: string) => call<void>(`/history/${id}`, { method: "DELETE" }),
    clear: () => call<{ deleted: number }>("/history", { method: "DELETE" }),
    bulkDelete: (ids: string[]) => call<{ deleted: number }>("/history/bulk-delete", { method: "POST", json: { ids } }),
  },

  environments: {
    list: () => call<{ items: Environment[] }>("/environments"),
    get: (id: string) => call<Environment>(`/environments/${id}`),
    create: (body: { name: string; variables: EnvironmentVariable[] }) => call<Environment>("/environments", { method: "POST", json: body }),
    update: (id: string, body: { name: string; variables: EnvironmentVariable[] }) => call<Environment>(`/environments/${id}`, { method: "PUT", json: body }),
    duplicate: (id: string) => call<Environment>(`/environments/${id}/duplicate`, { method: "POST" }),
    remove: (id: string) => call<void>(`/environments/${id}`, { method: "DELETE" }),
  },

  collections: {
    list: () => call<{ items: CollectionSummary[] }>("/collections"),
    get: (id: string) => call<Collection>(`/collections/${id}`),
    create: (body: { name: string; description?: string; environmentId?: string | null }) => call<Collection>("/collections", { method: "POST", json: body }),
    update: (id: string, body: { name: string; description?: string; environmentId?: string | null }) =>
      call<Collection>(`/collections/${id}`, { method: "PUT", json: body }),
    remove: (id: string) => call<void>(`/collections/${id}`, { method: "DELETE" }),
    addRequest: (id: string, body: { name: string; request: RequestSpec; contractId?: string | null }) =>
      call<SavedRequest>(`/collections/${id}/requests`, { method: "POST", json: body }),
    updateRequest: (id: string, rid: string, body: { name: string; request: RequestSpec; contractId?: string | null; extract?: Extraction[] }) =>
      call<SavedRequest>(`/collections/${id}/requests/${rid}`, { method: "PUT", json: body }),
    removeRequest: (id: string, rid: string) => call<void>(`/collections/${id}/requests/${rid}`, { method: "DELETE" }),
    reorder: (id: string, ids: string[]) => call<Collection>(`/collections/${id}/reorder`, { method: "POST", json: { ids } }),
    bulkDelete: (ids: string[]) => call<{ deleted: number }>("/collections/bulk-delete", { method: "POST", json: { ids } }),
    run: (id: string, environmentId?: string | null) =>
      call<CollectionRun>(`/collections/${id}/run${environmentId ? `?environmentId=${environmentId}` : ""}`, { method: "POST" }),
  },

  monitors: {
    list: () => call<{ items: Monitor[] }>("/monitors"),
    get: (id: string) => call<Monitor>(`/monitors/${id}`),
    create: (body: MonitorInput) => call<Monitor>("/monitors", { method: "POST", json: body }),
    update: (id: string, body: MonitorInput) => call<Monitor>(`/monitors/${id}`, { method: "PUT", json: body }),
    remove: (id: string) => call<void>(`/monitors/${id}`, { method: "DELETE" }),
    bulkDelete: (ids: string[]) => call<{ deleted: number }>("/monitors/bulk-delete", { method: "POST", json: { ids } }),
    pause: (id: string) => call<Monitor>(`/monitors/${id}/pause`, { method: "POST" }),
    resume: (id: string) => call<Monitor>(`/monitors/${id}/resume`, { method: "POST" }),
    run: (id: string) => call<MonitorCheck>(`/monitors/${id}/run`, { method: "POST" }),
    test: (body: MonitorInput) => call<DryRunResult>("/monitors/test", { method: "POST", json: body }),
    checks: (id: string, query: { status?: CheckStatus | "failing"; limit?: number; before?: string } = {}) =>
      call<Page<MonitorCheck>>(`/monitors/${id}/checks${qs(query)}`),
    stats: (id: string, window: StatsWindow) => call<MonitorStats>(`/monitors/${id}/stats${qs({ window })}`),
  },

  incidents: {
    list: (query: { status?: "open" | "resolved"; monitorId?: string; limit?: number; before?: string; page?: number } = {}) =>
      call<Page<Incident>>(`/incidents${qs(query)}`),
  },

  contracts: {
    list: () => call<{ items: ContractListItem[] }>("/contracts"),
    get: (id: string) => call<Contract>(`/contracts/${id}`),
    create: (body: { name: string; description?: string; kind?: ContractKind; document: string | object }) =>
      call<Contract>("/contracts", { method: "POST", json: body }),
    update: (id: string, body: { name?: string; description?: string; document?: string | object; note?: string }) =>
      call<{ contract: Contract; versioned: boolean; changes: ContractChange[]; breakingCount: number }>(`/contracts/${id}`, {
        method: "PUT",
        json: body,
      }),
    remove: (id: string) => call<void>(`/contracts/${id}`, { method: "DELETE" }),
    versions: (id: string) => call<{ items: ContractVersionInfo[] }>(`/contracts/${id}/versions`),
    preview: (before: string | object, after: string | object, kind?: ContractKind) =>
      call<{ changes: ContractChange[]; breakingCount: number }>("/contracts/diff", { method: "POST", json: { before, after, kind } }),
    validate: (id: string, body: { historyId: string } | { response: { method: string; url: string; status: number; body: string } }) =>
      call<ContractValidation>(`/contracts/${id}/validate`, { method: "POST", json: body }),
    bulkDelete: (ids: string[]) => call<{ deleted: number }>("/contracts/bulk-delete", { method: "POST", json: { ids } }),
    validations: (id: string, page: number, limit: number) =>
      call<{ items: ContractValidationLogItem[]; total: number }>(`/contracts/${id}/validations${qs({ page, limit })}`),
    infer: (body: { historyId: string; title?: string } | { body: string; title?: string }) =>
      call<{ kind: "jsonschema"; document: Record<string, unknown> }>("/contracts/infer", { method: "POST", json: body }),
  },

  ai: {
    status: () => call<{ provider: string; enabled: boolean; model: string }>("/ai/status"),
    summarize: (target: AiTarget, refresh = false) => call<AiSummary>("/ai/summaries", { method: "POST", json: { ...target, refresh } }),
  },

  // a curl command, a Postman collection or an OpenAPI document (JSON or YAML)
  import: (content: string, name?: string) => call<ImportResult>("/import", { method: "POST", json: { content, name } }),

  statusPage: {
    get: () => call<StatusPageSettings>("/status-page"),
    save: (body: StatusPageSettings) => call<StatusPageSettings>("/status-page", { method: "PUT", json: body }),
  },
  // send a request without an account: public addresses only, nothing saved
  guestExecute: (request: RequestSpec) => call<RunOutcome>("/public/execute", { method: "POST", json: { request } }),
  publicStatus: (slug: string) => call<PublicStatus>(`/public/status/${encodeURIComponent(slug)}`),

  dashboard: (window: StatsWindow) => call<Dashboard>(`/dashboard${qs({ window })}`),
  whoami: () => call<Whoami>("/dashboard/whoami"),
};
