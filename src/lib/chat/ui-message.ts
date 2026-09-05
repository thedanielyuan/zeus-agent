import type { UiMessage } from "@/hooks/use-chat-stream";
import type { ConversationDetail } from "@/lib/repo/conversations";
import type { StopReason } from "@/lib/providers/types";

const errors: Record<string, string> = {
  auth: "The API key was rejected. Check the server credentials and retry.",
  rate_limit: "The provider's rate limit was reached. Wait a moment and retry.",
  overloaded: "The provider is busy. Please retry shortly.",
  timeout:
    "The response timed out after 10 minutes. Your partial reply was saved.",
  network: "The connection ended before the reply finished. Try again.",
  server: "The server could not complete the response. Please retry.",
};

export function toUiMessage(
  row: ConversationDetail["messages"][number],
): UiMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    thinking: row.thinking ?? "",
    modelId: row.modelId ?? undefined,
    createdAt: row.createdAt,
    status: row.status,
    stopReason: (row.stopReason ?? undefined) as StopReason | undefined,
    refusal: row.refusalDetails ?? undefined,
    ...(row.errorCode
      ? {
          error: {
            code: row.errorCode,
            message:
              errors[row.errorCode] ??
              "The response could not be completed. Please retry.",
            retryable: true,
          },
        }
      : {}),
    usage:
      row.inputTokens !== null &&
      row.outputTokens !== null &&
      row.cacheReadTokens !== null &&
      row.cacheWriteTokens !== null
        ? {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheWriteTokens: row.cacheWriteTokens,
          }
        : undefined,
  };
}
