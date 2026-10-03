import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const db = new Pool({
  connectionString: env().DATABASE_URL,
  max: env().NODE_ENV === "production" ? 20 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
  application_name: "safer-support-api"
});

export async function dbHealth(): Promise<boolean> {
  const result = await db.query("select 1 as ok");
  return result.rows[0]?.ok === 1;
}
