// `themis init`, `themis dev` and `themis doctor`.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { canConnect, findRoot, mongoTarget, portFree, readEnvFile, writeEnvFile } from "./project.mjs";
import { banner, c, fail, info, ok, step } from "./ui.mjs";

const NOT_A_CHECKOUT = `No Themis checkout found from ${process.cwd()}.
  init, dev and doctor set up a self-hosted copy: clone https://github.com/Krishwalecha/themis, cd into it,
  then run ${"`themis init`"}. To check an endpoint from anywhere, use ${"`themis check <url>`"}.`;

const npm = (args, cwd) => {
  return new Promise((resolve) => {
    // npm is npm.cmd on Windows, which needs a shell to launch.
    const child = spawn("npm", args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
};

const flag = (argv, name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : (argv[i + 1] ?? "");
};

export const runInit = async (argv) => {
  banner("init · set up a workspace");
  const root = findRoot();
  if (!root) {
    fail(NOT_A_CHECKOUT);
    return 1;
  }
  info(`workspace ${c.paper(root)}`);

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    fail(`Node ${process.versions.node}`, "Themis needs Node 20 or newer");
    return 1;
  }
  ok(`Node ${process.versions.node}`);

  const yes = argv.includes("--yes") || argv.includes("-y") || !process.stdin.isTTY;
  const existing = readEnvFile(root) ?? {};
  const values = {};
  const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, fallback) => {
    if (!rl) return fallback;
    const answer = (await rl.question(`  ${c.accent("?")} ${q} ${fallback ? c.mute(`(${fallback}) `) : ""}`)).trim();
    return answer || fallback;
  };

  try {
    step("Database");
    let mongo = flag(argv, "--mongo") ?? existing.MONGODB_URI;
    if (mongo === undefined || (!yes && flag(argv, "--mongo") === undefined)) {
      info(`Leave empty for an embedded MongoDB ${c.mute("(zero setup, data in .data/mongo)")}`);
      info(`or paste a connection string to use your own.`);
      mongo = await ask("MONGODB_URI", mongo ?? "");
    }
    values.MONGODB_URI = mongo ?? "";
    if (values.MONGODB_URI) {
      const target = mongoTarget(values.MONGODB_URI);
      if (!target) ok("custom MongoDB", "SRV URI, reachability checked on first start");
      else if (await canConnect(target.host, target.port)) ok(`MongoDB reachable at ${target.host}:${target.port}`);
      else fail(`Nothing answering at ${target.host}:${target.port}`, "start MongoDB, or clear the URI for embedded");
    } else ok("embedded MongoDB", "starts with the server");

    step("AI summaries");
    let groq = flag(argv, "--groq-key") ?? existing.GROQ_API_KEY ?? "";
    if (!yes && flag(argv, "--groq-key") === undefined) {
      info(`Summaries run on Groq. Get a key at ${c.paper("console.groq.com/keys")}, or skip for rule-based summaries.`);
      const answer = await ask("GROQ_API_KEY", groq ? "keep current" : "skip");
      groq = answer === "keep current" ? groq : answer === "skip" ? "" : answer;
    }
    values.GROQ_API_KEY = groq;
    if (groq) ok("Groq key saved to .env", `…${groq.slice(-4)}`);
    else info("no key, Themis will write rule-based summaries");

    step("Ports");
    const port = flag(argv, "--port") ?? (await ask("API port", existing.THEMIS_PORT ?? "4000"));
    values.THEMIS_PORT = String(Number(port) || 4000);
    for (const [label, p] of [["API", Number(values.THEMIS_PORT)], ["web", 5173]]) {
      if (await portFree(p)) ok(`${label} port ${p} is free`);
      else info(`${label} port ${p} is in use ${c.mute("(fine if Themis is already running)")}`);
    }
  } finally {
    rl?.close();
  }

  const envPath = writeEnvFile(root, values);
  ok(`wrote ${envPath}`);

  if (!argv.includes("--skip-install") && !existsSync(join(root, "node_modules"))) {
    step("Installing dependencies");
    if ((await npm(["install"], root)) !== 0) {
      fail("npm install failed", "fix the error above, then run `npm install`");
      return 1;
    }
    ok("dependencies installed");
  }

  console.log(`\n  ${c.inverse("READY", "255;107;61")}  Start it with ${c.paper("npx themis dev")}, then open ${c.paper("http://localhost:5173")}\n`);
  return 0;
};

export const runDev = async () => {
  const root = findRoot();
  if (!root) {
    fail(NOT_A_CHECKOUT);
    return 1;
  }
  banner("dev · api :4000 · web :5173");
  if (!existsSync(join(root, "server", ".env"))) info(`no .env yet, using defaults ${c.mute("(run `npx themis init` to configure)")}`);
  return npm(["run", "dev"], root);
};

export const runDoctor = async () => {
  banner("doctor · checking your setup");
  let problems = 0;
  const bad = (msg, note) => {
    problems++;
    fail(msg, note);
  };

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) ok(`Node ${process.versions.node}`);
  else bad(`Node ${process.versions.node}`, "needs 20+");

  const root = findRoot();
  if (!root) {
    bad("not inside a Themis checkout (clone the repository to self-host; `themis check <url>` works anywhere)");
    return 1;
  }
  ok("Themis checkout", root);

  if (existsSync(join(root, "node_modules"))) ok("dependencies installed");
  else bad("dependencies missing", "run `npm install`");

  const env = readEnvFile(root);
  if (env) ok(".env present");
  else info(`.env missing, defaults apply ${c.mute("(run `npx themis init`)")}`);

  const uri = env?.MONGODB_URI ?? "";
  const target = uri ? mongoTarget(uri) : null;
  if (!uri) ok("database", "embedded MongoDB");
  else if (!target) ok("database", "SRV URI (not probed)");
  else if (await canConnect(target.host, target.port)) ok(`MongoDB reachable at ${target.host}:${target.port}`);
  else bad(`MongoDB not reachable at ${target.host}:${target.port}`);

  if (env?.GROQ_API_KEY) ok("Groq key set", "AI summaries on");
  else info("no GROQ_API_KEY, rule-based summaries");

  const apiPort = Number(env?.THEMIS_PORT) || 4000;
  try {
    const r = await fetch(`http://localhost:${apiPort}/api/health`, { signal: AbortSignal.timeout(1500) });
    const h = await r.json();
    ok(`API running on :${apiPort}`, `db ${h.db} · scheduler ${h.scheduler}`);
  } catch {
    info(`API not running on :${apiPort} ${c.mute("(start it with `npx themis dev`)")}`);
  }

  console.log(problems ? `\n  ${c.red(`${problems} problem${problems === 1 ? "" : "s"} found`)}\n` : `\n  ${c.green("All good.")}\n`);
  return problems ? 1 : 0;
};
