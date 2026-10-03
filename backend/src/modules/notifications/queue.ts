import { Queue } from "bullmq";
import { redisConnection } from "../../infra/redis.js";

export const notificationQueue = new Queue("notifications", {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 2_000,
    removeOnFail: 2_000
  }
});
