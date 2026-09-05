// Minimal Anthropic Messages API mock speaking the real SSE protocol.
// Lets the full stack (SDK -> adapter -> SSE route -> browser) be exercised without a key.
// Behaviour keys on the last user message: "slow" streams for a long time (test Stop),
// "refuse" ends with stop_reason=refusal, "error" returns HTTP 529.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "nope" } }));
    }
    const body = JSON.parse(raw || "{}");
    console.log("[mock] request", JSON.stringify({
      headers: { "x-api-key": req.headers["x-api-key"] ? "<present>" : "<missing>", "anthropic-version": req.headers["anthropic-version"] },
      model: body.model, max_tokens: body.max_tokens, thinking: body.thinking, output_config: body.output_config,
      cache_control: body.cache_control, system: body.system, stream: body.stream, temperature: body.temperature,
      messages: body.messages?.length,
    }));
    const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
    const text = typeof lastUser === "string" ? lastUser : JSON.stringify(lastUser);

    if (/error/i.test(text)) {
      res.writeHead(529, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
    }

    // IncomingMessage 'close' fires once the body is consumed (autoDestroy), so a
    // real client abort is: the response closed before we finished writing it.
    let closed = false;
    res.on("close", () => {
      if (!res.writableFinished) { closed = true; console.log("[mock] client disconnected"); }
    });

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": "req_mock" });
    sse(res, "message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 25, output_tokens: 1, cache_creation_input_tokens: 20, cache_read_input_tokens: 0 } } });

    sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
    for (const chunk of ["Reading the question. ", "Composing a short reply."]) {
      sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: chunk } });
      await sleep(80);
    }
    sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_mock" } });
    sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });

    sse(res, "content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    const slow = /slow/i.test(text);
    const words = slow
      ? Array.from({ length: 80 }, (_, i) => `word${i + 1} `)
      : ["Hello", " from", " the", " mock", " Anthropic", " server.", "\n\nYou said: ", JSON.stringify(text), "."];
    for (const w of words) {
      if (closed) return;
      sse(res, "content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: w } });
      await sleep(slow ? 150 : 40);
    }
    sse(res, "content_block_stop", { type: "content_block_stop", index: 1 });

    const refuse = /refuse/i.test(text);
    sse(res, "message_delta", {
      type: "message_delta",
      delta: refuse
        ? { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: "general_harms", explanation: "Mock refusal for testing." } }
        : { stop_reason: "end_turn", stop_sequence: null, stop_details: null },
      usage: { output_tokens: words.length + 12 },
    });
    sse(res, "message_stop", { type: "message_stop" });
    res.end();
    console.log("[mock] response complete");
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock] listening on http://127.0.0.1:${PORT}`));
