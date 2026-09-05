import { z } from "zod";
import { toSSEStream } from "@/lib/chat/sse";
import { isSameOrigin, jsonError } from "@/lib/http";
import { getModel } from "@/lib/models/registry";
import { credentialHint, getProvider, isVendorAvailable } from "@/lib/providers";
import { EFFORT_LEVELS, type ChatRequest } from "@/lib/providers/types";

/** Streaming default: generous, since output is only billed as generated. */
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;

const Body = z.object({
  modelId: z.string().min(1),
  system: z.string().max(100_000).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  maxOutputTokens: z.number().int().min(1).max(128_000).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(1_000_000),
      }),
    )
    .min(1),
});

/**
 * POST /api/chat — stream one turn as Server-Sent Events.
 * M0 is stateless: the client sends the whole conversation. Persistence
 * arrives with run-turn in M1/M2.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return jsonError("forbidden", "Cross-site requests are not allowed.", 403);
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("bad_request", "Invalid request body.", 400);
  }
  const body = parsed.data;
  if (body.messages[0]?.role !== "user") {
    return jsonError("bad_request", "The first message must be from the user.", 400);
  }

  const model = getModel(body.modelId);
  if (!model) {
    return jsonError("unknown_model", `Unknown model: ${body.modelId}`, 400);
  }
  if (!isVendorAvailable(model.vendor)) {
    return jsonError("no_credentials", credentialHint(model.vendor), 503);
  }

  // One controller aborts the provider call from either signal: the request
  // being torn down (client disconnect) or the SSE consumer cancelling.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const chatRequest: ChatRequest = {
    model,
    system: body.system,
    messages: body.messages,
    effort: body.effort,
    maxOutputTokens: body.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    thinkingDisplay: "summarized",
  };

  const events = getProvider(model.vendor).stream(chatRequest, abort.signal);
  return new Response(toSSEStream(events, { onCancel: () => abort.abort() }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
