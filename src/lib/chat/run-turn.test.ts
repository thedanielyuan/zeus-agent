import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, sweepStreamingRows, type Db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { ChatError } from "@/lib/errors";
import type {
  ChatEvent,
  ChatProvider,
  ChatRequest,
} from "@/lib/providers/types";
import { getMessages, saveProgress } from "@/lib/repo/messages";
import { TurnBody, type TurnInput } from "./request";
import { CHECKPOINT_MS, runTurn, TURN_TIMEOUT_MS } from "./run-turn";
import { toSSEStream } from "./sse";

const usage = {
  inputTokens: 12,
  outputTokens: 8,
  cacheReadTokens: 20,
  cacheWriteTokens: 5,
};
const happy: ChatEvent[] = [
  { type: "message_start", providerMessageId: "provider-1" },
  { type: "thinking_delta", text: "Plan." },
  { type: "text_delta", text: "Hello" },
  { type: "text_delta", text: " world." },
  { type: "usage", usage },
  { type: "stop", reason: "end" },
];
type Step = ChatEvent | { waitForAbort: true } | { throw: Error };
function fixture(steps: Step[] = happy) {
  const requests: ChatRequest[] = [];
  const signals: AbortSignal[] = [];
  const provider: ChatProvider = {
    vendor: "anthropic",
    async *stream(request, signal) {
      requests.push(structuredClone(request));
      signals.push(signal);
      for (const step of steps) {
        if ("throw" in step) throw step.throw;
        if ("waitForAbort" in step) {
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
          return;
        }
        yield step;
      }
    },
  };
  return { provider, requests, signals };
}
function input(overrides: Partial<TurnInput> = {}): TurnInput {
  return TurnBody.parse({
    conversationId: ulid(),
    userMessageId: ulid(),
    content: "Hi",
    modelId: "claude-sonnet-5",
    system: "You are terse.",
    ...overrides,
  });
}
const active: ReturnType<typeof runTurn>[] = [];
function start(
  db: Db,
  request: TurnInput,
  provider: ChatProvider,
  signal = new AbortController().signal,
) {
  const turn = runTurn(request, { db, provider, signal });
  active.push(turn);
  return turn;
}
async function collect(events: AsyncIterable<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}
afterEach(() => {
  for (const turn of active.splice(0)) turn.cancel();
  vi.useRealTimers();
});

