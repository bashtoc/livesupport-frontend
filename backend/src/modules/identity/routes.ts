import { Router } from "express";
import { z } from "zod";
import { transaction } from "../../db/transaction.js";
import { AppError } from "../../lib/errors.js";
import { audit } from "../audit/service.js";
import { createSession } from "../auth/sessions.js";
import { verifyIdentityAssertion } from "../auth/tokens.js";

const exchangeSchema = z.object({ assertion: z.string().min(80).max(10_000) });

export const identityRouter = Router();

identityRouter.post("/exchange", async (req, res) => {
  const { assertion } = exchangeSchema.parse(req.body);
  const claims = await verifyIdentityAssertion(assertion);
  if (claims.accountStatus === "revoked" || claims.accountStatus === "restricted") {
    throw new AppError(403, "account_unavailable", "Support is unavailable for this account");
  }
  const customer = await transaction(async (client) => {
    try {
      await client.query(
        "insert into consumed_identity_assertions(jti, expires_at) values ($1, to_timestamp($2))",
        [claims.jti, claims.exp]
      );
    } catch (error: unknown) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new AppError(401, "assertion_replayed", "Identity assertion has already been used");
      }
      throw error;
    }
    const result = await client.query(
      `insert into customers
        (external_uid, verified_name, email, avatar_url, account_status, profile_version, last_assertion_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (external_uid) do update set
         verified_name = case when excluded.profile_version >= customers.profile_version then excluded.verified_name else customers.verified_name end,
         email = case when excluded.profile_version >= customers.profile_version then excluded.email else customers.email end,
         avatar_url = case when excluded.profile_version >= customers.profile_version then excluded.avatar_url else customers.avatar_url end,
         account_status = case when excluded.profile_version >= customers.profile_version then excluded.account_status else customers.account_status end,
         profile_version = greatest(customers.profile_version, excluded.profile_version),
         last_assertion_at = now()
       returning id, external_uid, verified_name, email, avatar_url`,
      [
        claims.sub,
        claims.name,
        claims.email ?? null,
        claims.avatarUrl ?? null,
        claims.accountStatus ?? "active",
        claims.profileVersion ?? 1
      ]
    );
    const row = result.rows[0];
    await audit({
      actor: { type: "customer", id: row.id, externalUid: row.external_uid },
      action: "customer.identity_exchanged",
      entityType: "customer",
      entityId: row.id,
      requestId: String(req.id),
      ip: req.ip
    }, client);
    return row;
  });
  const session = await createSession(
    { type: "customer", id: customer.id, externalUid: customer.external_uid },
    req
  );
  res.status(201).json({
    session,
    customer: {
      id: customer.id,
      uid: customer.external_uid,
      name: customer.verified_name,
      email: customer.email,
      avatarUrl: customer.avatar_url
    }
  });
});
