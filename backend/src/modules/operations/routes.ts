import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/pool.js";
import { authenticate, requireRole, requireType } from "../../middleware/auth.js";
import type { StaffPrincipal } from "../auth/types.js";

export const operationsRouter = Router();
operationsRouter.use(authenticate, requireType("staff"));

operationsRouter.patch("/availability", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const status = z.enum(["available", "busy", "offline"]).parse(req.body?.status);
  await db.query("update staff_users set availability_status = $2 where id = $1", [staff.id, status]);
  res.json({ status });
});

operationsRouter.get("/policy", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const result = await db.query("select * from support_policies where team = $1", [staff.team]);
  res.json({ policy: result.rows[0] });
});

const policySchema = z.object({
  timezone: z.string().min(2).max(80).optional(),
  businessDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  businessOpen: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessClose: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  firstResponseMinutes: z.number().int().min(1).max(10080).optional(),
  resolutionMinutes: z.number().int().min(1).max(43200).optional(),
  assignmentMode: z.enum(["workload", "round_robin"]).optional()
}).refine((value) => Object.keys(value).length > 0);

operationsRouter.patch("/policy", requireRole("admin", "supervisor"), async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const input = policySchema.parse(req.body);
  const result = await db.query(
    `update support_policies set timezone = coalesce($2, timezone), business_days = coalesce($3, business_days),
      business_open = coalesce($4::time, business_open), business_close = coalesce($5::time, business_close),
      first_response_minutes = coalesce($6, first_response_minutes), resolution_minutes = coalesce($7, resolution_minutes),
      assignment_mode = coalesce($8, assignment_mode) where team = $1 returning *`,
    [staff.team, input.timezone ?? null, input.businessDays ?? null, input.businessOpen ?? null, input.businessClose ?? null,
      input.firstResponseMinutes ?? null, input.resolutionMinutes ?? null, input.assignmentMode ?? null]
  );
  res.json({ policy: result.rows[0] });
});

operationsRouter.get("/reports/overview", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const period = z.coerce.number().int().min(1).max(365).default(30).parse(req.query.days);
  const [summary, agents, queueAge, daily] = await Promise.all([
    db.query(
      `select count(*)::int as total,
        count(*) filter (where status <> 'resolved')::int as open,
        count(*) filter (where status = 'resolved')::int as resolved,
        count(*) filter (where assigned_staff_id is null and status <> 'resolved')::int as unassigned,
        count(*) filter (where sla_breached_at is not null)::int as sla_breached,
        coalesce(round(avg(extract(epoch from (first_response_at - created_at)) / 60) filter (where first_response_at is not null)), 0)::int as avg_first_response_minutes,
        coalesce(round(avg(extract(epoch from (resolved_at - created_at)) / 60) filter (where resolved_at is not null)), 0)::int as avg_resolution_minutes,
        coalesce(round(avg(cf.rating)::numeric, 1), 0) as csat,
        count(cf.id)::int as feedback_count
       from conversations c left join conversation_feedback cf on cf.conversation_id = c.id
       where c.team = $1 and c.created_at >= now() - ($2 || ' days')::interval`, [staff.team, period]),
    db.query(
      `select su.id, su.display_name, su.availability_status,
        count(c.id)::int as assigned,
        count(c.id) filter (where c.status = 'resolved')::int as resolved,
        coalesce(round(avg(cf.rating)::numeric, 1), 0) as csat
       from staff_users su left join conversations c on c.assigned_staff_id = su.id and c.created_at >= now() - ($2 || ' days')::interval
       left join conversation_feedback cf on cf.conversation_id = c.id
       where su.team = $1 and su.is_active group by su.id order by resolved desc`, [staff.team, period]),
    db.query(
      `select coalesce(round(avg(extract(epoch from (now() - created_at)) / 60)), 0)::int as average_minutes,
              coalesce(max(extract(epoch from (now() - created_at)) / 60), 0)::int as oldest_minutes
       from conversations where team = $1 and status <> 'resolved'`, [staff.team]),
    db.query(
      `select date_trunc('day', created_at)::date as day, count(*)::int as created,
              count(*) filter (where status = 'resolved')::int as resolved
       from conversations where team = $1 and created_at >= now() - ($2 || ' days')::interval
       group by 1 order by 1`, [staff.team, period])
  ]);
  res.json({ summary: summary.rows[0], agents: agents.rows, queueAge: queueAge.rows[0], daily: daily.rows });
});
