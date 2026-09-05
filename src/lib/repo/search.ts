import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { listConversations, type ConversationSummary } from "./conversations";

export type SearchResult = ConversationSummary & {
  snippet?: string;
  matchedAt?: number;
};

/** Literal, case-insensitive substring search. FTS syntax is never accepted from users. */
export function searchConversations(
  db: Db,
  query: string,
  limit = 100,
  offset = 0,
): SearchResult[] {
  const text = query.trim();
  if (!text) return listConversations(db, limit, offset);
  // Trigram MATCH needs three Unicode characters. Very short queries scan the
  // source columns using the same case-insensitive substring semantics.
  const phrase = `"${text.replaceAll('"', '""')}"`;
  const matches =
    Array.from(text).length >= 3
      ? sql`
    SELECT c.id, c.title_updated_at AS matched_at,
      snippet(conversation_titles_fts, 0, '', '', '…', 48) AS excerpt
    FROM conversation_titles_fts JOIN conversations c ON c.rowid = conversation_titles_fts.rowid
    WHERE conversation_titles_fts MATCH ${phrase} AND c.deleted_at IS NULL
    UNION ALL
    SELECT m.conversation_id, m.created_at,
      snippet(message_text_fts, 0, '', '', '…', 48)
    FROM message_text_fts JOIN messages m ON m.rowid = message_text_fts.rowid
    JOIN conversations c ON c.id = m.conversation_id
    WHERE message_text_fts MATCH ${phrase} AND c.deleted_at IS NULL
  `
      : sql`
    SELECT id, title_updated_at AS matched_at, title AS excerpt
    FROM conversations WHERE deleted_at IS NULL AND zeus_contains(title, ${text})
    UNION ALL
    SELECT m.conversation_id, m.created_at, substr(m.content, 1, 160)
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.deleted_at IS NULL AND zeus_contains(m.content, ${text})
  `;
  return db.all<SearchResult>(sql`
    WITH matches AS (${matches}), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY id ORDER BY matched_at DESC, excerpt) AS position
      FROM matches
    )
    SELECT c.id, c.title, c.title_status AS titleStatus, c.updated_at AS updatedAt,
      r.matched_at AS matchedAt, r.excerpt AS snippet
    FROM ranked r JOIN conversations c ON c.id = r.id
    WHERE r.position = 1
    ORDER BY r.matched_at DESC, c.id DESC LIMIT ${limit} OFFSET ${offset}
  `);
}
