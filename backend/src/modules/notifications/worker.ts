import { Worker } from "bullmq";
import { redisConnection } from "../../infra/redis.js";
import { logger } from "../../lib/logger.js";

export function startNotificationWorker(): Worker {
  return new Worker(
    "notifications",
    async (job) => {
      // APNs/FCM adapters plug in here. Job data intentionally contains IDs only,
      // so message text is never placed on a lock screen by this worker.
      logger.info({ jobId: job.id, type: job.name }, "Notification job accepted; provider adapter not configured");
    },
    { connection: redisConnection(), concurrency: 10 }
  );
}
