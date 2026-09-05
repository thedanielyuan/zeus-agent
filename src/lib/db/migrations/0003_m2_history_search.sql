-- Preserve legacy titles and give old untitled chats a useful fallback, without
-- retroactively making paid title requests for previously completed replies.
UPDATE conversations SET title_updated_at = updated_at,
  title_status = CASE WHEN title <> 'New chat' THEN 'manual'
    WHEN EXISTS (SELECT 1 FROM messages WHERE conversation_id = conversations.id AND role = 'assistant' AND status = 'complete') THEN 'failed'
    ELSE 'pending' END,
  title = CASE WHEN title = 'New chat' THEN coalesce(
    (SELECT substr(content, 1, 80) FROM messages WHERE conversation_id = conversations.id AND role = 'user' ORDER BY seq LIMIT 1), title)
    ELSE title END;
--> statement-breakpoint
CREATE VIRTUAL TABLE conversation_titles_fts USING fts5(title, content='conversations', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE VIRTUAL TABLE message_text_fts USING fts5(content, content='messages', content_rowid='rowid', tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER conversations_fts_insert AFTER INSERT ON conversations BEGIN
  INSERT INTO conversation_titles_fts(rowid, title) VALUES (new.rowid, new.title);
END;
--> statement-breakpoint
CREATE TRIGGER conversations_fts_delete AFTER DELETE ON conversations BEGIN
  INSERT INTO conversation_titles_fts(conversation_titles_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END;
--> statement-breakpoint
CREATE TRIGGER conversations_fts_update AFTER UPDATE OF title ON conversations WHEN old.title <> new.title BEGIN
  INSERT INTO conversation_titles_fts(conversation_titles_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
  INSERT INTO conversation_titles_fts(rowid, title) VALUES (new.rowid, new.title);
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO message_text_fts(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO message_text_fts(message_text_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages WHEN old.content <> new.content BEGIN
  INSERT INTO message_text_fts(message_text_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO message_text_fts(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
INSERT INTO conversation_titles_fts(conversation_titles_fts) VALUES ('rebuild');
--> statement-breakpoint
INSERT INTO message_text_fts(message_text_fts) VALUES ('rebuild');
