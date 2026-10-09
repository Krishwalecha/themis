import type { RequestHandler } from "express";
import { HttpError } from "../../lib/errors";

// Fixed-window, in-memory limiter (single-process deployments). Keyed by the signed-in account when there is one,
// otherwise by client IP.
export const rateLimit = ({ windowMs, max, name }: { windowMs: number; max: number; name: string }): RequestHandler & { reset: () => void } => {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  sweep.unref?.();

  const handler: RequestHandler = (req, res, next) => {
    const key = req.user ? `u:${req.user._id}` : `ip:${req.ip ?? "unknown"}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      next(new HttpError(429, `Too many ${name} requests. Try again in ${retry < 60 ? `${retry}s` : `${Math.ceil(retry / 60)} min`}.`));
      return;
    }
    next();
  };
  return Object.assign(handler, { reset: () => hits.clear() });
};
