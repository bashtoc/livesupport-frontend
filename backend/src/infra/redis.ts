import { Redis } from "ioredis";
import { env } from "../config/env.js";

export function redisConnection(): Redis {
  return new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
}
