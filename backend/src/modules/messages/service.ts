import type { PoolClient } from "pg";
import { db } from "../../db/pool.js";
import { transaction } from "../../db/transaction.js";
import { AppError } from "../../lib/errors.js";
import type { AuthPrincipal } from "../auth/types.js";
import { audit } from "../audit/service.js";
import { requireConversationAccess } from "../conversations/access.js";
import { publishConversationEvent } from "../realtime/socket.js";

export function serializeMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: Number(row.sequence),
    clientMessageId: row.client_message_id,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    senderCustomerId: row.sender_customer_id,
    senderStaffId: row.sender_staff_id,
    createdAt: row.created_at
  };
}

export async function insertMessage(
  client: PoolClient,
  input: {
    conversationId: string;
    clientMessageId: string;
    body: string;
    kind: "customer" | "agent" | "private_note";
    auth: AuthPrincipal;
    attachmentIds?: string[] | undefined;
  }
) {
  const senderCustomerId = input.auth.type === "customer" ? input.auth.id : null;
  const senderStaffId = input.auth.type === "staff" ? input.auth.id : null;
  const existing = await client.query(
    "select * from messages where conversation_id = $1 and client_message_id = $2",
    [input.conversationId, input.clientMessageId]
  );
  if (existing.rows[0]) return { message: existing.rows[0], created: false };
  const result = await client.query(
    `insert into messages
      (conversation_id, client_message_id, kind, sender_customer_id, sender_staff_id, body, metadata)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      input.conversationId,
      input.clientMessageId,
      input.kind,
      senderCustomerId,
      senderStaffId,
      input.body,
      { attachmentIds: input.attachmentIds ?? [] }
    ]
  );
  const message = result.rows[0];
  if (input.attachmentIds?.length) {
    const attachments = await client.query(
      `update attachments set message_id = $1
        where id = any($2::uuid[]) and conversation_id = $3 and uploaded_by_id = $4
          and status = 'available'
        returning id`,
      [message.id, input.attachmentIds, input.conversationId, input.auth.id]
    );
    if (attachments.rowCount !== input.attachmentIds.length) {
      throw new AppError(409, "attachment_unavailable", "One or more attachments are not available");
    }
  }
  await client.query(
    `update conversations
        set last_message_at = now(),
            status = case when status = 'resolved' then 'open' else status end,
            version = version + 1
      where id = $1`,
    [input.conversationId]
  );
  return { message, created: true };
}

export async function sendMessage(input: {
  conversationId: string;
  clientMessageId: string;
  body: string;
  visibility: "public" | "private_note";
  attachmentIds?: string[] | undefined;
  auth: AuthPrincipal;
  requestId?: string | undefined;
  ip?: string | undefined;
}) {
  const conversation = await requireConversationAccess(input.conversationId, input.auth);
  if (input.auth.type === "customer" && input.visibility === "private_note") {
    throw new AppError(403, "forbidden", "Customers cannot create private notes");
  }
  const kind = input.visibility === "private_note"
    ? "private_note"
    : input.auth.type === "customer" ? "customer" : "agent";
  const result = await transaction(async (client) => {
    const inserted = await insertMessage(client, { ...input, kind });
    if (inserted.created) {
      await audit({
        actor: input.auth,
        action: kind === "private_note" ? "message.private_note_created" : "message.created",
        entityType: "message",
        entityId: inserted.message.id,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.ip ? { ip: input.ip } : {}),
        details: { conversationId: input.conversationId }
      }, client);
    }
    return inserted;
  });
  const message = serializeMessage(result.message);
  if (result.created) {
    publishConversationEvent(
      input.conversationId,
      conversation.team,
      kind === "private_note" ? "message:private-note" : "message:created",
      message,
      kind === "private_note" ? "staff" : "all"
    );
  }
  return { message, deduplicated: !result.created };
}

export async function listMessages(
  conversationId: string,
  auth: AuthPrincipal,
  after: number,
  limit: number
) {
  await requireConversationAccess(conversationId, auth);
  const visibilityClause = auth.type === "customer" ? "and kind <> 'private_note'" : "";
  const result = await db.query(
    `select * from messages
      where conversation_id = $1 and sequence > $2 and deleted_at is null ${visibilityClause}
      order by sequence asc limit $3`,
    [conversationId, after, limit]
  );
  return result.rows.map(serializeMessage);
}
