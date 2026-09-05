import { notFound } from "next/navigation";
import { z } from "zod";
import { Chat } from "@/components/chat/Chat";
import { getDb } from "@/lib/db/client";
import { MODELS, toPublicModel } from "@/lib/models/registry";
import { isVendorAvailable } from "@/lib/providers/availability";
import {
  getConversation,
  getConversationDetail,
  listConversations,
} from "@/lib/repo/conversations";
import { getSettings } from "@/lib/repo/settings";

export const dynamic = "force-dynamic";
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = z.ulid().safeParse((await params).id);
  if (!id.success) notFound();
  const db = getDb();
  if (!getConversation(db, id.data)) notFound();
  const rows = listConversations(db, 101);
  const models = MODELS.map((m) =>
    toPublicModel(m, isVendorAvailable(m.vendor)),
  );
  return (
    <Chat
      key={id.data}
      models={models}
      initialSettings={getSettings(db)}
      initialConversation={getConversationDetail(db, id.data)}
      initialConversations={rows.slice(0, 100)}
      initialHasMore={rows.length > 100}
    />
  );
}
