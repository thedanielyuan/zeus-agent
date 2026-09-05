import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { conversations } from "@/lib/db/schema";
import { createConversation, RETENTION_MS } from "./conversations";
import { startHistoryCleanup } from "./maintenance";

it("catches up expired deletions on startup and runs one hourly cleanup timer", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  const shared = globalThis as typeof globalThis & {
    zeusHistoryCleanup?: ReturnType<typeof setInterval>;
  };
  try {
    const db = openDb(":memory:");
    const expired = createConversation(db);
    const retained = createConversation(db);
    db.update(conversations)
      .set({ deletedAt: Date.now() - RETENTION_MS })
      .where(eq(conversations.id, expired.id))
      .run();
    db.update(conversations)
      .set({ deletedAt: Date.now() - RETENTION_MS + 1 })
      .where(eq(conversations.id, retained.id))
      .run();
    startHistoryCleanup(db);
    startHistoryCleanup(db);
    expect(
      db
        .select()
        .from(conversations)
        .all()
        .map((r) => r.id),
    ).toEqual([retained.id]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(db.select().from(conversations).all()).toEqual([]);
  } finally {
    clearInterval(shared.zeusHistoryCleanup);
    delete shared.zeusHistoryCleanup;
    vi.useRealTimers();
  }
});
