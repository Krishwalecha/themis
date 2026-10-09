import { describe, expect, it } from "vitest";
import { diffContracts, diffSchemas } from "../src/lib/contracts/diff";
import { inferContract, inferSchema } from "../src/lib/contracts/infer";
import { listOperations, matchOperation } from "../src/lib/contracts/openapi";
import { checkDocument, findDrift, validateResponse } from "../src/lib/contracts/validate";

const spec = {
  openapi: "3.0.3",
  info: { title: "Users", version: "1" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/users": {
      get: {
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/User" } } } },
          },
        },
      },
    },
    "/users/{id}": {
      get: {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          "4XX": { description: "error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/users/me": {
      get: { responses: { "200": { description: "me", content: { "application/json": { schema: { type: "object" } } } } } },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        required: ["id", "email", "role"],
        properties: {
          id: { type: "integer" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["admin", "member"] },
          nickname: { type: "string", nullable: true },
          manager: { $ref: "#/components/schemas/User" },
        },
      },
      Error: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
    },
  },
};

const user = { id: 1, email: "ada@example.com", role: "admin", nickname: null };

describe("OpenAPI matching", () => {
  it("matches templates under the server base path, preferring literal segments", () => {
    expect(matchOperation(spec, "GET", "https://api.example.com/v1/users/42")).toMatchObject({ path: "/users/{id}", params: { id: "42" } });
    expect(matchOperation(spec, "get", "https://api.example.com/v1/users/me")?.path).toBe("/users/me");
    expect(matchOperation(spec, "POST", "https://api.example.com/v1/users")).toBeNull();
    expect(listOperations(spec)).toHaveLength(3);
  });
});

describe("validateResponse", () => {
  const sample = (url: string, status: number, body: unknown) => ({ method: "GET", url, status, body: JSON.stringify(body) });

  it("accepts a valid body (with $ref, nullable and recursive refs)", () => {
    const r = validateResponse("openapi", spec, sample("https://api.example.com/v1/users/1", 200, user));
    expect(r).toMatchObject({ valid: true, errors: [], matched: { path: "/users/{id}", method: "GET", status: "200" } });
  });

  it("reports precise violations", () => {
    const r = validateResponse("openapi", spec, sample("https://api.example.com/v1/users/1", 200, { id: "1", email: "nope", role: "owner" }));
    expect(r.valid).toBe(false);
    const messages = r.errors.map((e) => `${e.path} ${e.message}`);
    expect(messages).toEqual(
      expect.arrayContaining(['/id must be integer', '/email must match format "email"', '/role must be one of ["admin","member"]']),
    );
  });

  it("uses status ranges and flags undocumented statuses", () => {
    expect(validateResponse("openapi", spec, sample("https://api.example.com/v1/users/1", 404, { message: "x" })).matched?.status).toBe("4XX");
    const r = validateResponse("openapi", spec, sample("https://api.example.com/v1/users/1", 500, {}));
    expect(r.errors[0].message).toMatch(/status 500 is not documented/);
  });

  it("validates arrays, detects drift and skips unknown operations", () => {
    const r = validateResponse("openapi", spec, sample("https://api.example.com/v1/users", 200, [{ ...user, avatar: "x" }, { ...user, avatar: "y" }]));
    expect(r.valid).toBe(true);
    expect(r.drift).toEqual([{ path: "/*/avatar", kind: "undocumented", message: '"avatar" is returned but not documented' }]);
    expect(validateResponse("openapi", spec, sample("https://other.example.com/x", 200, {})).skipped).toMatch(/No operation/);
  });

  it("works with plain JSON Schema contracts", () => {
    const schema = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } }, additionalProperties: false };
    expect(validateResponse("jsonschema", schema, sample("http://x", 200, { ok: true })).valid).toBe(true);
    const bad = validateResponse("jsonschema", schema, sample("http://x", 200, { ok: 1, extra: 2 }));
    expect(bad.errors.map((e) => e.message)).toEqual(expect.arrayContaining(["must be boolean", 'has unexpected property "extra"']));
    expect(validateResponse("jsonschema", schema, { method: "GET", url: "http://x", status: 200, body: "<html>" }).skipped).toBe("Response body is not JSON");
  });

  it("checks documents before saving", () => {
    expect(checkDocument("openapi", { openapi: "3.0.0" })[0]).toMatch(/Not an OpenAPI document/);
    expect(checkDocument("jsonschema", { type: "nonsense" })[0]).toMatch(/Invalid JSON Schema/);
    expect(checkDocument("openapi", spec)).toEqual([]);
  });
});

