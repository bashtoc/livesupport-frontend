import { Router } from "express";
import { db } from "../../db/pool.js";
import { redisConnection } from "../../infra/redis.js";
import { env } from "../../config/env.js";

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

healthRouter.get("/metrics", async (req, res) => {
  const token = env().METRICS_TOKEN;
  if (!token || req.get("authorization") !== `Bearer ${token}`) {
    res.status(404).json({ error: { code: "not_found", message: "Not found" } });
    return;
  }
  const redis = redisConnection();
  try {
    const [counts, queueDepth] = await Promise.all([
      db.query(`select
        count(*) filter (where status <> 'resolved')::int as open_conversations,
        count(*) filter (where assigned_staff_id is null and status <> 'resolved')::int as unassigned_conversations,
        count(*) filter (where sla_breached_at is not null and status <> 'resolved')::int as active_sla_breaches
        from conversations`),
      redis.llen("bull:notifications:wait")
    ]);
    const values = counts.rows[0];
    res.type("text/plain; version=0.0.4").send([
      "# HELP safer_support_open_conversations Current non-resolved conversations.",
      "# TYPE safer_support_open_conversations gauge",
      `safer_support_open_conversations ${values.open_conversations}`,
      "# HELP safer_support_unassigned_conversations Current unassigned conversations.",
      "# TYPE safer_support_unassigned_conversations gauge",
      `safer_support_unassigned_conversations ${values.unassigned_conversations}`,
      "# HELP safer_support_active_sla_breaches Current open SLA breaches.",
      "# TYPE safer_support_active_sla_breaches gauge",
      `safer_support_active_sla_breaches ${values.active_sla_breaches}`,
      "# HELP safer_support_notification_queue_depth Waiting push jobs.",
      "# TYPE safer_support_notification_queue_depth gauge",
      `safer_support_notification_queue_depth ${queueDepth}`,
      "# HELP process_resident_memory_bytes Resident memory size.",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${process.memoryUsage().rss}`,
      ""
    ].join("\n"));
  } finally {
    redis.disconnect();
  }
});
