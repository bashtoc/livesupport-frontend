import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/pool.js";
import { AppError } from "../../lib/errors.js";
import { authenticate, requireType } from "../../middleware/auth.js";
import type { StaffPrincipal } from "../auth/types.js";

const uuid = z.string().uuid();
const bodySchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(10_000)
});

export const savedReplyRouter = Router();
savedReplyRouter.use(authenticate, requireType("staff"));

savedReplyRouter.get("/", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const result = await db.query(
    "select id, title, body, created_at, updated_at from saved_replies where team = $1 order by title",
    [staff.team]
  );
  res.json({ data: result.rows });
});

savedReplyRouter.post("/", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const input = bodySchema.parse(req.body);
  const result = await db.query(
    `insert into saved_replies(title, body, team, created_by) values ($1, $2, $3, $4)
     returning id, title, body, created_at, updated_at`,
    [input.title, input.body, staff.team, staff.id]
  );
  res.status(201).json({ savedReply: result.rows[0] });
});

savedReplyRouter.patch("/:id", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const id = uuid.parse(req.params.id);
  const input = bodySchema.partial().refine((value) => Object.keys(value).length > 0).parse(req.body);
  const result = await db.query(
    `update saved_replies set title = coalesce($2, title), body = coalesce($3, body)
      where id = $1 and team = $4 returning id, title, body, created_at, updated_at`,
    [id, input.title ?? null, input.body ?? null, staff.team]
  );
  if (!result.rowCount) throw new AppError(404, "saved_reply_not_found", "Saved reply not found");
  res.json({ savedReply: result.rows[0] });
});

savedReplyRouter.delete("/:id", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const id = uuid.parse(req.params.id);
  const result = await db.query("delete from saved_replies where id = $1 and team = $2", [id, staff.team]);
  if (!result.rowCount) throw new AppError(404, "saved_reply_not_found", "Saved reply not found");
  res.status(204).end();
});
