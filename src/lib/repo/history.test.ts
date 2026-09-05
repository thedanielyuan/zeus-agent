import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { getModel, DEFAULT_MODEL_ID } from "@/lib/models/registry";
import { TurnBody } from "@/lib/chat/request";
import { toUiMessage } from "@/lib/chat/ui-message";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  claimTitle,
  createConversation,
  deleteConversation,
  getConversation,
  getConversationDetail,
  listConversations,
  purgeDeletedConversations,
  RETENTION_MS,
  updateConversation,
} from "./conversations";
import { getSettings, updateSettings } from "./settings";
import { searchConversations } from "./search";
import { finishTurn, getMessages, prepareTurn, saveProgress } from "./messages";

const databases: Db[] = [];
function open(file = ":memory:") {
  const db = openDb(file);
  databases.push(db);
  return db;
}
function close(db: Db) {
  (db as Db & { $client: Database.Database }).$client.close();
  databases.splice(databases.indexOf(db), 1);
}
afterEach(() => {
  for (const db of [...databases]) close(db);
  vi.useRealTimers();
});
function message(db: Db, id: string, content: string, createdAt = 10, seq = 0) {
  return db
    .insert(messages)
    .values({
      id: ulid(),
      conversationId: id,
      seq,
      role: "user",
      content,
      status: "complete",
      createdAt,
    })
    .returning()
    .get();
}

describe("durable history and preferences", () => {
  it("creates chats from saved defaults and patches without touching messages", () => {
    const db = open();
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
    updateSettings(db, {
      defaultSystemPrompt: "Be concise.",
      defaultEffort: "low",
      theme: "light",
      hideThinking: true,
    });
    const row = createConversation(db);
    expect(row).toMatchObject({
      modelId: DEFAULT_MODEL_ID,
      systemPrompt: "Be concise.",
      effort: "low",
      deletedAt: null,
    });
    const stored = message(db, row.id, "Immutable original.");
    updateConversation(db, row.id, {
      title: "Renamed",
      effort: "max",
      systemPrompt: "Explain examples.",
      maxOutputTokens: 2048,
    });
    expect(getMessages(db, row.id)).toEqual([stored]);
    expect(getConversationDetail(db, row.id).conversation).toMatchObject({
      title: "Renamed",
      titleStatus: "manual",
      effort: "max",
      maxOutputTokens: 2048,
    });
    expect(createConversation(db).effort).toBe("low");
  });

  it("paginates newest first with a deterministic tie-break and omits deleted rows", () => {
    const db = open();
    const rows = Array.from({ length: 5 }, () => createConversation(db));
    db.update(conversations).set({ updatedAt: 100 }).run();
    deleteConversation(db, rows[1].id);
    const expected = rows
      .filter((r) => r.id !== rows[1].id)
      .map((r) => r.id)
      .sort()
      .reverse();
    expect(
      [...listConversations(db, 2), ...listConversations(db, 2, 2)].map(
        (r) => r.id,
      ),
    ).toEqual(expected);
    expect(getConversation(db, rows[1].id)).toBeUndefined();
    expect(() => getConversationDetail(db, rows[1].id)).toThrow("not found");
  });

  it("blocks settings/rename/delete during a turn and preserves the claim", () => {
    const db = open();
    const input = TurnBody.parse({
      conversationId: ulid(),
      userMessageId: ulid(),
      modelId: DEFAULT_MODEL_ID,
      content: "Hello",
    });
    prepareTurn(db, input, getModel(DEFAULT_MODEL_ID)!);
    for (const action of [
      () => deleteConversation(db, input.conversationId),
      () =>
        updateConversation(db, input.conversationId, { title: "New title" }),
      () => updateConversation(db, input.conversationId, { effort: "max" }),
    ]) {
      expect(action).toThrow("still running");
    }
    expect(getMessages(db, input.conversationId).at(-1)?.status).toBe(
      "streaming",
    );
    expect(getConversation(db, input.conversationId)?.title).toBe("Hello");
  });

  it("does not overwrite a manual title when sending the first message", () => {
    const db = open();
    const row = createConversation(db);
    updateConversation(db, row.id, { title: "New chat" });
    prepareTurn(
      db,
      TurnBody.parse({
        conversationId: row.id,
        userMessageId: ulid(),
        modelId: row.modelId,
        content: "A replacement title?",
      }),
      getModel(row.modelId)!,
    );
    expect(getConversation(db, row.id)).toMatchObject({
      title: "New chat",
      titleStatus: "manual",
    });
  });

  it("reopens settings, final metadata, partial checkpoints and crashed title claims", () => {
    const directory = mkdtempSync(join(tmpdir(), "zeus-history-"));
    try {
      const file = join(directory, "history.db");
      const db = open(file);
      updateSettings(db, {
        theme: "light",
        hideThinking: true,
        defaultEffort: "xhigh",
        defaultSystemPrompt: "Saved across restarts.",
      });
      const row = createConversation(db);
      const input = TurnBody.parse({
        conversationId: row.id,
        userMessageId: ulid(),
        modelId: row.modelId,
        content: "Remember this.",
      });
      const turn = prepareTurn(db, input, getModel(row.modelId)!);
      finishTurn(db, row.id, turn.assistantMessageId, {
        content: "A final reply.",
        thinking: "Summary.",
        status: "complete",
        stopReason: "max_tokens",
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          cacheReadTokens: 4,
          cacheWriteTokens: 5,
        },
      });
      claimTitle(db, row.id);
      const next = prepareTurn(
        db,
        { ...input, userMessageId: ulid(), content: "Continue." },
        getModel(row.modelId)!,
      );
      saveProgress(
        db,
        next.assistantMessageId,
        "Durable partial",
        "Partial thinking",
      );
      close(db);
      const reopened = open(file);
      expect(getSettings(reopened)).toMatchObject({
        theme: "light",
        hideThinking: true,
        defaultSystemPrompt: "Saved across restarts.",
      });
      const detail = getConversationDetail(reopened, row.id);
      expect(detail.conversation.titleStatus).toBe("failed");
      expect(toUiMessage(detail.messages[1])).toMatchObject({
        content: "A final reply.",
        thinking: "Summary.",
        stopReason: "max_tokens",
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          cacheReadTokens: 4,
          cacheWriteTokens: 5,
        },
      });
      expect(toUiMessage(detail.messages[3])).toMatchObject({
        content: "Durable partial",
        status: "interrupted",
        usage: undefined,
      });
      expect(searchConversations(reopened, "durable partial")[0]?.id).toBe(
        row.id,
      );
    } finally {
      for (const db of [...databases]) close(db);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains deleted rows for exactly 30 days, then cascades records and FTS entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const db = open();
    const expired = createConversation(db);
    const live = createConversation(db);
    message(db, expired.id, "Needle retained");
    message(db, live.id, "Needle visible");
    deleteConversation(db, expired.id);
    expect(searchConversations(db, "Needle").map((r) => r.id)).toEqual([
      live.id,
    ]);
    expect(purgeDeletedConversations(db, Date.now() + RETENTION_MS - 1)).toBe(
      0,
    );
    expect(getMessages(db, expired.id)).toHaveLength(1);
    expect(purgeDeletedConversations(db, Date.now() + RETENTION_MS)).toBe(1);
    expect(getMessages(db, expired.id)).toHaveLength(0);
    expect(purgeDeletedConversations(db, Date.now() + RETENTION_MS)).toBe(0);
    expect(getConversation(db, live.id)).toBeDefined();
    expect(
      db.all(
        sql`SELECT rowid FROM message_text_fts WHERE message_text_fts MATCH '"retained"'`,
      ),
    ).toEqual([]);
    db.run(
      sql`INSERT INTO message_text_fts(message_text_fts, rank) VALUES ('integrity-check', 1)`,
    );
    db.run(
      sql`INSERT INTO conversation_titles_fts(conversation_titles_fts, rank) VALUES ('integrity-check', 1)`,
    );
  });
});

