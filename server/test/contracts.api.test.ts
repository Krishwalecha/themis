import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { Contract, ContractValidationLog, ContractVersion } from "../src/models/Contract";
import { Monitor } from "../src/models/Monitor";
import { MonitorCheck } from "../src/models/MonitorCheck";
import { signedInAgent } from "./helpers";

let target: http.Server;
let baseUrl: string;
// The live API's current response for GET /users/1
let userBody: Record<string, unknown> = { id: 1, email: "ada@example.com" };
const app = createApp();
let api: Awaited<ReturnType<typeof signedInAgent>>;

const yamlSpec = (base: string) => `
openapi: 3.0.3
info: { title: Users API, version: "1" }
servers:
  - url: ${base}
paths:
  /users/{id}:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [id, email]
                properties:
                  id: { type: integer }
                  email: { type: string }
`;

beforeAll(async () => {
  await connectDatabase("");
  api = await signedInAgent(app);
  target = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(userBody));
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  target?.close();
  await disconnectDatabase();
});

beforeEach(async () => {
  userBody = { id: 1, email: "ada@example.com" };
  await Promise.all([
    Contract.deleteMany({}),
    ContractVersion.deleteMany({}),
    ContractValidationLog.deleteMany({}),
    Monitor.deleteMany({}),
    MonitorCheck.deleteMany({}),
  ]);
});

const createContract = async () => {
  const res = await api.post("/api/contracts").send({ name: "Users", document: yamlSpec(baseUrl) }).expect(201);
  return res.body as { _id: string; kind: string; operations: unknown[]; version: number };
};

