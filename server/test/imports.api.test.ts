import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/db";
import { parseCurl } from "../src/lib/importers/curl";
import { signedInAgent } from "./helpers";

const app = createApp();

beforeAll(async () => {
  await connectDatabase("");
});

afterAll(async () => {
  await disconnectDatabase();
});

describe("curl import", () => {
  it("reads a bash command with headers, a JSON body and a bearer token", () => {
    const { spec } = parseCurl(`curl -X POST 'https://api.example.com/v1/orders?expand=items' \\
      -H 'Content-Type: application/json' \\
      -H "Authorization: Bearer abc123" \\
      --data-raw '{"sku":"A1","qty":2}'`);
    expect(spec).toMatchObject({
      method: "POST",
      url: "https://api.example.com/v1/orders?expand=items",
      auth: { type: "bearer", token: "abc123" },
      body: { mode: "json" },
    });
    expect(JSON.parse((spec.body as { content: string }).content)).toEqual({ sku: "A1", qty: 2 });
    expect(spec.headers).toEqual([{ key: "Content-Type", value: "application/json", enabled: true }]);
  });

  it("reads Chrome's Windows cmd format", () => {
    const { spec } = parseCurl(`curl ^"https://api.example.com/items^" ^
  -H ^"accept: application/json^" ^
  --data-raw ^"^{^\\^"name^\\^":^\\^"pen^\\^"^}^"`);
    expect(spec.method).toBe("POST");
    expect(spec.url).toBe("https://api.example.com/items");
    expect(JSON.parse((spec.body as { content: string }).content)).toEqual({ name: "pen" });
  });

  it("handles --json, -u, -G and bundled flags", () => {
    expect(parseCurl(`curl -sSL --json '{"a":1}' api.example.com/x`).spec).toMatchObject({ method: "POST", url: "https://api.example.com/x", body: { mode: "json" } });
    expect(parseCurl("curl -u ada:s3cret https://x.dev").spec.auth).toEqual({ type: "basic", username: "ada", password: "s3cret" });
    expect(parseCurl("curl -G -d q=pens -d limit=5 https://x.dev/search").spec).toMatchObject({ method: "GET", url: "https://x.dev/search?q=pens&limit=5", body: { mode: "none" } });
    expect(parseCurl("curl -d 'a=1&b=two' https://x.dev").spec.body).toEqual({
      mode: "form-urlencoded",
      form: [
        { key: "a", value: "1", enabled: true },
        { key: "b", value: "two", enabled: true },
      ],
    });
  });

  it("reads a multi-line command pasted into a one-line field", () => {
    const { spec } = parseCurl("curl -X PUT https://x.dev/items/1 \\   -H 'X-Team: core' \\   -d 'name=pen'");
    expect(spec).toMatchObject({ method: "PUT", url: "https://x.dev/items/1", headers: [{ key: "X-Team", value: "core" }], body: { mode: "form-urlencoded" } });
  });

  it("rejects things that aren't curl", () => {
    expect(() => parseCurl("wget https://x.dev")).toThrow(/starts with curl/);
  });
});

describe("import endpoint", () => {
  it("returns a curl request without saving anything", async () => {
    const api = await signedInAgent(app);
    const res = await api.post("/api/import").send({ content: "curl https://api.github.com/zen" }).expect(200);
    expect(res.body).toMatchObject({ kind: "curl", request: { method: "GET", url: "https://api.github.com/zen" } });
    expect((await api.get("/api/collections").expect(200)).body.items).toHaveLength(0);
  });

  it("imports a Postman collection with folders, inherited auth and variables", async () => {
    const api = await signedInAgent(app);
    const postman = {
      info: { name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] },
      variable: [
        { key: "baseUrl", value: "https://shop.dev" },
        { key: "token", value: "t0k" },
      ],
      item: [
        {
          name: "Orders",
          item: [
            { name: "List", request: { method: "GET", url: { raw: "{{baseUrl}}/orders" } } },
            {
              name: "Create",
              request: { method: "POST", url: "{{baseUrl}}/orders", body: { mode: "raw", raw: '{"qty":1}', options: { raw: { language: "json" } } } },
            },
          ],
        },
        { name: "Health", request: { method: "GET", url: "{{baseUrl}}/health", auth: { type: "noauth" } } },
      ],
    };
    const res = await api.post("/api/import").send({ content: JSON.stringify(postman) }).expect(201);
    expect(res.body).toMatchObject({ kind: "postman", collection: { name: "Shop", requestCount: 3 }, environment: { name: "Shop", variables: 2 } });

    const c = (await api.get(`/api/collections/${res.body.collection._id}`).expect(200)).body;
    expect(c.environmentId).toBe(res.body.environment._id);
    expect(c.requests.map((r: { name: string }) => r.name)).toEqual(["Orders / List", "Orders / Create", "Health"]);
    expect(c.requests[0].request.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(c.requests[1].request.body).toEqual({ mode: "json", content: '{"qty":1}' });
    expect(c.requests[2].request.auth).toEqual({ type: "none" });

    // importing again keeps both, with a numbered name
    const again = await api.post("/api/import").send({ content: postman }).expect(201);
    expect(again.body.collection.name).toBe("Shop (2)");
  });

  it("imports an OpenAPI document as a collection, an environment and a linked contract", async () => {
    const api = await signedInAgent(app);
    const yaml = `openapi: 3.0.3
info: { title: Pets, version: "1.0" }
servers: [{ url: "https://pets.dev/v1" }]
components:
  securitySchemes:
    key: { type: http, scheme: bearer }
  schemas:
    Pet:
      type: object
      required: [name]
      properties: { name: { type: string, example: Rex }, age: { type: integer } }
security: [{ key: [] }]
paths:
  /pets:
    get:
      summary: List pets
      parameters: [{ name: limit, in: query, required: true, schema: { type: integer, example: 10 } }]
      responses: { "200": { description: ok } }
    post:
      summary: Add a pet
      requestBody: { content: { application/json: { schema: { $ref: "#/components/schemas/Pet" } } } }
      responses: { "201": { description: created } }
  /pets/{petId}:
    get:
      operationId: getPet
      parameters: [{ name: petId, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: ok } }
`;
    const res = await api.post("/api/import").send({ content: yaml }).expect(201);
    expect(res.body).toMatchObject({ kind: "openapi", collection: { name: "Pets", requestCount: 3 }, contract: { _id: expect.any(String) } });

    const c = (await api.get(`/api/collections/${res.body.collection._id}`).expect(200)).body;
    const byName = Object.fromEntries(c.requests.map((r: { name: string }) => [r.name, r]));
    expect(byName["List pets"].request).toMatchObject({ method: "GET", url: "{{baseUrl}}/pets?limit=10", auth: { type: "bearer", token: "{{token}}" } });
    expect(JSON.parse(byName["Add a pet"].request.body.content)).toEqual({ name: "Rex" });
    expect(byName.getPet.request.url).toBe("{{baseUrl}}/pets/{{petId}}");
    expect(byName.getPet.contractId).toBe(res.body.contract._id);

    const env = (await api.get(`/api/environments/${res.body.environment._id}`).expect(200)).body;
    expect(env.variables.map((v: { key: string }) => v.key)).toEqual(["baseUrl", "petId", "token"]);
    expect(env.variables[0].value).toBe("https://pets.dev/v1");
  });

  it("explains what it accepts when the input is something else", async () => {
    const api = await signedInAgent(app);
    const res = await api.post("/api/import").send({ content: '{"hello":"world"}' }).expect(400);
    expect(res.body.error).toMatch(/curl command, a Postman collection/);
  });
});
