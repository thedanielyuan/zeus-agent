import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { ChatError } from "@/lib/errors";
import { getModel } from "@/lib/models/registry";
import {
  ConversationPatch,
  conversationDefaults,
  type ConversationSettings,
} from "@/lib/settings";
import { getMessages } from "./messages";
import { getSettings, updateSettings } from "./settings";

export type Conversation = typeof conversations.$inferSelect;
export const summaryFields = {
  id: conversations.id,
  title: conversations.title,
  titleStatus: conversations.titleStatus,
  updatedAt: conversations.updatedAt,
};
export type ConversationSummary = Pick<
  Conversation,
  keyof typeof summaryFields
>;

export function listConversations(db: Db, limit = 100, offset = 0) {
  return db
    .select(summaryFields)
    .from(conversations)
    .where(isNull(conversations.deletedAt))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(limit)
    .offset(offset)
    .all();
}

export function getConversation(db: Db, id: string) {
  return db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), isNull(conversations.deletedAt)))
    .get();
}

export function requireConversation(db: Db, id: string) {
  const row = getConversation(db, id);
  if (!row)
    throw new ChatError("not_found", "Conversation not found.", false, 404);
  return row;
}

export function getConversationDetail(db: Db, id: string) {
  return db.transaction((tx) => ({
    conversation: requireConversation(tx, id),
    messages: getMessages(tx, id),
  }));
}
export type ConversationDetail = ReturnType<typeof getConversationDetail>;

export function assertIdle(db: Db, id: string) {
  if (
    db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.conversationId, id), eq(messages.status, "streaming")),
      )
      .get()
  ) {
    throw new ChatError(
      "conflict",
      "A response is still running. Wait for it to finish.",
      true,
      409,
    );
  }
}

export function createConversation(
  db: Db,
  patch: Partial<ConversationSettings> = {},
) {
  return db.transaction(
    (tx) => {
      const defaults = conversationDefaults(getSettings(tx));
      const values = { ...defaults, ...patch };
      const model = getModel(values.modelId);
      if (!model)
        throw new ChatError("unknown_model", "Unknown model.", false, 400);
      const now = Date.now();
      const row = tx
        .insert(conversations)
        .values({
          id: ulid(),
          ...values,
          maxOutputTokens: Math.min(
            values.maxOutputTokens,
            model.maxOutputTokens,
          ),
          createdAt: now,
          updatedAt: now,
          titleUpdatedAt: now,
        })
        .returning()
        .get();
      updateSettings(tx, { defaultModelId: row.modelId });
      return row;
    },
    { behavior: "immediate" },
  );
}

export function updateConversation(
  db: Db,
  id: string,
  input: Partial<ConversationSettings> & { title?: string },
) {
  const patch = ConversationPatch.parse(input);
  return db.transaction(
    (tx) => {
      const row = requireConversation(tx, id);
      assertIdle(tx, id);
      const model = getModel(patch.modelId ?? row.modelId)!;
      if (
        patch.modelId &&
        patch.modelId !== row.modelId &&
        getMessages(tx, id).length
      ) {
        throw new ChatError(
          "conflict",
          "Start a new chat to use a different model.",
          false,
          409,
        );
      }
      const maxOutputTokens =
        patch.maxOutputTokens ?? row.maxOutputTokens ?? 64_000;
      if (maxOutputTokens > model.maxOutputTokens) {
        throw new ChatError(
          "bad_request",
          "Response limit exceeds the model's output limit.",
          false,
          400,
        );
      }
      const now = Date.now();
      const updated = tx
        .update(conversations)
        .set({
          ...patch,
          maxOutputTokens,
          updatedAt: now,
          ...(patch.title !== undefined
            ? { titleStatus: "manual" as const, titleUpdatedAt: now }
            : {}),
        })
        .where(eq(conversations.id, id))
        .returning()
        .get()!;
      if (patch.modelId) updateSettings(tx, { defaultModelId: patch.modelId });
      return updated;
    },
    { behavior: "immediate" },
  );
}

export function deleteConversation(db: Db, id: string) {
  return db.transaction(
    (tx) => {
      requireConversation(tx, id);
      assertIdle(tx, id);
      tx.update(conversations)
        .set({ deletedAt: Date.now() })
        .where(eq(conversations.id, id))
        .run();
    },
    { behavior: "immediate" },
  );
}

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export function purgeDeletedConversations(db: Db, now = Date.now()) {
  return db
    .delete(conversations)
    .where(lte(conversations.deletedAt, now - RETENTION_MS))
    .run().changes;
}

/** Claim once, before provider I/O. Renaming or deleting wins over late title results. */
export function claimTitle(db: Db, id: string) {
  return db.transaction(
    (tx) => {
      const row = getConversation(tx, id);
      if (!row || row.titleStatus !== "pending") return;
      const history = getMessages(tx, id);
      const assistant = history.find(
        (m) =>
          m.role === "assistant" && m.status === "complete" && m.content.trim(),
      );
      const user = history.find((m) => m.role === "user");
      if (!assistant || !user) return;
      const claimed = tx
        .update(conversations)
        .set({ titleStatus: "generating" })
        .where(
          and(
            eq(conversations.id, id),
            eq(conversations.titleStatus, "pending"),
          ),
        )
        .run();
      if (!claimed.changes) return;
      return {
        conversation: row,
        user: user.content,
        assistant: assistant.content,
      };
    },
    { behavior: "immediate" },
  );
}

export function finishTitle(db: Db, id: string, title?: string) {
  db.update(conversations)
    .set(
      title
        ? { title, titleStatus: "generated", titleUpdatedAt: Date.now() }
        : { titleStatus: "failed" },
    )
    .where(
      and(
        eq(conversations.id, id),
        isNull(conversations.deletedAt),
        eq(conversations.titleStatus, "generating"),
      ),
    )
    .run();
}

export function sweepTitleClaims(db: Db) {
  // An interrupted or not-yet-started title is not billed again after restart.
  db.update(conversations)
    .set({ titleStatus: "failed" })
    .where(sql`title_status = 'generating' OR (title_status = 'pending' AND EXISTS (
      SELECT 1 FROM messages WHERE conversation_id = conversations.id
        AND role = 'assistant' AND status = 'complete'
    ))`)
    .run();
}
