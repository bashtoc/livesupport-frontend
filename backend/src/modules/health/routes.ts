import { Router } from "express";
import { db } from "../../db/pool.js";
import { redisConnection } from "../../infra/redis.js";

export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok", service: "safer-support-api" });
});

healthRouter.get("/ready", async (_req, res) => {
  const redis = redisConnection();
  try {
    await Promise.all([db.query("select 1"), redis.ping()]);
    res.json({ status: "ready", dependencies: { postgres: "ok", redis: "ok" } });
  } finally {
    redis.disconnect();
  }
});
