import type { ChatEvent } from "@/lib/providers/types";

const encoder = new TextEncoder();
const PING = encoder.encode(": ping\n\n");

/** One SSE frame per ChatEvent: `event: <type>\ndata: <json>\n\n`. */
export function encodeFrame(event: ChatEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface SSEOptions {
  /** Comment frame cadence to keep intermediaries from closing idle streams. */
  pingIntervalMs?: number;
  /** Called when the consumer cancels (client disconnect or Stop). */
  onCancel?: () => void;
}

function safeEnqueue(controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array): void {
  try {
    controller.enqueue(chunk);
  } catch {
    // Stream already closed or cancelled; nothing to do.
  }
}

/**
 * Pull-based so backpressure is respected and cancel() can stop the source.
 * Errors thrown by the source become a terminal `error` frame, never a dropped
 * connection with no explanation.
 */
export function toSSEStream(events: AsyncIterable<ChatEvent>, opts: SSEOptions = {}): ReadableStream<Uint8Array> {
  const pingMs = opts.pingIntervalMs ?? 15_000;
  const iterator = events[Symbol.asyncIterator]();
  let ping: ReturnType<typeof setInterval> | undefined;

  const stopPing = () => {
    if (ping !== undefined) {
      clearInterval(ping);
      ping = undefined;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      ping = setInterval(() => safeEnqueue(controller, PING), pingMs);
    },
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          stopPing();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeFrame(value)));
      } catch (err) {
        stopPing();
        safeEnqueue(
          controller,
          encoder.encode(
            encodeFrame({
              type: "error",
              code: "unknown",
              message: err instanceof Error ? err.message : String(err),
              retryable: false,
            }),
          ),
        );
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    async cancel() {
      stopPing();
      opts.onCancel?.();
      try {
        await iterator.return?.();
      } catch {
        // source already finished or threw; nothing to do
      }
    },
  });
}
