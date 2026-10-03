import { db } from "../../db/pool.js";
import { AppError } from "../../lib/errors.js";
import type { AuthPrincipal } from "../auth/types.js";

export async function requireConversationAccess(conversationId: string, auth: AuthPrincipal) {
  const result = await db.query(
    `select c.*, cu.external_uid, cu.verified_name, cu.email, cu.avatar_url,
            su.display_name as assignee_name
       from conversations c
       join customers cu on cu.id = c.customer_id
       left join staff_users su on su.id = c.assigned_staff_id
      where c.id = $1`,
    [conversationId]
  );
  const conversation = result.rows[0];
  if (!conversation) throw new AppError(404, "conversation_not_found", "Conversation not found");
  if (auth.type === "customer" && conversation.customer_id !== auth.id) {
    throw new AppError(404, "conversation_not_found", "Conversation not found");
  }
  if (auth.type === "staff" && auth.role === "agent" && conversation.team !== auth.team) {
    throw new AppError(403, "forbidden", "Conversation belongs to another team");
  }
  return conversation;
}

export function serializeConversation(row: Record<string, unknown>) {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    team: row.team,
    version: Number(row.version),
    assignedStaffId: row.assigned_staff_id,
    assigneeName: row.assignee_name,
    firstResponseDueAt: row.first_response_due_at,
    resolutionDueAt: row.resolution_due_at,
    firstResponseAt: row.first_response_at,
    slaBreachedAt: row.sla_breached_at,
    reopenedCount: Number(row.reopened_count ?? 0),
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    customer: row.external_uid
      ? {
          id: row.customer_id,
          uid: row.external_uid,
          name: row.verified_name,
          email: row.email,
          avatarUrl: row.avatar_url
        }
      : undefined
  };
}
