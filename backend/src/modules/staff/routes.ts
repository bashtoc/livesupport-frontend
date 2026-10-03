import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { db } from "../../db/pool.js";
import { transaction } from "../../db/transaction.js";
import { AppError } from "../../lib/errors.js";
import { opaqueToken } from "../../lib/ids.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { audit } from "../audit/service.js";
import type { StaffPrincipal } from "../auth/types.js";
import { queueStaffCredentials } from "../email/outbox.js";

const uuid = z.string().uuid();
const createSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "supervisor", "agent"]).default("agent"),
  team: z.string().trim().min(2).max(80).default("customer-support")
});
const updateSchema = z.object({
  role: z.enum(["admin", "supervisor", "agent"]).optional(),
  team: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "At least one change is required" });

export const staffRouter = Router();
staffRouter.use(authenticate, requireRole("admin", "supervisor"));

staffRouter.get("/users", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const result = await db.query(
    `select id, email, display_name, role, team, is_active, mfa_enabled,
            invitation_sent_at, invitation_status, created_at
       from staff_users
      where ($1 = 'admin' or team = $2)
      order by display_name`,
    [staff.role, staff.team]
  );
  res.json({ data: result.rows });
});

staffRouter.post("/users", requireRole("admin"), async (req, res) => {
  const input = createSchema.parse(req.body);
  const initialPassword = `${opaqueToken(24)}!9Aa`;
  const passwordHash = await argon2.hash(initialPassword, { type: argon2.argon2id });
  try {
    const created = await transaction(async (client) => {
      const result = await client.query(
        `insert into staff_users(email, display_name, password_hash, role, team)
         values ($1, $2, $3, $4, $5)
         returning id, email, display_name, role, team, is_active, created_at`,
        [input.email, input.name, passwordHash, input.role, input.team]
      );
      const staff = result.rows[0];
      const queueId = await queueStaffCredentials(client, staff.id, {
        name: input.name,
        email: input.email,
        password: initialPassword,
        role: input.role
      });
      const updated = await client.query(
        `select id, email, display_name, role, team, is_active,
                invitation_sent_at, invitation_status, created_at
           from staff_users where id = $1`,
        [staff.id]
      );
      await audit({
        actor: req.auth!, action: "staff.created", entityType: "staff_user", entityId: staff.id,
        requestId: String(req.id), ip: req.ip,
        details: { role: input.role, team: input.team, credentialsEmailQueued: true, queueId }
      }, client);
      return updated.rows[0];
    });
    res.status(201).json({ staff: created, delivery: { status: "queued" } });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new AppError(409, "email_exists", "A staff user already has that email");
    }
    throw error;
  }
});

staffRouter.post("/users/:id/resend-credentials", requireRole("admin"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  if (id === req.auth!.id) {
    throw new AppError(400, "cannot_reset_self", "Use the password settings to update your own account");
  }
  const initialPassword = `${opaqueToken(24)}!9Aa`;
  const passwordHash = await argon2.hash(initialPassword, { type: argon2.argon2id });
  const result = await transaction(async (client) => {
    const found = await client.query(
      "select id, email, display_name, role, team, is_active from staff_users where id = $1",
      [id]
    );
    const staff = found.rows[0];
    if (!staff || !staff.is_active) throw new AppError(404, "staff_not_found", "Active staff user not found");
    const queueId = await queueStaffCredentials(client, staff.id, {
      name: staff.display_name,
      email: staff.email,
      password: initialPassword,
      role: staff.role
    });
    await client.query(
      `update staff_users set password_hash = $2, session_version = session_version + 1,
              invitation_sent_at = null, invitation_message_id = null
        where id = $1`,
      [id, passwordHash]
    );
    await client.query("update auth_sessions set revoked_at = now() where subject_type = 'staff' and subject_id = $1", [id]);
    await audit({
      actor: req.auth!, action: "staff.credentials_resent", entityType: "staff_user", entityId: id,
      requestId: String(req.id), ip: req.ip,
      details: { credentialsEmailQueued: true, queueId }
    }, client);
    return { queueId };
  });
  res.status(202).json({ delivery: { status: "queued", queueId: result.queueId } });
});

staffRouter.patch("/users/:id", requireRole("admin"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = updateSchema.parse(req.body);
  if (id === req.auth!.id && input.isActive === false) {
    throw new AppError(400, "cannot_deactivate_self", "You cannot deactivate your own account");
  }
  const result = await db.query(
    `update staff_users set
       role = coalesce($2::staff_role, role),
       team = coalesce($3, team),
       is_active = coalesce($4, is_active),
       session_version = case when $4 = false then session_version + 1 else session_version end
     where id = $1
     returning id, email, display_name, role, team, is_active, mfa_enabled, created_at`,
    [id, input.role ?? null, input.team ?? null, input.isActive ?? null]
  );
  if (!result.rowCount) throw new AppError(404, "staff_not_found", "Staff user not found");
  if (input.isActive === false) {
    await db.query("update auth_sessions set revoked_at = now() where subject_type = 'staff' and subject_id = $1", [id]);
  }
  await audit({
    actor: req.auth!, action: "staff.updated", entityType: "staff_user", entityId: id,
    requestId: String(req.id), ip: req.ip, details: input
  });
  res.json({ staff: result.rows[0] });
});
