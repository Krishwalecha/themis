import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { config } from "./config";
import { errorHandler, notFoundHandler } from "./lib/errors";
import { aiRouter } from "./modules/ai/routes";
import { authRouter, requireAuth } from "./modules/auth/routes";
import { contractsRouter } from "./modules/contracts/routes";
import { dashboardRouter } from "./modules/dashboard/routes";
import { collectionsRouter } from "./modules/collections/routes";
import { environmentsRouter } from "./modules/environments/routes";
import { historyRouter } from "./modules/history/routes";
import { importsRouter } from "./modules/imports/routes";
import { incidentsRouter } from "./modules/incidents/routes";
import { monitorsRouter } from "./modules/monitors/routes";
import { scheduler } from "./modules/monitors/scheduler";
import { requestsRouter } from "./modules/requests/routes";
import { publicRouter, statusPageRouter } from "./modules/statusPage/routes";
import { guestRouter } from "./modules/guest/routes";

export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  if (config.env === "production") app.set("trust proxy", 1);
  // security headers on every response; signed-in data is never cached by browsers or proxies
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    if (config.env === "production") res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    next();
  });
  app.use(cors({ origin: config.corsOrigin.split(",").map((o) => o.trim()), credentials: true }));
  // room for a request carrying up to 5 MB of files as base64
  app.use(express.json({ limit: "10mb" }));
  // curl gets indented JSON and a trailing newline, so terminal output reads well without jq
  app.use((req, res, next) => {
    if (/^curl\//i.test(req.get("user-agent") ?? "")) {
      res.json = (body: unknown) => res.type("json").send(`${JSON.stringify(body, null, 2)}
`);
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "1.0.0",
      db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      uptimeSec: Math.round(process.uptime()),
      scheduler: scheduler.isRunning ? "running" : "stopped",
    });
  });

  app.use("/api/auth", authRouter);
  // read-only and unauthenticated: each route scopes itself to the page's owner
  app.use("/api/public", publicRouter);
  app.use("/api/public", guestRouter);

  // Everything below belongs to a signed-in user and is scoped to their data.
  app.use("/api", (req, res, next) => (req.path === "/health" || req.path.startsWith("/public/") ? next() : requireAuth(req, res, next)));
  app.use("/api/requests", requestsRouter);
  app.use("/api/history", historyRouter);
  app.use("/api/environments", environmentsRouter);
  app.use("/api/collections", collectionsRouter);
  app.use("/api/import", importsRouter);
  app.use("/api/monitors", monitorsRouter);
  app.use("/api/incidents", incidentsRouter);
  app.use("/api/contracts", contractsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/status-page", statusPageRouter);

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
};
