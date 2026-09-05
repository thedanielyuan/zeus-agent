import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { getConversationDetail } from "@/lib/repo/conversations";
import { searchConversations } from "@/lib/repo/search";
import { DEFAULT_MODEL_ID } from "@/lib/models/registry";
import { openDb, type Db } from "./client";

describe("M1 to M2 migration", () => {
  it("backfills search and fallback titles without changing existing message records", () => {
    const directory = mkdtempSync(join(tmpdir(), "zeus-migration-"));
    const oldMigrations = join(directory, "migrations");
    const file = join(directory, "history.db");
    let reopened: (Db & { $client: Database.Database }) | undefined;
    try {
      mkdirSync(join(oldMigrations, "meta"), { recursive: true });
      const source = join(process.cwd(), "src/lib/db/migrations");
      const journal = JSON.parse(
        readFileSync(join(source, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 2);
      writeFileSync(
        join(oldMigrations, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries)
        copyFileSync(
          join(source, `${entry.tag}.sql`),
          join(oldMigrations, `${entry.tag}.sql`),
        );
      const sqlite = new Database(file);
      migrate(drizzle(sqlite), { migrationsFolder: oldMigrations });
      sqlite
        .prepare(
          "INSERT INTO conversations(id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, 10, 20)",
        )
        .run("legacy", "New chat", DEFAULT_MODEL_ID);
      sqlite
        .prepare(
          "INSERT INTO conversations(id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, 10, 20)",
        )
        .run("manual", "Owner's title", DEFAULT_MODEL_ID);
      sqlite
        .prepare(
          "INSERT INTO messages(id, conversation_id, seq, role, content, status, created_at) VALUES (?, 'legacy', ?, ?, ?, 'complete', 10)",
        )
        .run("user", 0, "user", "Legacy searchable content");
      sqlite
        .prepare(
          "INSERT INTO messages(id, conversation_id, seq, role, content, thinking, status, created_at) VALUES ('assistant', 'legacy', 1, 'assistant', 'Saved reply', 'Saved thinking', 'complete', 11)",
        )
        .run();
      const original = sqlite
        .prepare("SELECT * FROM messages ORDER BY seq")
        .all();
      sqlite.close();
      reopened = openDb(file) as typeof reopened;
      expect(
        reopened!.$client.prepare("SELECT * FROM messages ORDER BY seq").all(),
      ).toEqual(original);
      expect(
        getConversationDetail(reopened!, "legacy").conversation,
      ).toMatchObject({
        title: "Legacy searchable content",
        titleStatus: "failed",
      });
      expect(
        getConversationDetail(reopened!, "manual").conversation,
      ).toMatchObject({ title: "Owner's title", titleStatus: "manual" });
      expect(searchConversations(reopened!, "SEARCHABLE")[0]?.id).toBe(
        "legacy",
      );
      expect(searchConversations(reopened!, "owner")[0]?.id).toBe("manual");
    } finally {
      reopened?.$client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
