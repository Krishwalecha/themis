// `themis check <url>`: send one request, assert on it, print a verdict. Exits 1 on FAIL.
import { c, formatBytes, pad, stamp } from "./ui.mjs";

export const CHECK_HELP = `
  Usage: themis check <url> [options]

  Options
    -X, --method <verb>      HTTP method (default GET, or POST with --data)
    -H, --header <k: v>      Request header, repeatable
    -d, --data <body>        Request body (sent as JSON if it parses)
    --status <code|2xx>      Expected status (default 2xx)
    --max-ms <n>             Latency budget in ms (default 1000)
    --contains <text>        Body must contain this text
    --json-path <a.b[0].c>   Path that must exist in the JSON body
    --timeout <ms>           Abort after this long (default 15000)
    --body                   Print the response body
    --json                   Machine-readable output
`;

export const parseCheckArgs = (argv) => {
  const opts = { method: undefined, headers: {}, data: undefined, status: "2xx", maxMs: 1000, contains: [], jsonPaths: [], timeout: 15000, body: false, json: false };
  let url;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "-X" || a === "--method") opts.method = next().toUpperCase();
    else if (a === "-H" || a === "--header") {
      const raw = next();
      const at = raw.indexOf(":");
      if (at < 1) throw new Error(`Header must look like "Name: value", got "${raw}"`);
      opts.headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
    } else if (a === "-d" || a === "--data") opts.data = next();
    else if (a === "--status") opts.status = next();
    else if (a === "--max-ms") opts.maxMs = Number(next());
    else if (a === "--contains") opts.contains.push(next());
    else if (a === "--json-path") opts.jsonPaths.push(next());
    else if (a === "--timeout") opts.timeout = Number(next());
    else if (a === "--body") opts.body = true;
    else if (a === "--json") opts.json = true;
    else if (a.startsWith("-")) throw new Error(`Unknown option ${a}`);
    else if (!url) url = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  if (!url) throw new Error("Missing <url>");
  if (!/^https?:\/\//i.test(url)) url = `http${/^(localhost|127\.|\[::1\])/.test(url) ? "" : "s"}://${url}`;
  opts.method ??= opts.data === undefined ? "GET" : "POST";
  if (!Number.isFinite(opts.maxMs) || opts.maxMs <= 0) throw new Error("--max-ms must be a positive number");
  return { url, opts };
};

// Resolves `a.b[0].c` against a value; returns { found, value }
export const readPath = (root, path) => {
  const parts = path.replace(/^\$\.?/, "").match(/[^.[\]]+/g) ?? [];
  let cur = root;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || !(p in cur)) return { found: false };
    cur = cur[p];
  }
  return { found: true, value: cur };
};

export const statusMatches = (status, expected) => {
  const e = String(expected).toLowerCase();
  if (/^[1-5]xx$/.test(e)) return Math.floor(status / 100) === Number(e[0]);
  return status === Number(e);
};

// Pure: turns a response into assertion results
export const judge = (res, opts) => {
  const checks = [];
  checks.push({ label: `status is ${opts.status}`, ok: statusMatches(res.status, opts.status), note: String(res.status) });
  checks.push({ label: `latency < ${opts.maxMs}ms`, ok: res.ms < opts.maxMs, note: `${Math.round(res.ms)}ms` });
  const isJson = /json/i.test(res.contentType ?? "");
  let parsed;
  if (isJson) {
    try {
      parsed = JSON.parse(res.text);
      checks.push({ label: "body is valid JSON", ok: true, note: Array.isArray(parsed) ? `array(${parsed.length})` : typeof parsed });
    } catch {
      checks.push({ label: "body is valid JSON", ok: false, note: "parse error" });
    }
  }
  for (const text of opts.contains) checks.push({ label: `body contains "${text}"`, ok: res.text.includes(text), note: "" });
  for (const path of opts.jsonPaths) {
    const hit = parsed === undefined ? { found: false } : readPath(parsed, path);
    checks.push({ label: `has ${path}`, ok: hit.found, note: hit.found ? JSON.stringify(hit.value)?.slice(0, 24) ?? "" : "missing" });
  }
  return { checks, pass: checks.every((ch) => ch.ok), parsed };
};

export const runCheck = async (argv) => {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(CHECK_HELP);
    return 0;
  }
  const { url, opts } = parseCheckArgs(argv);
  const headers = { "user-agent": "themis-cli/0.2", ...opts.headers };
  let body = opts.data;
  if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
    try {
      JSON.parse(body);
      headers["content-type"] = "application/json";
    } catch {
      headers["content-type"] = "text/plain";
    }
  }

  const started = performance.now();
  let res;
  try {
    const r = await fetch(url, { method: opts.method, headers, body, redirect: "follow", signal: AbortSignal.timeout(opts.timeout) });
    const text = await r.text();
    res = { status: r.status, statusText: r.statusText, ms: performance.now() - started, text, bytes: Buffer.byteLength(text), contentType: r.headers.get("content-type") };
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? `timed out after ${opts.timeout}ms` : (err?.cause?.code ?? err?.message ?? String(err));
    if (opts.json) console.log(JSON.stringify({ url, method: opts.method, pass: false, error: reason }, null, 2));
    else {
      console.log(`\n  ${c.accent(opts.method)} ${c.paper(url)}\n`);
      console.log(`  ${c.red("✗")} request failed  ${c.mute(reason)}\n`);
      console.log(`  ${c.mute("verdict")}  ${stamp(false)}\n`);
    }
    return 1;
  }

  const { checks, pass, parsed } = judge(res, opts);
  if (opts.json) {
    console.log(JSON.stringify({ url, method: opts.method, status: res.status, ms: Math.round(res.ms), bytes: res.bytes, pass, checks }, null, 2));
    return pass ? 0 : 1;
  }

  const tone = res.status < 300 ? c.green : res.status < 400 ? c.paper : c.red;
  console.log(`\n  ${c.accent(opts.method)} ${c.paper(url)}`);
  console.log(`  ${tone(`${res.status} ${res.statusText}`)} ${c.mute(`· ${Math.round(res.ms)} ms · ${formatBytes(res.bytes)}${res.contentType ? ` · ${res.contentType.split(";")[0]}` : ""}`)}\n`);
  const width = Math.max(...checks.map((ch) => ch.label.length)) + 4;
  for (const ch of checks) console.log(`  ${ch.ok ? c.green("✓") : c.red("✗")} ${pad(ch.label, width)}${c.mute(ch.note)}`);
  if (opts.body) {
    const shown = parsed !== undefined ? JSON.stringify(parsed, null, 2) : res.text;
    const lines = shown.split("\n");
    console.log(`\n${lines.slice(0, 40).map((l) => `  ${c.mute("│")} ${l}`).join("\n")}${lines.length > 40 ? `\n  ${c.mute(`│ … ${lines.length - 40} more lines`)}` : ""}`);
  }
  const failed = checks.filter((ch) => !ch.ok).length;
  console.log(`\n  ${c.mute("verdict")}  ${stamp(pass)}  ${c.mute(pass ? `${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`)}\n`);
  return pass ? 0 : 1;
};
