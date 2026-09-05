import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "src", "lib", "db", "migrations");

/**
 * Open (creating if needed) a database file, apply pending migrations, and
 * flip any rows left in `streaming` by a crash to `interrupted`.
 * Pass ":memory:" in tests.
 */
export function openDb(filePath: string): Db {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sweepStreamingRows(db);
  return db;
}

/** Crash recovery: a row still marked streaming at startup never finished. */
export function sweepStreamingRows(db: Db): number {
  return db
    .update(schema.messages)
    .set({ status: "interrupted" })
    .where(eq(schema.messages.status, "streaming"))
    .run().changes;
}

let singleton: Db | undefined;

export function getDb(): Db {
  if (!singleton) {
    singleton = openDb(getEnv().ZEUS_DB_PATH);
  }
  return singleton;
}
