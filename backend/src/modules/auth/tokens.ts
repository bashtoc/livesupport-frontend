import { createSecretKey } from "node:crypto";
import { importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { AuthPrincipal } from "./types.js";

const secretKey = () => createSecretKey(Buffer.from(env().SESSION_SECRET, "utf8"));

export async function signAccessToken(principal: AuthPrincipal, expiresIn: string): Promise<string> {
  return new SignJWT({
    typ: principal.type,
    ...(principal.type === "customer"
      ? { externalUid: principal.externalUid }
      : { role: principal.role, team: principal.team })
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env().SESSION_ISSUER)
    .setAudience("safer-support-api")
    .setSubject(principal.id)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(expiresIn)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AuthPrincipal> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: env().SESSION_ISSUER,
      audience: "safer-support-api",
      algorithms: ["HS256"]
    });
    if (!payload.sub || (payload.typ !== "customer" && payload.typ !== "staff")) {
      throw new Error("Malformed principal");
    }
    if (payload.typ === "customer" && typeof payload.externalUid === "string") {
      return { type: "customer", id: payload.sub, externalUid: payload.externalUid };
    }
    if (
      payload.typ === "staff" &&
      (payload.role === "admin" || payload.role === "supervisor" || payload.role === "agent") &&
      typeof payload.team === "string"
    ) {
      return { type: "staff", id: payload.sub, role: payload.role, team: payload.team };
    }
    throw new Error("Malformed claims");
  } catch {
    throw new AppError(401, "invalid_token", "Access token is invalid or expired");
  }
}

export type IdentityClaims = JWTPayload & {
  sub: string;
  jti: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  profileVersion?: number;
  accountStatus?: "active" | "restricted" | "revoked";
};

export async function verifyIdentityAssertion(assertion: string): Promise<IdentityClaims> {
  try {
    const key = await importSPKI(env().PRIMARY_APP_PUBLIC_KEY, "EdDSA");
    const { payload } = await jwtVerify(assertion, key, {
      issuer: env().PRIMARY_APP_ISSUER,
      audience: env().PRIMARY_APP_AUDIENCE,
      algorithms: ["EdDSA"],
      maxTokenAge: "5m",
      clockTolerance: 5
    });
    if (
      !payload.sub ||
      !payload.jti ||
      typeof payload.name !== "string" ||
      payload.name.length < 1 ||
      payload.name.length > 120
    ) {
      throw new Error("Missing required identity claims");
    }
    return payload as IdentityClaims;
  } catch {
    throw new AppError(401, "invalid_identity_assertion", "Identity assertion is invalid or expired");
  }
}
