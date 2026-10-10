import type { Types } from "mongoose";
import { runExtractions } from "../../lib/assertions";
import { requestSpecSchema } from "../../schemas/requestSpec";
import { extractionSchema } from "../../schemas/testing";
import { loadContract } from "../contracts/service";
import { checkContract, delivered, runRequest } from "../requests/service";

interface SavedRequest {
  _id: Types.ObjectId | string;
  name: string;
  request: unknown;
  contractId?: Types.ObjectId | string | null;
  extract?: unknown[];
}

interface RunnableCollection {
  _id: Types.ObjectId | string;
  name: string;
  environmentId?: Types.ObjectId | string | null;
  requests: SavedRequest[];
}

// one line on why a request in the chain failed
const reasonFor = (r: { error: { code: string } | null; status: number; contract: { name: string; valid: boolean; errors: { path?: string | null; message?: string | null }[] } | null }) =>
  r.error
    ? r.error.code
    : r.status >= 400
      ? `status ${r.status}`
      : r.contract && !r.contract.valid
        ? `contract ${r.contract.name}: ${r.contract.errors[0]?.path || "(root)"} ${r.contract.errors[0]?.message ?? ""}`.trim()
        : "";

// Runs every request in order. Values captured by one request's extract rules become {{variables}} for the
// requests after it, so a chain like "log in, create an order, fetch it" works in a single run.
export const runCollection = async (c: RunnableCollection, opts: { environmentId?: string; save?: boolean } = {}) => {
  const env = opts.environmentId ?? (c.environmentId ? String(c.environmentId) : undefined);
  const captured: Record<string, string> = {};
  const started = Date.now();
  const results = [];
  for (const saved of c.requests) {
    const outcome = await runRequest({ spec: requestSpecSchema.parse(saved.request), environmentId: env, name: saved.name, save: opts.save, variables: captured });
    const r = outcome.result;
    const doc = saved.contractId ? await loadContract(saved.contractId).catch(() => null) : null;
    const v = doc && (await checkContract(doc, outcome));
    const contract = doc && v ? { name: doc.name, valid: v.valid, errors: v.errors } : null;

    // captured values are reported as captured or missing, never echoed: they are often tokens
    const extracted = r.error ? [] : runExtractions((saved.extract ?? []).map((x) => extractionSchema.parse(x)), r);
    for (const x of extracted) if (x.value !== null) captured[x.variable] = x.value;

    const pass = delivered(r) && (!contract || contract.valid);
    const result = {
      requestId: saved._id,
      name: saved.name,
      method: r.request.method,
      url: r.request.url,
      status: r.status,
      latencyMs: r.timings.totalMs,
      error: r.error ?? null,
      contract,
      historyId: outcome.historyId,
      unresolvedVariables: outcome.unresolvedVariables,
      extracted: extracted.map((x) => ({ variable: x.variable, captured: x.value !== null, error: x.error ?? null })),
      verdict: (pass ? "pass" : "fail") as "pass" | "fail",
    };
    results.push({ ...result, reason: pass ? null : reasonFor(result) });
  }
  const failed = results.filter((r) => r.verdict === "fail").length;
  return {
    collectionId: c._id,
    name: c.name,
    environmentId: env ?? null,
    passed: results.length - failed,
    failed,
    durationMs: Date.now() - started,
    verdict: (failed ? "fail" : "pass") as "pass" | "fail",
    results,
  };
};
