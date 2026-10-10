import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { Incident } from "../src/models/Incident";
import { Monitor } from "../src/models/Monitor";
import { MonitorCheck } from "../src/models/MonitorCheck";
import { alertBody } from "../src/modules/monitors/alerts";
import { scheduler } from "../src/modules/monitors/scheduler";
import { runAs } from "../src/lib/tenant";
import { signedInAgent } from "./helpers";

// A target API whose health we can flip, plus a webhook receiver
let target: http.Server;
let baseUrl: string;
let mode: "ok" | "slow" | "error" = "ok";
const webhooks: { text: string; event: string }[] = [];
const app = createApp();
let api: Awaited<ReturnType<typeof signedInAgent>>;

beforeAll(async () => {
  await connectDatabase("");
  api = await signedInAgent(app);
  target = http.createServer((req, res) => {
    if (req.url === "/hook") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        webhooks.push(JSON.parse(body));
        res.end("ok");
      });
      return;
    }
    if (mode === "error") {
      res.writeHead(503).end("unavailable");
      return;
    }
    const send = () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
    if (mode === "slow") setTimeout(send, 150);
    else send();
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  scheduler.stop();
  target?.close();
  await disconnectDatabase();
});

beforeEach(async () => {
  mode = "ok";
  webhooks.length = 0;
  await Promise.all([Monitor.deleteMany({}), MonitorCheck.deleteMany({}), Incident.deleteMany({})]);
});

const waitFor = async (fn: () => boolean | Promise<boolean>, timeout = 5000) => {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};

const monitorBody = (extra: Record<string, unknown> = {}) => {
  return {
    name: "Health",
    request: { method: "GET", url: `${baseUrl}/health` },
    schedule: { type: "interval", seconds: 60 },
    assertions: [{ source: "latency", operator: "lt", expected: "100" }],
    alerts: { webhookUrl: `${baseUrl}/hook` },
    ...extra,
  };
};

describe("monitor lifecycle", () => {
  it("runs checks, opens and resolves incidents, sends alerts and computes stats", async () => {
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody()).expect(201);
    expect(monitor.state.status).toBe("pending");

    // Healthy
    let check = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(check.status).toBe("up");

    // Slow → degraded incident
    mode = "slow";
    check = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(check.status).toBe("degraded");
    let incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident).toMatchObject({ status: "open", severity: "degraded" });

    // 503 → escalates to down
    mode = "error";
    check = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(check).toMatchObject({ status: "down", statusCode: 503 });
    incident = await Incident.findById(incident!._id).lean();
    expect(incident).toMatchObject({ severity: "down", failedChecks: 2 });

    // Recovery resolves it
    mode = "ok";
    await api.post(`/api/monitors/${monitor._id}/run`).expect(200);
    incident = await Incident.findById(incident!._id).lean();
    expect(incident?.status).toBe("resolved");
    expect(incident?.durationMs).toBeGreaterThanOrEqual(0);

    await waitFor(() => webhooks.length >= 3);
    expect(webhooks.map((w) => w.event)).toEqual(["degraded", "escalated", "recovered"]);
    expect(webhooks[0].text).toContain("Health is DEGRADED");

    const stats = (await api.get(`/api/monitors/${monitor._id}/stats?window=1h`).expect(200)).body;
    expect(stats).toMatchObject({ total: 4, up: 2, degraded: 1, down: 1, uptimePct: 75 });
    expect(stats.series).toHaveLength(60);

    const failing = (await api.get(`/api/monitors/${monitor._id}/checks?status=failing`).expect(200)).body;
    expect(failing.items).toHaveLength(2);

    const dash = (await api.get("/api/dashboard?window=24h").expect(200)).body;
    expect(dash.monitors).toMatchObject({ total: 1, up: 1 });
    expect(dash.checks.total).toBe(4);
    expect(dash.incidents.resolvedInWindow).toBe(1);
    expect(dash.recentFailures[0].monitorName).toBe("Health");
    expect(dash.monitorRows[0]).toMatchObject({ name: "Health", uptimePct: 75, checks: 4 });
  });

  it("waits for the failure threshold before opening an incident", async () => {
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody({ failureThreshold: 2 })).expect(201);
    mode = "error";
    await api.post(`/api/monitors/${monitor._id}/run`);
    expect(await Incident.countDocuments()).toBe(0);
    await api.post(`/api/monitors/${monitor._id}/run`);
    expect(await Incident.countDocuments({ status: "open" })).toBe(1);
  });

  it("pausing closes open incidents; deleting removes history", async () => {
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody()).expect(201);
    mode = "error";
    await api.post(`/api/monitors/${monitor._id}/run`);
    const paused = (await api.post(`/api/monitors/${monitor._id}/pause`).expect(200)).body;
    expect(paused.state.status).toBe("paused");
    expect(await Incident.countDocuments({ status: "open" })).toBe(0);

    await api.delete(`/api/monitors/${monitor._id}`).expect(204);
    expect(await MonitorCheck.countDocuments()).toBe(0);
  });

  it("serialises concurrent checks so they never open duplicate incidents", async () => {
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody()).expect(201);
    mode = "error";
    await Promise.all([1, 2, 3].map(() => api.post(`/api/monitors/${monitor._id}/run`)));
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(1);
    const incident = await Incident.findOne({ monitorId: monitor._id }).lean();
    expect(incident?.failedChecks).toBe(3);
  });

  it("ignores a check that finishes after the monitor was paused", async () => {
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody()).expect(201);
    mode = "slow"; // 150 ms response: pause lands while it's in flight
    const inFlight = api.post(`/api/monitors/${monitor._id}/run`).then((r) => r); // .then() dispatches now
    await new Promise((r) => setTimeout(r, 40));
    await api.post(`/api/monitors/${monitor._id}/pause`).expect(200);
    await inFlight;
    const m = await Monitor.findById(monitor._id).lean();
    expect(m?.state?.status).toBe("paused");
    expect(await Incident.countDocuments({ status: "open" })).toBe(0);
  });

  it("validates schedules and dry-runs definitions", async () => {
    const bad = await api
      .post("/api/monitors")
      .send(monitorBody({ schedule: { type: "cron", expression: "every minute" } }))
      .expect(400);
    expect(bad.body.error).toMatch(/Invalid cron/);
    await api.post("/api/monitors").send(monitorBody({ schedule: { type: "interval", seconds: 5 } })).expect(400);

    const dry = (await api.post("/api/monitors/test").send(monitorBody()).expect(200)).body;
    expect(dry).toMatchObject({ status: "up", statusCode: 200 });
    expect(await MonitorCheck.countDocuments()).toBe(0);
  });
});

