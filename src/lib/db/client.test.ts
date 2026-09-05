import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb, sweepStreamingRows } from "./client";
import { conversations, messages } from "./schema";

describe("db client", () => {
  it("applies migrations to a fresh database", () => {
    const db = openDb(":memory:");
    const rows = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`);
    const names = rows.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["conversations", "messages", "settings"]));
  });

  it("enforces one seq per conversation and cascades deletes", () => {
    const db = openDb(":memory:");
    const now = Date.now();
    db.insert(conversations).values({ id: "c1", modelId: "claude-sonnet-5", createdAt: now, updatedAt: now }).run();
    db.insert(messages).values({ id: "m1", conversationId: "c1", seq: 0, role: "user", content: "hi", status: "complete", createdAt: now }).run();
    expect(() =>
      db.insert(messages).values({ id: "m2", conversationId: "c1", seq: 0, role: "assistant", status: "complete", createdAt: now }).run(),
    ).toThrow();
    db.delete(conversations).where(sql`id = 'c1'`).run();
    expect(db.select().from(messages).all()).toHaveLength(0);
  });

  it("sweeps rows left streaming by a crash", () => {
    const db = openDb(":memory:");
    const now = Date.now();
    db.insert(conversations).values({ id: "c1", modelId: "claude-sonnet-5", createdAt: now, updatedAt: now }).run();
    db.insert(messages).values({ id: "m1", conversationId: "c1", seq: 0, role: "assistant", status: "streaming", createdAt: now }).run();
    expect(sweepStreamingRows(db)).toBe(1);
    expect(db.select().from(messages).all()[0]?.status).toBe("interrupted");
  });
});
