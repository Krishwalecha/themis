import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { judge, parseCheckArgs, readPath, statusMatches } from "../src/check.mjs";
import { mongoTarget, parseEnv, renderEnv } from "../src/project.mjs";

test("parseCheckArgs fills defaults and adds a scheme", () => {
  const { url, opts } = parseCheckArgs(["api.example.com/health", "-H", "x-key: 1", "--max-ms", "250"]);
  assert.equal(url, "https://api.example.com/health");
  assert.equal(opts.method, "GET");
  assert.deepEqual(opts.headers, { "x-key": "1" });
  assert.equal(opts.maxMs, 250);
  assert.equal(parseCheckArgs(["localhost:4000/api/health"]).url, "http://localhost:4000/api/health");
  assert.equal(parseCheckArgs(["http://x", "-d", "{}"]).opts.method, "POST");
  assert.throws(() => parseCheckArgs([]), /Missing <url>/);
  assert.throws(() => parseCheckArgs(["http://x", "--nope"]), /Unknown option/);
});

test("statusMatches handles classes and exact codes", () => {
  assert.ok(statusMatches(204, "2xx"));
  assert.ok(!statusMatches(301, "2xx"));
  assert.ok(statusMatches(404, "404"));
});

test("readPath walks objects and arrays", () => {
  const v = { data: [{ id: "a", total: 3 }] };
  assert.deepEqual(readPath(v, "data[0].total"), { found: true, value: 3 });
  assert.deepEqual(readPath(v, "$.data[1].id"), { found: false });
});

test("judge fails on wrong status, slow response, and missing paths", () => {
  const res = { status: 500, ms: 1200, text: '{"ok":false}', contentType: "application/json" };
  const { pass, checks } = judge(res, { status: "2xx", maxMs: 1000, contains: ["ok"], jsonPaths: ["ok", "data"] });
  assert.equal(pass, false);
  assert.deepEqual(
    checks.map((ch) => ch.ok),
    [false, false, true, true, true, false],
  );
});

test("env helpers round-trip and keep comments", () => {
  const template = "# db\nMONGODB_URI=mongodb://x\nGROQ_API_KEY=\n";
  const out = renderEnv(template, { MONGODB_URI: "", GROQ_API_KEY: "gsk_test", THEMIS_PORT: "4100" });
  assert.match(out, /^# db\nMONGODB_URI=\nGROQ_API_KEY=gsk_test\n\nTHEMIS_PORT=4100\n$/);
  assert.deepEqual(parseEnv(out), { MONGODB_URI: "", GROQ_API_KEY: "gsk_test", THEMIS_PORT: "4100" });
  assert.deepEqual(mongoTarget("mongodb://u:p@db.local:27018/themis"), { host: "db.local", port: 27018 });
  assert.equal(mongoTarget("mongodb+srv://cluster.example.net/db"), null);
});

test("check command passes against a live server and fails on a bad path", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", items: [1, 2] }));
  }).listen(0);
  const { port } = server.address();
  const { execFile } = await import("node:child_process");
  const run = (args) =>
    new Promise((resolve) => {
      execFile(process.execPath, ["bin/themis.mjs", "check", `http://127.0.0.1:${port}/`, ...args], (err, stdout) =>
        resolve({ code: err ? err.code : 0, stdout }),
      );
    });
  try {
    const good = await run(["--json-path", "items[1]", "--json"]);
    assert.equal(good.code, 0);
    assert.equal(JSON.parse(good.stdout).pass, true);
    const bad = await run(["--json-path", "missing", "--json"]);
    assert.equal(bad.code, 1);
  } finally {
    server.close();
  }
});