describe("scheduler", () => {
  it("runs a new monitor immediately and schedules the next run", async () => {
    await scheduler.start();
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody()).expect(201);
    await waitFor(async () => (await MonitorCheck.countDocuments({ monitorId: monitor._id })) === 1);
    await waitFor(async () => Boolean((await Monitor.findById(monitor._id).lean())?.state?.nextRunAt));
    const m = await Monitor.findById(monitor._id).lean();
    const gap = m!.state!.nextRunAt!.getTime() - m!.state!.lastCheckedAt!.getTime();
    expect(gap).toBeGreaterThanOrEqual(59_000);
    expect(m!.state!.status).toBe("up");
    scheduler.stop();
  });
});

describe("whoami", () => {
  it("summarises the signed-in user's monitors and recent checks only", async () => {
    const a = await signedInAgent(app);
    const b = await signedInAgent(app);
    const monitorId = new Monitor()._id;
    const now = new Date();
    await runAs(a.user.id, () =>
      MonitorCheck.create([
        { monitorId, status: "up", checkedAt: now },
        { monitorId, status: "down", checkedAt: now },
        { monitorId, status: "up", checkedAt: new Date(now.getTime() - 3 * 86_400_000) },
        { monitorId, status: "up", checkedAt: new Date(now.getTime() - 30 * 86_400_000) },
      ]),
    );
    const mine = (await a.get("/api/dashboard/whoami").expect(200)).body;
    expect(mine.daily).toHaveLength(14);
    expect(mine.daily.at(-1)).toBe(2);
    expect(mine.checks).toBe(3);
    expect(mine.passRate).toBeCloseTo(2 / 3);
    const theirs = (await b.get("/api/dashboard/whoami").expect(200)).body;
    expect(theirs).toMatchObject({ checks: 0, passRate: null, monitors: { total: 0 } });
  });
});

describe("strict mode for CI", () => {
  it("answers 422 when a monitor run or a request fails, 200 when it passes", async () => {
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody()).expect(201);
    mode = "ok";
    await api.post(`/api/monitors/${monitor._id}/run?strict=1`).expect(200);
    mode = "error";
    expect((await api.post(`/api/monitors/${monitor._id}/run?strict=1`).expect(422)).body.status).toBe("down");
    await api.post(`/api/monitors/${monitor._id}/run`).expect(200);

    const request = monitorBody().request;
    expect((await api.post("/api/requests/execute?strict=1").send({ request }).expect(422)).body.verdict).toBe("fail");
    mode = "ok";
    expect((await api.post("/api/requests/execute?strict=1").send({ request }).expect(200)).body.verdict).toBe("pass");
  });
});

