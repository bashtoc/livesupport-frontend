import http2 from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { Worker } from "bullmq";
import { redisConnection } from "../../infra/redis.js";
import { db } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { decryptSecret } from "../../lib/secrets.js";
import { logger } from "../../lib/logger.js";

let cachedApnsToken: { value: string; expires: number } | undefined;
let cachedFcmToken: { value: string; expires: number; projectId: string } | undefined;

async function providerToken() {
  const config = env();
  if (cachedApnsToken && cachedApnsToken.expires > Date.now()) return cachedApnsToken.value;
  if (!config.APNS_PRIVATE_KEY || !config.APNS_KEY_ID || !config.APNS_TEAM_ID) throw new Error("APNs credentials are not configured");
  const key = await importPKCS8(config.APNS_PRIVATE_KEY, "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.APNS_KEY_ID })
    .setIssuer(config.APNS_TEAM_ID).setIssuedAt().sign(key);
  cachedApnsToken = { value, expires: Date.now() + 45 * 60_000 };
  return value;
}

async function sendApns(token: string, environment: string, conversationId: string) {
  const config = env();
  if (!config.APNS_BUNDLE_ID) throw new Error("APNs bundle ID is not configured");
  const origin = environment === "development" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const client = http2.connect(origin);
  try {
    const jwt = await providerToken();
    await new Promise<void>((resolve, reject) => {
      const request = client.request({
        ":method": "POST", ":path": `/3/device/${token}`,
        authorization: `bearer ${jwt}`, "apns-topic": config.APNS_BUNDLE_ID,
        "apns-push-type": "alert", "apns-priority": "10"
      });
      let status = 0;
      let response = "";
      request.on("response", (headers) => { status = Number(headers[":status"]); });
      request.on("data", (chunk) => { response += chunk; });
      request.on("end", () => status === 200 ? resolve() : reject(new Error(`APNs ${status}: ${response}`)));
      request.on("error", reject);
      request.end(JSON.stringify({
        aps: { alert: { title: "Safer", body: "You have a new support reply." }, sound: "default", "thread-id": `support-${conversationId}` },
        type: "support_message", conversationId
      }));
    });
  } finally {
    client.close();
  }
}

async function fcmAccessToken() {
  if (cachedFcmToken && cachedFcmToken.expires > Date.now()) return cachedFcmToken;
  const raw = env().FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FCM credentials are not configured");
  const account = JSON.parse(raw) as { client_email?: string; private_key?: string; project_id?: string };
  if (!account.client_email || !account.private_key || !account.project_id) throw new Error("FCM credentials are invalid");
  const key = await importPKCS8(account.private_key.replaceAll("\\n", "\n"), "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("1h").sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !payload.access_token) throw new Error(`FCM authorization failed: ${payload.error ?? response.status}`);
  cachedFcmToken = { value: payload.access_token, expires: Date.now() + ((payload.expires_in ?? 3600) - 120) * 1000, projectId: account.project_id };
  return cachedFcmToken;
}

async function sendFcm(token: string, conversationId: string) {
  const auth = await fcmAccessToken();
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(auth.projectId)}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.value}`, "content-type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      notification: { title: "Safer", body: "You have a new support reply." },
      data: { type: "support_message", conversationId },
      android: { priority: "high", notification: { channel_id: "support_messages" } }
    } })
  });
  if (!response.ok) throw new Error(`FCM ${response.status}: ${await response.text()}`);
}

export function startNotificationWorker(): Worker {
  return new Worker(
    "notifications",
    async (job) => {
      if (job.name !== "agent-reply") return;
      const result = await db.query(
        `select nd.id, nd.provider, nd.environment, nd.token_ciphertext, c.id as conversation_id
           from messages m join conversations c on c.id = m.conversation_id
           join notification_devices nd on nd.customer_id = c.customer_id and nd.is_active
          where m.id = $1`,
        [job.data.messageId]
      );
      for (const device of result.rows) {
        const token = decryptSecret(device.token_ciphertext);
        if (device.provider === "apns") await sendApns(token, device.environment, device.conversation_id);
        else await sendFcm(token, device.conversation_id);
      }
      logger.info({ jobId: job.id, devices: result.rowCount }, "Support push notification delivered");
    },
    { connection: redisConnection(), concurrency: 10 }
  );
}
