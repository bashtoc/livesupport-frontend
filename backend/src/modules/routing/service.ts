import type { PoolClient } from "pg";

export async function assignConversation(client: PoolClient, conversationId: string, team: string) {
  const policy = await client.query("select assignment_mode from support_policies where team = $1", [team]);
  const mode = policy.rows[0]?.assignment_mode ?? "workload";
  const order = mode === "round_robin"
    ? "su.last_assigned_at asc nulls first, su.created_at asc"
    : "active_count asc, su.last_assigned_at asc nulls first";
  const candidates = await client.query(
    `select su.id,
            (select count(*)::int from conversations c
              where c.assigned_staff_id = su.id and c.status <> 'resolved') as active_count
       from staff_users su
      where su.team = $1 and su.is_active and su.availability_status <> 'offline'
      order by ${order}
      limit 1
      for update of su skip locked`,
    [team]
  );
  const agent = candidates.rows[0];
  if (!agent) return null;
  await client.query("update conversations set assigned_staff_id = $1 where id = $2", [agent.id, conversationId]);
  await client.query("update staff_users set last_assigned_at = now() where id = $1", [agent.id]);
  await client.query(
    `insert into assignment_history(conversation_id, previous_staff_id, new_staff_id, changed_by_staff_id, reason)
     values ($1, null, $2, null, $3)`,
    [conversationId, agent.id, `automatic_${mode}`]
  );
  return agent.id as string;
}
