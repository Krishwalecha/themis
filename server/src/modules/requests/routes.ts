import { Router } from "express";
import { z } from "zod";
import { objectId } from "../../lib/objectId";
import { requestSpecSchema } from "../../schemas/requestSpec";
import { loadContract } from "../contracts/service";
import { checkContract, delivered, runRequest } from "./service";
import { rateLimit } from "../auth/rateLimit";

const executeBody = z.object({
  request: requestSpecSchema,
  environmentId: objectId.optional(),
  name: z.string().trim().max(200).optional(),
  save: z.boolean().default(true),
  // Validate the response against this contract and include the result
  contractId: objectId.optional(),
});

export const requestsRouter = Router();

const strictQuery = z.object({ strict: z.enum(["1", "true"]).optional() });

// the server sends these on the user's behalf, so one account can't flood it
const sendLimiter = rateLimit({ windowMs: 60_000, max: 120, name: "send" });

requestsRouter.post("/execute", sendLimiter, async (req, res) => {
  const body = executeBody.parse(req.body);
  const strict = Boolean(strictQuery.parse(req.query).strict);
  const outcome = await runRequest({
    spec: body.request,
    environmentId: body.environmentId,
    name: body.name,
    save: body.save,
  });
  const sent = delivered(outcome.result);
  if (!body.contractId) {
    res.status(strict && !sent ? 422 : 200).json({ ...outcome, verdict: sent ? "pass" : "fail" });
    return;
  }
  const contract = await loadContract(body.contractId);
  const validation = await checkContract(contract, outcome);
  const pass = sent && Boolean(validation?.valid);
  res
    .status(strict && !pass ? 422 : 200)
    .json({ ...outcome, verdict: pass ? "pass" : "fail", contract: validation && { contractId: String(contract._id), name: contract.name, ...validation } });
});
