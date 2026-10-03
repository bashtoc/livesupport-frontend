import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { raw, Router } from "express";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env.js";
import { db } from "../../db/pool.js";
import { r2 } from "../../infra/r2.js";
import { AppError } from "../../lib/errors.js";
import { objectKey } from "../../lib/ids.js";
import { authenticate } from "../../middleware/auth.js";
import { audit } from "../audit/service.js";
import { requireConversationAccess } from "../conversations/access.js";
import { attachmentQueue } from "./queue.js";
import { validateAttachmentContent } from "./validation.js";

const allowedTypes = new Set(["image/png", "image/jpeg", "application/pdf", "text/plain"]);
const uuid = z.string().uuid();
const initiateSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().max(100),
  byteSize: z.number().int().positive()
});
const uploadLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many attachment uploads" } }
});

export const attachmentRouter = Router();
attachmentRouter.use(authenticate);

attachmentRouter.post("/conversations/:id/attachments/initiate", async (req, res) => {
  const conversationId = uuid.parse(req.params.id);
  const input = initiateSchema.parse(req.body);
  await requireConversationAccess(conversationId, req.auth!);
  if (!allowedTypes.has(input.contentType)) {
    throw new AppError(400, "unsupported_attachment_type", "PNG, JPEG, PDF, and text files are supported");
  }
  if (input.byteSize > env().MAX_ATTACHMENT_BYTES) {
    throw new AppError(413, "attachment_too_large", "Attachment exceeds the configured size limit");
  }
  const id = crypto.randomUUID();
  const key = objectKey(conversationId, id, input.fileName);
  await db.query(
    `insert into attachments
      (id, conversation_id, uploaded_by_type, uploaded_by_id, object_key, original_name, content_type, byte_size)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, conversationId, req.auth!.type, req.auth!.id, key, input.fileName, input.contentType, input.byteSize]
  );
  res.status(201).json({
    attachment: { id, status: "pending_upload", fileName: input.fileName, byteSize: input.byteSize },
    upload: {
      url: `/api/v1/conversations/${conversationId}/attachments/${id}/content`,
      method: "PUT",
      headers: { "content-type": input.contentType }
    }
  });
});

attachmentRouter.put(
  "/conversations/:conversationId/attachments/:attachmentId/content",
  uploadLimiter,
  raw({ type: () => true, limit: env().MAX_ATTACHMENT_BYTES }),
  async (req, res) => {
    const conversationId = uuid.parse(req.params.conversationId);
    const attachmentId = uuid.parse(req.params.attachmentId);
    await requireConversationAccess(conversationId, req.auth!);
    const result = await db.query(
      `select * from attachments
        where id = $1 and conversation_id = $2 and uploaded_by_type = $3 and uploaded_by_id = $4`,
      [attachmentId, conversationId, req.auth!.type, req.auth!.id]
    );
    const attachment = result.rows[0];
    if (!attachment) throw new AppError(404, "attachment_not_found", "Attachment not found");
    if (attachment.status !== "pending_upload") {
      throw new AppError(409, "attachment_already_uploaded", "Attachment content has already been uploaded");
    }
    if (!Buffer.isBuffer(req.body) || req.body.length !== attachment.byte_size) {
      throw new AppError(409, "upload_mismatch", "Uploaded file does not match its declared size");
    }
    if (req.get("content-type") !== attachment.content_type) {
      throw new AppError(409, "upload_mismatch", "Uploaded file does not match its declared content type");
    }
    await validateAttachmentContent(req.body, attachment.content_type);
    await r2().send(new PutObjectCommand({
      Bucket: env().R2_BUCKET,
      Key: attachment.object_key,
      Body: req.body,
      ContentType: attachment.content_type,
      ContentLength: req.body.length,
      Metadata: { attachmentId, conversationId }
    }));
    await audit({
      actor: req.auth!, action: "attachment.uploaded", entityType: "attachment", entityId: attachmentId,
      requestId: String(req.id), ip: req.ip
    });
    res.status(204).end();
  }
);

attachmentRouter.post("/conversations/:conversationId/attachments/:attachmentId/complete", async (req, res) => {
  const conversationId = uuid.parse(req.params.conversationId);
  const attachmentId = uuid.parse(req.params.attachmentId);
  await requireConversationAccess(conversationId, req.auth!);
  const result = await db.query(
    `select * from attachments
      where id = $1 and conversation_id = $2 and uploaded_by_type = $3 and uploaded_by_id = $4`,
    [attachmentId, conversationId, req.auth!.type, req.auth!.id]
  );
  const attachment = result.rows[0];
  if (!attachment) throw new AppError(404, "attachment_not_found", "Attachment not found");
  if (attachment.status !== "pending_upload") {
    res.json({ attachment: { id: attachment.id, status: attachment.status } });
    return;
  }
  const object = await r2().send(new HeadObjectCommand({ Bucket: env().R2_BUCKET, Key: attachment.object_key }));
  if (object.ContentLength !== attachment.byte_size || object.ContentType !== attachment.content_type) {
    await db.query("update attachments set status = 'rejected', scan_result = 'metadata_mismatch' where id = $1", [
      attachmentId
    ]);
    throw new AppError(409, "upload_mismatch", "Uploaded file does not match its declared metadata");
  }
  await db.query("update attachments set status = 'quarantined' where id = $1", [attachmentId]);
  await attachmentQueue.add("scan", { attachmentId }, { jobId: attachmentId });
  await audit({
    actor: req.auth!,
    action: "attachment.quarantined",
    entityType: "attachment",
    entityId: attachmentId,
    requestId: String(req.id),
    ip: req.ip
  });
  res.status(202).json({ attachment: { id: attachmentId, status: "quarantined" } });
});

attachmentRouter.get("/conversations/:conversationId/attachments/:attachmentId", async (req, res) => {
  const conversationId = uuid.parse(req.params.conversationId);
  const attachmentId = uuid.parse(req.params.attachmentId);
  await requireConversationAccess(conversationId, req.auth!);
  const result = await db.query(
    `select id, original_name, content_type, byte_size, status
       from attachments where id = $1 and conversation_id = $2`,
    [attachmentId, conversationId]
  );
  const attachment = result.rows[0];
  if (!attachment) throw new AppError(404, "attachment_not_found", "Attachment not found");
  res.json({
    attachment: {
      id: attachment.id,
      fileName: attachment.original_name,
      contentType: attachment.content_type,
      byteSize: attachment.byte_size,
      status: attachment.status
    }
  });
});

attachmentRouter.get("/conversations/:conversationId/attachments/:attachmentId/download", async (req, res) => {
  const conversationId = uuid.parse(req.params.conversationId);
  const attachmentId = uuid.parse(req.params.attachmentId);
  await requireConversationAccess(conversationId, req.auth!);
  const result = await db.query(
    `select * from attachments where id = $1 and conversation_id = $2 and status = 'available'`,
    [attachmentId, conversationId]
  );
  const attachment = result.rows[0];
  if (!attachment) throw new AppError(404, "attachment_unavailable", "Attachment is not available");
  const object = await r2().send(new GetObjectCommand({ Bucket: env().R2_BUCKET, Key: attachment.object_key }));
  if (!(object.Body instanceof Readable)) {
    throw new AppError(502, "storage_read_failed", "Attachment storage returned an invalid response");
  }
  res.setHeader("content-type", attachment.content_type);
  res.setHeader("content-length", String(attachment.byte_size));
  res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`);
  res.setHeader("cache-control", "private, no-store");
  await pipeline(object.Body, res);
});
