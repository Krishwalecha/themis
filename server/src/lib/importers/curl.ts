import type { KeyValue, RequestSpec } from "../../schemas/requestSpec";

export interface Imported {
  spec: RequestSpec;
  warnings: string[];
}

// shell-style words: quotes, backslash escapes, and line continuations from bash (\), cmd (^) and PowerShell (`)
const tokenize = (input: string): string[] => {
  let text = input
    .replace(/\\\r?\n|\^\r?\n|`\r?\n/g, " ")
    // pasted into a one-line field, continuations lose their newline and leave "\ " behind
    .replace(/(^|\s)[\\^`](?=\s)/g, "$1")
    .trim();
  // Windows cmd ("Copy as cURL (cmd)") escapes with ^: unescape, then it parses like bash
  if (/\^"/.test(text)) text = text.replace(/\^(.)/g, "$1");
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && (text[i + 1] === '"' || text[i + 1] === "\\")) cur += text[++i];
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      // $'...' ANSI-C quoting: treat like a plain single-quoted string
      if (ch === "'" && cur.endsWith("$") && !has) cur = cur.slice(0, -1);
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else if (ch === "\\" && i + 1 < text.length) {
      cur += text[++i];
    } else {
      cur += ch;
    }
  }
  if (cur || has) out.push(cur);
  return out;
};

const VALUE_FLAGS = new Set([
  "-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode", "--json",
  "-u", "--user", "-b", "--cookie", "-A", "--user-agent", "-e", "--referer", "--url", "-F", "--form", "-o", "--output",
  "-m", "--max-time", "--connect-timeout", "-c", "--cookie-jar", "-x", "--proxy", "-w", "--write-out", "--retry",
]);

const header = (key: string, value: string): KeyValue => ({ key, value, enabled: true });

export const parseCurl = (command: string): Imported => {
  const words = tokenize(command);
  if (!words.length || !/^curl(\.exe)?$/i.test(words[0])) throw new Error("Paste a command that starts with curl");
  const warnings: string[] = [];
  const headers: KeyValue[] = [];
  const data: string[] = [];
  let method: string | null = null;
  let url = "";
  let user: string | null = null;
  let asQuery = false;
  let json = false;
  let timeoutMs: number | undefined;

  for (let i = 1; i < words.length; i++) {
    let flag = words[i];
    let value: string | undefined;
    // --flag=value
    const eq = flag.startsWith("--") ? flag.indexOf("=") : -1;
    if (eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    // -sSL style bundles: expand, the last one may take the next word as its value
    if (/^-[a-zA-Z]{2,}$/.test(flag) && !VALUE_FLAGS.has(flag)) {
      const letters = flag.slice(1).split("");
      for (const l of letters.slice(0, -1)) if (l === "G") asQuery = true;
      else if (l === "I") method = "HEAD";
      flag = `-${letters[letters.length - 1]}`;
    }
    const take = () => value ?? words[++i] ?? "";
    switch (flag) {
      case "-X":
      case "--request":
        method = take().toUpperCase();
        break;
      case "-H":
      case "--header": {
        const h = take();
        const c = h.indexOf(":");
        if (c > 0) headers.push(header(h.slice(0, c).trim(), h.slice(c + 1).trim()));
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
      case "--data-urlencode": {
        const d = take();
        if (d.startsWith("@")) warnings.push(`Body from file ${d.slice(1)} isn't included; paste the content instead`);
        else data.push(d);
        break;
      }
      case "--json":
        data.push(take());
        json = true;
        break;
      case "-u":
      case "--user":
        user = take();
        break;
      case "-b":
      case "--cookie": {
        const c = take();
        if (c.includes("=")) headers.push(header("Cookie", c));
        else warnings.push(`Cookie jar file ${c} isn't included`);
        break;
      }
      case "-A":
      case "--user-agent":
        headers.push(header("User-Agent", take()));
        break;
      case "-e":
      case "--referer":
        headers.push(header("Referer", take()));
        break;
      case "--url":
        url = take();
        break;
      case "-G":
      case "--get":
        asQuery = true;
        break;
      case "-I":
      case "--head":
        method = "HEAD";
        break;
      case "-m":
      case "--max-time": {
        const s = Number(take());
        if (s > 0) timeoutMs = Math.min(120_000, Math.max(100, Math.round(s * 1000)));
        break;
      }
      case "-F":
      case "--form":
        take();
        warnings.push("Multipart form fields (-F) aren't supported yet and were skipped");
        break;
      default:
        if (VALUE_FLAGS.has(flag)) take();
        else if (!flag.startsWith("-") && !url) url = flag;
    }
  }
  if (!url) throw new Error("No URL found in the curl command");
  if (!/^[a-z][\w+.-]*:\/\//i.test(url) && !url.startsWith("{{")) url = `https://${url}`;

  const body = data.join("&");
  if (asQuery && body) {
    url += (url.includes("?") ? "&" : "?") + body;
  }
  const finalMethod = method ?? (data.length && !asQuery ? "POST" : "GET");

  // auth: pull Authorization headers and -u into the auth tab
  let auth: RequestSpec["auth"] = { type: "none" };
  const authIdx = headers.findIndex((h) => h.key.toLowerCase() === "authorization");
  if (authIdx >= 0) {
    const v = headers[authIdx].value;
    const bearer = /^Bearer\s+(.+)$/i.exec(v);
    const basic = /^Basic\s+(.+)$/i.exec(v);
    if (bearer) {
      auth = { type: "bearer", token: bearer[1] };
      headers.splice(authIdx, 1);
    } else if (basic) {
      try {
        const [u, ...p] = Buffer.from(basic[1], "base64").toString("utf8").split(":");
        auth = { type: "basic", username: u, password: p.join(":") };
        headers.splice(authIdx, 1);
      } catch {
        /* keep the raw header */
      }
    }
  }
  if (user !== null) {
    const [u, ...p] = user.split(":");
    auth = { type: "basic", username: u, password: p.join(":") };
  }

  // body: JSON when declared or when it parses as JSON, form when urlencoded pairs, otherwise text
  let specBody: RequestSpec["body"] = { mode: "none" };
  if (body && !asQuery) {
    const ct = headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    if (json || ct.includes("json") || (parsed !== undefined && typeof parsed === "object")) {
      specBody = { mode: "json", content: parsed !== undefined ? JSON.stringify(parsed, null, 2) : body };
      if (json && !ct) headers.push(header("Content-Type", "application/json"));
    } else if ((!ct || ct.includes("x-www-form-urlencoded")) && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) {
      const form = body.split("&").map((pair) => {
        const [k, ...v] = pair.split("=");
        const dec = (s: string) => {
          try {
            return decodeURIComponent(s.replace(/\+/g, " "));
          } catch {
            return s;
          }
        };
        return { key: dec(k), value: dec(v.join("=")), enabled: true };
      });
      specBody = { mode: "form-urlencoded", form };
      const i = headers.findIndex((h) => h.key.toLowerCase() === "content-type");
      if (i >= 0) headers.splice(i, 1);
    } else {
      specBody = { mode: "text", content: body };
    }
  }

  return {
    spec: {
      method: (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(finalMethod) ? finalMethod : "GET") as RequestSpec["method"],
      url,
      params: [],
      headers,
      body: specBody,
      auth,
      timeoutMs,
      followRedirects: true,
    },
    warnings,
  };
};
