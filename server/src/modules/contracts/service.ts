import type { Types } from "mongoose";
import { parse as parseYaml } from "yaml";
import { HttpError, notFound } from "../../lib/errors";
import { validateResponse, type ContractKind, type ContractValidation, type ResponseSample } from "../../lib/contracts/validate";
import { isOpenApi } from "../../lib/contracts/openapi";
import { Contract, ContractValidationLog, type ContractDoc } from "../../models/Contract";

// Accepts a parsed object, or JSON / YAML text
export const parseDocument = (input: unknown): unknown => {
  if (typeof input !== "string") return input;
  const text = input.trim();
  if (!text) throw new HttpError(400, "Contract document is empty");
  try {
    return JSON.parse(text);
  } catch {
    try {
      return parseYaml(text);
    } catch (e) {
      throw new HttpError(400, `Document is neither valid JSON nor YAML: ${(e as Error).message}`);
    }
  }
};

export const detectKind = (doc: unknown): ContractKind => {
  return isOpenApi(doc) ? "openapi" : "jsonschema";
};

export const loadContract = async (id: Types.ObjectId | string): Promise<ContractDoc> => {
  const contract = await Contract.findById(id).lean<ContractDoc>();
  if (!contract) throw notFound("Contract");
  return contract;
};

const validateWith = (contract: ContractDoc, sample: ResponseSample): ContractValidation => {
  return validateResponse(contract.kind as ContractKind, contract.document, sample, `${contract._id}@${contract.version}`);
};

// Validates and records the result in the validation log
export const validateAndLog = async (
  contract: ContractDoc,
  sample: ResponseSample,
  source: "workspace" | "history" | "monitor" | "manual",
  sourceId?: Types.ObjectId | string,
): Promise<ContractValidation & { validationId: string }> => {
  const result = validateWith(contract, sample);
  const log = await ContractValidationLog.create({
    contractId: contract._id,
    contractVersion: contract.version,
    source,
    sourceId,
    method: sample.method,
    url: sample.url,
    status: sample.status,
    valid: result.valid,
    skipped: result.skipped,
    matched: result.matched,
    errorCount: result.errors.length,
    driftCount: result.drift.length,
    errors: result.errors.slice(0, 50),
    drift: result.drift.slice(0, 50),
  });
  return { ...result, validationId: String(log._id) };
};
