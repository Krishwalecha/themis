import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { Model, Types } from "mongoose";
import { config } from "../../config";
import { HttpError } from "../../lib/errors";
import { runUnscoped } from "../../lib/tenant";
import { AiSummary } from "../../models/AiSummary";
import { Collection } from "../../models/Collection";
import { Contract, ContractValidationLog, ContractVersion } from "../../models/Contract";
import { Environment } from "../../models/Environment";
import { History } from "../../models/History";
import { Incident } from "../../models/Incident";
import { Monitor } from "../../models/Monitor";
import { MonitorCheck } from "../../models/MonitorCheck";
import { StatusPage } from "../../models/StatusPage";
import { Session } from "../../models/Session";
import { User } from "../../models/User";
import { scheduler } from "../monitors/scheduler";
import { dummyHash, hashPassword, verifyPassword } from "./password";

const SESSION_COOKIE = "themis_session";

interface PublicUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  createdAt: Date;
  hasPassword: boolean;
}

export const toPublic = (u: {
  _id: Types.ObjectId;
  name: string;
  email: string;
  username?: string | null;
  createdAt?: Date | null;
  hasPassword?: boolean;
}): PublicUser => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  username: u.username ?? null,
  createdAt: u.createdAt ?? new Date(0),
  // accounts made with Google have none until they set one in Settings
  hasPassword: u.hasPassword ?? true,
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* -------------------------------------------------------------------------- */
/* Cookies                                                                     */
/* -------------------------------------------------------------------------- */

export const readCookie = (req: Request, name: string): string | null => {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
};

const setSessionCookie = (res: Response, token: string, expires: Date) => {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.auth.secureCookies,
    path: "/",
    expires,
  });
};

const clearSessionCookie = (res: Response) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: config.auth.secureCookies, path: "/" });
};

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export const startSession = async (req: Request, res: Response, userId: Types.ObjectId) => {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.auth.sessionDays * 24 * 3600 * 1000);
  await Session.create({
    userId,
    tokenHash: sha256(token),
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
    ip: String(req.ip ?? "").slice(0, 64),
    expiresAt,
  });
  setSessionCookie(res, token, expiresAt);
};

// Resolves the cookie to a live session + user, sliding `lastSeenAt` at most every 5 minutes
export const resolveSession = async (req: Request) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const session = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await User.findById(session.userId).lean();
  if (!user) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    void Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).exec();
  }
  return { session, user };
};

export const endSession = async (req: Request, res: Response) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await Session.deleteOne({ tokenHash: sha256(token) });
  clearSessionCookie(res);
};

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

const OWNED_MODELS: Model<any>[] = [History, Collection, Environment, Monitor, MonitorCheck, Incident, Contract, ContractVersion, ContractValidationLog, AiSummary, StatusPage];

// Data created before accounts existed has no owner
const claimOrphans = async (userId: Types.ObjectId) => {
  await runUnscoped(() => Promise.all(OWNED_MODELS.map((m) => m.updateMany({ ownerId: null }, { $set: { ownerId: userId } }))));
};

export const register = async (input: { name: string; email: string; username?: string; password: string }) => {
  if (!config.auth.allowSignup) throw new HttpError(403, "Sign-ups are disabled on this server");
  const email = input.email.trim().toLowerCase();
  const username = input.username?.trim().toLowerCase() || undefined;
  if (await User.exists({ email })) throw new HttpError(409, "An account with this email already exists");
  if (username && (await User.exists({ username }))) throw new HttpError(409, "That username is taken");
  const isFirst = (await User.estimatedDocumentCount()) === 0;
  let user;
  try {
    // no lastLoginAt yet: the first sign-in is what runs onboarding
    user = await User.create({ name: input.name.trim(), email, username, passwordHash: await hashPassword(input.password) });
  } catch (e) {
    if ((e as { code?: number; keyPattern?: Record<string, number> }).code === 11000)
      throw new HttpError(409, (e as { keyPattern?: Record<string, number> }).keyPattern?.username ? "That username is taken" : "An account with this email already exists");
    throw e;
  }
  if (isFirst) await claimOrphans(user._id);
  return user;
};

export const hasPassword = async (userId: Types.ObjectId): Promise<boolean> => Boolean(await User.exists({ _id: userId, passwordHash: { $exists: true, $ne: null } }));

// Signs in (or signs up) with a Google account. A verified Google email links to an existing account with that email.
export const signInWithGoogle = async (profile: { sub: string; email: string; name: string }) => {
  const email = profile.email.trim().toLowerCase();
  let user = (await User.findOne({ googleId: profile.sub }).select("+passwordHash")) ?? (await User.findOne({ email }).select("+passwordHash"));
  if (!user) {
    if (!config.auth.allowSignup) throw new HttpError(403, "Sign-ups are disabled on this server");
    const isFirst = (await User.estimatedDocumentCount()) === 0;
    user = await User.create({ name: profile.name.trim().slice(0, 80) || email.split("@")[0], email, googleId: profile.sub });
    if (isFirst) await claimOrphans(user._id);
  } else if (!user.get("googleId")) {
    user.set("googleId", profile.sub);
  }
  const firstSignIn = !user.lastLoginAt;
  user.lastLoginAt = new Date();
  await user.save();
  return { user, firstSignIn };
};

const INVALID = new HttpError(401, "Incorrect email, username or password");

// signs in with an email or a username; reports whether this is the account's first sign-in
export const login = async (input: { email: string; password: string }) => {
  const id = input.email.trim().toLowerCase();
  const user = await User.findOne(id.includes("@") ? { email: id } : { username: id }).select("+passwordHash");
  if (!user) {
    // Burn the same time as a real check so response timing doesn't reveal which emails exist.
    await verifyPassword(input.password, await dummyHash());
    throw INVALID;
  }
  if (!user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw INVALID;
  const firstSignIn = !user.lastLoginAt;
  user.lastLoginAt = new Date();
  await user.save();
  return { user, firstSignIn };
};

export const changePassword = async (userId: Types.ObjectId, current: string, next: string, keepSessionId: Types.ObjectId) => {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new HttpError(404, "User not found");
  // an account made with Google sets its first password without one
  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) throw new HttpError(400, "Current password is incorrect");
  user.passwordHash = await hashPassword(next);
  await user.save();
  // Sign out every other browser.
  await Session.deleteMany({ userId, _id: { $ne: keepSessionId } });
};

// confirmed with the password, or, for an account without one, by typing its email
export const deleteAccount = async (userId: Types.ObjectId, confirm: { password?: string; email?: string }) => {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new HttpError(404, "User not found");
  if (user.passwordHash) {
    if (!confirm.password || !(await verifyPassword(confirm.password, user.passwordHash))) throw new HttpError(400, "Password is incorrect");
  } else if (confirm.email?.trim().toLowerCase() !== user.email) throw new HttpError(400, "Type your email to confirm");
  const monitors = await runUnscoped(() => Monitor.find({ ownerId: userId }, { _id: 1 }).lean().exec());
  for (const m of monitors) scheduler.unschedule(String(m._id));
  await runUnscoped(() => Promise.all(OWNED_MODELS.map((m) => m.deleteMany({ ownerId: userId }))));
  await Session.deleteMany({ userId });
  await User.deleteOne({ _id: userId });
};
