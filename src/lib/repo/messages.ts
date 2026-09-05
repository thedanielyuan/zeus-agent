import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { TurnInput } from "@/lib/chat/request";
import type { Db } from "@/lib/db/client";
import { conversations, messages, type MessageStatus } from "@/lib/db/schema";
import { ChatError } from "@/lib/errors";
import type {
  ChatMessage,
  ModelSpec,
  RefusalDetails,
  StopReason,
  Usage,
} from "@/lib/providers/types";

export function getMessages(db: Db, conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.seq))
    .all();
}

/** Claim one turn and rebuild its context in one write transaction, before provider I/O. */
export function prepareTurn(db: Db, input: TurnInput, model: ModelSpec) {
  return db.transaction(
    (tx) => {
      const now = Date.now();
      const conversation = tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .get();
      if (conversation?.deletedAt != null) {
        throw new ChatError(
          "conflict",
          "This conversation was deleted. Start a new chat.",
          false,
          409,
        );
      }
      if (conversation && conversation.modelId !== model.id) {
        throw new ChatError(
          "conflict",
          "Start a new chat to use a different model.",
          false,
          409,
        );
      }
      const rows = getMessages(tx, input.conversationId);
      if (rows.some((row) => row.status === "streaming")) {
        throw new ChatError(
          "conflict",
          "A response is still running. Wait for it to finish, then retry.",
          true,
          409,
        );
      }
      const existing = tx
        .select()
        .from(messages)
        .where(eq(messages.id, input.userMessageId))
        .get();
      if (
        existing &&
        (input.action !== "retry" ||
          existing.conversationId !== input.conversationId ||
          existing.role !== "user" ||
          existing.content !== input.content ||
          rows.findLast((row) => row.role === "user")?.id !== existing.id)
      ) {
        throw new ChatError(
          "conflict",
          "Only the latest user message can be retried.",
          false,
          409,
        );
      }

      const settings = {
        systemPrompt: input.system || null,
        effort: input.effort,
        maxOutputTokens: Math.min(
          input.maxOutputTokens ?? 64_000,
          model.maxOutputTokens,
        ),
        updatedAt: now,
      };
      if (!conversation) {
        tx.insert(conversations)
          .values({
            id: input.conversationId,
            modelId: model.id,
            createdAt: now,
            ...settings,
          })
          .run();
      } else {
        tx.update(conversations)
          .set(settings)
          .where(eq(conversations.id, conversation.id))
          .run();
      }

      // Retry replaces only the suffix after the last user row, never its content.
      // If the original request failed before any write, the same IDs create it now.
      const userSeq = existing?.seq ?? (rows.at(-1)?.seq ?? -1) + 1;
      if (existing) {
        tx.delete(messages)
          .where(
            and(
              eq(messages.conversationId, input.conversationId),
              gt(messages.seq, userSeq),
            ),
          )
          .run();
      } else {
        tx.insert(messages)
          .values({
            id: input.userMessageId,
            conversationId: input.conversationId,
            seq: userSeq,
            role: "user",
            content: input.content,
            status: "complete",
            createdAt: now,
          })
          .run();
      }
      const assistantMessageId = ulid();
      tx.insert(messages)
        .values({
          id: assistantMessageId,
          conversationId: input.conversationId,
          seq: userSeq + 1,
          role: "assistant",
          modelId: model.id,
          status: "streaming",
          createdAt: now,
        })
        .run();

      const history: ChatMessage[] = getMessages(tx, input.conversationId)
        .filter(
          (row) =>
            (row.status === "complete" || row.status === "interrupted") &&
            row.content.length > 0,
        )
        .map(({ role, content }) => ({ role, content }));
      return { assistantMessageId, history, settings };
    },
    { behavior: "immediate" },
  );
}

export function saveProgress(
  db: Db,
  id: string,
  content: string,
  thinking: string,
) {
  const result = db
    .update(messages)
    .set({ content, thinking: thinking || null })
    .where(and(eq(messages.id, id), eq(messages.status, "streaming")))
    .run();
  if (result.changes !== 1)
    throw new Error("Streaming row is no longer writable");
}

export interface TurnResult {
  content: string;
  thinking: string;
  status: Exclude<MessageStatus, "streaming">;
  stopReason: StopReason;
  errorCode?: string;
  refusalDetails?: RefusalDetails;
  usage?: Usage;
}

export function finishTurn(
  db: Db,
  conversationId: string,
  id: string,
  result: TurnResult,
) {
  db.transaction((tx) => {
    const usage = result.status === "interrupted" ? undefined : result.usage;
    const updated = tx
      .update(messages)
      .set({
        content: result.content,
        thinking: result.thinking || null,
        status: result.status,
        stopReason: result.stopReason,
        errorCode: result.errorCode ?? null,
        refusalDetails: result.refusalDetails ?? null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        cacheReadTokens: usage?.cacheReadTokens ?? null,
        cacheWriteTokens: usage?.cacheWriteTokens ?? null,
      })
      .where(and(eq(messages.id, id), eq(messages.status, "streaming")))
      .run();
    if (updated.changes !== 1)
      throw new Error("Streaming row is no longer writable");
    tx.update(conversations)
      .set({ updatedAt: Date.now() })
      .where(
        and(
          eq(conversations.id, conversationId),
          isNull(conversations.deletedAt),
        ),
      )
      .run();
  });
}

/** Only run when opening the process's database, never when reading an active chat. */
export function sweepStreamingRows(db: Db): number {
  return db
    .update(messages)
    .set({
      status: "interrupted",
      stopReason: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    })
    .where(eq(messages.status, "streaming"))
    .run().changes;
}