describe("contracts API", () => {
  it("imports YAML OpenAPI, detects the kind and lists operations", async () => {
    const c = await createContract();
    expect(c).toMatchObject({ kind: "openapi", version: 1 });
    expect(c.operations).toEqual([{ path: "/users/{id}", method: "GET", responses: ["200"] }]);
    await api.post("/api/contracts").send({ name: "Bad", document: "openapi: [" }).expect(400);
  });

  it("validates workspace responses and logs them", async () => {
    const c = await createContract();
    userBody = { id: "1", nickname: "ada" };
    const res = await api
      .post("/api/requests/execute")
      .send({ request: { url: `${baseUrl}/users/1` }, contractId: c._id })
      .expect(200);
    expect(res.body.contract).toMatchObject({ name: "Users", valid: false, matched: { path: "/users/{id}" } });
    expect(res.body.contract.errors.map((e: { message: string }) => e.message)).toEqual(
      expect.arrayContaining(["must be integer", 'is missing required property "email"']),
    );
    expect(res.body.contract.drift[0].path).toBe("/nickname");

    // Re-validate the stored history entry
    const again = await api.post(`/api/contracts/${c._id}/validate`).send({ historyId: res.body.historyId }).expect(200);
    expect(again.body.valid).toBe(false);
    const log = await api.get(`/api/contracts/${c._id}/validations`).expect(200);
    expect(log.body.items.map((v: { source: string }) => v.source)).toEqual(["history", "workspace"]);
  });

  it("re-checks the latest response when a new version is saved, so the status is current", async () => {
    const c = await createContract();
    expect((await api.get(`/api/contracts/${c._id}`).expect(200)).body.lastValidation).toBeNull();
    userBody = { id: "1", email: "ada@example.com" };
    await api.post("/api/requests/execute").send({ request: { url: `${baseUrl}/users/1` }, contractId: c._id }).expect(200);
    expect((await api.get(`/api/contracts/${c._id}`).expect(200)).body.lastValidation).toMatchObject({ valid: false, errorCount: 1, contractVersion: 1 });

    // the contract now says id is a string: the same response matches v2 without sending it again
    const fixed = yamlSpec(baseUrl).replace("id: { type: integer }", "id: { type: string }");
    const saved = (await api.put(`/api/contracts/${c._id}`).send({ document: fixed }).expect(200)).body;
    expect(saved).toMatchObject({ versioned: true, breakingCount: 1, contract: { version: 2, lastValidation: { valid: true, contractVersion: 2 } } });
    const list = (await api.get("/api/contracts").expect(200)).body.items.find((x: { _id: string }) => x._id === c._id);
    expect(list.lastValidation).toMatchObject({ valid: true, contractVersion: 2 });

    const page = (await api.get(`/api/contracts/${c._id}/validations?page=1&limit=1`).expect(200)).body;
    expect(page).toMatchObject({ total: 2 });
    expect(page.items).toHaveLength(1);
  });

  it("deletes several contracts at once, with their versions and logs, only the caller's own", async () => {
    const a = await createContract();
    const b = await createContract();
    const other = await signedInAgent(app);
    const theirs = (await other.post("/api/contracts").send({ name: "Theirs", document: yamlSpec(baseUrl) }).expect(201)).body;
    expect((await api.post("/api/contracts/bulk-delete").send({ ids: [a._id, b._id, theirs._id] }).expect(200)).body.deleted).toBe(2);
    expect(await ContractVersion.countDocuments({ contractId: { $in: [a._id, b._id] } })).toBe(0);
    await other.get(`/api/contracts/${theirs._id}`).expect(200);
  });

  it("versions documents and reports breaking changes", async () => {
    const c = await createContract();
    const next = yamlSpec(baseUrl).replace("required: [id, email]", "required: [id]").replace("id: { type: integer }", "id: { type: string }");
    const res = await api.put(`/api/contracts/${c._id}`).send({ document: next, note: "loosen" }).expect(200);
    expect(res.body).toMatchObject({ versioned: true, breakingCount: 2, contract: { version: 2 } });

    const unchanged = await api.put(`/api/contracts/${c._id}`).send({ document: next }).expect(200);
    expect(unchanged.body.versioned).toBe(false);

    const versions = await api.get(`/api/contracts/${c._id}/versions`).expect(200);
    expect(versions.body.items.map((v: { version: number; breakingCount: number }) => [v.version, v.breakingCount])).toEqual([
      [2, 2],
      [1, 0],
    ]);
    const diff = await api.get(`/api/contracts/${c._id}/diff?from=1&to=2`).expect(200);
    expect(diff.body.breakingCount).toBe(2);
  });

  it("infers a contract from a history entry", async () => {
    const exec = await api.post("/api/requests/execute").send({ request: { url: `${baseUrl}/users/1` } }).expect(200);
    const inferred = await api.post("/api/contracts/infer").send({ historyId: exec.body.historyId }).expect(200);
    expect(inferred.body.document).toMatchObject({ type: "object", required: ["id", "email"] });
    const created = await api.post("/api/contracts").send({ name: "Inferred", document: inferred.body.document }).expect(201);
    expect(created.body.kind).toBe("jsonschema");
  });

  it("guards monitors: violations degrade checks and show on the dashboard", async () => {
    const c = await createContract();
    const { body: monitor } = await api
      .post("/api/monitors")
      .send({
        name: "Users",
        request: { url: `${baseUrl}/users/1` },
        schedule: { type: "interval", seconds: 60 },
        contractId: c._id,
      })
      .expect(201);

    let check = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(check).toMatchObject({ status: "up", contract: { valid: true, errorCount: 0 } });

    userBody = { id: 1 }; // API stops returning email
    check = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(check.status).toBe("degraded");
    expect(check.failures[0]).toMatch(/Contract "Users": 1 violation/);

    await api.put(`/api/monitors/${monitor._id}`).send({
      name: "Users",
      request: { url: `${baseUrl}/users/1` },
      schedule: { type: "interval", seconds: 60 },
      contractId: c._id,
      contractSeverity: "critical",
    });
    check = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(check.status).toBe("down");

    const dash = (await api.get("/api/dashboard").expect(200)).body;
    expect(dash.contracts).toMatchObject({ total: 1, validations: 3, passRate: 33.33 });
    expect(dash.contracts.recentViolations[0].contractName).toBe("Users");

    const detail = (await api.get(`/api/contracts/${c._id}`).expect(200)).body;
    expect(detail.linkedMonitors).toHaveLength(1);

    await api.delete(`/api/contracts/${c._id}`).expect(204);
    expect((await Monitor.findById(monitor._id).lean())?.contractId).toBeUndefined();
  });
});
