import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/pool.js";
import { encryptSecret } from "../../lib/secrets.js";
import { authenticate, requireType } from "../../middleware/auth.js";
import type { CustomerPrincipal } from "../auth/types.js";

const registration = z.object({
  provider: z.enum(["apns", "fcm"]),
  platform: z.enum(["ios", "android"]),
  token: z.string().min(32).max(4096),
  environment: z.enum(["development", "production"]).default("production")
});

export const notificationRouter = Router();
notificationRouter.use(authenticate, requireType("customer"));

notificationRouter.put("/devices", async (req, res) => {
  const customer = req.auth as CustomerPrincipal;
  const input = registration.parse(req.body);
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  await db.query(
    `insert into notification_devices(customer_id, platform, provider, environment, token_ciphertext, token_hash, is_active)
     values ($1, $2, $3, $4, $5, $6, true)
     on conflict (customer_id, provider, token_hash) do update set
       platform = excluded.platform, environment = excluded.environment,
       token_ciphertext = excluded.token_ciphertext, is_active = true, updated_at = now()`,
    [customer.id, input.platform, input.provider, input.environment, encryptSecret(input.token), tokenHash]
  );
  res.status(204).end();
});

notificationRouter.delete("/devices", async (req, res) => {
  const customer = req.auth as CustomerPrincipal;
  await db.query("update notification_devices set is_active = false, updated_at = now() where customer_id = $1", [customer.id]);
  res.status(204).end();
});