describe("inference", () => {
  it("infers types, formats, required fields and merges array items", () => {
    const schema = inferSchema({
      id: 1,
      price: 2.5,
      at: "2026-01-01T00:00:00Z",
      items: [{ a: 1, b: "x" }, { a: 2 }],
      maybe: null,
    });
    expect(schema).toMatchObject({
      type: "object",
      required: ["id", "price", "at", "items", "maybe"],
      properties: {
        id: { type: "integer" },
        price: { type: "number" },
        at: { type: "string", format: "date-time" },
        items: { type: "array", items: { type: "object", required: ["a"] } },
        maybe: { type: "null" },
      },
    });
    const contract = inferContract({ ok: true }, "Health");
    expect(contract).toMatchObject({ $schema: expect.stringContaining("draft-07"), title: "Health" });
    expect(validateResponse("jsonschema", contract, { method: "GET", url: "x", status: 200, body: '{"ok":false}' }).valid).toBe(true);
  });

  it("only infers formats the response itself passes, so a contract made from a response accepts it", () => {
    // GitHub's root API: most links are URI templates with {placeholders}, which aren't strict URIs
    const github = {
      current_user_url: "https://api.github.com/user",
      code_search_url: "https://api.github.com/search/code?q={query}{&page,per_page,sort,order}",
      user_url: "https://api.github.com/users/{user}",
      contact: "not an email@",
    };
    const schema = inferSchema(github) as { properties: Record<string, { format?: string }> };
    expect(schema.properties.current_user_url.format).toBe("uri");
    expect(schema.properties.code_search_url.format).toBe("uri-template");
    expect(schema.properties.contact.format).toBeUndefined();
    const contract = inferContract(github, "GitHub");
    expect(validateResponse("jsonschema", contract, { method: "GET", url: "https://api.github.com/", status: 200, body: JSON.stringify(github) })).toMatchObject({
      valid: true,
      errors: [],
    });
  });
});

describe("diff", () => {
  const before = {
    type: "object",
    required: ["id", "email", "status"],
    properties: {
      id: { type: "integer" },
      email: { type: "string" },
      status: { type: "string", enum: ["active", "banned"] },
      legacy: { type: "string" },
    },
  };

  it("classifies response changes from the consumer's point of view", () => {
    const after = {
      type: "object",
      required: ["id", "status"],
      properties: {
        id: { type: "string" },
        email: { type: "string" },
        status: { type: "string", enum: ["active", "banned", "pending"] },
        avatar: { type: "string" },
      },
    };
    const changes = diffSchemas(before, after);
    const summary = changes.map((c) => `${c.path} ${c.type} ${c.breaking ? "BREAKING" : "ok"}`);
    expect(summary).toEqual(
      expect.arrayContaining([
        "/id type-changed BREAKING",
        "/email required-removed BREAKING",
        "/status enum-changed BREAKING",
        "/legacy property-removed BREAKING",
        "/avatar property-added ok",
      ]),
    );
  });

  it("finds removed operations, new required params and request-body breaks in OpenAPI", () => {
    const after = structuredClone(spec) as typeof spec & { paths: Record<string, Record<string, unknown>> };
    delete (after.paths as Record<string, unknown>)["/users/me"];
    (after.paths["/users"] as Record<string, unknown>).get = {
      ...(spec.paths["/users"].get as object),
      parameters: [{ name: "tenant", in: "query", required: true, schema: { type: "string" } }],
    };
    (after.paths["/users"] as Record<string, unknown>).post = {
      requestBody: { content: { "application/json": { schema: { type: "object" } } } },
      responses: { "201": { description: "created" } },
    };
    const changes = diffContracts("openapi", spec, after);
    const summary = changes.map((c) => `${c.location} ${c.type} ${c.breaking}`);
    expect(summary).toEqual(
      expect.arrayContaining([
        "GET /users/me operation-removed true",
        "GET /users parameter-added true",
        "POST /users operation-added false",
      ]),
    );
  });

  it("reports no changes for identical documents", () => {
    expect(diffContracts("openapi", spec, structuredClone(spec))).toEqual([]);
  });
});

describe("drift", () => {
  it("ignores schemas that forbid extra properties", () => {
    expect(findDrift({ type: "object", properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2 })).toEqual([]);
    expect(findDrift({ type: "object", properties: { a: { type: "object", properties: {} } } }, { a: { deep: 1 } })).toEqual([
      { path: "/a/deep", kind: "undocumented", message: '"deep" is returned but not documented' },
    ]);
  });
});
