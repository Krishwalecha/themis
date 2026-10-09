import { createApp } from "./app";
import { config } from "./config";
import { connectDatabase, disconnectDatabase } from "./db";
import { Environment } from "./models/Environment";
import { scheduler } from "./modules/monitors/scheduler";

const main = async () => {
  await connectDatabase();
  // Environment names became unique per owner (was global): drop the stale index on existing databases.
  await Environment.syncIndexes().catch((e) => console.warn("[db] could not sync environment indexes", e));
  const server = createApp().listen(config.port, () => {
    console.log(`[themis] API listening on http://localhost:${config.port}`);
  });

  if (config.schedulerEnabled) {
    const count = await scheduler.start();
    console.log(`[themis] monitor scheduler started (${count} active monitor${count === 1 ? "" : "s"})`);
  }

  const shutdown = async (signal: string) => {
    console.log(`[themis] ${signal} received, shutting down`);
    scheduler.stop();
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((err) => {
  console.error("[themis] failed to start", err);
  process.exit(1);
});
