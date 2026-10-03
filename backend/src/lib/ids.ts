import { createHash, randomBytes } from "node:crypto";

export function opaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function objectKey(conversationId: string, attachmentId: string, fileName: string): string {
  const safe = fileName.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  return `conversations/${conversationId}/${attachmentId}/${safe || "attachment"}`;
}
