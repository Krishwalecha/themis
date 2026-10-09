import { mkdirSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { config } from "./config";

let memoryServer: { stop: (opts?: { doCleanup?: boolean }) => Promise<boolean> } | null = null;

// Where the embedded dev database keeps its files (repo-root/.data/mongo by default)
const devDataDir = (): string => {
  return path.resolve(process.env.THEMIS_DATA_DIR?.trim() || path.join(__dirname, "..", "..", ".data", "mongo"));
};

export const connectDatabase = async (uri = config.mongoUri): Promise<string> => {
  let target = uri;
  if (!target) {
    if (config.env === "production") {
      throw new Error("MONGODB_URI is required in production");
    }
    // Zero-setup local dev: run an embedded MongoDB. Outside tests its data lives on disk, so it survives restarts.
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const persistent = config.env !== "test" && !process.env.VITEST;
    let instance: { dbPath: string; storageEngine: "wiredTiger" } | undefined;
    if (persistent) {
      const dbPath = devDataDir();
      mkdirSync(dbPath, { recursive: true });
      instance = { dbPath, storageEngine: "wiredTiger" };
    }
    const server = await MongoMemoryServer.create(instance ? { instance } : undefined);
    memoryServer = server;
    target = server.getUri("themis");
    console.warn(
      persistent
        ? `[db] MONGODB_URI not set: using embedded MongoDB with data in ${instance!.dbPath}`
        : "[db] MONGODB_URI not set: using in-memory MongoDB (data resets on restart)",
    );
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(target);
  return target;
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  if (memoryServer) {
    // Never delete the persistent data directory on shutdown.
    await memoryServer.stop({ doCleanup: false });
    memoryServer = null;
  }
};
