const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const env = process.env.NODE_ENV ?? "development";

export const config = {
  // Hosting platforms inject PORT in production
  port: int("THEMIS_PORT", env === "production" ? int("PORT", 4000) : 4000),
  env,
  mongoUri: process.env.MONGODB_URI?.trim() || "",
  schedulerEnabled: process.env.THEMIS_SCHEDULER_ENABLED !== "false",
  ai: {
    groqApiKey: process.env.GROQ_API_KEY?.trim() || "",
    model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
    timeoutMs: int("THEMIS_AI_TIMEOUT_MS", 30_000),
  },
  // lets visitors send requests from /try without an account (public addresses only, nothing saved)
  guestRequests: process.env.THEMIS_GUEST_REQUESTS !== "false",
  // per account, so one account can't load the scheduler with thousands of checks
  maxMonitors: int("THEMIS_MAX_MONITORS", 50),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // where the web app lives, for links in alerts
  appUrl: (process.env.THEMIS_APP_URL?.trim() || (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",")[0]).replace(/\/$/, ""),
  auth: {
    sessionDays: int("THEMIS_SESSION_DAYS", 30),
    // Secure cookies need HTTPS; on by default in production
    secureCookies: process.env.THEMIS_SECURE_COOKIES ? process.env.THEMIS_SECURE_COOKIES === "true" : env === "production",
    // Set to "false" to stop anyone new from creating an account (existing users can still sign in)
    allowSignup: process.env.THEMIS_ALLOW_SIGNUP !== "false",
  },
  // "Continue with Google": on when both are set (see README)
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || "",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    // overridable so tests can stand in for Google
    tokenUrl: process.env.GOOGLE_TOKEN_URL?.trim() || "https://oauth2.googleapis.com/token",
  },
  request: {
    defaultTimeoutMs: int("THEMIS_REQUEST_TIMEOUT_MS", 30_000),
    maxTimeoutMs: 120_000,
    // Hard cap on how many response bytes the executor will read
    maxResponseBytes: int("THEMIS_MAX_RESPONSE_BYTES", 10 * 1024 * 1024),
    // Private, loopback and cloud-metadata addresses are refused unless this is on. Off in production by default,
    // so a hosted instance can't be used to reach its own network; turn it on to monitor internal services.
    allowPrivateNetworks: process.env.THEMIS_ALLOW_PRIVATE_NETWORKS ? process.env.THEMIS_ALLOW_PRIVATE_NETWORKS === "true" : env !== "production",
    // How much of a response body is persisted to history
    maxStoredBodyBytes: int("THEMIS_MAX_STORED_BODY_BYTES", 1024 * 1024),
  },
} as const;
