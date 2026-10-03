import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/pool.js";
import { transaction } from "../../db/transaction.js";
import { AppError } from "../../lib/errors.js";
import { authenticate, requireRole, requireType } from "../../middleware/auth.js";
import { audit } from "../audit/service.js";
import type { CustomerPrincipal, StaffPrincipal } from "../auth/types.js";
import { insertMessage, listMessages, sendMessage } from "../messages/service.js";
import { publishConversationEvent } from "../realtime/socket.js";
import { requireConversationAccess, serializeConversation } from "./access.js";

const uuid = z.string().uuid();
const listQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
const messageSchema = z.object({
  clientMessageId: z.string().min(8).max(128),
  body: z.string().max(10_000).default(""),
  visibility: z.enum(["public", "private_note"]).default("public"),
  attachmentIds: z.array(uuid).max(10).optional()
}).refine((value) => value.body.trim().length > 0 || value.attachmentIds?.length, {
  message: "A body or attachment is required"
});

export const conversationRouter = Router();
conversationRouter.use(authenticate);

conversationRouter.get("/conversations/:id/messages", async (req, res) => {
  const conversationId = uuid.parse(req.params.id);
  const query = listQuery.parse(req.query);
  const messages = await listMessages(conversationId, req.auth!, query.after, query.limit);
  res.json({ data: messages, nextAfter: messages.at(-1)?.sequence ?? query.after });
});

conversationRouter.post("/conversations/:id/messages", async (req, res) => {
  const conversationId = uuid.parse(req.params.id);
  const input = messageSchema.parse(req.body);
  const result = await sendMessage({
    conversationId,
    ...input,
    body: input.body.trim(),
    auth: req.auth!,
    requestId: String(req.id),
    ip: req.ip
  });
  res.status(result.deduplicated ? 200 : 201).json(result);
});

const createConversationSchema = z.object({
  subject: z.string().trim().min(2).max(160),
  initialMessage: z.object({
    clientMessageId: z.string().min(8).max(128),
    body: z.string().trim().min(1).max(10_000)
  }).optional()
});

conversationRouter.get("/customer/conversations", requireType("customer"), async (req, res) => {
  const customer = req.auth as CustomerPrincipal;
  const result = await db.query(
    `select c.*, su.display_name as assignee_name
       from conversations c left join staff_users su on su.id = c.assigned_staff_id
      where c.customer_id = $1 order by c.last_message_at desc limit 100`,
    [customer.id]
  );
  res.json({ data: result.rows.map(serializeConversation) });
});

conversationRouter.post("/customer/conversations", requireType("customer"), async (req, res) => {
  const customer = req.auth as CustomerPrincipal;
  const input = createConversationSchema.parse(req.body);
  const result = await transaction(async (client) => {
    const created = await client.query(
      `insert into conversations(customer_id, subject) values ($1, $2) returning *`,
      [customer.id, input.subject]
    );
    const conversation = created.rows[0];
    const message = input.initialMessage
      ? await insertMessage(client, {
          conversationId: conversation.id,
          clientMessageId: input.initialMessage.clientMessageId,
          body: input.initialMessage.body,
          kind: "customer",
          auth: customer
        })
      : null;
    await audit({
      actor: customer,
      action: "conversation.created",
      entityType: "conversation",
      entityId: conversation.id,
      requestId: String(req.id),
      ip: req.ip
    }, client);
    return { conversation, message: message?.message ?? null };
  });
  publishConversationEvent(result.conversation.id, result.conversation.team, "conversation:created", {
    conversation: serializeConversation(result.conversation)
  });
  res.status(201).json({ conversation: serializeConversation(result.conversation) });
});

const staffListSchema = z.object({
  view: z.enum(["unassigned", "mine", "team", "all"]).default("all"),
  status: z.enum(["open", "waiting", "snoozed", "resolved"]).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional()
});

