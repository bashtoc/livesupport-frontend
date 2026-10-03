import { describe, expect, it } from "vitest";
import { validateAttachmentContent } from "../src/modules/attachments/validation.js";

describe("attachment content validation", () => {
  it("accepts valid UTF-8 text", async () => {
    await expect(validateAttachmentContent(Buffer.from("Hello support", "utf8"), "text/plain")).resolves.toBeUndefined();
  });

  it("rejects binary bytes declared as text", async () => {
    await expect(validateAttachmentContent(Buffer.from([0xff, 0x00, 0xfe]), "text/plain")).rejects.toMatchObject({
      code: "attachment_content_invalid"
    });
  });

  it("recognizes PNG content", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3WQAAAAASUVORK5CYII=",
      "base64"
    );
    await expect(validateAttachmentContent(png, "image/png")).resolves.toBeUndefined();
    await expect(validateAttachmentContent(png, "application/pdf")).rejects.toMatchObject({
      code: "attachment_content_invalid"
    });
  });
});
