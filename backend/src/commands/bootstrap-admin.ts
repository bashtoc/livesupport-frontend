import argon2 from "argon2";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { logger } from "../lib/logger.js";

async function main(): Promise<void> {
  const email = env().BOOTSTRAP_ADMIN_EMAIL;
  const password = env().BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required");
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3 });
  const result = await db.query(
    `insert into staff_users(email, display_name, password_hash, role)
     values ($1, 'Support Administrator', $2, 'admin')
     on conflict (email) do nothing returning id`,
    [email.toLowerCase(), hash]
  );
  if (!result.rowCount) throw new Error("Administrator already exists; use the staff management API");
  logger.info({ email }, "Bootstrap administrator created; remove bootstrap credentials from the environment");
}

main().then(() => db.end()).catch((error) => {
  logger.fatal({ err: error }, "Unable to bootstrap administrator");
  process.exit(1);
});
