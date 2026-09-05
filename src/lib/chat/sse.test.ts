import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@/lib/providers/types";
import { parseSSE } from "./sse-parse";
import { encodeFrame, toSSEStream } from "./sse";

async function* fromArray(events: ChatEvent[], delayMs = 0): AsyncIterable<ChatEvent> {
  for (const e of events) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    yield e;
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

const sample: ChatEvent[] = [
  { type: "message_start", providerMessageId: "msg_1" },
  { type: "text_delta", text: "Hel" },
  { type: "text_delta", text: "lo\n\nworld" },
  { type: "usage", usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 10 } },
  { type: "stop", reason: "end" },
];

describe("SSE encoding", () => {
  it("frames each event with its type and JSON payload", () => {
    expect(encodeFrame({ type: "text_delta", text: "hi" })).toBe(
      'event: text_delta\ndata: {"type":"text_delta","text":"hi"}\n\n',
    );
  });

  it("round-trips through the client parser, including embedded blank lines", async () => {
    const text = await readAll(toSSEStream(fromArray(sample), { pingIntervalMs: 60_000 }));
    const { events, rest } = parseSSE(text);
    expect(rest).toBe("");
    expect(events).toEqual(sample);
  });

  it("parses frames split across chunk boundaries", () => {
    const full = encodeFrame({ type: "text_delta", text: "abc" }) + encodeFrame({ type: "stop", reason: "end" });
    const cut = 20;
    const first = parseSSE(full.slice(0, cut));
    expect(first.events).toEqual([]);
    const second = parseSSE(first.rest + full.slice(cut));
    expect(second.events).toEqual([
      { type: "text_delta", text: "abc" },
      { type: "stop", reason: "end" },
    ]);
    expect(second.rest).toBe("");
  });

  it("emits ping comments while the source is slow and the parser ignores them", async () => {
    const text = await readAll(toSSEStream(fromArray(sample.slice(0, 2), 30), { pingIntervalMs: 5 }));
    expect(text).toContain(": ping\n\n");
    expect(parseSSE(text).events).toEqual(sample.slice(0, 2));
  });

  it("turns a throwing source into a terminal error frame", async () => {
    async function* broken(): AsyncIterable<ChatEvent> {
      yield { type: "text_delta", text: "partial" };
      throw new Error("boom");
    }
    const { events } = parseSSE(await readAll(toSSEStream(broken(), { pingIntervalMs: 60_000 })));
    expect(events).toEqual([
      { type: "text_delta", text: "partial" },
      { type: "error", code: "unknown", message: "boom", retryable: false },
    ]);
  });

  it("calls onCancel and closes the source when the reader cancels", async () => {
    let finallyRan = false;
    let cancelled = false;
    async function* slow(): AsyncIterable<ChatEvent> {
      try {
        yield { type: "text_delta", text: "1" };
        await new Promise((r) => setTimeout(r, 1_000));
        yield { type: "text_delta", text: "2" };
      } finally {
        finallyRan = true;
      }
    }
    const stream = toSSEStream(slow(), { pingIntervalMs: 60_000, onCancel: () => (cancelled = true) });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
    // The generator's finally runs once its pending timer resolves or return() is processed.
    await new Promise((r) => setTimeout(r, 1_100));
    expect(finallyRan).toBe(true);
  });
});