describe("bulk delete", () => {
  it("deletes only the caller's monitors and runs, with their checks", async () => {
    const other = await signedInAgent(app);
    const a = (await api.post("/api/monitors").send(monitorBody({ name: "A" })).expect(201)).body;
    const b = (await api.post("/api/monitors").send(monitorBody({ name: "B" })).expect(201)).body;
    const theirs = (await other.post("/api/monitors").send(monitorBody({ name: "C" })).expect(201)).body;
    mode = "ok";
    await api.post(`/api/monitors/${a._id}/run`).expect(200);

    expect((await api.post("/api/monitors/bulk-delete").send({ ids: [a._id, b._id, theirs._id] }).expect(200)).body.deleted).toBe(2);
    expect(await MonitorCheck.countDocuments({ monitorId: a._id })).toBe(0);
    await other.get(`/api/monitors/${theirs._id}`).expect(200);
    await api.post("/api/monitors/bulk-delete").send({ ids: [] }).expect(400);

    const run = async () => (await api.post("/api/requests/execute").send({ request: { url: `${baseUrl}/health` } }).expect(200)).body.historyId as string;
    const [h1, h2] = [await run(), await run()];
    expect((await api.post("/api/history/bulk-delete").send({ ids: [h1, h2] }).expect(200)).body.deleted).toBe(2);
    await api.get(`/api/history/${h1}`).expect(404);
  });
});

describe("collection monitors and maintenance", () => {
  it("runs a whole collection on each check and names the request that failed", async () => {
    const c = (await api.post("/api/collections").send({ name: `Checkout ${Date.now()}` }).expect(201)).body;
    await api.post(`/api/collections/${c._id}/requests`).send({ name: "health", request: { url: `${baseUrl}/health` } }).expect(201);
    await api.post(`/api/collections/${c._id}/requests`).send({ name: "status", request: { url: `${baseUrl}/status` } }).expect(201);
    const { request: _ignored, ...rest } = monitorBody({ collectionId: c._id, assertions: [] });
    const { body: monitor } = await api.post("/api/monitors").send(rest).expect(201);
    // the stored request mirrors the collection's first request, for display
    expect(monitor.request.url).toBe(`${baseUrl}/health`);

    expect((await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body.status).toBe("up");
    mode = "error";
    const down = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(down).toMatchObject({ status: "down", statusCode: 503 });
    // each failure names the request and its address, so incidents and alerts say which one broke
    expect(down.failures).toEqual([`health (GET ${baseUrl}/health): status 503`, `status (GET ${baseUrl}/status): status 503`]);
    const incident = await Incident.findOne({ monitorId: monitor._id, status: "open" }).lean();
    expect(incident?.cause).toBe(`health (GET ${baseUrl}/health): status 503`);
  });

  it("caps how many monitors one account can have", async () => {
    const cap = config.maxMonitors;
    (config as { maxMonitors: number }).maxMonitors = 1;
    try {
      await api.post("/api/monitors").send(monitorBody()).expect(201);
      expect((await api.post("/api/monitors").send(monitorBody({ name: "Second" })).expect(403)).body.error).toMatch(/up to 1 monitors/);
    } finally {
      (config as { maxMonitors: number }).maxMonitors = cap;
    }
  });

  it("rejects a monitor with neither a request nor a collection", async () => {
    const { request: _ignored, ...rest } = monitorBody();
    await api.post("/api/monitors").send(rest).expect(400);
  });

  it("records checks during maintenance without incidents, alerts or uptime cost", async () => {
    const now = Date.now();
    const maintenance = [{ startsAt: new Date(now - 3600_000), endsAt: new Date(now + 3600_000), note: "deploy" }];
    const { body: monitor } = await api.post("/api/monitors").send(monitorBody({ maintenance })).expect(201);
    mode = "error";
    const check = (await api.post(`/api/monitors/${monitor._id}/run`).expect(200)).body;
    expect(check).toMatchObject({ status: "down", maintenance: true });
    expect(await Incident.countDocuments({ monitorId: monitor._id })).toBe(0);
    const stats = (await api.get(`/api/monitors/${monitor._id}/stats?window=1h`).expect(200)).body;
    expect(stats.total).toBe(0);
    await api
      .post("/api/monitors")
      .send(monitorBody({ maintenance: [{ startsAt: new Date(now), endsAt: new Date(now - 1) }] }))
      .expect(400);
  });
});

describe("alert payloads", () => {
  const payload = {
    kind: "down" as const,
    monitor: { id: "m1", name: "Checkout", url: "https://api.example.com/health" },
    incident: { id: "i1", severity: "down", cause: "status 503", startedAt: new Date("2026-01-01T00:00:00Z") },
  };

  it("speaks Slack's and Discord's formats, and plain JSON elsewhere", () => {
    const slack = alertBody("https://hooks.slack.com/services/T/B/X", payload);
    expect(Object.keys(slack).sort()).toEqual(["blocks", "text"]);
    expect(slack.text).toBe("[themis] Checkout is DOWN: status 503");

    const discord = alertBody("https://discord.com/api/webhooks/1/abc", payload) as { embeds: { title: string; description: string }[] };
    expect(Object.keys(discord).sort()).toEqual(["embeds", "username"]);
    expect(discord.embeds[0]).toMatchObject({ title: "Checkout: down", description: "status 503" });

    expect(alertBody("https://example.com/hook", payload)).toMatchObject({ event: "down", kind: "down", monitor: payload.monitor });
  });
});
