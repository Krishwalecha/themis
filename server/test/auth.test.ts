import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { runUnscoped } from "../src/lib/tenant";
import { Environment } from "../src/models/Environment";
import { History } from "../src/models/History";
import { Monitor } from "../src/models/Monitor";
import { Session } from "../src/models/Session";
import { User } from "../src/models/User";
import { authLimiter } from "../src/modules/auth/routes";
import { signedInAgent } from "./helpers";

const app = createApp();
const creds = { name: "Ada", email: "ada@example.com", password: "correct-horse-battery" };

beforeAll(async () => {
  await connectDatabase("");
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  authLimiter.reset();
  await Promise.all([User.deleteMany({}), Session.deleteMany({}), Environment.deleteMany({}), History.deleteMany({}), Monitor.deleteMany({})]);
});

describe("auth", () => {
  it("registers without signing in, then signs in, reads the session, signs out", async () => {
    const agent = request.agent(app);
    const reg = await agent.post("/api/auth/register").send(creds).expect(201);
    expect(reg.body.user).toMatchObject({ name: "Ada", email: "ada@example.com" });
    expect(reg.body.user.passwordHash).toBeUndefined();
    expect(reg.headers["set-cookie"]).toBeUndefined();
    await agent.get("/api/auth/me").expect(401);

    const signIn = await agent.post("/api/auth/login").send(creds).expect(200);
    const cookie = signIn.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^themis_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    // The raw token is never stored, only its hash.
    const token = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
    expect(await Session.countDocuments({ tokenHash: token })).toBe(0);

    await agent.get("/api/auth/me").expect(200);
    await agent.post("/api/auth/logout").expect(204);
    await agent.get("/api/auth/me").expect(401);
    expect(await Session.countDocuments()).toBe(0);
  });

  it("rejects duplicates, bad input and wrong passwords without saying which part was wrong", async () => {
    await request(app).post("/api/auth/register").send(creds).expect(201);
    await request(app).post("/api/auth/register").send({ ...creds, email: "ADA@example.com" }).expect(409);
    await request(app).post("/api/auth/register").send({ ...creds, email: "x@example.com", password: "short" }).expect(400);

    const wrong = await request(app).post("/api/auth/login").send({ email: creds.email, password: "nope-nope-nope" }).expect(401);
    const unknown = await request(app).post("/api/auth/login").send({ email: "who@example.com", password: "nope-nope-nope" }).expect(401);
    expect(wrong.body.error).toBe(unknown.body.error);

    const ok = await request(app).post("/api/auth/login").send({ email: " Ada@Example.com ", password: creds.password }).expect(200);
    expect(ok.body.user.email).toBe("ada@example.com");
  });

  it("guards every API route except health and auth", async () => {
    await request(app).get("/api/health").expect(200);
    for (const path of ["/api/history", "/api/environments", "/api/monitors", "/api/incidents", "/api/contracts", "/api/dashboard"]) {
      const res = await request(app).get(path).expect(401);
      expect(res.body.error).toMatch(/Sign in/);
    }
    await request(app).get("/api/history").set("Cookie", "themis_session=forged").expect(401);
  });

  it("keeps every user's data to themselves", async () => {
    const ada = await signedInAgent(app, "Ada");
    const bob = await signedInAgent(app, "Bob");

    const env = (await ada.post("/api/environments").send({ name: "Prod", variables: [{ key: "token", value: "s3cret" }] }).expect(201)).body;
    // Same name is fine for a different user: uniqueness is per owner.
    await bob.post("/api/environments").send({ name: "Prod", variables: [] }).expect(201);

    expect((await ada.get("/api/environments").expect(200)).body.items).toHaveLength(1);
    await bob.get(`/api/environments/${env._id}`).expect(404);
    await bob.put(`/api/environments/${env._id}`).send({ name: "Hijacked", variables: [] }).expect(404);
    await bob.delete(`/api/environments/${env._id}`).expect(404);
    expect((await ada.get(`/api/environments/${env._id}`).expect(200)).body.name).toBe("Prod");

    // Aggregations (dashboard) are scoped too.
    await ada.post("/api/monitors").send({ name: "m", request: { url: "http://127.0.0.1:9/x" }, schedule: { type: "interval", seconds: 60 }, enabled: false });
    const bobDash = (await bob.get("/api/dashboard").expect(200)).body;
    expect(bobDash.monitors.total).toBe(0);
    expect((await ada.get("/api/dashboard").expect(200)).body.monitors.total).toBe(1);
  });

  it("gives data created before accounts existed to the first user only", async () => {
    await runUnscoped(() => Environment.create({ name: "Legacy", variables: [] }));
    const first = await signedInAgent(app, "First");
    const second = await signedInAgent(app, "Second");
    expect((await first.get("/api/environments").expect(200)).body.items.map((e: { name: string }) => e.name)).toEqual(["Legacy"]);
    expect((await second.get("/api/environments").expect(200)).body.items).toHaveLength(0);
  });

  it("changes the password and signs out other browsers", async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    await a.post("/api/auth/register").send(creds).expect(201);
    await a.post("/api/auth/login").send(creds).expect(200);
    await b.post("/api/auth/login").send(creds).expect(200);

    await a.post("/api/auth/password").send({ currentPassword: "wrong-wrong", newPassword: "another-good-one" }).expect(400);
    await a.post("/api/auth/password").send({ currentPassword: creds.password, newPassword: "another-good-one" }).expect(204);

    await a.get("/api/auth/me").expect(200);
    await b.get("/api/auth/me").expect(401);
    await request(app).post("/api/auth/login").send(creds).expect(401);
    await request(app).post("/api/auth/login").send({ ...creds, password: "another-good-one" }).expect(200);
  });

  it("signs up with a username, signs in by email or username, and flags only the first sign-in", async () => {
    const anon = request(app);
    expect((await anon.get("/api/auth/username-available?u=ada_l").expect(200)).body.available).toBe(true);
    await anon.post("/api/auth/register").send({ ...creds, username: "Ada_L" }).expect(201);
    expect((await anon.get("/api/auth/username-available?u=ada_l").expect(200)).body.available).toBe(false);
    await anon.post("/api/auth/register").send({ ...creds, email: "other@example.com", username: "ada_l" }).expect(409);

    const first = await request(app).post("/api/auth/login").send({ email: "ada_l", password: creds.password }).expect(200);
    expect(first.body).toMatchObject({ user: { username: "ada_l" }, firstSignIn: true });
    const again = await request(app).post("/api/auth/login").send({ email: creds.email, password: creds.password }).expect(200);
    expect(again.body.firstSignIn).toBe(false);
    await request(app).post("/api/auth/login").send({ email: "ada_l", password: "wrong-password" }).expect(401);
  });

  it("sets, validates, clears and de-duplicates usernames", async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    await a.post("/api/auth/register").send(creds).expect(201);
    await b.post("/api/auth/register").send({ ...creds, email: "grace@example.com" }).expect(201);
    await a.post("/api/auth/login").send(creds).expect(200);
    await b.post("/api/auth/login").send({ ...creds, email: "grace@example.com" }).expect(200);

    expect((await a.patch("/api/auth/me").send({ username: "Ada_L" }).expect(200)).body.user.username).toBe("ada_l");
    expect((await a.get("/api/auth/me").expect(200)).body.user.username).toBe("ada_l");
    await a.patch("/api/auth/me").send({ username: "no spaces" }).expect(400);
    await a.patch("/api/auth/me").send({}).expect(400);
    await b.patch("/api/auth/me").send({ username: "ada_l" }).expect(409);
    expect((await b.get("/api/auth/username-available?u=ada_l").expect(200)).body.available).toBe(false);
    expect((await a.get("/api/auth/username-available?u=ada_l").expect(200)).body.available).toBe(true);
    expect((await b.get("/api/auth/username-available?u=x").expect(200)).body).toMatchObject({ available: false });
    expect((await b.get("/api/auth/username-available?u=grace").expect(200)).body.available).toBe(true);

    expect((await a.patch("/api/auth/me").send({ username: "" }).expect(200)).body.user.username).toBeNull();
    await b.patch("/api/auth/me").send({ username: "ada_l" }).expect(200);
  });

  it("rate-limits repeated sign-in attempts", async () => {
    for (let i = 0; i < 20; i++) await request(app).post("/api/auth/login").send({ email: "x@example.com", password: "nope" });
    const res = await request(app).post("/api/auth/login").send({ email: "x@example.com", password: "nope" }).expect(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
