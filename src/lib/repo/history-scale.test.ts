import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { DEFAULT_MODEL_ID } from "@/lib/models/registry";
import { listConversations } from "./conversations";
import { searchConversations } from "./search";

describe("history at the PRD dataset size", () => {
  it("retrieves and ranks 1,000 conversations / 100,000 messages without loading transcripts for the sidebar", () => {
    const db = openDb(":memory:") as Db & { $client: Database.Database };
    try {
      const conversation = db.$client.prepare(
        "INSERT INTO conversations (id, model_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      );
      const message = db.$client.prepare(
        "INSERT INTO messages (id, conversation_id, seq, role, content, status, created_at) VALUES (?, ?, ?, 'user', ?, 'complete', ?)",
      );
      db.$client.transaction(() => {
        for (let c = 0; c < 1000; c++) {
          const id = String(c).padStart(4, "0");
          conversation.run(id, DEFAULT_MODEL_ID, `Conversation ${id}`, c, c);
          for (let seq = 0; seq < 100; seq++)
            message.run(
              `${id}-${seq}`,
              id,
              seq,
              `Message ${seq}: ${seq === 50 ? "Needle for search. " : "Other content. "}A representative saved chat discussing a small software project and its implementation.`,
              c * 100 + seq,
            );
        }
      })();
      const timings: Record<string, number> = {};
      for (const [name, query] of Object.entries({
        sidebar: "",
        indexed: "needle",
        short: "ne",
        common: "message",
      })) {
        const start = performance.now();
        const results = query
          ? searchConversations(db, query)
          : listConversations(db);
        timings[name] = Math.round((performance.now() - start) * 100) / 100;
        expect(results).toHaveLength(100);
        expect(results[0].id).toBe("0999");
        expect(results[0]).not.toHaveProperty("messages");
      }
      // Report measurements; correctness does not depend on machine speed in CI.
      console.info("History query timings (ms):", JSON.stringify(timings));
    } finally {
      db.$client.close();
    }
  }, 30_000);
});
