import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "./pool.js";
import { logger } from "../lib/logger.js";

const migrationsDirectory = resolve(process.cwd(), "migrations");

export async function migrate(): Promise<void> {
  const lock = await db.connect();
  try {
    await lock.query("select pg_advisory_lock(74201931)");
    await lock.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) {
    const exists = await lock.query("select 1 from schema_migrations where name = $1", [name]);
    if (exists.rowCount) continue;
    const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(name) values ($1)", [name]);
      await client.query("commit");
      logger.info({ migration: name }, "Applied database migration");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  } finally {
    await lock.query("select pg_advisory_unlock(74201931)").catch(() => undefined);
    lock.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => db.end()).catch((error) => {
    logger.fatal({ err: error }, "Migration failed");
    process.exit(1);
  });
}
