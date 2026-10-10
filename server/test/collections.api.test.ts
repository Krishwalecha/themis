import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { signedInAgent } from "./helpers";

const app = createApp();
let target: http.Server;
let baseUrl = "";

beforeAll(async () => {
  await connectDatabase("");
  target = http.createServer((req, res) => {
    if (req.url === "/broken") return void res.writeHead(500).end("nope");
    if (req.url === "/login") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token: "t-123", user: { id: 7 } }));
    if (req.url === "/me") return void res.writeHead(req.headers.authorization === "Bearer t-123" ? 200 : 401, { "content-type": "application/json" }).end("{}");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [1, 2] }));
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
});

afterAll(async () => {
  target.close();
  await disconnectDatabase();
});

describe("collections", () => {
  it("creates, fills, reorders and runs a collection, scoped to its owner", async () => {
    const api = await signedInAgent(app);
    const other = await signedInAgent(app);

    const c = (await api.post("/api/collections").send({ name: "Orders" }).expect(201)).body;
    await api.post("/api/collections").send({ name: "orders" }).expect(409);
    const ok = (await api.post(`/api/collections/${c._id}/requests`).send({ name: "list", request: { url: `${baseUrl}/orders` } }).expect(201)).body;
    const bad = (await api.post(`/api/collections/${c._id}/requests`).send({ name: "broken", request: { url: `${baseUrl}/broken` } }).expect(201)).body;

    expect((await api.get("/api/collections").expect(200)).body.items).toMatchObject([{ name: "Orders", requestCount: 2 }]);
    expect((await other.get("/api/collections").expect(200)).body.items).toHaveLength(0);
    await other.get(`/api/collections/${c._id}`).expect(404);

    const reordered = (await api.post(`/api/collections/${c._id}/reorder`).send({ ids: [bad._id, ok._id] }).expect(200)).body;
    expect(reordered.requests.map((r: { name: string }) => r.name)).toEqual(["broken", "list"]);
    await api.post(`/api/collections/${c._id}/reorder`).send({ ids: [ok._id] }).expect(400);

    const run = (await api.post(`/api/collections/${c._id}/run`).expect(200)).body;
    expect(run).toMatchObject({ passed: 1, failed: 1, verdict: "fail" });
    expect(run.results.map((r: { status: number }) => r.status)).toEqual([500, 200]);
    await api.post(`/api/collections/${c._id}/run?strict=1`).expect(422);

    await api.delete(`/api/collections/${c._id}/requests/${bad._id}`).expect(204);
    expect((await api.post(`/api/collections/${c._id}/run?strict=1`).expect(200)).body.verdict).toBe("pass");
    await api.delete(`/api/collections/${c._id}`).expect(204);
    await api.get(`/api/collections/${c._id}`).expect(404);
  });

  it("chains requests: values captured from one response feed the next", async () => {
    const api = await signedInAgent(app);
    const c = (await api.post("/api/collections").send({ name: "Flow" }).expect(201)).body;
    await api
      .post(`/api/collections/${c._id}/requests`)
      .send({ name: "log in", request: { url: `${baseUrl}/login` }, extract: [{ variable: "token", source: "jsonPath", path: "$.token" }] })
      .expect(201);
    await api
      .post(`/api/collections/${c._id}/requests`)
      .send({ name: "me", request: { url: `${baseUrl}/me`, auth: { type: "bearer", token: "{{token}}" } } })
      .expect(201);

    const run = (await api.post(`/api/collections/${c._id}/run`).expect(200)).body;
    expect(run).toMatchObject({ passed: 2, failed: 0 });
    expect(run.results[0].extracted).toEqual([{ variable: "token", captured: true, error: null }]);
    // captured values are reported, never echoed back
    expect(JSON.stringify(run)).not.toContain("t-123");

    // a save that leaves the rules out (the workspace's Save) keeps them
    const saved = (await api.get(`/api/collections/${c._id}`).expect(200)).body.requests[0];
    const kept = (await api.put(`/api/collections/${c._id}/requests/${saved._id}`).send({ name: "log in", request: saved.request }).expect(200)).body;
    expect(kept.extract).toHaveLength(1);

    // without the capture the second request has no token and fails, with a reason
    await api.put(`/api/collections/${c._id}/requests/${saved._id}`).send({ name: "log in", request: saved.request, extract: [] }).expect(200);
    const broken = (await api.post(`/api/collections/${c._id}/run`).expect(200)).body;
    expect(broken.results[1]).toMatchObject({ verdict: "fail", reason: "status 401", unresolvedVariables: ["token"] });
  });

  it("deletes several collections at once, only the caller's own", async () => {
    const api = await signedInAgent(app);
    const other = await signedInAgent(app);
    const a = (await api.post("/api/collections").send({ name: "A" }).expect(201)).body;
    const b = (await api.post("/api/collections").send({ name: "B" }).expect(201)).body;
    const theirs = (await other.post("/api/collections").send({ name: "Theirs" }).expect(201)).body;
    expect((await api.post("/api/collections/bulk-delete").send({ ids: [a._id, b._id, theirs._id] }).expect(200)).body.deleted).toBe(2);
    expect((await api.get("/api/collections").expect(200)).body.items).toHaveLength(0);
    await other.get(`/api/collections/${theirs._id}`).expect(200);
  });
});
