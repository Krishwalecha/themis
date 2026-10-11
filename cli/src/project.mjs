// Locating an Themis checkout and reading/writing its server/.env.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";

// Walks up from `from` to the repo root: a package.json whose workspaces include "server"
export const findRoot = (from = process.cwd()) => {
  let dir = from;
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, "utf8"));
        if (Array.isArray(json.workspaces) && json.workspaces.includes("server") && existsSync(join(dir, "server"))) return dir;
      } catch {
        /* not ours, keep walking */
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
};

// Parses KEY=value lines; comments and blanks are ignored
export const parseEnv = (text) => {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
};

export const renderEnv = (template, values) => {
  const seen = new Set();
  const lines = template.split(/\r?\n/).map((line) => {
    const m = line.match(/^(\s*)([A-Z0-9_]+)(\s*=)/i);
    if (!m || !(m[2] in values)) return line;
    seen.add(m[2]);
    return `${m[1]}${m[2]}=${values[m[2]]}`;
  });
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const extra = Object.keys(values).filter((k) => !seen.has(k));
  if (extra.length) lines.push("", ...extra.map((k) => `${k}=${values[k]}`));
  return lines.join("\n").replace(/\n*$/, "\n");
};

export const readEnvFile = (root) => {
  const path = join(root, "server", ".env");
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : null;
};

export const writeEnvFile = (root, values) => {
  const examplePath = join(root, "server", ".env.example");
  const envPath = join(root, "server", ".env");
  // Merge into the existing .env when there is one so hand-added keys survive.
  const base = existsSync(envPath) ? readFileSync(envPath, "utf8") : existsSync(examplePath) ? readFileSync(examplePath, "utf8") : "";
  writeFileSync(envPath, renderEnv(base, values));
  return envPath;
};

// Host and port from a mongodb:// URI, or null for SRV/unparseable URIs
export const mongoTarget = (uri) => {
  const m = uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/,?:]+)(?::(\d+))?/i);
  return m ? { host: m[1], port: Number(m[2] ?? 27017) } : null;
};

export const canConnect = (host, port, timeoutMs = 1500) => {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
};

// True when nothing is listening on the port (so we could bind it)
export const portFree = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
};