describe("durable chat turns", () => {
  it("writes both rows before provider I/O and commits final content before usage/stop", async () => {
    const db = openDb(":memory:");
    const request = input();
    const fake = fixture();
    const turn = start(db, request, fake.provider);
    expect(fake.requests).toHaveLength(0);
    expect(getMessages(db, request.conversationId)).toMatchObject([
      {
        id: request.userMessageId,
        role: "user",
        content: "Hi",
        status: "complete",
        seq: 0,
      },
      {
        id: turn.assistantMessageId,
        role: "assistant",
        content: "",
        status: "streaming",
        seq: 1,
      },
    ]);
    const actual = [];
    for await (const event of turn.events) {
      if (event.type === "usage" || event.type === "stop") {
        expect(getMessages(db, request.conversationId).at(-1)).toMatchObject({
          status: "complete",
          content: "Hello world.",
          thinking: "Plan.",
          stopReason: "end",
          modelId: "claude-sonnet-5",
          ...usage,
          costUsd: null,
        });
      }
      actual.push(event);
    }
    expect(actual).toEqual(happy);
    expect(fake.requests[0]).toMatchObject({
      effort: "high",
      maxOutputTokens: 64_000,
      thinkingDisplay: "summarized",
    });
    expect(() =>
      saveProgress(db, turn.assistantMessageId, "changed", ""),
    ).toThrow();
  });

  it("checkpoints within 250 ms even when no next token arrives, then recovers a crashed row", async () => {
    vi.useFakeTimers();
    const db = openDb(":memory:");
    const request = input();
    const turn = start(
      db,
      request,
      fixture([
        { type: "thinking_delta", text: "Plan" },
        { type: "text_delta", text: "Partial" },
        { waitForAbort: true },
      ]).provider,
    );
    const iterator = turn.events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await vi.advanceTimersByTimeAsync(CHECKPOINT_MS - 1);
    expect(getMessages(db, request.conversationId).at(-1)?.content).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(getMessages(db, request.conversationId).at(-1)).toMatchObject({
      content: "Partial",
      thinking: "Plan",
      status: "streaming",
    });
    expect(sweepStreamingRows(db)).toBe(1);
    expect(getMessages(db, request.conversationId).at(-1)).toMatchObject({
      content: "Partial",
      thinking: "Plan",
      status: "interrupted",
      inputTokens: null,
    });
    turn.cancel();
    await iterator.return?.(undefined);
  });

  it.each(["signal", "reader"])(
    "flushes all partial text and null usage on %s cancellation",
    async (mode) => {
      const db = openDb(":memory:");
      const request = input();
      const fake = fixture([
        { type: "text_delta", text: "Partial" },
        { type: "usage", usage },
        { waitForAbort: true },
      ]);
      const abort = new AbortController();
      const turn = start(db, request, fake.provider, abort.signal);
      const reader = toSSEStream(turn.events, {
        onCancel: turn.cancel,
      }).getReader();
      await reader.read();
      if (mode === "signal") abort.abort();
      await reader.cancel();
      expect(fake.signals[0].aborted).toBe(true);
      expect(getMessages(db, request.conversationId).at(-1)).toMatchObject({
        content: "Partial",
        status: "interrupted",
        stopReason: "cancelled",
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      });
    },
  );

  it("cancels a claimed turn before any provider iteration", async () => {
    const db = openDb(":memory:");
    const request = input();
    const fake = fixture();
    const turn = start(db, request, fake.provider);
    turn.cancel();
    expect(getMessages(db, request.conversationId).at(-1)?.status).toBe(
      "interrupted",
    );
    expect(await collect(turn.events)).toEqual([
      { type: "stop", reason: "cancelled" },
    ]);
    expect(fake.requests).toHaveLength(0);
  });

  it("times out at 10 minutes even if the provider ignores abort", async () => {
    vi.useFakeTimers();
    const db = openDb(":memory:");
    const request = input();
    const provider: ChatProvider = {
      vendor: "anthropic",
      async *stream() {
        yield { type: "text_delta", text: "Partial" };
        await new Promise(() => {});
      },
    };
    const turn = start(db, request, provider);
    const output = collect(turn.events);
    await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS - 1);
    expect(getMessages(db, request.conversationId).at(-1)?.status).toBe(
      "streaming",
    );
    await vi.advanceTimersByTimeAsync(1);
    expect((await output).at(-1)).toMatchObject({
      type: "error",
      code: "timeout",
      retryable: true,
    });
    expect(getMessages(db, request.conversationId).at(-1)).toMatchObject({
      status: "interrupted",
      content: "Partial",
      errorCode: "timeout",
      inputTokens: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [
      {
        type: "stop",
        reason: "refusal",
        details: { category: "test", explanation: "Fixture refusal" },
      },
      "refused",
      "refusal",
      null,
    ],
    [{ type: "stop", reason: "max_tokens" }, "complete", "max_tokens", null],
    [
      { type: "stop", reason: "context_exceeded" },
      "complete",
      "context_exceeded",
      null,
    ],
    [
      { type: "error", code: "overloaded", message: "Busy", retryable: true },
      "error",
      "error",
      "overloaded",
    ],
    [
      { type: "error", code: "network", message: "Dropped", retryable: true },
      "interrupted",
      "error",
      "network",
    ],
  ] as const)(
    "persists terminal fixture %j",
    async (event, status, stopReason, errorCode) => {
      const db = openDb(":memory:");
      const request = input();
      const turn = start(
        db,
        request,
        fixture([{ type: "text_delta", text: "Partial" }, event]).provider,
      );
      expect((await collect(turn.events)).at(-1)).toEqual(event);
      expect(getMessages(db, request.conversationId).at(-1)).toMatchObject({
        content: "Partial",
        status,
        stopReason,
        errorCode,
        refusalDetails:
          event.type === "stop" && event.reason === "refusal"
            ? event.details
            : null,
      });
    },
  );

  it.each([false, true])(
    "keeps partial text on unexpected EOF/throw (%s) without leaking exception text",
    async (throws) => {
      const db = openDb(":memory:");
      const request = input();
      const turn = start(
        db,
        request,
        fixture([
          { type: "text_delta", text: "Partial" },
          ...(throws ? [{ throw: new Error("secret-key-and-prompt") }] : []),
        ]).provider,
      );
      const output = await collect(turn.events);
      expect(output.at(-1)).toMatchObject({
        type: "error",
        code: throws ? "unknown" : "network",
      });
      expect(JSON.stringify(output)).not.toContain("secret-key-and-prompt");
      expect(getMessages(db, request.conversationId).at(-1)).toMatchObject({
        content: "Partial",
        status: throws ? "error" : "interrupted",
      });
    },
  );

  it("Retry reuses the last user row and truncates only its assistant suffix", async () => {
    const db = openDb(":memory:");
    const first = input();
    await collect(start(db, first, fixture().provider).events);
    const second = input({
      conversationId: first.conversationId,
      content: "More",
    });
    const failed = start(
      db,
      second,
      fixture([
        { type: "error", code: "server", message: "Failed", retryable: true },
      ]).provider,
    );
    await collect(failed.events);
    const before = getMessages(db, first.conversationId);
    const fake = fixture();
    await collect(
      start(db, { ...second, action: "retry" }, fake.provider).events,
    );
    const after = getMessages(db, first.conversationId);
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(after).toHaveLength(4);
    expect(after[3].id).not.toBe(failed.assistantMessageId);
    expect(fake.requests[0].messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello world." },
      { role: "user", content: "More" },
    ]);
    expect(() =>
      start(db, { ...first, action: "retry" }, fake.provider),
    ).toThrow(ChatError);
    expect(getMessages(db, first.conversationId)).toEqual(after);
  });

  it("Continue appends after max_tokens and retains a byte-identical request prefix", async () => {
    const db = openDb(":memory:");
    const first = input();
    const fake = fixture([
      ...happy.slice(0, -1),
      { type: "stop", reason: "max_tokens" },
    ]);
    await collect(start(db, first, fake.provider).events);
    const before = getMessages(db, first.conversationId);
    await collect(
      start(
        db,
        input({ conversationId: first.conversationId, content: "Continue." }),
        fake.provider,
      ).events,
    );
    expect(getMessages(db, first.conversationId).slice(0, 2)).toEqual(before);
    const [a, b] = fake.requests;
    expect(JSON.stringify(b.messages.slice(0, a.messages.length))).toBe(
      JSON.stringify(a.messages),
    );
    expect(b.system).toBe(a.system);
    expect(b.model).toEqual(a.model);
    expect(b.messages.at(-1)).toEqual({ role: "user", content: "Continue." });
  });

  it("omits error/refused/empty replies, includes interrupted text, and preserves ordering", async () => {
    const db = openDb(":memory:");
    const conversationId = ulid();
    for (const reason of ["error", "refusal", "cancelled"] as const) {
      await collect(
        start(
          db,
          input({ conversationId, content: reason }),
          fixture([
            { type: "text_delta", text: reason },
            { type: "stop", reason },
          ]).provider,
        ).events,
      );
    }
    const fake = fixture();
    await collect(
      start(db, input({ conversationId, content: "Next" }), fake.provider)
        .events,
    );
    expect(fake.requests[0].messages).toEqual([
      { role: "user", content: "error" },
      { role: "user", content: "refusal" },
      { role: "user", content: "cancelled" },
      { role: "assistant", content: "cancelled" },
      { role: "user", content: "Next" },
    ]);
  });

  it("rejects overlapping turns and duplicate sends without modifying stored history", async () => {
    const db = openDb(":memory:");
    const request = input();
    const first = start(db, request, fixture().provider);
    expect(() =>
      start(
        db,
        input({ conversationId: request.conversationId }),
        fixture().provider,
      ),
    ).toThrow(ChatError);
    expect(getMessages(db, request.conversationId)).toHaveLength(2);
    await collect(first.events);
    const before = getMessages(db, request.conversationId);
    expect(() => start(db, request, fixture().provider)).toThrow(ChatError);
    expect(getMessages(db, request.conversationId)).toEqual(before);
  });

  it("recovers a Retry whose original request failed before persistence and rejects mismatched IDs", async () => {
    const db = openDb(":memory:");
    const request = input({ action: "retry" });
    await collect(start(db, request, fixture().provider).events);
    expect(getMessages(db, request.conversationId)).toHaveLength(2);
    expect(() =>
      start(db, { ...request, content: "tampered" }, fixture().provider),
    ).toThrow(ChatError);
    expect(() =>
      start(db, { ...request, conversationId: ulid() }, fixture().provider),
    ).toThrow(ChatError);
    expect(db.select().from(conversations).all()).toHaveLength(1);
  });

  it("rolls back partial turn creation when the assistant insert fails", () => {
    const db = openDb(":memory:");
    db.run(
      sql`CREATE TRIGGER fail_assistant BEFORE INSERT ON messages WHEN NEW.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'fixture'); END`,
    );
    expect(() => start(db, input(), fixture().provider)).toThrow();
    expect(db.select().from(conversations).all()).toEqual([]);
    expect(db.select().from(messages).all()).toEqual([]);
  });

  it("does not report success if the final write fails", async () => {
    const db = openDb(":memory:");
    const request = input();
    const turn = start(db, request, fixture().provider);
    db.run(
      sql`CREATE TRIGGER fail_finalize BEFORE UPDATE ON messages WHEN NEW.status = 'complete' BEGIN SELECT RAISE(ABORT, 'fixture'); END`,
    );
    const output = await collect(turn.events);
    expect(output.at(-1)).toMatchObject({ type: "error", code: "server" });
    expect(output.some((event) => event.type === "usage")).toBe(false);
    expect(output.some((event) => event.type === "stop")).toBe(false);
    expect(getMessages(db, request.conversationId).at(-1)?.status).toBe(
      "streaming",
    );
  });

  it("rejects a deleted conversation and an already aborted request before writes", () => {
    const db = openDb(":memory:");
    const request = input();
    const turn = start(db, request, fixture().provider);
    turn.cancel();
    db.update(conversations)
      .set({ deletedAt: Date.now() })
      .where(eq(conversations.id, request.conversationId))
      .run();
    expect(() =>
      start(
        db,
        input({ conversationId: request.conversationId }),
        fixture().provider,
      ),
    ).toThrow(ChatError);
    const abort = new AbortController();
    abort.abort();
    expect(() => start(db, input(), fixture().provider, abort.signal)).toThrow(
      ChatError,
    );
    expect(db.select().from(conversations).all()).toHaveLength(1);
  });

  it("reopens committed messages and recovers unfinished checkpoints from disk", async () => {
    const directory = mkdtempSync(join(tmpdir(), "zeus-m1-"));
    try {
      const file = join(directory, "chat.db");
      const db = openDb(file);
      const request = input();
      await collect(start(db, request, fixture().provider).events);
      const unfinished = start(
        db,
        input({ conversationId: request.conversationId }),
        fixture().provider,
      );
      saveProgress(db, unfinished.assistantMessageId, "Checkpoint", "Thought");
      const reopened = openDb(file);
      const rows = getMessages(reopened, request.conversationId);
      expect(rows[1]).toMatchObject({
        content: "Hello world.",
        status: "complete",
      });
      expect(rows.at(-1)).toMatchObject({
        content: "Checkpoint",
        thinking: "Thought",
        status: "interrupted",
      });
      unfinished.cancel();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
