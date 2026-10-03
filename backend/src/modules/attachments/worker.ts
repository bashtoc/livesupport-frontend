import { Worker } from "bullmq";
import { db } from "../../db/pool.js";
import { redisConnection } from "../../infra/redis.js";
import { logger } from "../../lib/logger.js";
import { publishConversationEvent } from "../realtime/socket.js";
import { deleteAttachment, fetchAttachment, scanBuffer, sha256 } from "./scanner.js";

export function startAttachmentWorker(): Worker {
  const worker = new Worker(
    "attachment-scans",
    async (job) => {
      const result = await db.query(
        `update attachments set status = 'scanning'
          where id = $1 and status in ('quarantined', 'failed') returning *`,
        [job.data.attachmentId]
      );
      const attachment = result.rows[0];
      if (!attachment) return;
      try {
        const buffer = await fetchAttachment(attachment.object_key);
        const scan = await scanBuffer(buffer);
        if (!scan.clean) {
          await deleteAttachment(attachment.object_key);
          await db.query(
            `update attachments set status = 'rejected', scan_result = $1, sha256 = $2, scanned_at = now()
              where id = $3`,
            [scan.result, sha256(buffer), attachment.id]
          );
          return;
        }
        await db.query(
          `update attachments set status = 'available', scan_result = $1, sha256 = $2, scanned_at = now()
            where id = $3`,
          [scan.result, sha256(buffer), attachment.id]
        );
        const conversation = await db.query("select team from conversations where id = $1", [
          attachment.conversation_id
        ]);
        publishConversationEvent(attachment.conversation_id, conversation.rows[0]?.team ?? "customer-support", "attachment:available", {
          id: attachment.id,
          conversationId: attachment.conversation_id,
          status: "available"
        });
      } catch (error) {
        await db.query("update attachments set status = 'failed', scan_result = $1 where id = $2", [
          String(error).slice(0, 500),
          attachment.id
        ]);
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: 3 }
  );
  worker.on("failed", (job, error) => logger.error({ err: error, jobId: job?.id }, "Attachment scan failed"));
  return worker;
}
