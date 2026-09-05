import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { RefusalDetails } from "@/lib/providers/types";

/** Timestamps are Unix milliseconds. IDs are ULIDs (sortable by creation). */

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull().default("New chat"),
    modelId: text("model_id").notNull(),
    systemPrompt: text("system_prompt"),
    effort: text("effort"),
    maxOutputTokens: integer("max_output_tokens"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    /** Null unless soft-deleted; hard-deleted by a cleanup job after 30 days. */
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("conversations_updated_at_idx").on(t.updatedAt)],
);

export const MESSAGE_STATUSES = ["complete", "streaming", "interrupted", "error", "refused"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** 0..n within a conversation; the provider payload is rebuilt in seq order. */
    seq: integer("seq").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull().default(""),
    /** Summarized thinking, when the model returned one. */
    thinking: text("thinking"),
    /** Null on user rows. */
    modelId: text("model_id"),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    stopReason: text("stop_reason"),
    errorCode: text("error_code"),
    refusalDetails: text("refusal_details", { mode: "json" }).$type<RefusalDetails>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    /** Computed at write time from registry prices; never recomputed. */
    costUsd: real("cost_usd"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("messages_conversation_seq_idx").on(t.conversationId, t.seq)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  /** JSON-encoded value. */
  value: text("value").notNull(),
});
