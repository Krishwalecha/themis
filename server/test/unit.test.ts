import { describe, expect, it } from "vitest";
import { prepareRequest } from "../src/lib/executor";
import { interpolateSpec, maskSecrets, variablesFrom } from "../src/lib/interpolate";
import { requestSpecSchema } from "../src/schemas/requestSpec";

const spec = (input: unknown) => requestSpecSchema.parse(input);

describe("interpolateSpec", () => {
  it("replaces variables everywhere and reports unknown ones", () => {
    const { spec: out, unresolved } = interpolateSpec(
      spec({
        method: "POST",
        url: "{{baseUrl}}/users/{{ id }}",
        params: [{ key: "q", value: "{{query}}" }],
        headers: [{ key: "X-Tenant", value: "{{tenant}}" }],
        body: { mode: "json", content: '{"name":"{{name}}"}' },
        auth: { type: "bearer", token: "{{token}}" },
      }),
      { baseUrl: "https://api.test", id: "42", name: "Ada", token: "t0k" },
    );
    expect(out.url).toBe("https://api.test/users/42");
    expect(out.body).toEqual({ mode: "json", content: '{"name":"Ada"}' });
    expect(out.auth).toEqual({ type: "bearer", token: "t0k" });
    expect(out.headers[0].value).toBe("{{tenant}}");
    expect(unresolved.sort()).toEqual(["query", "tenant"]);
  });

  it("ignores disabled environment variables", () => {
    expect(
      variablesFrom([
        { key: "a", value: "1", enabled: true },
        { key: "b", value: "2", enabled: false },
      ]),
    ).toEqual({ a: "1" });
  });
});

describe("prepareRequest", () => {
  it("builds query params, auth and default headers", () => {
    const p = prepareRequest(
      spec({
        url: "example.com/search?x=1",
        params: [
          { key: "q", value: "hello world" },
          { key: "skip", value: "1", enabled: false },
        ],
        auth: { type: "apiKey", key: "api_key", value: "secret", in: "query" },
      }),
    );
    expect(p.url).toBe("http://example.com/search?x=1&q=hello+world&api_key=secret");
    expect(p.headers.find((h) => h.key === "User-Agent")).toBeTruthy();
    expect(p.body).toBeUndefined();
  });

  it("encodes basic auth and sets JSON content type", () => {
    const p = prepareRequest(
      spec({
        method: "POST",
        url: "https://example.com",
        body: { mode: "json", content: "{}" },
        auth: { type: "basic", username: "user", password: "pass" },
      }),
    );
    expect(p.headers).toContainEqual({ key: "Authorization", value: "Basic dXNlcjpwYXNz" });
    expect(p.headers).toContainEqual({ key: "Content-Type", value: "application/json" });
    expect(p.body).toBe("{}");
  });

  it("does not override an explicit Authorization or Content-Type header", () => {
    const p = prepareRequest(
      spec({
        method: "PUT",
        url: "https://example.com",
        headers: [
          { key: "authorization", value: "Custom x" },
          { key: "content-type", value: "application/vnd.api+json" },
        ],
        body: { mode: "json", content: "{}" },
        auth: { type: "bearer", token: "ignored" },
      }),
    );
    expect(p.headers.filter((h) => h.key.toLowerCase() === "authorization")).toEqual([
      { key: "authorization", value: "Custom x" },
    ]);
    expect(p.headers.filter((h) => h.key.toLowerCase() === "content-type")).toHaveLength(1);
  });

  it("never sends a body with GET", () => {
    const p = prepareRequest(spec({ url: "https://example.com", body: { mode: "text", content: "hi" } }));
    expect(p.body).toBeUndefined();
  });

  it("rejects non-http protocols", () => {
    expect(() => prepareRequest(spec({ url: "file:///etc/passwd" }))).toThrow(/Unsupported protocol/);
  });
});

describe("secret masking", () => {
  it("masks secrets in plain text, URL-encoded, and inside Basic auth", () => {
    expect(maskSecrets("Bearer sk_live_123", ["sk_live_123"])).toBe("Bearer ••••");
    expect(maskSecrets("https://x.dev/?key=a%2Fb%3D", ["a/b="])).toBe("https://x.dev/?key=••••");
    expect(maskSecrets(`Basic ${Buffer.from("ada:hunter22").toString("base64")}`, ["hunter22"])).toBe("Basic ••••");
    expect(maskSecrets("ab and more", ["ab"])).toBe("ab and more");
  });
});
