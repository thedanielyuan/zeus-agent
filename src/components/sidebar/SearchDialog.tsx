"use client";

import { useEffect, useState } from "react";
import type { SearchResult } from "@/lib/repo/search";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";

export function SearchDialog({
  onClose,
  onOpen,
  disabled,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    page: number;
    conversations: SearchResult[];
    hasMore: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setError("");
      try {
        const response = await fetch(
          `/api/conversations?${new URLSearchParams({ q: query, offset: String(page * 50), limit: "50" })}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error();
        const next = await response.json();
        if (!controller.signal.aborted) setResult({ ...next, query, page });
      } catch {
        if (!controller.signal.aborted)
          setError("Could not search saved chats. Please retry.");
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, page, attempt]);
  const ready = result?.query === query && result?.page === page;
  return (
    <Dialog
      title="Search your chats"
      onClose={onClose}
      className="search-dialog"
    >
      <div className="search-input">
        <Icon name="search" />
        <input
          autoFocus
          value={query}
          maxLength={200}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
            setError("");
          }}
          placeholder="Search by title or message…"
          aria-label="Search conversations"
        />
        <kbd>esc</kbd>
      </div>
      <div className="search-results" aria-live="polite">
        {error ? (
          <p role="alert">
            {error}{" "}
            <button
              className="text-button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry search
            </button>
          </p>
        ) : !ready ? (
          <p role="status">Searching saved chats…</p>
        ) : result.conversations.length ? (
          result.conversations.map((item) => (
            <button
              key={item.id}
              className="search-result"
              disabled={disabled}
              onClick={() => onOpen(item.id)}
            >
              <Icon name="chat" size={20} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.snippet}</small>
              </span>
              <Icon name="arrowRight" size={16} />
            </button>
          ))
        ) : (
          <div className="search-empty">
            <Icon name="search" size={30} />
            <h3>No chats found</h3>
            <p>Try a different word or phrase.</p>
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <span>Searches all saved titles and messages.</span>
        {page > 0 && (
          <button
            className="secondary-button"
            onClick={() => setPage((n) => n - 1)}
          >
            Previous results
          </button>
        )}
        {ready && result.hasMore && (
          <button
            className="secondary-button"
            onClick={() => setPage((n) => n + 1)}
          >
            More results
          </button>
        )}
      </div>
    </Dialog>
  );
}
