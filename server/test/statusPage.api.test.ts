import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { scheduler } from "../src/modules/monitors/scheduler";
import { signedInAgent } from "./helpers";

const app = createApp();
let target: http.Server;
let baseUrl = "";
let failing = false;

beforeAll(async () => {
  await connectDatabase("");
  target = http.createServer((_req, res) => res.writeHead(failing ? 503 : 200).end("{}"));
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
});

afterAll(async () => {
  scheduler.stop();
  target.close();
  await disconnectDatabase();
});

const monitor = (name: string, path: string) => ({ name, request: { url: `${baseUrl}${path}?key=secret` }, schedule: { type: "interval", seconds: 3600 } });

describe("public status page", () => {
  it("shows the chosen monitors' health to anyone, without URLs or error details", async () => {
    const owner = await signedInAgent(app);
    const api = (await owner.post("/api/monitors").send(monitor("Public API", "/api")).expect(201)).body;
    const hidden = (await owner.post("/api/monitors").send(monitor("Internal admin", "/admin")).expect(201)).body;
    await owner.post(`/api/monitors/${api._id}/run`).expect(200);
    failing = true;
    await owner.post(`/api/monitors/${api._id}/run`).expect(200);

    expect((await owner.get("/api/status-page").expect(200)).body).toMatchObject({ enabled: false, slug: "" });
    await owner.put("/api/status-page").send({ enabled: true, slug: "Bad Slug!", monitorIds: [] }).expect(400);
    await owner.put("/api/status-page").send({ enabled: true, slug: "acme", title: "Acme status", monitorIds: [api._id] }).expect(200);

    const page = (await request(app).get("/api/public/status/acme").expect(200)).body;
    expect(page).toMatchObject({ title: "Acme status", status: "down", monitors: [{ name: "Public API", status: "down", uptimePct: 50 }] });
    expect(page.monitors[0].days).toHaveLength(30);
    expect(page.incidents).toEqual([expect.objectContaining({ monitorName: "Public API", severity: "down", status: "open" })]);
    const raw = JSON.stringify(page);
    expect(raw).not.toContain(baseUrl);
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("503");
    expect(raw).not.toContain(hidden.name);

    // another account can't take the address or list someone else's monitors
    const other = await signedInAgent(app);
    await other.put("/api/status-page").send({ enabled: true, slug: "acme", monitorIds: [] }).expect(409);
    const theirs = (await other.put("/api/status-page").send({ enabled: true, slug: "other-co", monitorIds: [api._id] }).expect(200)).body;
    expect(theirs.monitorIds).toEqual([]);

    // turning it off takes it down
    await owner.put("/api/status-page").send({ enabled: false, slug: "acme", monitorIds: [api._id] }).expect(200);
    await request(app).get("/api/public/status/acme").expect(404);
    failing = false;
  });
});
