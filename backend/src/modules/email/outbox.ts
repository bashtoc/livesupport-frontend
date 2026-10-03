import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "../../db/pool.js";
import { transaction } from "../../db/transaction.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { logger } from "../../lib/logger.js";
import { sendStaffCredentials } from "./cloudflare.js";

type CredentialsPayload = {
  name: string;
  email: string;
  password: string;
  role: string;
};

type OutboxRow = {
  id: string;
  staff_user_id: string;
  payload_ciphertext: string;
  attempts: number;
};

export async function queueStaffCredentials(
  client: PoolClient,
  staffUserId: string,
  payload: CredentialsPayload,
): Promise<string> {
  const id = crypto.randomUUID();
  await client.query(
    `update email_outbox set status = 'cancelled', updated_at = now()
      where staff_user_id = $1 and status = 'queued'`,
    [staffUserId],
  );
  await client.query(
    `insert into email_outbox(id, staff_user_id, kind, recipient, payload_ciphertext)
     values ($1, $2, 'staff_credentials', $3, $4)`,
    [id, staffUserId, payload.email, encryptSecret(JSON.stringify(payload))],
  );
  await client.query(
    `update staff_users set invitation_status = 'queued', invitation_queue_id = $2,
            invitation_last_error = null
      where id = $1`,
    [staffUserId, id],
  );
  return id;
}

async function claimNext(): Promise<OutboxRow | null> {
  return transaction(async (client) => {
    const result = await client.query<OutboxRow>(
      `select id, staff_user_id, payload_ciphertext, attempts
         from email_outbox
        where status = 'queued' and next_attempt_at <= now()
        order by created_at
        for update skip locked
        limit 1`,
    );
    const row = result.rows[0];
    if (!row) return null;
    await client.query(
      `update email_outbox set status = 'processing', attempts = attempts + 1, updated_at = now()
        where id = $1`,
      [row.id],
    );
    return { ...row, attempts: Number(row.attempts) + 1 };
  });
}

async function deliver(row: OutboxRow): Promise<void> {
  const current = await db.query(
    "select invitation_queue_id, is_active from staff_users where id = $1",
    [row.staff_user_id],
  );
  if (!current.rows[0]?.is_active || current.rows[0].invitation_queue_id !== row.id) {
    await db.query("update email_outbox set status = 'cancelled', updated_at = now() where id = $1", [row.id]);
    return;
  }
  try {
    const payload = JSON.parse(decryptSecret(row.payload_ciphertext)) as CredentialsPayload;
    const delivery = await sendStaffCredentials(payload);
    await transaction(async (client) => {
      await client.query(
        `update email_outbox set status = 'sent', provider_message_id = $2,
                sent_at = now(), updated_at = now(), payload_ciphertext = ''
          where id = $1`,
        [row.id, delivery.messageId],
      );
      await client.query(
        `update staff_users set invitation_status = 'sent', invitation_sent_at = now(),
                invitation_message_id = $2, invitation_last_error = null
          where id = $1 and invitation_queue_id = $3`,
        [row.staff_user_id, delivery.messageId, row.id],
      );
    });
    logger.info({ outboxId: row.id }, "Staff credentials email delivered");
  } catch (error) {
    const exhausted = row.attempts >= 5;
    const delaySeconds = Math.min(3_600, 30 * 2 ** Math.max(0, row.attempts - 1));
    const nextAttempt = new Date(Date.now() + delaySeconds * 1_000);
    const reason = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
    await transaction(async (client) => {
      await client.query(
        `update email_outbox set status = $2, next_attempt_at = $3,
                last_error = $4, updated_at = now()
          where id = $1`,
        [row.id, exhausted ? "failed" : "queued", nextAttempt, reason],
      );
      if (exhausted) {
        await client.query(
          `update staff_users set invitation_status = 'failed', invitation_last_error = $2
            where id = $1 and invitation_queue_id = $3`,
          [row.staff_user_id, reason, row.id],
        );
      }
    });
    logger.warn({ err: error, outboxId: row.id, attempts: row.attempts }, "Staff credentials email attempt failed");
  }
}

export function startEmailOutboxWorker(): { close: () => Promise<void> } {
  let closed = false;
  let running: Promise<void> | null = null;
  void db.query(
    `update email_outbox set status = 'queued', updated_at = now()
      where status = 'processing' and updated_at < now() - interval '5 minutes'`,
  );
  const drain = async () => {
    if (closed || running) return;
    running = (async () => {
      for (;;) {
        const row = await claimNext();
        if (!row || closed) break;
        await deliver(row);
      }
    })().catch((error) => logger.error({ err: error }, "Email outbox worker failed")).finally(() => {
      running = null;
    });
    await running;
  };
  const timer = setInterval(() => void drain(), 2_000);
  void drain();
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await running;
    },
  };
}
