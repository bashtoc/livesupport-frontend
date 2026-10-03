import type { AuthPrincipal } from "../auth/types.js";
import { db } from "../../db/pool.js";
import { requireConversationAccess } from "../conversations/access.js";
import { publishConversationEvent } from "../realtime/socket.js";

export type ReceiptState = "delivered" | "read";

export async function recordReceipt(input: {
  conversationId: string;
  messageIds: string[];
  state: ReceiptState;
  auth: AuthPrincipal;
}) {
  const conversation = await requireConversationAccess(input.conversationId, input.auth);
  if (!input.messageIds.length) return [];
  const oppositeKind = input.auth.type === "customer" ? "agent" : "customer";
  const result = await db.query(
    `insert into message_receipts(message_id, recipient_type, recipient_id, delivered_at, read_at)
     select m.id, $3, $4,
            now(), case when $5 = 'read' then now() else null end
       from messages m
      where m.conversation_id = $1 and m.id = any($2::uuid[]) and m.kind = $6
     on conflict (message_id, recipient_type, recipient_id) do update set
       delivered_at = coalesce(message_receipts.delivered_at, excluded.delivered_at),
       read_at = case when $5 = 'read' then coalesce(message_receipts.read_at, excluded.read_at) else message_receipts.read_at end,
       updated_at = now()
     returning message_id, delivered_at, read_at`,
    [input.conversationId, input.messageIds, input.auth.type, input.auth.id, input.state, oppositeKind]
  );
  const receipts = result.rows.map((row) => ({
    messageId: row.message_id,
    deliveredAt: row.delivered_at,
    readAt: row.read_at
  }));
  if (receipts.length) {
    publishConversationEvent(input.conversationId, conversation.team, "message:receipt", { receipts }, "all");
  }
  return receipts;
}