describe("history search", () => {
  it.each([
    "HELLO",
    "ell",
    "he",
    '"quoted"',
    "OR *",
    "100%_",
    "ÉcO",
    "é",
    "你好",
    "你好世",
    "'; DROP TABLE messages; --",
  ])("treats %j as literal case-insensitive text", (query) => {
    const db = open();
    const row = createConversation(db);
    message(
      db,
      row.id,
      'Hello "quoted" OR * 100%_ ÉCOLE 你好世界 \'; DROP TABLE messages; --',
    );
    expect(searchConversations(db, query).map((r) => r.id)).toEqual([row.id]);
    expect(getMessages(db, row.id)).toHaveLength(1);
  });

  it("ranks by the most recent matching message or title and deduplicates before pagination", () => {
    const db = open();
    const old = createConversation(db);
    const recent = createConversation(db);
    const title = createConversation(db);
    message(db, old.id, "needle", 1);
    message(db, old.id, "needle twice", 2, 1);
    message(db, old.id, "unrelated update", 100, 2);
    message(db, recent.id, "NEEDLE recent", 10);
    db.update(conversations)
      .set({ title: "Needle title", titleUpdatedAt: 20 })
      .where(eq(conversations.id, title.id))
      .run();
    expect(searchConversations(db, "needle", 2).map((r) => r.id)).toEqual([
      title.id,
      recent.id,
    ]);
    expect(searchConversations(db, "needle", 2, 2).map((r) => r.id)).toEqual([
      old.id,
    ]);
    updateConversation(db, title.id, { title: "Gone" });
    expect(searchConversations(db, "needle").map((r) => r.id)).toEqual([
      recent.id,
      old.id,
    ]);
    expect(searchConversations(db, "gone")[0]?.id).toBe(title.id);
  });

  it("indexes checkpoint changes and removes the Retry suffix from search", () => {
    const db = open();
    const input = TurnBody.parse({
      conversationId: ulid(),
      userMessageId: ulid(),
      modelId: DEFAULT_MODEL_ID,
      content: "First question",
    });
    const model = getModel(DEFAULT_MODEL_ID)!;
    const turn = prepareTurn(db, input, model);
    saveProgress(
      db,
      turn.assistantMessageId,
      "oldphrase",
      "Not indexed thinking",
    );
    expect(searchConversations(db, "oldphrase")).toHaveLength(1);
    expect(searchConversations(db, "indexed thinking")).toHaveLength(0);
    finishTurn(db, input.conversationId, turn.assistantMessageId, {
      content: "newphrase",
      thinking: "",
      status: "interrupted",
      stopReason: "cancelled",
    });
    expect(searchConversations(db, "oldphrase")).toHaveLength(0);
    expect(searchConversations(db, "newphrase")).toHaveLength(1);
    prepareTurn(db, { ...input, action: "retry" }, model);
    expect(searchConversations(db, "newphrase")).toHaveLength(0);
    expect(searchConversations(db, "first question")).toHaveLength(1);
  });
});
