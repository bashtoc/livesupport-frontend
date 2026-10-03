import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { staffCredentialsEmail } from "./templates.js";

type CloudflareResponse = {
  success?: boolean;
  result?: { message_id?: string; messageId?: string; id?: string };
  errors?: Array<{ code?: number; message?: string }>;
};

export async function sendStaffCredentials(input: {
  name: string;
  email: string;
  password: string;
  role: string;
}): Promise<{ messageId: string | null }> {
  const config = env();
  const token = config.CLOUDFLARE_EMAIL_API_TOKEN;
  const accountId = config.CLOUDFLARE_EMAIL_ACCOUNT_ID ?? config.R2_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new AppError(503, "email_not_configured", "Staff email delivery is not configured");
  }
  const content = staffCredentialsEmail({ ...input, loginUrl: config.SUPPORT_APP_URL });
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: input.email,
          from: config.EMAIL_FROM,
          subject: content.subject,
          html: content.html,
          text: content.text,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new AppError(502, "email_delivery_failed", "Cloudflare could not accept the credentials email");
  }
  const payload = (await response.json().catch(() => ({}))) as CloudflareResponse;
  if (!response.ok || payload.success === false) {
    throw new AppError(
      502,
      "email_delivery_failed",
      payload.errors?.[0]?.message ?? "Cloudflare could not accept the credentials email",
    );
  }
  return {
    messageId: payload.result?.message_id ?? payload.result?.messageId ?? payload.result?.id ?? null,
  };
}
