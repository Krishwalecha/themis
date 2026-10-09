import type { Types } from "mongoose";
import { config } from "../../config";
import { notFound } from "../../lib/errors";
import { executeRequest, type ExecutionResult } from "../../lib/executor";
import { interpolateSpec, maskSecrets, variablesFrom } from "../../lib/interpolate";
import { Environment } from "../../models/Environment";
import { History } from "../../models/History";
import { withoutFileData, type RequestSpec } from "../../schemas/requestSpec";
import type { ContractDoc } from "../../models/Contract";
import { validateAndLog } from "../contracts/service";

interface RunOptions {
  spec: RequestSpec;
  environmentId?: string;
  name?: string;
  rerunOf?: Types.ObjectId | string;
  save?: boolean;
  // extra variables layered over the environment's, e.g. values captured earlier in a collection run
  variables?: Record<string, string>;
}

interface RunOutcome {
  historyId: string | null;
  result: ExecutionResult;
  unresolvedVariables: string[];
}

// values that must never come back to the browser: secret environment variables, and values captured mid-run (often tokens)
const loadSecrets = async (environmentId?: string): Promise<string[]> => {
  if (!environmentId) return [];
  const env = await Environment.findById(environmentId).lean();
  return (env?.variables ?? []).filter((v) => v.secret && v.enabled !== false && v.value).map((v) => String(v.value));
};

export const loadVariables = async (environmentId?: string): Promise<Record<string, string>> => {
  if (!environmentId) return {};
  const env = await Environment.findById(environmentId).lean();
  if (!env) throw notFound("Environment");
  return variablesFrom(env.variables);
};

const storedBody = (result: ExecutionResult): { body: string; storedBodyTruncated: boolean } => {
  const limit = config.request.maxStoredBodyBytes;
  if (Buffer.byteLength(result.body) <= limit) return { body: result.body, storedBodyTruncated: false };
  return { body: Buffer.from(result.body).subarray(0, limit).toString(), storedBodyTruncated: true };
};

// Interpolates, executes and (optionally) records a request in history
export const runRequest = async (opts: RunOptions): Promise<RunOutcome> => {
  const variables = { ...(await loadVariables(opts.environmentId)), ...opts.variables };
  const { spec: resolved, unresolved } = interpolateSpec(opts.spec, variables);
  const result = await executeRequest(resolved);
  const secrets = [...(await loadSecrets(opts.environmentId)), ...Object.values(opts.variables ?? {})];
  if (secrets.length) {
    result.request = {
      ...result.request,
      url: maskSecrets(result.request.url, secrets),
      headers: result.request.headers.map((h) => ({ ...h, value: maskSecrets(h.value, secrets) })),
      body: result.request.body === undefined ? undefined : maskSecrets(result.request.body, secrets),
    };
    result.finalUrl = maskSecrets(result.finalUrl, secrets);
  }

  if (opts.save === false) return { historyId: null, result, unresolvedVariables: unresolved };

  const { body, storedBodyTruncated } = storedBody(result);
  const entry = await History.create({
    name: opts.name,
    request: withoutFileData(opts.spec),
    environmentId: opts.environmentId,
    method: opts.spec.method,
    url: opts.spec.url,
    resolvedUrl: result.request.url,
    status: result.status,
    latencyMs: result.timings.totalMs,
    sizeBytes: result.sizeBytes,
    errorCode: result.error?.code,
    response: {
      statusText: result.statusText,
      headers: result.headers,
      contentType: result.contentType,
      body,
      bodyEncoding: result.bodyEncoding,
      truncated: result.truncated,
      storedBodyTruncated,
      ttfbMs: result.timings.ttfbMs,
      redirected: result.redirected,
      finalUrl: result.finalUrl,
      error: result.error,
    },
    requestHeaders: result.request.headers,
    unresolvedVariables: unresolved,
    rerunOf: opts.rerunOf,
  });

  return { historyId: String(entry._id), result, unresolvedVariables: unresolved };
};

// the request went out and came back without a transport error or a 4xx/5xx
export const delivered = (r: ExecutionResult) => !r.error && r.status < 400;

// checks a run's response against a contract and logs it; null when nothing came back to check
export const checkContract = (contract: ContractDoc, outcome: RunOutcome) => {
  const r = outcome.result;
  if (r.error) return null;
  return validateAndLog(
    contract,
    { method: r.request.method, url: r.request.url, status: r.status, body: r.bodyEncoding === "utf8" ? r.body : "" },
    "workspace",
    outcome.historyId ?? undefined,
  );
};
