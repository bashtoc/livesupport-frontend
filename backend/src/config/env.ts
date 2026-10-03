import { z } from "zod";

const duration = z.string().regex(/^\d+[smhd]$/);
const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalEmail = z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional());
const optionalPassword = z.preprocess((value) => value === "" ? undefined : value, z.string().min(12).optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.string().default("loopback,linklocal,uniquelocal"),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  SESSION_ISSUER: z.string().default("safer-support"),
  PRIMARY_APP_ISSUER: z.string().default("safer-primary"),
  PRIMARY_APP_AUDIENCE: z.string().default("safer-support"),
  PRIMARY_APP_PUBLIC_KEY: z.string().min(1),
  CUSTOMER_ACCESS_TTL: duration.default("15m"),
  STAFF_ACCESS_TTL: duration.default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: z.string().default("safer-support-private"),
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  CLOUDFLARE_EMAIL_API_TOKEN: optionalString,
  CLOUDFLARE_EMAIL_ACCOUNT_ID: optionalString,
  EMAIL_FROM: z.string().email().default("support@saference.com"),
  SUPPORT_APP_URL: z.string().url().default("https://support.saference.com"),
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().min(1024).max(25_000_000).default(10_485_760),
  CLAMAV_HOST: z.string().default("clamav"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  APNS_TEAM_ID: optionalString,
  APNS_KEY_ID: optionalString,
  APNS_BUNDLE_ID: optionalString,
  APNS_PRIVATE_KEY: optionalString,
  FCM_SERVICE_ACCOUNT_JSON: optionalString,
  METRICS_TOKEN: optionalString,
  LOG_LEVEL: z.string().default("info"),
  BOOTSTRAP_ADMIN_EMAIL: optionalEmail,
  BOOTSTRAP_ADMIN_PASSWORD: optionalPassword
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const input = { ...process.env };
    if (input.PRIMARY_APP_PUBLIC_KEY) {
      input.PRIMARY_APP_PUBLIC_KEY = input.PRIMARY_APP_PUBLIC_KEY.replaceAll("\\n", "\n");
    }
    if (input.APNS_PRIVATE_KEY) input.APNS_PRIVATE_KEY = input.APNS_PRIVATE_KEY.replaceAll("\\n", "\n");
    cached = schema.parse(input);
  }
  return cached;
}

export function resetEnvForTests(): void {
  cached = undefined;
}
