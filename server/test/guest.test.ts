import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { History } from "../src/models/History";

const app = createApp();

beforeAll(async () => {
  await connectDatabase("");
});

afterAll(async () => {
  await disconnectDatabase();
});

describe("trying Themis without an account", () => {
  it("never reaches private addresses, saves nothing, and is rate limited per visitor", async () => {
    expect(config.request.allowPrivateNetworks).toBe(true); // signed-in users may, in tests
    const res = await request(app).post("/api/public/execute").send({ request: { url: "http://127.0.0.1:4000/api/health" } }).expect(200);
    expect(res.body).toMatchObject({ historyId: null, verdict: "fail", result: { error: { code: "BLOCKED_ADDRESS" } } });
    await request(app).post("/api/public/execute").send({ request: { url: "http://169.254.169.254/latest/meta-data/" } }).expect(200);
    expect(await History.countDocuments()).toBe(0);

    // 20 a minute: the two above plus 18 more go through, then the next is refused
    for (let i = 0; i < 18; i++) await request(app).post("/api/public/execute").send({ request: { url: "http://localhost/" } }).expect(200);
    expect((await request(app).post("/api/public/execute").send({ request: { url: "http://localhost/" } }).expect(429)).body.error).toMatch(/Too many guest/);
  });

  it("can be turned off", async () => {
    expect((await request(app).get("/api/auth/config").expect(200)).body.guestRequests).toBe(true);
    (config as { guestRequests: boolean }).guestRequests = false;
    try {
      expect((await request(app).post("/api/public/execute").send({ request: { url: "http://example.com/" } }).expect(404)).body.error).toMatch(/turned off/);
    } finally {
      (config as { guestRequests: boolean }).guestRequests = true;
    }
  });
});
