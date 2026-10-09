import { Router, type RequestHandler } from "express";
import type { Types } from "mongoose";
import { z } from "zod";
import { config } from "../../config";
import { HttpError } from "../../lib/errors";
import { runAs } from "../../lib/tenant";
import { User } from "../../models/User";
import { rateLimit } from "./rateLimit";
import { randomBytes } from "node:crypto";
import { changePassword, deleteAccount, endSession, hasPassword, login, readCookie, register, resolveSession, signInWithGoogle, startSession, toPublic } from "./service";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { _id: Types.ObjectId; name: string; email: string; username?: string | null; createdAt?: Date | null };
      sessionId?: Types.ObjectId;
    }
  }
}

const password = z.string().min(8, "Use at least 8 characters").max(200);
const email = z.string().trim().toLowerCase().email("Enter a valid email").max(254);

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Use 3 to 20 letters, numbers or underscores");
const registerBody = z.object({ name: z.string().trim().min(1, "Tell us your name").max(80), email, username: username.optional(), password });
// "email" holds an email or a username
const loginBody = z.object({ email: z.string().trim().min(1, "Enter your email or username").max(254), password: z.string().min(1, "Enter your password").max(200) });
// an empty username clears it
const profileBody = z
  .object({ name: z.string().trim().min(1).max(80).optional(), username: z.union([username, z.literal("")]).optional() })
  .refine((b) => b.name !== undefined || b.username !== undefined, "Nothing to update");
// an account made with Google has no current password yet
const passwordBody = z.object({ currentPassword: z.string().max(200).default(""), newPassword: password });
// the password, or (for an account made with Google) the account's email
const deleteBody = z.object({ password: z.string().max(200).optional(), email: z.string().max(254).optional() });

export const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, name: "sign-in" });
// checked while typing on the sign-up form, so it gets its own, looser budget
const usernameLimiter = rateLimit({ windowMs: 60_000, max: 60, name: "username-check" });

// Rejects anonymous requests and runs the rest of the request scoped to the signed-in user's data
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const resolved = await resolveSession(req);
    if (!resolved) throw new HttpError(401, "Sign in to continue");
    req.user = resolved.user;
    req.sessionId = resolved.session._id;
    runAs(resolved.user._id, () => next());
  } catch (e) {
    next(e);
  }
};

export const authRouter = Router();

authRouter.get("/config", (_req, res) => {
  res.json({ allowSignup: config.auth.allowSignup, google: Boolean(config.google.clientId && config.google.clientSecret), guestRequests: config.guestRequests });
});

// ---- Continue with Google (OAuth 2.0 authorization code flow) ----
const OAUTH_COOKIE = "themis_oauth";
const googleRedirectUri = () => `${config.appUrl}/api/auth/google/callback`;
// only same-site paths, so the sign-in can't bounce visitors to another site
const safeNext = (next: unknown) => (typeof next === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : "/dashboard");

authRouter.get("/google", (req, res) => {
  if (!config.google.clientId || !config.google.clientSecret) throw new HttpError(404, "Google sign-in isn't set up on this server");
  const state = randomBytes(24).toString("base64url");
  res.cookie(OAUTH_COOKIE, JSON.stringify({ state, next: safeNext(req.query.next) }), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.auth.secureCookies,
    path: "/api/auth",
    maxAge: 10 * 60_000,
  });
  const url = new URL(config.google.authUrl);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  res.redirect(url.toString());
});

authRouter.get("/google/callback", authLimiter, async (req, res) => {
  const fail = (message: string) => res.redirect(`${config.appUrl}/login?${new URLSearchParams({ oauthError: message })}`);
  let saved: { state?: string; next?: string } = {};
  try {
    saved = JSON.parse(readCookie(req, OAUTH_COOKIE) ?? "{}");
  } catch {
    /* treated as missing */
  }
  res.clearCookie(OAUTH_COOKIE, { path: "/api/auth" });
  if (req.query.error) return fail("Google sign-in was cancelled");
  if (!saved.state || saved.state !== req.query.state || typeof req.query.code !== "string") return fail("That sign-in link expired. Try again.");

  // the code is exchanged server-to-server over TLS, so the id_token comes straight from Google
  const tokenRes = await fetch(config.google.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: req.query.code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  }).catch(() => null);
  const token = tokenRes?.ok ? ((await tokenRes.json()) as { id_token?: string }) : null;
  const claims = (() => {
    try {
      return JSON.parse(Buffer.from(String(token?.id_token).split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  const issuerOk = claims && (claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com");
  if (!claims || !issuerOk || claims.aud !== config.google.clientId || typeof claims.sub !== "string" || typeof claims.email !== "string")
    return fail("Google sign-in didn't complete. Try again.");
  if (claims.email_verified !== true) return fail("Verify your Google email first, then try again.");

  try {
    const { user, firstSignIn } = await signInWithGoogle({ sub: claims.sub, email: claims.email, name: String(claims.name ?? "") });
    await startSession(req, res, user._id);
    res.redirect(`${config.appUrl}/login?${new URLSearchParams({ oauth: "1", first: firstSignIn ? "1" : "0", next: safeNext(saved.next) })}`);
  } catch (e) {
    fail((e as Error).message);
  }
});

// creates the account only; signing in is a separate step
authRouter.post("/register", authLimiter, async (req, res) => {
  const body = registerBody.parse(req.body);
  const user = await register(body);
  res.status(201).json({ user: toPublic(user) });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const body = loginBody.parse(req.body);
  const { user, firstSignIn } = await login(body);
  await startSession(req, res, user._id);
  res.json({ user: toPublic(user), firstSignIn });
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: toPublic({ ...req.user!, hasPassword: await hasPassword(req.user!._id) }) });
});

// public so the sign-up form can check; signed in, your own handle counts as available
authRouter.get("/username-available", usernameLimiter, async (req, res) => {
  const parsed = username.safeParse(String(req.query.u ?? ""));
  if (!parsed.success) return void res.json({ available: false, reason: parsed.error.issues[0]?.message ?? "Invalid username" });
  const me = (await resolveSession(req))?.user;
  const owner = await User.findOne({ username: parsed.data }, { _id: 1 }).lean();
  const available = !owner || (me != null && String(owner._id) === String(me._id));
  res.json({ available, reason: available ? null : "That username is taken" });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const { name, username } = profileBody.parse(req.body);
  const update: { $set: Record<string, string>; $unset?: Record<string, 1> } = { $set: {} };
  if (name !== undefined) update.$set.name = name;
  if (username) update.$set.username = username;
  else if (username === "") update.$unset = { username: 1 };
  let user;
  try {
    user = await User.findByIdAndUpdate(req.user!._id, update, { new: true }).lean();
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new HttpError(409, "That username is taken");
    throw e;
  }
  if (!user) throw new HttpError(404, "User not found");
  res.json({ user: toPublic({ ...user, hasPassword: await hasPassword(user._id) }) });
});

authRouter.post("/password", requireAuth, authLimiter, async (req, res) => {
  const body = passwordBody.parse(req.body);
  await changePassword(req.user!._id, body.currentPassword, body.newPassword, req.sessionId!);
  res.status(204).end();
});

authRouter.delete("/me", requireAuth, authLimiter, async (req, res) => {
  const body = deleteBody.parse(req.body);
  await deleteAccount(req.user!._id, body);
  await endSession(req, res);
  res.status(204).end();
});
