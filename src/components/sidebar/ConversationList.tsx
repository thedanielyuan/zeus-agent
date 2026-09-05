"use client";

import { useEffect, useState } from "react";
import type { ConversationSummary } from "@/lib/repo/conversations";
import { Icon } from "@/components/ui/icon";

function groupDate(timestamp: number, now: number) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return days <= 0
    ? "Today"
    : days === 1
      ? "Yesterday"
      : days < 7
        ? "Previous 7 days"
        : "Older";
}
function relativeTime(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  return minutes < 1
    ? "now"
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
}

export function ConversationList({
  conversations,
  activeId,
  disabled,
  hasMore,
  onOpen,
  onMore,
}: {
  conversations: ConversationSummary[];
  activeId: string;
  disabled: boolean;
  hasMore: boolean;
  onOpen: (id: string) => void;
  onMore: () => void;
}) {
  // Render deterministic timestamps on the server, then local relative times.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);
  return (
    <div className="sidebar-history">
      {!conversations.length ? (
        <div className="history-empty">
          <Icon name="chat" size={22} />
          <p>
            A little space for
            <br />
            your next big idea.
          </p>
          <span>Your conversations will appear here.</span>
        </div>
      ) : (
        conversations.map((item, index) => (
          <div key={item.id}>
            {(index === 0 ||
              (now !== null &&
                groupDate(item.updatedAt, now) !==
                  groupDate(conversations[index - 1].updatedAt, now))) && (
              <h2 className="history-heading">
                {now === null ? "Saved chats" : groupDate(item.updatedAt, now)}
              </h2>
            )}
            <button
              className={`history-item${activeId === item.id ? " active" : ""}`}
              disabled={disabled}
              onClick={() => onOpen(item.id)}
              aria-current={activeId === item.id ? "page" : undefined}
              title={item.title}
            >
              <span>{item.title}</span>
              <time dateTime={new Date(item.updatedAt).toISOString()}>
                {now === null ? "" : relativeTime(item.updatedAt, now)}
              </time>
            </button>
          </div>
        ))
      )}
      {hasMore && (
        <button
          className="text-button history-more"
          disabled={disabled}
          onClick={onMore}
        >
          Load older chats
        </button>
      )}
    </div>
  );
}
