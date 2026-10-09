import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import request from "supertest";
import { authLimiter } from "../src/modules/auth/routes";

let n = 0;

// A supertest agent holding a fresh account's session cookie
export const signedInAgent = async (app: Express, name = "Test User") => {
  authLimiter.reset();
  const server = http.createServer(app).listen(0);
  server.unref();
  await new Promise((r) => server.once("listening", r));
  const agent = request.agent(server);
  const email = `user${Date.now()}${n++}@example.com`;
  await agent.post("/api/auth/register").send({ name, email, password: "correct-horse-battery" }).expect(201);
  const res = await agent.post("/api/auth/login").send({ email, password: "correct-horse-battery" }).expect(200);
  return Object.assign(agent, { user: res.body.user as { id: string; email: string; name: string }, server });
};

// A port that nothing is listening on (bound, then released)
export const freePort = async (): Promise<number> => {
  const s = http.createServer().listen(0);
  await new Promise((r) => s.once("listening", r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
};
