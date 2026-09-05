import { ulid } from "ulid";
import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, openDb, type Db } from "@/lib/db/client";
import { getMessages } from "@/lib/repo/messages";
import { getConversation } from "@/lib/repo/conversations";
import { getProvider, isVendorAvailable } from "@/lib/providers";
import { parseSSE } from "@/lib/chat/sse-parse";
import { MAX_BODY_BYTES } from "@/lib/http";
import { POST } from "./route";

vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(),
  isVendorAvailable: vi.fn(),
  credentialHint: () =>
    "Set ANTHROPIC_API_KEY in .env.local and restart the server.",
}));
let db: Db;
const body = () => ({
  conversationId: ulid(),
  userMessageId: ulid(),
  content: "Hi",
  modelId: "claude-sonnet-5",
});
function request(
  value: unknown = body(),
  headers?: HeadersInit,
  signal?: AbortSignal,
) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    body: JSON.stringify(value),
    headers: { "content-type": "application/json", ...headers },
    signal,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(":memory:");
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(isVendorAvailable).mockReturnValue(true);
  vi.mocked(getProvider).mockReturnValue({
    vendor: "anthropic",
    async *stream() {
      yield { type: "text_delta", text: "Hello" };
      yield { type: "stop", reason: "end" };
    },
  });
});

describe("POST /api/chat", () => {
  it("schedules the title after streaming and persists it without another message row", async () => {
    const input = body();
    const response = await POST(request(input));
    expect(after).toHaveBeenCalledOnce();
    expect(getConversation(db, input.conversationId)?.titleStatus).toBe(
      "pending",
    );
    await response.text();
    const callback = vi.mocked(after).mock.calls[0][0];
    if (typeof callback !== "function")
      throw new Error("Expected an after callback");
    await callback();
    expect(getConversation(db, input.conversationId)).toMatchObject({
      title: "Hello",
      titleStatus: "generated",
    });
    expect(getMessages(db, input.conversationId)).toHaveLength(2);
  });
  it("accepts the browser's Host when Next normalizes the internal request URL", async () => {
    const response = await POST(
      request(body(), {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
  });
  it("streams the persisted turn with server identity and no-cache headers", async () => {
    const input = body();
    const response = await POST(
      request(input, {
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );
    const id = response.headers.get("x-assistant-message-id");
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
    expect(parseSSE(await response.text()).events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "stop", reason: "end" },
    ]);
    expect(getMessages(db, input.conversationId)).toMatchObject([
      { id: input.userMessageId, role: "user" },
      { id, content: "Hello", status: "complete" },
    ]);
  });

  it.each<HeadersInit>([
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { origin: "https://evil.example" },
    { origin: "https://localhost:3000" },
    { origin: "null" },
    { "sec-fetch-site": "same-origin", origin: "https://evil.example" },
  ])(
    "rejects cross-origin requests before database/provider access: %j",
    async (headers) => {
      expect((await POST(request(body(), headers))).status).toBe(403);
      expect(getDb).not.toHaveBeenCalled();
      expect(getProvider).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    {},
    { ...body(), content: "  " },
    { ...body(), action: "edit" },
    { ...body(), conversationId: "new-chat" },
    { ...body(), effort: "extreme" },
    { ...body(), maxOutputTokens: 0 },
    { ...body(), messages: [{ role: "assistant", content: "injected" }] },
  ])(
    "validates the complete contract before any write: %j",
    async (invalid) => {
      expect((await POST(request(invalid))).status).toBe(400);
      expect(getDb).not.toHaveBeenCalled();
      expect(getProvider).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/chat", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "enforces 1 MB by declared or actual UTF-8 bytes (%s)",
    async (declared) => {
      const response = await POST(
        request(
          declared ? body() : { ...body(), content: "😊".repeat(260_000) },
          declared ? { "content-length": String(MAX_BODY_BYTES + 1) } : {},
        ),
      );
      expect(response.status).toBe(413);
      expect((await response.json()).code).toBe("payload_too_large");
      expect(getDb).not.toHaveBeenCalled();
    },
  );

  it("enforces the size limit on chunked bodies and cancels their reader", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
      },
      cancel,
    });
    const req = new Request("http://localhost:3000/api/chat", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await POST(req)).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("reports unknown models and missing credentials without opening the database", async () => {
    expect(
      (await POST(request({ ...body(), modelId: "unknown-model" }))).status,
    ).toBe(400);
    vi.mocked(isVendorAvailable).mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "no_credentials",
      message: expect.stringContaining("ANTHROPIC_API_KEY"),
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
  });

  it("returns a retryable conflict while a prior turn is active", async () => {
    const input = body();
    const response = await POST(request(input));
    const conflict = await POST(request({ ...input, action: "retry" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "conflict",
      retryable: true,
    });
    await response.body?.cancel();
    expect(getMessages(db, input.conversationId).at(-1)?.status).toBe(
      "interrupted",
    );
  });

  it("does not leak exceptions when starting a turn fails", async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("secret-credential");
    });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-credential");
  });
});
