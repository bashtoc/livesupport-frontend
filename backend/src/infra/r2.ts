import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export function r2(): S3Client {
  const config = env();
  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY) {
    throw new AppError(503, "attachments_not_configured", "Private attachment storage is not configured");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY
    }
  });
}
