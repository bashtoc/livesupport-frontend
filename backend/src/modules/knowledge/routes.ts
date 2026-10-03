import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/pool.js";
import { AppError } from "../../lib/errors.js";
import { authenticate, requireType } from "../../middleware/auth.js";
import type { StaffPrincipal } from "../auth/types.js";

const uuid = z.string().uuid();
const articleSchema = z.object({
  title: z.string().trim().min(3).max(180),
  summary: z.string().trim().max(500).default(""),
  body: z.string().trim().min(10).max(50_000),
  category: z.string().trim().min(2).max(80).default("General"),
  isPublished: z.boolean().default(false)
});
const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);

export const publicKnowledgeRouter = Router();
publicKnowledgeRouter.use(authenticate, requireType("customer"));
publicKnowledgeRouter.get("/articles", async (_req, res) => {
  const result = await db.query(
    `select id, title, slug, summary, body, category, updated_at
       from knowledge_articles where is_published order by category, title`
  );
  res.json({ data: result.rows });
});

export const staffKnowledgeRouter = Router();
staffKnowledgeRouter.use(authenticate, requireType("staff"));
staffKnowledgeRouter.get("/articles", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const result = await db.query(
    `select id, title, slug, summary, body, category, is_published, created_at, updated_at
       from knowledge_articles where team = $1 order by updated_at desc`, [staff.team]
  );
  res.json({ data: result.rows });
});
staffKnowledgeRouter.post("/articles", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const input = articleSchema.parse(req.body);
  const result = await db.query(
    `insert into knowledge_articles(team, title, slug, summary, body, category, is_published, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     returning *`,
    [staff.team, input.title, `${slug(input.title)}-${crypto.randomUUID().slice(0, 8)}`, input.summary, input.body, input.category, input.isPublished, staff.id]
  );
  res.status(201).json({ article: result.rows[0] });
});
staffKnowledgeRouter.patch("/articles/:id", async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const id = uuid.parse(req.params.id);
  const input = articleSchema.partial().refine((value) => Object.keys(value).length > 0).parse(req.body);
  const result = await db.query(
    `update knowledge_articles set title = coalesce($3, title), summary = coalesce($4, summary),
       body = coalesce($5, body), category = coalesce($6, category),
       is_published = coalesce($7, is_published), updated_by = $8
     where id = $1 and team = $2 returning *`,
    [id, staff.team, input.title ?? null, input.summary ?? null, input.body ?? null, input.category ?? null, input.isPublished ?? null, staff.id]
  );
  if (!result.rowCount) throw new AppError(404, "article_not_found", "Knowledge article not found");
  res.json({ article: result.rows[0] });
});

