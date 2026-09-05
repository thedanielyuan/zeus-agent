import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { historyResponse, readJsonBody } from "@/lib/http";
import { createConversation } from "@/lib/repo/conversations";
import { searchConversations } from "@/lib/repo/search";
import { ConversationSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Query = z.strictObject({
  q: z
    .string()
    .trim()
    .max(200)
    .refine((q) => !q.includes("\0"))
    .default(""),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
});

export function GET(request: Request) {
  return historyResponse(request, false, () => {
    const { q, limit, offset } = Query.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const rows = searchConversations(getDb(), q, limit + 1, offset);
    return Response.json({
      conversations: rows.slice(0, limit),
      hasMore: rows.length > limit,
    });
  });
}

export function POST(request: Request) {
  return historyResponse(request, true, async () => {
    const values = ConversationSettings.partial().parse(
      await readJsonBody(request),
    );
    return Response.json(createConversation(getDb(), values), { status: 201 });
  });
}
