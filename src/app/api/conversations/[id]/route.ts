import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { historyResponse, readJsonBody } from "@/lib/http";
import {
  deleteConversation,
  getConversationDetail,
  updateConversation,
} from "@/lib/repo/conversations";
import { ConversationPatch } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return historyResponse(request, false, async () =>
    Response.json(
      getConversationDetail(getDb(), z.ulid().parse((await context.params).id)),
    ),
  );
}

export function PATCH(request: Request, context: Context) {
  return historyResponse(request, true, async () => {
    const id = z.ulid().parse((await context.params).id);
    const patch = ConversationPatch.parse(await readJsonBody(request));
    return Response.json(updateConversation(getDb(), id, patch));
  });
}

export function DELETE(request: Request, context: Context) {
  return historyResponse(request, true, async () => {
    deleteConversation(getDb(), z.ulid().parse((await context.params).id));
    return new Response(null, { status: 204 });
  });
}
