// Forwards /api/* to the API at THEMIS_API_URL, so the app and its sign-in cookie stay on one domain
export const config = { runtime: "edge" };

const HOP = ["host", "connection", "content-length", "transfer-encoding"];

export default async (request) => {
  const api = process.env.THEMIS_API_URL?.replace(/\/+$/, "");
  if (!api) return Response.json({ error: { code: "not_configured", message: "THEMIS_API_URL is not set" } }, { status: 500 });

  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  url.searchParams.delete("path");
  const target = `${api}/api/${path}${url.search}`;

  const headers = new Headers(request.headers);
  for (const h of HOP) headers.delete(h);
  const hasBody = !["GET", "HEAD"].includes(request.method);

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
  });
  // fetch already decoded the body, so its encoding and length no longer apply
  const out = new Headers(res.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
};
