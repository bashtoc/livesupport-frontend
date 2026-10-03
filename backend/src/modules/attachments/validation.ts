import { TextDecoder } from "node:util";
import { fileTypeFromBuffer } from "file-type";
import { AppError } from "../../lib/errors.js";

const expectedTypes: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "application/pdf": "application/pdf"
};

export async function validateAttachmentContent(buffer: Buffer, declaredType: string): Promise<void> {
  if (declaredType === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (text.includes("\0")) throw new Error("Binary content");
      return;
    } catch {
      throw new AppError(400, "attachment_content_invalid", "File content does not match text/plain");
    }
  }
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || detected.mime !== expectedTypes[declaredType]) {
    throw new AppError(400, "attachment_content_invalid", "File content does not match its declared type");
  }
}
