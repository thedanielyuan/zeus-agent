import { describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { openDb } from "@/lib/db/client";
import { messages } from "@/lib/db/schema";
import type {
  ChatEvent,
  ChatProvider,
  ChatRequest,
} from "@/lib/providers/types";
import {
  claimTitle,
  createConversation,
  deleteConversation,
  getConversation,
  updateConversation,
  sweepTitleClaims,
} from "@/lib/repo/conversations";
import { getMessages } from "@/lib/repo/messages";
import { searchConversations } from "@/lib/repo/search";
import { generateTitle, TITLE_SYSTEM } from "./title";

function setup() {
  const db = openDb(":memory:");
  const row = createConversation(db);
  db.insert(messages)
    .values([
      {
        id: ulid(),
        conversationId: row.id,
        seq: 0,
        role: "user",
        content: "Explain SQLite",
        status: "complete",
        createdAt: 1,
      },
      {
        id: ulid(),
        conversationId: row.id,
        seq: 1,
        role: "assistant",
        content: "A local database.",
        status: "complete",
        createdAt: 2,
      },
    ])
    .run();
  return { db, id: row.id };
}
function fixture(events: ChatEvent[], during?: () => void) {
  const requests: ChatRequest[] = [];
  const provider: ChatProvider = {
    vendor: "anthropic",
    async *stream(request) {
      requests.push(request);
      during?.();
      yield* events;
    },
  };
  return { provider, requests };
}
const happy: ChatEvent[] = [
  { type: "text_delta", text: '"SQLite ' },
  { type: "text_delta", text: 'explained"\n' },
  { type: "stop", reason: "end" },
];

describe("automatic titles", () => {
  it("abandons a title left pending after a saved reply when the process restarts", () => {
    const { db, id } = setup();
    sweepTitleClaims(db);
    expect(getConversation(db, id)?.titleStatus).toBe("failed");
    expect(claimTitle(db, id)).toBeUndefined();
  });
  it("makes one bounded low-effort call on the same model, saves the title and leaves messages untouched", async () => {
    const { db, id } = setup();
    const before = getMessages(db, id);
    const fake = fixture(happy);
    await Promise.all([
      generateTitle(id, { db, provider: fake.provider }),
      generateTitle(id, { db, provider: fake.provider }),
    ]);
    await generateTitle(id, { db, provider: fake.provider });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      model: { id: getConversation(db, id)!.modelId },
      system: TITLE_SYSTEM,
      effort: "low",
      maxOutputTokens: 128,
      thinkingDisplay: "omitted",
    });
    expect(fake.requests[0].messages).toHaveLength(1);
    expect(getConversation(db, id)).toMatchObject({
      title: "SQLite explained",
      titleStatus: "generated",
    });
    expect(getMessages(db, id)).toEqual(before);
    expect(searchConversations(db, "explained")[0]?.id).toBe(id);
  });

  it.each(["manual", "deleted"])(
    "lets a %s change win over a late title",
    async (change) => {
      const { db, id } = setup();
      const fake = fixture(happy, () =>
        change === "manual"
          ? updateConversation(db, id, { title: "My own title" })
          : deleteConversation(db, id),
      );
      await generateTitle(id, { db, provider: fake.provider });
      if (change === "manual")
        expect(getConversation(db, id)).toMatchObject({
          title: "My own title",
          titleStatus: "manual",
        });
      else expect(getConversation(db, id)).toBeUndefined();
    },
  );

  it.each([
    [
      {
        type: "error",
        code: "overloaded",
        message: "fixture",
        retryable: true,
      },
    ],
    [{ type: "text_delta", text: "Incomplete" }],
    [{ type: "stop", reason: "refusal" }],
    [
      { type: "text_delta", text: "Cut off" },
      { type: "stop", reason: "max_tokens" },
    ],
    [{ type: "stop", reason: "end" }],
  ] satisfies ChatEvent[][])(
    "keeps the fallback on failure or incomplete output: %j",
    async (...events) => {
      const { db, id } = setup();
      await generateTitle(id, { db, provider: fixture(events).provider });
      expect(getConversation(db, id)).toMatchObject({
        title: "New chat",
        titleStatus: "failed",
      });
    },
  );

  it("bounds hung providers, including ones that ignore abort", async () => {
    vi.useFakeTimers();
    try {
      const { db, id } = setup();
      let signal: AbortSignal | undefined;
      const provider: ChatProvider = {
        vendor: "anthropic",
        stream(_request, nextSignal) {
          signal = nextSignal;
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => new Promise(() => {}),
            }),
          };
        },
      };
      const task = generateTitle(id, { db, provider, timeoutMs: 20 });
      await vi.advanceTimersByTimeAsync(20);
      await task;
      expect(signal?.aborted).toBe(true);
      expect(getConversation(db, id)?.titleStatus).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a completed textual reply and never claims empty or manually named chats", () => {
    const db = openDb(":memory:");
    const row = createConversation(db);
    expect(claimTitle(db, row.id)).toBeUndefined();
    updateConversation(db, row.id, { title: "My chat" });
    expect(claimTitle(db, row.id)).toBeUndefined();
  });
});
