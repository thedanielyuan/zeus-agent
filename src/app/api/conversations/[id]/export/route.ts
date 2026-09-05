import { z } from "zod";
import { exportConversation } from "@/lib/chat/export";
import { getDb } from "@/lib/db/client";
import { historyResponse } from "@/lib/http";
import { getConversationDetail } from "@/lib/repo/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return historyResponse(request, false, async () => {
    const id = z.ulid().parse((await context.params).id);
    const format = z
      .enum(["md", "json"])
      .parse(new URL(request.url).searchParams.get("format") ?? "md");
    return exportConversation(getConversationDetail(getDb(), id), format);
  });
}
