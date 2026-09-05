import type { ChatEvent } from "@/lib/providers/types";

/**
 * Incremental SSE parser for the browser side. Feed raw text chunks; get back
 * parsed ChatEvents plus the unconsumed tail to carry into the next call.
 * Comment frames (`: ping`) are ignored. Safe against a frame split across chunks.
 */
export function parseSSE(buffer: string): { events: ChatEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const part of parts) {
    const dataLines = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    try {
      events.push(JSON.parse(dataLines.join("\n")) as ChatEvent);
    } catch {
      // Malformed frame; skip rather than kill the stream.
    }
  }
  return { events, rest };
}
