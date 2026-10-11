# usethemis

The [Themis](https://usethemis.dev) command line. Send a request to any API and get a clear pass or fail verdict, with a non-zero exit code on failure, so it drops straight into CI.

No account, no server, no dependencies. Requires Node.js 20+.

```bash
npx usethemis check https://api.example.com/health
```

Or install it once:

```bash
npm install -g usethemis
themis check https://api.example.com/health
```

## check

```bash
themis check https://api.example.com/orders   -H "Authorization: Bearer $TOKEN"   --status 200 --max-ms 800 --json-path data[0].id
```

| Option | What it does |
|---|---|
| `-X, --method <verb>` | HTTP method (GET, or POST with `--data`) |
| `-H, --header <k: v>` | Request header, repeatable |
| `-d, --data <body>` | Request body, sent as JSON if it parses |
| `--status <code\|2xx>` | Expected status (default `2xx`) |
| `--max-ms <n>` | Latency budget in ms (default 1000) |
| `--contains <text>` | Body must contain this text |
| `--json-path <a.b[0].c>` | Path that must exist in the JSON body |
| `--timeout <ms>` | Abort after this long (default 15000) |
| `--body` | Print the response body |
| `--json` | Machine-readable output |

Exit code `0` on PASS and `1` on FAIL.

### In GitHub Actions

```yaml
- name: Smoke-test the API
  run: npx usethemis check https://api.example.com/health --max-ms 800
```

## Self-hosting Themis

`init`, `dev` and `doctor` set up and run your own copy of Themis. Clone the [repository](https://github.com/Krishwalecha/themis), then:

```bash
npx usethemis init
npx usethemis dev
```

## License

MIT
