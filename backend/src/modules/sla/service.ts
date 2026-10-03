import type { PoolClient } from "pg";
import { db } from "../../db/pool.js";
import { publishConversationEvent } from "../realtime/socket.js";

type Policy = {
  timezone: string;
  business_days: number[];
  business_open: string;
  business_close: string;
  first_response_minutes: number;
  resolution_minutes: number;
};

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function addBusinessMinutes(start: Date, minutes: number, policy: Policy): Date {
  const open = Number(policy.business_open.slice(0, 2)) * 60 + Number(policy.business_open.slice(3, 5));
  const close = Number(policy.business_close.slice(0, 2)) * 60 + Number(policy.business_close.slice(3, 5));
  let cursor = new Date(start);
  let remaining = minutes;
  while (remaining > 0) {
    const local = localParts(cursor, policy.timezone);
    if (policy.business_days.includes(local.day) && local.minute >= open && local.minute < close) remaining -= 1;
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return cursor;
}

export async function initializeSla(client: PoolClient, conversationId: string, team: string, now = new Date()) {
  const result = await client.query("select * from support_policies where team = $1", [team]);
  const policy = result.rows[0] as Policy | undefined;
  if (!policy) return;
  await client.query(
    "update conversations set first_response_due_at = $2, resolution_due_at = $3 where id = $1",
    [conversationId, addBusinessMinutes(now, policy.first_response_minutes, policy), addBusinessMinutes(now, policy.resolution_minutes, policy)]
  );
}

export async function processSlaBreaches() {
  const result = await db.query(
    `with missed as (
       select c.id, c.team,
              case when c.first_response_at is null and c.first_response_due_at <= now()
                   then 'first_response_missed' else 'resolution_missed' end as event_type,
              case when c.first_response_at is null and c.first_response_due_at <= now()
                   then c.first_response_due_at else c.resolution_due_at end as due_at
         from conversations c
        where c.status <> 'resolved' and c.sla_breached_at is null
          and ((c.first_response_at is null and c.first_response_due_at <= now()) or c.resolution_due_at <= now())
     ), inserted as (
       insert into sla_events(conversation_id, event_type, due_at)
       select id, event_type, due_at from missed on conflict do nothing returning conversation_id
     )
     update conversations c set sla_breached_at = now(), priority = 'urgent', version = version + 1
      from missed where c.id = missed.id
      returning c.id, c.team, c.sla_breached_at, c.version`
  );
  for (const row of result.rows) {
    publishConversationEvent(row.id, row.team, "conversation:sla-breached", {
      conversationId: row.id, breachedAt: row.sla_breached_at, version: Number(row.version)
    }, "staff");
  }
  return result.rowCount ?? 0;
}
