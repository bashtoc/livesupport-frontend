import { db } from "./db/pool.js";
import { logger } from "./lib/logger.js";
import { startAttachmentWorker } from "./modules/attachments/worker.js";
import { startEmailOutboxWorker } from "./modules/email/outbox.js";
import { startNotificationWorker } from "./modules/notifications/worker.js";
import { processSlaBreaches } from "./modules/sla/service.js";

function startSlaMonitor() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const breaches = await processSlaBreaches();
      if (breaches) logger.warn({ breaches }, "SLA breaches escalated");
    } catch (error) {
      logger.error({ err: error }, "SLA monitor failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), 30_000);
  void run();
  return { close: async () => clearInterval(timer) };
}

async function main(): Promise<void> {
  await db.query("select 1");
  const workers = [startAttachmentWorker(), startNotificationWorker(), startEmailOutboxWorker(), startSlaMonitor()];
  logger.info({ workers: workers.length }, "Safer Support workers started");

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "Shutting down workers");
    await Promise.all(workers.map((worker) => worker.close()));
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});
