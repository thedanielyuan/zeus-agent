import { ChatError } from "@/lib/errors";
import { ZodError } from "zod";

/**
 * Same-origin gate for mutating routes (PRD FR-X2). Browsers send Fetch
 * Metadata on every request; fall back to an Origin/Host comparison for
 * clients that don't, and allow requests with no Origin at all (curl).
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    // Next may normalize request.url to localhost even when the browser used
    // 127.0.0.1. Host retains the authority the browser actually requested.
    return (
      source.protocol === target.protocol &&
      source.host === (request.headers.get("host") ?? target.host)
    );
  } catch {
    return false;
  }
}

export function jsonError(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ code, message }, { status });
}

/** Shared boundary for the history/settings APIs; callers do validation and repo work. */
export async function historyResponse(
  request: Request,
  mutating: boolean,
  action: () => Response | Promise<Response>,
) {
  if (mutating && !isSameOrigin(request))
    return jsonError("forbidden", "Cross-site requests are not allowed.", 403);
  try {
    const response = await action();
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof ZodError)
      return jsonError("bad_request", "Invalid request.", 400);
    if (error instanceof ChatError)
      return jsonError(error.code, error.message, error.status ?? 500);
    return jsonError(
      "server",
      "Could not access saved history or settings. Please retry.",
      500,
    );
  }
}

export const MAX_BODY_BYTES = 1_000_000;

/** Bound actual bytes, including chunked requests without Content-Length. */
export async function readJsonBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new ChatError(
      "payload_too_large",
      "Message and settings must fit within 1 MB.",
      false,
      413,
    );
  }
  if (!request.body)
    throw new ChatError("bad_request", "Invalid request body.", false, 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ChatError(
          "payload_too_large",
          "Message and settings must fit within 1 MB.",
          false,
          413,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError("bad_request", "Invalid request body.", false, 400);
  } finally {
    reader.releaseLock();
  }
}
