import Anthropic, { APIUserAbortError, AuthenticationError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { getModel } from "@/lib/models/registry";
import { buildParams, createAnthropicProvider, mapError, toStopEvent } from "./anthropic";
import type { ChatEvent, ChatRequest, ModelSpec } from "./types";

const sonnet = getModel("claude-sonnet-5") as ModelSpec;

function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: sonnet,
    system: "You are terse.",
    messages: [{ role: "user", content: "hi" }],
    effort: "high",
    maxOutputTokens: 4_000,
    thinkingDisplay: "summarized",
    ...overrides,
  };
}

function makeFinal(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: "Hello", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 12,
      output_tokens: 3,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      speed: null,
    } as unknown as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message;
}

interface FakeStreamOptions {
  events?: Anthropic.MessageStreamEvent[];
  final?: Anthropic.Message;
  /** Throw this instead of finishing (simulates SDK errors). */
  throwError?: unknown;
  /** Wait for the abort signal, then throw APIUserAbortError. */
  waitForAbort?: boolean;
}

function fakeClient(opts: FakeStreamOptions) {
  const abort = vi.fn();
  const stream = vi.fn((_params: unknown, requestOptions?: { signal?: AbortSignal }) => {
    const signal = requestOptions?.signal;
    const fake = {
      abort,
      async finalMessage() {
        return opts.final ?? makeFinal();
      },
      async *[Symbol.asyncIterator]() {
        for (const e of opts.events ?? []) yield e;
        if (opts.waitForAbort) {
          await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
          throw new APIUserAbortError();
        }
        if (opts.throwError) throw opts.throwError;
      },
    };
    return fake;
  });
  const client = { messages: { stream } } as unknown as Anthropic;
  return { client, stream, abort };
}

async function collect(iter: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const textDelta = (text: string): Anthropic.MessageStreamEvent => ({
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text },
});

describe("buildParams", () => {
  it("builds the documented Sonnet 5 request shape (ARCHITECTURE §4.2)", () => {
    const params = buildParams(makeRequest());
    expect(params).toEqual({
      model: "claude-sonnet-5",
      max_tokens: 4_000,
      messages: [{ role: "user", content: "hi" }],
      system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params).not.toHaveProperty("top_k");
  });

  it("caps max_tokens at the model's output limit and omits optional fields", () => {
    const params = buildParams(makeRequest({ system: undefined, effort: undefined, maxOutputTokens: 999_999 }));
    expect(params.max_tokens).toBe(sonnet.maxOutputTokens);
    expect(params).not.toHaveProperty("system");
    expect(params).not.toHaveProperty("output_config");
  });

  it("respects capability flags for models without thinking or caching", () => {
    const plain: ModelSpec = {
      ...sonnet,
      capabilities: { ...sonnet.capabilities, thinking: false, caching: false, effort: false },
    };
    const params = buildParams(makeRequest({ model: plain }));
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("cache_control");
    expect(params).not.toHaveProperty("output_config");
    expect(params.system).toEqual([{ type: "text", text: "You are terse." }]);
  });
});

describe("stream event mapping", () => {
  it("maps a normal turn to message_start, deltas, usage, stop", async () => {
    const { client, stream } = fakeClient({
      events: [
        { type: "message_start", message: makeFinal({ content: [] }) },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } },
        textDelta("Hel"),
        textDelta("lo"),
        { type: "message_stop" },
      ],
    });
    const ac = new AbortController();
    const events = await collect(createAnthropicProvider(client).stream(makeRequest(), ac.signal));
    expect(events).toEqual([
      { type: "message_start", providerMessageId: "msg_1" },
      { type: "thinking_delta", text: "plan" },
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "usage", usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 10 } },
      { type: "stop", reason: "end" },
    ]);
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-sonnet-5" }), { signal: ac.signal });
  });

  it("surfaces refusal details", async () => {
    const { client } = fakeClient({
      final: makeFinal({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "nope" } as Anthropic.RefusalStopDetails,
      }),
    });
    const events = await collect(createAnthropicProvider(client).stream(makeRequest(), new AbortController().signal));
    expect(events.at(-1)).toEqual({
      type: "stop",
      reason: "refusal",
      details: { category: "cyber", explanation: "nope" },
    });
  });

  it("yields a cancelled stop when the signal aborts mid-stream", async () => {
    const { client, abort } = fakeClient({ events: [textDelta("par")], waitForAbort: true });
    const ac = new AbortController();
    const iter = createAnthropicProvider(client).stream(makeRequest(), ac.signal)[Symbol.asyncIterator]();
    expect((await iter.next()).value).toEqual({ type: "text_delta", text: "par" });
    const pending = iter.next();
    ac.abort();
    expect((await pending).value).toEqual({ type: "stop", reason: "cancelled" });
    expect((await iter.next()).done).toBe(true);
    expect(abort).toHaveBeenCalled();
  });

  it("maps SDK errors to vendor-neutral error events", async () => {
    const { client } = fakeClient({
      events: [textDelta("x")],
      throwError: new RateLimitError(429, undefined, "slow down", new Headers()),
    });
    const events = await collect(createAnthropicProvider(client).stream(makeRequest(), new AbortController().signal));
    expect(events).toEqual([
      { type: "text_delta", text: "x" },
      { type: "error", code: "rate_limit", message: expect.any(String), retryable: true },
    ]);
  });
});

describe("toStopEvent", () => {
  it.each([
    ["end_turn", { type: "stop", reason: "end" }],
    ["stop_sequence", { type: "stop", reason: "end" }],
    ["max_tokens", { type: "stop", reason: "max_tokens" }],
    ["model_context_window_exceeded", { type: "stop", reason: "context_exceeded" }],
  ] as const)("maps %s", (reason, expected) => {
    expect(toStopEvent(makeFinal({ stop_reason: reason }))).toEqual(expected);
  });

  it("rejects tool_use and pause_turn in v1", () => {
    expect(toStopEvent(makeFinal({ stop_reason: "tool_use" }))).toMatchObject({ type: "error", code: "unsupported_stop" });
  });
});

describe("mapError", () => {
  it("orders checks most-specific first", () => {
    expect(mapError(new AuthenticationError(401, undefined, "bad key", new Headers()))).toMatchObject({ code: "auth", retryable: false });
    expect(mapError(new InternalServerError(503, undefined, "overloaded", new Headers()))).toMatchObject({ code: "server", retryable: true });
    expect(mapError(new Error("weird"))).toMatchObject({ code: "unknown", message: "weird" });
  });
});
