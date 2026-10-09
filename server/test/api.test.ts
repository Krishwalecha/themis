import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { Environment } from "../src/models/Environment";
import { History } from "../src/models/History";
import { signedInAgent } from "./helpers";

// Local target API that echoes what it received
let target: http.Server;
let targetUrl: string;
const app = createApp();
let api: Awaited<ReturnType<typeof signedInAgent>>;

beforeAll(async () => {
  await connectDatabase("");
  api = await signedInAgent(app);
  target = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.startsWith("/slow")) {
        setTimeout(() => res.end("late"), 2_000);
        return;
      }
      const status = Number(new URL(req.url ?? "/", "http://x").searchParams.get("status") ?? 200);
      res.writeHead(status, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] });
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  target?.close();
  await disconnectDatabase();
});

beforeEach(async () => {
  await History.deleteMany({});
  await Environment.deleteMany({});
});

describe("POST /api/requests/execute", () => {
  it("executes a request, interpolates environment variables and records history", async () => {
    const env = await api
      .post("/api/environments")
      .send({ name: "local", variables: [{ key: "base", value: targetUrl }, { key: "token", value: "abc", secret: true }] })
      .expect(201);

    const res = await api
      .post("/api/requests/execute")
      .send({
        environmentId: env.body._id,
        request: {
          method: "POST",
          url: "{{base}}/users",
          params: [{ key: "page", value: "2" }],
          body: { mode: "json", content: '{"hello":"{{missing}}"}' },
          auth: { type: "bearer", token: "{{token}}" },
        },
      })
      .expect(200);

    const { result, historyId, unresolvedVariables } = res.body;
    expect(result.status).toBe(200);
    expect(result.timings.totalMs).toBeGreaterThan(0);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(unresolvedVariables).toEqual(["missing"]);
    const echoed = JSON.parse(result.body);
    expect(echoed.url).toBe("/users?page=2");
    expect(echoed.headers.authorization).toBe("Bearer abc");
    expect(echoed.body).toBe('{"hello":"{{missing}}"}');
    expect(result.headers.filter((h: { key: string }) => h.key === "set-cookie")).toHaveLength(2);

    const stored = await api.get(`/api/history/${historyId}`).expect(200);
    expect(stored.body.request.url).toBe("{{base}}/users");
    expect(stored.body.resolvedUrl).toBe(`${targetUrl}/users?page=2`);
    // the secret reached the API, but never comes back to the browser or into history
    const sent = (headers: { key: string; value: string }[]) => headers.find((h) => h.key.toLowerCase() === "authorization")?.value;
    expect(sent(result.request.headers)).toBe("Bearer ••••");
    expect(sent(stored.body.requestHeaders)).toBe("Bearer ••••");
  });

  it("reports network failures instead of throwing", async () => {
    // Grab a free port, then close it so nothing is listening there.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const closedPort = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));

    for (const host of ["127.0.0.1", "localhost"]) {
      const res = await api
        .post("/api/requests/execute")
        .send({ request: { url: `http://${host}:${closedPort}/nothing` } })
        .expect(200);
      expect(res.body.result.status).toBe(0);
      expect(res.body.result.error.code).toBe("CONNECTION_REFUSED");
      expect(res.body.result.error.message).not.toBe("");
    }
  });

  it("flags ports blocked by the fetch spec as invalid", async () => {
    const res = await api
      .post("/api/requests/execute")
      .send({ request: { url: "http://127.0.0.1:1/" }, save: false })
      .expect(200);
    expect(res.body.result.error.code).toBe("INVALID_URL");
  });

  it("enforces timeouts", async () => {
    const res = await api
      .post("/api/requests/execute")
      .send({ request: { url: `${targetUrl}/slow`, timeoutMs: 200 }, save: false })
      .expect(200);
    expect(res.body.result.error.code).toBe("TIMEOUT");
    expect(res.body.historyId).toBeNull();
  });

  it("validates input", async () => {
    const res = await api.post("/api/requests/execute").send({ request: { method: "FETCH", url: "" } }).expect(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("history", () => {
  it("lists with filters and cursor pagination, re-runs and deletes", async () => {
    for (const status of [200, 201, 404, 500]) {
      await api.post("/api/requests/execute").send({ request: { url: `${targetUrl}/s?status=${status}` } });
    }

    const page1 = await api.get("/api/history?limit=3").expect(200);
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.items[0].response).toBeUndefined();
    const page2 = await api.get(`/api/history?limit=3&before=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    // Numbered pages carry the total so the UI can render page links.
    const numbered = await api.get("/api/history?limit=3&page=2").expect(200);
    expect(numbered.body).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(numbered.body.items).toHaveLength(1);
    expect(numbered.body.items[0]._id).toBe(page2.body.items[0]._id);

    const errors = await api.get("/api/history?status=4xx").expect(200);
    expect(errors.body.items.map((i: { status: number }) => i.status)).toEqual([404]);

    const search = await api.get("/api/history?q=status%3D500").expect(200);
    expect(search.body.items).toHaveLength(1);

    const original = errors.body.items[0];
    const rerun = await api.post(`/api/history/${original._id}/rerun`).send({}).expect(200);
    expect(rerun.body.result.status).toBe(404);
    const rerunEntry = await api.get(`/api/history/${rerun.body.historyId}`).expect(200);
    expect(rerunEntry.body.rerunOf).toBe(original._id);

    await api.delete(`/api/history/${original._id}`).expect(204);
    await api.get(`/api/history/${original._id}`).expect(404);
  });
});

describe("environments", () => {
  it("masks secrets, keeps them on round-trip updates, and enforces unique names", async () => {
    const created = await api
      .post("/api/environments")
      .send({ name: "prod", variables: [{ key: "key", value: "s3cret", secret: true }] })
      .expect(201);

    const listed = await api.get("/api/environments").expect(200);
    expect(listed.body.items[0].variables[0].value).toBe("••••••");

    await api
      .put(`/api/environments/${created.body._id}`)
      .send({ name: "prod", variables: listed.body.items[0].variables })
      .expect(200);
    // secrets are write-only: no way to read them back
    const again = await api.get(`/api/environments/${created.body._id}?reveal=true`).expect(200);
    expect(again.body.variables[0].value).not.toBe("s3cret");
    expect(JSON.stringify(created.body)).not.toContain("s3cret");
    expect((await Environment.findById(created.body._id).lean())?.variables[0].value).toBe("s3cret");

    // un-ticking "secret" without a new value keeps it stored and secret, so it can't be revealed that way
    const unticked = listed.body.items[0].variables.map((v: object) => ({ ...v, secret: false }));
    const after = (await api.put(`/api/environments/${created.body._id}`).send({ name: "prod", variables: unticked }).expect(200)).body;
    expect(after.variables[0]).toMatchObject({ secret: true, value: "••••••" });
    expect((await Environment.findById(created.body._id).lean())?.variables[0].value).toBe("s3cret");

    await api.post("/api/environments").send({ name: "PROD" }).expect(409);
    await api
      .post("/api/environments")
      .send({ name: "dup", variables: [{ key: "a" }, { key: "a" }] })
      .expect(400);
  });
});

describe("terminal output", () => {
  it("pretty-prints JSON for curl and keeps it compact for everyone else", async () => {
    const pretty = await request(app).get("/api/health").set("user-agent", "curl/8.7.1").expect(200);
    expect(pretty.text).toMatch(/^\{\n {2}"status": "ok",/);
    expect(pretty.text.endsWith("}\n")).toBe(true);
    const compact = await request(app).get("/api/health").set("user-agent", "Mozilla/5.0").expect(200);
    expect(compact.text.startsWith('{"status":"ok"')).toBe(true);
  });
});

describe("file bodies", () => {
  const file = (text: string, name = "note.txt", type = "text/plain") => ({ name, type, size: text.length, data: Buffer.from(text).toString("base64") });

  it("sends multipart forms with files and keeps only file names in history", async () => {
    const res = await api
      .post("/api/requests/execute")
      .send({
        request: {
          method: "POST",
          url: `${targetUrl}/upload`,
          headers: [{ key: "Content-Type", value: "multipart/form-data" }],
          body: {
            mode: "multipart",
            parts: [
              { key: "title", kind: "text", value: "hello {{missing}}" },
              { key: "doc", kind: "file", file: file("file contents here") },
            ],
          },
        },
      })
      .expect(200);
    const echoed = JSON.parse(res.body.result.body);
    // fetch set its own boundary, replacing the hand-set header
    expect(echoed.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(echoed.body).toContain('name="doc"; filename="note.txt"');
    expect(echoed.body).toContain("file contents here");
    expect(echoed.body).toContain('name="title"');
    expect(res.body.result.request.body).toBe("title=hello {{missing}}\ndoc: note.txt (text/plain, 18 B)");

    const saved = await History.findById(res.body.historyId).lean();
    const parts = (saved!.request as { body: { parts: { file?: { name: string; data: string } }[] } }).body.parts;
    expect(parts[1].file).toMatchObject({ name: "note.txt", data: "" });

    // re-running from history needs the file again
    const rerun = await api.post(`/api/history/${res.body.historyId}/rerun`).send({}).expect(200);
    expect(rerun.body.result.error).toMatchObject({ code: "MISSING_FILE" });
  });

  it("sends a binary body with the file's type, and caps attachments at 5 MB", async () => {
    const res = await api
      .post("/api/requests/execute")
      .send({ request: { method: "PUT", url: `${targetUrl}/raw`, body: { mode: "binary", file: file('{"a":1}', "a.json", "application/json") } } })
      .expect(200);
    const echoed = JSON.parse(res.body.result.body);
    expect(echoed).toMatchObject({ method: "PUT", body: '{"a":1}' });
    expect(echoed.headers["content-type"]).toBe("application/json");

    const big = Buffer.alloc(5 * 1024 * 1024 + 10).toString("base64");
    await api
      .post("/api/requests/execute")
      .send({ request: { method: "PUT", url: `${targetUrl}/raw`, body: { mode: "binary", file: { name: "big.bin", size: 1, data: big } } } })
      .expect(400);
  });
});
