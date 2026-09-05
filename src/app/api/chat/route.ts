import { after } from "next/server";
import { generateTitle } from "@/lib/chat/title";
import { TurnBody } from "@/lib/chat/request";
import { runTurn } from "@/lib/chat/run-turn";
import { toSSEStream } from "@/lib/chat/sse";
import { ChatError } from "@/lib/errors";
import { isSameOrigin, jsonError, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";

/** POST /api/chat — persist a turn, then stream normalized provider events. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return jsonError("forbidden", "Cross-site requests are not allowed.", 403);
  }
  try {
    const parsed = TurnBody.safeParse(await readJsonBody(request));
    if (!parsed.success)
      return jsonError("bad_request", "Invalid request body.", 400);
    const turn = runTurn(parsed.data, { signal: request.signal });
    after(async () => {
      try {
        await generateTitle(parsed.data.conversationId);
      } catch {
        console.error(JSON.stringify({ event: "title_generation_failed" }));
      }
    });
    return new Response(toSSEStream(turn.events, { onCancel: turn.cancel }), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Assistant-Message-Id": turn.assistantMessageId,
      },
    });
  } catch (error) {
    if (error instanceof ChatError) {
      return Response.json(
        {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
        { status: error.status ?? 500 },
      );
    }
    return jsonError(
      "server",
      "Could not start the response. Check the server and retry.",
      500,
    );
  }
}
