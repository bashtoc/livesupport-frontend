import { Queue } from "bullmq";
import { redisConnection } from "../../infra/redis.js";

export const attachmentQueue = new Queue("attachment-scans", {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1_000,
    removeOnFail: 1_000
  }
});
