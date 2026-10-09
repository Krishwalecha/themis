import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config";
import { executeRequest } from "../src/lib/executor";
import { isPrivateAddress } from "../src/lib/netguard";
import { sendWebhook } from "../src/modules/monitors/alerts";
import { requestSpecSchema } from "../src/schemas/requestSpec";

let server: http.Server;
let base = "";
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    if (req.url === "/hop") return void res.writeHead(302, { location: "/final" }).end();
    res.writeHead(200).end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  (config.request as { allowPrivateNetworks: boolean }).allowPrivateNetworks = true;
});

const guard = (on: boolean) => ((config.request as { allowPrivateNetworks: boolean }).allowPrivateNetworks = !on);

describe("private network guard", () => {
  it("knows private, loopback, link-local and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "140.82.112.3", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses requests and webhooks to private addresses when on, without sending anything", async () => {
    guard(true);
    hits = 0;
    const r = await executeRequest(requestSpecSchema.parse({ url: `${base}/x` }));
    expect(r.error).toMatchObject({ code: "BLOCKED_ADDRESS" });
    for (const url of ["http://localhost:1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]:1/"])
      expect((await executeRequest(requestSpecSchema.parse({ url }))).error?.code, url).toBe("BLOCKED_ADDRESS");
    const hook = await sendWebhook(`${base}/hook`, {
      kind: "down",
      monitor: { id: "m", name: "M", url: "x" },
      incident: { id: "i", severity: "down", cause: "c", startedAt: new Date() },
    });
    expect(hook).toMatch(/private or reserved/);
    expect(hits).toBe(0);
  });

  it("allows them when the instance opts in, and still follows redirects", async () => {
    guard(false);
    const r = await executeRequest(requestSpecSchema.parse({ url: `${base}/hop` }));
    expect(r).toMatchObject({ status: 200, redirected: true, finalUrl: `${base}/final` });
  });
});
