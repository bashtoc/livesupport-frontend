import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import argon2 from "argon2";
import * as OTPAuth from "otpauth";
import { db } from "../../db/pool.js";
import { AppError } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { authenticate, requireType } from "../../middleware/auth.js";
import { audit } from "../audit/service.js";
import { createSession, revokeSession, rotateSession } from "./sessions.js";
import type { StaffPrincipal } from "./types.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many authentication attempts" } }
});

const loginSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
  otp: z.string().regex(/^\d{6}$/).optional()
});
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) });

export const authRouter = Router();

authRouter.post("/staff/login", authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await db.query(
    `select id, email, display_name, password_hash, role, team, is_active,
            mfa_enabled, mfa_secret_encrypted
       from staff_users where email = $1`,
    [input.email]
  );
  const user = result.rows[0];
  const passwordValid = user ? await argon2.verify(user.password_hash, input.password) : false;
  if (!user || !passwordValid || !user.is_active) {
    throw new AppError(401, "invalid_credentials", "Email, password, or one-time code is incorrect");
  }
  if (user.mfa_enabled) {
    if (!input.otp || !user.mfa_secret_encrypted) {
      throw new AppError(401, "mfa_required", "A one-time code is required");
    }
    const totp = new OTPAuth.TOTP({
      issuer: "Safer Support",
      label: user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(decryptSecret(user.mfa_secret_encrypted))
    });
    if (totp.validate({ token: input.otp, window: 1 }) === null) {
      throw new AppError(401, "invalid_credentials", "Email, password, or one-time code is incorrect");
    }
  }
  const principal: StaffPrincipal = { type: "staff", id: user.id, role: user.role, team: user.team };
  const session = await createSession(principal, req);
  await audit({
    actor: principal,
    action: "staff.logged_in",
    entityType: "staff_user",
    entityId: user.id,
    requestId: String(req.id),
    ip: req.ip
  });
  res.json({
    session,
    staff: { id: user.id, email: user.email, name: user.display_name, role: user.role, team: user.team }
  });
});

authRouter.post("/refresh", authLimiter, async (req, res) => {
  const input = refreshSchema.parse(req.body);
  res.json({ session: await rotateSession(input.refreshToken, req) });
});

authRouter.post("/logout", async (req, res) => {
  const input = refreshSchema.parse(req.body);
  await revokeSession(input.refreshToken);
  res.status(204).end();
});

authRouter.post("/staff/mfa/setup", authenticate, requireType("staff"), async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const user = await db.query("select email, mfa_enabled from staff_users where id = $1", [staff.id]);
  if (!user.rows[0] || user.rows[0].mfa_enabled) {
    throw new AppError(409, "mfa_already_enabled", "MFA is already enabled");
  }
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({ issuer: "Safer Support", label: user.rows[0].email, secret });
  await db.query("update staff_users set mfa_secret_encrypted = $1 where id = $2", [
    encryptSecret(secret.base32),
    staff.id
  ]);
  res.json({ secret: secret.base32, otpauthUrl: totp.toString() });
});

authRouter.post("/staff/mfa/confirm", authenticate, requireType("staff"), async (req, res) => {
  const staff = req.auth as StaffPrincipal;
  const { otp } = z.object({ otp: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const result = await db.query(
    "select email, mfa_secret_encrypted from staff_users where id = $1 and mfa_enabled = false",
    [staff.id]
  );
  const user = result.rows[0];
  if (!user?.mfa_secret_encrypted) throw new AppError(409, "mfa_setup_missing", "Start MFA setup first");
  const totp = new OTPAuth.TOTP({
    issuer: "Safer Support",
    label: user.email,
    secret: OTPAuth.Secret.fromBase32(decryptSecret(user.mfa_secret_encrypted))
  });
  if (totp.validate({ token: otp, window: 1 }) === null) {
    throw new AppError(400, "invalid_otp", "The one-time code is invalid");
  }
  await db.query("update staff_users set mfa_enabled = true where id = $1", [staff.id]);
  await audit({ actor: staff, action: "staff.mfa_enabled", entityType: "staff_user", entityId: staff.id });
  res.status(204).end();
});
