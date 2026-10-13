# Themis

**API testing, monitoring and contract validation in one workspace.** Every response gets a clear pass or fail verdict, and when something breaks, Themis explains what happened and how to fix it.

[usethemis.dev](https://usethemis.dev)

## Features

- **Workspace:** send requests with environments, `{{variables}}`, auth and any body (JSON, forms, file uploads). Every response gets a verdict.
- **Collections:** run requests in order and pass values between them, like a login token. Import from curl, Postman or OpenAPI.
- **Monitors:** check an endpoint or a whole collection as often as every 10 seconds, at set times, or on cron. Incidents open and close on their own, with Slack and Discord alerts, maintenance windows and a public status page.
- **Contracts:** validate responses against OpenAPI or JSON Schema, or generate a contract from a real response. Each version shows whether the API passes it.
- **AI summaries:** plain-language explanations of failures with concrete fixes, powered by Groq, with a rule-based fallback.
- **CLI:** `npx usethemis check <url>` checks any endpoint from your terminal or CI, with a non-zero exit code on failure.
- **Try without an account:** send requests to public APIs at `/try`, no sign-up needed.

## Quick start

Requires Node.js 22.12+.

```bash
npm install
npm run dev
```

Open http://localhost:5173. No database setup is needed for development: without `MONGODB_URI`, Themis downloads and runs a local MongoDB on first start and keeps its data in `.data/mongo`.

## Self-hosting

Themis has two parts: the **app** in `client/` (a static site) and the **API** in `server/` (a Node service that also runs your monitors).

- **App:** host it anywhere that serves static files with a single-page fallback and can forward `/api` to the API on the same domain, so sign-in cookies work. On Vercel this is built in (`client/vercel.json` and `client/api/proxy.js`): set `THEMIS_API_URL` to your API's address.
- **API:** host it on an always-on Node host with a MongoDB database (`MONGODB_URI` is required in production), so monitors keep running.

Build both with `npm run build`, then start the API with `npm start -w server`.

Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`, then set what you need.

### API (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | embedded database | MongoDB connection string. Required in production |
| `THEMIS_PORT` | `4000` | Port the API listens on. In production the host's `PORT` is used if this is unset |
| `THEMIS_APP_URL` | first `CORS_ORIGIN` | Public address of the app, used for alert links and Google sign-in |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated origins allowed to call the API |
| `THEMIS_ALLOW_SIGNUP` | `true` | Set to `false` to close sign-ups |
| `THEMIS_SECURE_COOKIES` | `true` in production | Secure session cookies. Needs HTTPS |
| `THEMIS_SESSION_DAYS` | `30` | How long a sign-in lasts |
| `GROQ_API_KEY` | none | Enables AI summaries |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Any Groq chat model that supports JSON output |
| `THEMIS_AI_TIMEOUT_MS` | `30000` | Time limit for one AI summary |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Enable "Continue with Google" |
| `THEMIS_SCHEDULER_ENABLED` | `true` | Set to `false` to stop running monitors on this instance |
| `THEMIS_MAX_MONITORS` | `50` | Most monitors one account can have |
| `THEMIS_GUEST_REQUESTS` | `true` | Let visitors send requests from `/try` without an account (public addresses only, nothing saved) |
| `THEMIS_ALLOW_PRIVATE_NETWORKS` | `false` in production | Let signed-in users send requests to private, loopback and cloud-metadata addresses. Turn on to monitor internal services |
| `THEMIS_CHECK_RETENTION_DAYS` | `90` | How long monitor checks are kept |
| `THEMIS_REQUEST_TIMEOUT_MS` | `30000` | Default timeout for requests Themis sends |
| `THEMIS_MAX_RESPONSE_BYTES` | `10485760` | Largest response Themis will read (10 MB) |
| `THEMIS_MAX_STORED_BODY_BYTES` | `1048576` | Largest response body saved to history (1 MB) |
| `THEMIS_DATA_DIR` | `.data/mongo` | Where the embedded development database keeps its files |

### App (`client/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_THEMIS_API_URL` | `http://localhost:4000` | Where the development server forwards `/api`, and the address shown in the CLI page's examples. In production the app always calls `/api` on its own domain |

### Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), set up the **OAuth consent screen**, then create an **OAuth client ID** of type **Web application**.
2. Add each address the app runs on under **Authorized JavaScript origins** (for example `http://localhost:5173`) and its callback under **Authorized redirect URIs**: `<THEMIS_APP_URL>/api/auth/google/callback`, for example `http://localhost:5173/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `THEMIS_APP_URL` in `server/.env` and restart the API. The button appears on the sign-in and sign-up pages.

### Security

Themis sends requests from its server, so in production it refuses private, loopback and cloud-metadata addresses by default (guests always). Saved secrets are write-only and masked in everything the browser receives. Sign-in, guest requests, sends and AI summaries are rate limited. Keep `THEMIS_ALLOW_PRIVATE_NETWORKS` off on a public instance.

## CLI

Check any endpoint from your terminal or CI, with no account or download of this repository:

```bash
npx usethemis check https://api.example.com/health
```

It exits non-zero on failure. Inside a clone, `npx usethemis init` sets up the database and keys, `dev` runs the app, and `doctor` checks the setup. The CLI lives in `cli/` and is published to npm as [`usethemis`](https://www.npmjs.com/package/usethemis).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the API and the app |
| `npm test` | Run the server and CLI tests |
| `npm run typecheck` | Type-check the server and client |
| `npm run build` | Build both for production |

## Stack

React 19 · TypeScript · Vite · Express 5 · MongoDB (Mongoose) · Zod · Ajv · Groq · Vitest

## Credits

The landing page design is inspired by [Auren](https://github.com/motiveo-co/auren-landing) (MIT License). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