conversationRouter.get("/staff/conversations", requireType("staff"), async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const query = staffListSchema.parse(req.query);
  const conditions = ["c.team = $1"];
  const values: unknown[] = [staff.team];
  if (query.view === "unassigned") conditions.push("c.assigned_staff_id is null");
  if (query.view === "mine") {
    values.push(staff.id);
    conditions.push(`c.assigned_staff_id = $${values.length}`);
  }
  if (query.status) {
    values.push(query.status);
    conditions.push(`c.status = $${values.length}`);
  }
  if (query.cursor) {
    values.push(query.cursor);
    conditions.push(`c.last_message_at < $${values.length}`);
  }
  if (query.search) {
    values.push(`%${query.search}%`);
    conditions.push(`(c.subject ilike $${values.length} or cu.verified_name ilike $${values.length})`);
  }
  values.push(query.limit);
  const result = await db.query(
    `select c.*, cu.external_uid, cu.verified_name, cu.email, cu.avatar_url,
            su.display_name as assignee_name,
            (select body from messages m where m.conversation_id = c.id and m.kind <> 'private_note'
              order by sequence desc limit 1) as preview
       from conversations c join customers cu on cu.id = c.customer_id
       left join staff_users su on su.id = c.assigned_staff_id
      where ${conditions.join(" and ")}
      order by c.last_message_at desc limit $${values.length}`,
    values
  );
  res.json({
    data: result.rows.map((row) => ({ ...serializeConversation(row), preview: row.preview })),
    nextCursor: result.rows.at(-1)?.last_message_at ?? null
  });
});

const patchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  assignedStaffId: z.string().uuid().nullable().optional(),
  status: z.enum(["open", "waiting", "snoozed", "resolved"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  snoozedUntil: z.string().datetime().nullable().optional()
}).refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), {
  message: "At least one change is required"
});

conversationRouter.patch("/staff/conversations/:id", requireType("staff"), async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const conversationId = uuid.parse(req.params.id);
  const input = patchSchema.parse(req.body);
  const current = await requireConversationAccess(conversationId, staff);
  if (input.assignedStaffId) {
    const target = await db.query("select id from staff_users where id = $1 and team = $2 and is_active", [
      input.assignedStaffId,
      current.team
    ]);
    if (!target.rowCount) throw new AppError(400, "invalid_assignee", "Assignee is unavailable or in another team");
  }
  const updated = await transaction(async (client) => {
    const result = await client.query(
      `update conversations set
          assigned_staff_id = case when $3::boolean then $4::uuid else assigned_staff_id end,
          status = coalesce($5::conversation_status, status),
          priority = coalesce($6::conversation_priority, priority),
          snoozed_until = case when $7::boolean then $8::timestamptz else snoozed_until end,
          resolved_at = case when $5 = 'resolved' then now() when $5 is not null then null else resolved_at end,
          version = version + 1
        where id = $1 and version = $2 returning *`,
      [
        conversationId,
        input.expectedVersion,
        Object.hasOwn(input, "assignedStaffId"),
        input.assignedStaffId ?? null,
        input.status ?? null,
        input.priority ?? null,
        Object.hasOwn(input, "snoozedUntil"),
        input.snoozedUntil ?? null
      ]
    );
    if (!result.rowCount) {
      throw new AppError(409, "version_conflict", "Conversation changed; refresh before trying again");
    }
    const row = result.rows[0];
    if (Object.hasOwn(input, "assignedStaffId") && current.assigned_staff_id !== input.assignedStaffId) {
      await client.query(
        `insert into assignment_history
          (conversation_id, previous_staff_id, new_staff_id, changed_by_staff_id)
         values ($1, $2, $3, $4)`,
        [conversationId, current.assigned_staff_id, input.assignedStaffId ?? null, staff.id]
      );
    }
    await audit({
      actor: staff,
      action: "conversation.updated",
      entityType: "conversation",
      entityId: conversationId,
      requestId: String(req.id),
      ip: req.ip,
      details: input
    }, client);
    return row;
  });
  const serialized = serializeConversation(updated);
  publishConversationEvent(conversationId, current.team, "conversation:updated", serialized);
  res.json({ conversation: serialized });
});

conversationRouter.get(
  "/staff/audit/:conversationId",
  requireRole("admin", "supervisor"),
  async (req, res) => {
    const conversationId = uuid.parse(req.params.conversationId);
    await requireConversationAccess(conversationId, req.auth!);
    const events = await db.query(
      `select id, actor_type, actor_id, action, details, created_at
         from audit_events where entity_type = 'conversation' and entity_id = $1
        order by created_at desc limit 200`,
      [conversationId]
    );
    res.json({ data: events.rows });
  }
);
