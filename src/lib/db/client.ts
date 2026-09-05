import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getEnv } from "@/lib/env";
import { sweepStreamingRows } from "@/lib/repo/messages";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export { sweepStreamingRows } from "@/lib/repo/messages";

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
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sweepStreamingRows(db);
  return db;
}

// Survive Next's development module reloads: reopening would sweep live turns.
const shared = globalThis as typeof globalThis & { zeusChatDb?: Db };

export function getDb(): Db {
  if (!shared.zeusChatDb) {
    shared.zeusChatDb = openDb(getEnv().ZEUS_DB_PATH);
  }
  return shared.zeusChatDb;
}
