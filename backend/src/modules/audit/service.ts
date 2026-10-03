import type { PoolClient } from "pg";
import { db } from "../../db/pool.js";
import type { AuthPrincipal } from "../auth/types.js";

type AuditInput = {
  actor?: AuthPrincipal | undefined;
  action: string;
  entityType: string;
  entityId?: string | undefined;
  requestId?: string | undefined;
  ip?: string | undefined;
  details?: Record<string, unknown> | undefined;
};

export async function audit(input: AuditInput, client: PoolClient | typeof db = db): Promise<void> {
  await client.query(
    `insert into audit_events
      (actor_type, actor_id, action, entity_type, entity_id, request_id, ip_address, details)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.actor?.type ?? "system",
      input.actor?.id ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.requestId ?? null,
      input.ip ?? null,
      input.details ?? {}
    ]
  );
}
