#!/usr/bin/env node
import { runCheck } from "../src/check.mjs";
import { runDev, runDoctor, runInit } from "../src/commands.mjs";
import { banner, c } from "../src/ui.mjs";

const VERSION = "1.0.0";

const HELP = `  Usage: themis <command> [options]

  Commands
    init                 Configure this checkout: database, Groq key, ports, deps
    dev                  Run the API and the web app together
    doctor               Check that everything is wired up
    check <url>          Send a request and get a verdict (exit 1 on FAIL)

  init options
    -y, --yes            Accept defaults, no prompts
    --mongo <uri>        Use this MongoDB (empty string for embedded)
    --groq-key <key>     Groq API key for AI summaries
    --port <n>           API port (default 4000)
    --skip-install       Don't run npm install

  Run ${"`themis check --help`"} for check options.
`;

export const main = async (argv) => {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "init":
      return runInit(rest);
    case "dev":
      return runDev();
    case "doctor":
      return runDoctor();
    case "check":
      return runCheck(rest);
    case "-v":
    case "--version":
      console.log(VERSION);
      return 0;
    case undefined:
    case "help":
    case "-h":
    case "--help":
      banner(`v${VERSION} · every response gets a verdict`);
      console.log(HELP);
      return 0;
    default:
      console.error(`\n  ${c.red("Unknown command")} ${cmd}\n`);
      console.log(HELP);
      return 1;
  }
};

export const run = (argv) => {
  main(argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`\n  ${c.red("✗")} ${err?.message ?? err}\n`);
      process.exit(1);
    },
  );
};

run(process.argv.slice(2));
