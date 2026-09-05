import { ulid } from "ulid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, openDb, type Db } from "@/lib/db/client";
import { messages } from "@/lib/db/schema";
import {
  createConversation,
  getConversation,
  getConversationDetail,
} from "@/lib/repo/conversations";
import { getSettings } from "@/lib/repo/settings";
import { DEFAULT_MODEL_ID } from "@/lib/models/registry";
import { MAX_BODY_BYTES } from "@/lib/http";
import { GET, POST } from "./route";
import { GET as detail, PATCH, DELETE } from "./[id]/route";
import { GET as download } from "./[id]/export/route";
import { GET as settings, PATCH as patchSettings } from "../settings/route";

vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<typeof import("@/lib/db/client")>()),
  getDb: vi.fn(),
}));
let db: Db;
beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(":memory:");
  vi.mocked(getDb).mockReturnValue(db);
});
function request(
  method = "GET",
  body?: unknown,
  suffix = "",
  headers?: HeadersInit,
) {
  return new Request(`http://localhost:3000/api/conversations${suffix}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      ...headers,
    },
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("history and settings APIs", () => {
  it("creates from global defaults, lists summaries and reloads a saved rename/settings change", async () => {
    expect(
      (
        await patchSettings(
          request("PATCH", {
            defaultEffort: "low",
            defaultSystemPrompt: "Persist me",
            theme: "light",
            hideThinking: true,
          }),
        )
      ).status,
    ).toBe(200);
    const response = await POST(request("POST", {}));
    expect(response.status).toBe(201);
    const row = await response.json();
    expect(row).toMatchObject({
      effort: "low",
      systemPrompt: "Persist me",
      modelId: DEFAULT_MODEL_ID,
    });
    expect(
      (
        await PATCH(
          request("PATCH", { title: "Durable title", maxOutputTokens: 2048 }),
          context(row.id),
        )
      ).status,
    ).toBe(200);
    const loaded = await detail(request(), context(row.id));
    expect(loaded.headers.get("cache-control")).toBe("no-store");
    expect(await loaded.json()).toMatchObject({
      conversation: { title: "Durable title", maxOutputTokens: 2048 },
      messages: [],
    });
    const list = await (await GET(request())).json();
    expect(list).toMatchObject({
      hasMore: false,
      conversations: [{ id: row.id, title: "Durable title" }],
    });
    expect(list.conversations[0]).not.toHaveProperty("systemPrompt");
    expect(await (await settings(request())).json()).toMatchObject({
      theme: "light",
      hideThinking: true,
    });
  });

  it("searches saved message contents and paginates at the conversation level", async () => {
    const ids = [];
    for (let index = 0; index < 3; index++) {
      const row = createConversation(db);
      ids.push(row.id);
      db.insert(messages)
        .values({
          id: ulid(),
          conversationId: row.id,
          seq: 0,
          role: "user",
          content: "database query",
          status: "complete",
          createdAt: index,
        })
        .run();
    }
    const first = await (
      await GET(request("GET", undefined, "?q=DATABASE&limit=2"))
    ).json();
    expect(first.hasMore).toBe(true);
    expect(first.conversations.map((r: { id: string }) => r.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    const second = await (
      await GET(request("GET", undefined, "?q=DATABASE&limit=2&offset=2"))
    ).json();
    expect(second).toMatchObject({
      hasMore: false,
      conversations: [{ id: ids[0] }],
    });
  });

  it.each([
    POST,
    (r: Request) => PATCH(r, context(ulid())),
    (r: Request) => DELETE(r, context(ulid())),
    patchSettings,
  ])(
    "rejects cross-site mutations before opening the database",
    async (handler) => {
      const response = await handler(
        request("POST", {}, "", {
          "sec-fetch-site": "cross-site",
          origin: "https://example.com",
        }),
      );
      expect(response.status).toBe(403);
      expect(getDb).not.toHaveBeenCalled();
    },
  );

  it.each([
    { modelId: "invented-model" },
    { effort: "extreme" },
    { maxOutputTokens: 0 },
    { maxOutputTokens: 1.5 },
    { systemPrompt: "x".repeat(100_001) },
    { apiKey: "not-a-real-key" },
  ])("rejects invalid conversation creation", async (value) => {
    expect((await POST(request("POST", value))).status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects empty/unknown patches and invalid model limits without writing", async () => {
    const row = createConversation(db);
    for (const value of [
      {},
      { title: "   " },
      { deletedAt: 1 },
      { maxOutputTokens: 999999 },
      { modelId: "invented" },
    ]) {
      expect(
        (await PATCH(request("PATCH", value), context(row.id))).status,
      ).toBe(400);
      expect(getConversation(db, row.id)).toEqual(row);
    }
    for (const value of [
      {},
      { theme: "system" },
      { hideThinking: "true" },
      { defaultModelId: "invented" },
    ]) {
      expect((await patchSettings(request("PATCH", value))).status).toBe(400);
    }
    expect(getSettings(db).theme).toBe("dark");
  });

  it.each([
    "?limit=0",
    "?offset=-1",
    "?limit=101",
    "?q=%00",
    `?q=${"x".repeat(201)}`,
    "?unknown=1",
  ])("rejects invalid search options: %s", async (suffix) => {
    expect((await GET(request("GET", undefined, suffix))).status).toBe(400);
  });

  it("enforces the body byte limit and redacts unexpected storage errors", async () => {
    expect(
      (
        await POST(
          request("POST", { systemPrompt: "x".repeat(MAX_BODY_BYTES) }),
        )
      ).status,
    ).toBe(413);
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("secret fixture credentials");
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });

  it("returns 404 for missing/deleted chats on every detail, write and export path", async () => {
    const row = createConversation(db);
    expect((await DELETE(request("DELETE"), context(row.id))).status).toBe(204);
    for (const id of [row.id, ulid()]) {
      expect((await detail(request(), context(id))).status).toBe(404);
      expect((await download(request(), context(id))).status).toBe(404);
      expect(
        (await PATCH(request("PATCH", { title: "resurrect?" }), context(id)))
          .status,
      ).toBe(404);
      expect((await DELETE(request("DELETE"), context(id))).status).toBe(404);
    }
    expect((await detail(request(), context("not-an-id"))).status).toBe(400);
    expect(await (await GET(request())).json()).toMatchObject({
      conversations: [],
    });
  });

  it("exports exact JSON records including null usage, thinking and refusal details", async () => {
    const row = createConversation(db);
    db.insert(messages)
      .values([
        {
          id: ulid(),
          conversationId: row.id,
          seq: 0,
          role: "user",
          content: "Question",
          status: "complete",
          createdAt: 1,
        },
        {
          id: ulid(),
          conversationId: row.id,
          seq: 1,
          role: "assistant",
          content: "Partial",
          thinking: "Saved thinking",
          status: "interrupted",
          stopReason: "cancelled",
          createdAt: 2,
        },
        {
          id: ulid(),
          conversationId: row.id,
          seq: 2,
          role: "assistant",
          content: "Refusal text",
          status: "refused",
          stopReason: "refusal",
          modelId: row.modelId,
          refusalDetails: {
            category: "fixture",
            explanation: "Stored explanation",
          },
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          costUsd: 0.001,
          createdAt: 3,
        },
      ])
      .run();
    const response = await download(
      request("GET", undefined, "?format=json"),
      context(row.id),
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename=".*\.json"/,
    );
    expect(await response.json()).toEqual({
      version: 1,
      ...getConversationDetail(db, row.id),
    });
    const markdown = await download(
      request("GET", undefined, "?format=md"),
      context(row.id),
    );
    const text = await markdown.text();
    for (const part of [
      "## You",
      "## Assistant",
      "Question",
      "Partial",
      "### Thinking",
      "Saved thinking",
      "Stored explanation",
      "interrupted",
    ])
      expect(text).toContain(part);
    expect(
      (
        await download(
          request("GET", undefined, "?format=html"),
          context(row.id),
        )
      ).status,
    ).toBe(400);
  });
});
