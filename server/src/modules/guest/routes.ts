import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { config } from "../../config";
import { HttpError } from "../../lib/errors";
import { executeRequest } from "../../lib/executor";
import { interpolateSpec } from "../../lib/interpolate";
import { requestSpecSchema } from "../../schemas/requestSpec";
import { rateLimit } from "../auth/rateLimit";
import { delivered } from "../requests/service";

// Try Themis without an account. Visitors aren't trusted like signed-in users: public addresses only (always),
// a short timeout, a 1 MB response cap, tight per-IP limits, and nothing is saved.
const GUEST_TIMEOUT_MS = 15_000;
const GUEST_MAX_RESPONSE_BYTES = 1024 * 1024;
const perMinute = rateLimit({ windowMs: 60_000, max: 20, name: "guest" });
const perDay = rateLimit({ windowMs: 24 * 3600_000, max: 200, name: "guest" });

export const guestRouter = Router();

// checked first, so a server with guests turned off says so plainly
const enabled: RequestHandler = (_req, _res, next) =>
  next(config.guestRequests ? undefined : new HttpError(404, "Trying Themis without an account is turned off on this server"));

guestRouter.post("/execute", enabled, perMinute, perDay, async (req, res) => {
  const { request } = z.object({ request: requestSpecSchema }).parse(req.body);
  // no environments for guests: any {{variable}} is reported as unresolved and sent as written
  const { spec, unresolved } = interpolateSpec({ ...request, timeoutMs: Math.min(request.timeoutMs ?? GUEST_TIMEOUT_MS, GUEST_TIMEOUT_MS) }, {});
  const result = await executeRequest(spec, { publicOnly: true, maxResponseBytes: GUEST_MAX_RESPONSE_BYTES });
  res.json({ historyId: null, result, unresolvedVariables: unresolved, verdict: delivered(result) ? "pass" : "fail" });
});
