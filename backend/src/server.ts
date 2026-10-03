import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { migrate } from "./db/migrate.js";
import { db } from "./db/pool.js";
import { logger } from "./lib/logger.js";
import { startRealtime } from "./modules/realtime/socket.js";

async function main(): Promise<void> {
  await migrate();
  const server = createServer(createApp());
  const io = await startRealtime(server);
  server.listen(env().PORT, "0.0.0.0", () => {
    logger.info({ port: env().PORT }, "Safer Support API listening");
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "Shutting down API");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await io.close();
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "API failed to start");
  process.exit(1);
});
