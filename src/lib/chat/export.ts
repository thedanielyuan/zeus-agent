import type { ConversationDetail } from "@/lib/repo/conversations";

export function exportConversation(
  detail: ConversationDetail,
  format: "md" | "json",
) {
  const { conversation, messages } = detail;
  const filename = `${conversation.title.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "zeus-chat"}-${conversation.id}.${format}`;
  const body =
    format === "json"
      ? JSON.stringify({ version: 1, ...detail }, null, 2) + "\n"
      : `# ${conversation.title.replace(/\s+/g, " ")}\n\n${messages
          .map((message) => {
            const metadata = [
              new Date(message.createdAt).toISOString(),
              message.modelId,
              message.status,
              message.stopReason,
              message.errorCode,
            ]
              .filter(Boolean)
              .join(" · ");
            const refusal = message.refusalDetails
              ? `\n\nRefusal: ${message.refusalDetails.category ?? "unspecified"}${message.refusalDetails.explanation ? ` — ${message.refusalDetails.explanation}` : ""}`
              : "";
            return `## ${message.role === "user" ? "You" : "Assistant"}\n\n${metadata}\n\n${message.content}${message.thinking ? `\n\n### Thinking\n\n${message.thinking}` : ""}${refusal}`;
          })
          .join("\n\n---\n\n")}\n`;
  return new Response(body, {
    headers: {
      "Content-Type":
        format === "json"
          ? "application/json; charset=utf-8"
          : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
