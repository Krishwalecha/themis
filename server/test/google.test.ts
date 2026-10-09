import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { authLimiter } from "../src/modules/auth/routes";

// Stands in for Google's token endpoint: hands back an id_token for whichever profile the test set
let profile: Record<string, unknown> = {};
let google: http.Server;
const app = createApp();
const idToken = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

beforeAll(async () => {
  await connectDatabase("");
  google = http.createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id_token: idToken(profile) })));
  await new Promise<void>((r) => google.listen(0, "127.0.0.1", r));
  Object.assign(config.google, { clientId: "client-1", clientSecret: "secret", tokenUrl: `http://127.0.0.1:${(google.address() as AddressInfo).port}/token` });
});

afterAll(async () => {
  google.close();
  await disconnectDatabase();
});

// runs the whole redirect dance with one browser-like agent
const signInWithGoogle = async (claims: Record<string, unknown>, opts: { tamper?: boolean } = {}) => {
  authLimiter.reset();
  profile = { iss: "https://accounts.google.com", aud: "client-1", email_verified: true, ...claims };
  const agent = request.agent(app);
  const start = await agent.get("/api/auth/google?next=/workspace").expect(302);
  const state = new URL(start.headers.location).searchParams.get("state")!;
  const back = await agent.get(`/api/auth/google/callback?code=abc&state=${opts.tamper ? "forged" : state}`).expect(302);
  return { agent, location: new URL(back.headers.location) };
};

describe("Continue with Google", () => {
  it("creates an account, signs in, and lets a passwordless account set a password", async () => {
    expect((await request(app).get("/api/auth/config").expect(200)).body).toMatchObject({ google: true });
    const { agent, location } = await signInWithGoogle({ sub: "g-1", email: "ada@gmail.com", name: "Ada" });
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ oauth: "1", first: "1", next: "/workspace" });
    expect((await agent.get("/api/auth/me").expect(200)).body.user).toMatchObject({ email: "ada@gmail.com", name: "Ada", hasPassword: false });

    // no password yet: setting one needs no current password; then email+password sign-in works
    await agent.post("/api/auth/password").send({ newPassword: "correct-horse-battery" }).expect(204);
    await request(app).post("/api/auth/login").send({ email: "ada@gmail.com", password: "correct-horse-battery" }).expect(200);

    // a second Google sign-in finds the same account
    const again = await signInWithGoogle({ sub: "g-1", email: "ada@gmail.com", name: "Ada" });
    expect(again.location.searchParams.get("first")).toBe("0");
  });

  it("links to an existing account with the same email", async () => {
    authLimiter.reset();
    await request(app).post("/api/auth/register").send({ name: "Bo", email: "bo@example.com", password: "correct-horse-battery" }).expect(201);
    const { agent } = await signInWithGoogle({ sub: "g-2", email: "bo@example.com", name: "Bo G" });
    expect((await agent.get("/api/auth/me").expect(200)).body.user).toMatchObject({ email: "bo@example.com", name: "Bo", hasPassword: true });
  });

  it("refuses forged state, other apps' tokens and unverified emails", async () => {
    const forged = await signInWithGoogle({ sub: "g-3", email: "eve@gmail.com" }, { tamper: true });
    expect(forged.location.searchParams.get("oauthError")).toMatch(/expired/);
    await forged.agent.get("/api/auth/me").expect(401);

    const otherApp = await signInWithGoogle({ sub: "g-3", email: "eve@gmail.com", aud: "someone-else" });
    expect(otherApp.location.searchParams.get("oauthError")).toBeTruthy();

    const unverified = await signInWithGoogle({ sub: "g-4", email: "mal@gmail.com", email_verified: false });
    expect(unverified.location.searchParams.get("oauthError")).toMatch(/Verify/);
  });

  it("deletes a passwordless account when its email is typed", async () => {
    const { agent } = await signInWithGoogle({ sub: "g-5", email: "cy@gmail.com", name: "Cy" });
    await agent.delete("/api/auth/me").send({ email: "wrong@gmail.com" }).expect(400);
    await agent.delete("/api/auth/me").send({ email: "cy@gmail.com" }).expect(204);
  });
});
