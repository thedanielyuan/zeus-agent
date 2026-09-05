import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/models/registry";
import { createAnthropicProvider } from "./anthropic";
import type { ChatEvent, ModelSpec } from "./types";

/**
 * Live smoke test. Costs real money and needs credentials.
 * Run with `pnpm test:live`; skipped unless ZEUS_LIVE=1.
 */
describe.skipIf(!process.env.ZEUS_LIVE)("live: claude-sonnet-5 streamed turn", () => {
  it("streams text, reports usage, and stops with end", async () => {
    const provider = createAnthropicProvider();
    const events: ChatEvent[] = [];
    for await (const e of provider.stream(
      {
        model: getModel("claude-sonnet-5") as ModelSpec,
        system: "Answer with a single word.",
        messages: [{ role: "user", content: "Reply with the word: pong" }],
        effort: "low",
        maxOutputTokens: 2_000,
        thinkingDisplay: "summarized",
      },
      new AbortController().signal,
    )) {
      events.push(e);
    }
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: "text_delta" }> => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    expect(text.toLowerCase()).toContain("pong");
    expect(events.find((e) => e.type === "usage")).toBeDefined();
    expect(events.at(-1)).toEqual({ type: "stop", reason: "end" });
  }, 60_000);
});
