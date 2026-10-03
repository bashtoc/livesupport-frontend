import type { Request } from "express";
import { db } from "../../db/pool.js";
import { AppError } from "../../lib/errors.js";
import { opaqueToken, tokenHash } from "../../lib/ids.js";
import { env } from "../../config/env.js";
import type { AuthPrincipal } from "./types.js";
import { signAccessToken } from "./tokens.js";

export async function createSession(principal: AuthPrincipal, req: Request) {
  const refreshToken = opaqueToken();
  const expiresAt = new Date(Date.now() + env().REFRESH_TOKEN_DAYS * 86_400_000);
  await db.query(
    `insert into auth_sessions
      (subject_type, subject_id, refresh_token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [principal.type, principal.id, tokenHash(refreshToken), req.get("user-agent")?.slice(0, 500), req.ip, expiresAt]
  );
  const ttl = principal.type === "staff" ? env().STAFF_ACCESS_TTL : env().CUSTOMER_ACCESS_TTL;
  return {
    accessToken: await signAccessToken(principal, ttl),
    refreshToken,
    expiresIn: ttl,
    refreshExpiresAt: expiresAt.toISOString()
  };
}

export async function rotateSession(refreshToken: string, req: Request) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `select s.id, s.subject_type, s.subject_id, c.external_uid,
              u.role, u.team, u.is_active
         from auth_sessions s
         left join customers c on s.subject_type = 'customer' and c.id = s.subject_id
         left join staff_users u on s.subject_type = 'staff' and u.id = s.subject_id
        where s.refresh_token_hash = $1 and s.revoked_at is null and s.expires_at > now()
        for update of s`,
      [tokenHash(refreshToken)]
    );
    const row = result.rows[0];
    if (!row || (row.subject_type === "staff" && !row.is_active)) {
      throw new AppError(401, "invalid_refresh_token", "Refresh session is invalid or expired");
    }
    const next = opaqueToken();
    await client.query(
      `update auth_sessions
          set refresh_token_hash = $1, last_used_at = now(), user_agent = $2, ip_address = $3
        where id = $4`,
      [tokenHash(next), req.get("user-agent")?.slice(0, 500), req.ip, row.id]
    );
    const principal: AuthPrincipal = row.subject_type === "customer"
      ? { type: "customer", id: row.subject_id, externalUid: row.external_uid }
      : { type: "staff", id: row.subject_id, role: row.role, team: row.team };
    const ttl = principal.type === "staff" ? env().STAFF_ACCESS_TTL : env().CUSTOMER_ACCESS_TTL;
    await client.query("commit");
    return { accessToken: await signAccessToken(principal, ttl), refreshToken: next, expiresIn: ttl };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSession(refreshToken: string): Promise<void> {
  await db.query(
    "update auth_sessions set revoked_at = now() where refresh_token_hash = $1 and revoked_at is null",
    [tokenHash(refreshToken)]
  );
}
