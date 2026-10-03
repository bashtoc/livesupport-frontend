import { createHash } from "node:crypto";
import net from "node:net";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { r2 } from "../../infra/r2.js";

export async function fetchAttachment(key: string): Promise<Buffer> {
  const object = await r2().send(new GetObjectCommand({ Bucket: env().R2_BUCKET, Key: key }));
  if (!object.Body) throw new Error("Attachment object is empty");
  const bytes = await object.Body.transformToByteArray();
  if (bytes.byteLength > env().MAX_ATTACHMENT_BYTES) throw new Error("Attachment exceeds scan limit");
  return Buffer.from(bytes);
}

export async function deleteAttachment(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: env().R2_BUCKET, Key: key }));
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function scanBuffer(buffer: Buffer): Promise<{ clean: boolean; result: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: env().CLAMAV_HOST, port: env().CLAMAV_PORT });
    const responses: Buffer[] = [];
    socket.setTimeout(30_000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, offset + chunkSize);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => responses.push(chunk));
    socket.on("timeout", () => socket.destroy(new Error("ClamAV scan timed out")));
    socket.on("error", reject);
    socket.on("close", () => {
      const result = Buffer.concat(responses).toString("utf8").replaceAll("\0", "").trim();
      if (!result) return reject(new Error("ClamAV returned no result"));
      resolve({ clean: result.endsWith("OK"), result });
    });
  });
}
