"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ulid } from "ulid";
import { useChatStream } from "@/hooks/use-chat-stream";
import { toUiMessage } from "@/lib/chat/ui-message";
import { apiRequest } from "@/lib/api-client";
import type {
  Conversation,
  ConversationDetail,
  ConversationSummary,
} from "@/lib/repo/conversations";
import {
  conversationDefaults,
  type ConversationSettings,
  type GlobalSettings,
} from "@/lib/settings";
import { ConversationList } from "@/components/sidebar/ConversationList";
import { SearchDialog } from "@/components/sidebar/SearchDialog";
import { SettingsDialog } from "./SettingsDialog";
import type { PublicModel } from "@/lib/models/registry";
import { type Effort } from "@/lib/providers/types";
import { Dialog } from "@/components/ui/dialog";
import { Icon, ZeusMark, type IconName } from "@/components/ui/icon";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatProps {
  models: PublicModel[];
  initialSettings: GlobalSettings;
  initialConversation?: ConversationDetail;
  initialConversations: ConversationSummary[];
  initialHasMore: boolean;
}
type OpenDialog = "search" | "settings" | "rename" | "delete" | null;

const suggestions: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "pen",
    title: "Write something",
    text: "Help me turn a rough idea into something worth reading. Ask me what I have in mind.",
  },
  {
    icon: "bulb",
    title: "Explore an idea",
    text: "Help me brainstorm a fresh idea for a small, creative project. Ask me about my interests first.",
  },
  {
    icon: "code",
    title: "Build with code",
    text: "Be my coding partner. Help me break a project into simple steps, starting with what I want to build.",
  },
  {
    icon: "book",
    title: "Learn something",
    text: "Help me understand something new. Ask me what I am curious about and explain it with a simple example.",
  },
];
export function Chat({
  models,
  initialSettings,
  initialConversation,
  initialConversations,
  initialHasMore,
}: ChatProps) {
  const router = useRouter();
  const [initialMessages] = useState(
    () => initialConversation?.messages.map(toUiMessage) ?? [],
  );
  const [preferences, setPreferences] = useState(initialSettings);
  // The theme lives on <html> (set server-side by the root layout) so the
  // body, dialogs and menus are themed; keep it in sync after a settings save.
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  const [record, setRecord] = useState(initialConversation?.conversation);
  const [settings, setSettings] = useState<ConversationSettings>(() =>
    initialConversation
      ? {
          modelId: initialConversation.conversation.modelId,
          systemPrompt: initialConversation.conversation.systemPrompt ?? "",
          effort: (initialConversation.conversation.effort ?? "high") as Effort,
          maxOutputTokens:
            initialConversation.conversation.maxOutputTokens ?? 64_000,
        }
      : conversationDefaults(initialSettings),
  );
  const { modelId, systemPrompt: system, effort, maxOutputTokens } = settings;
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(initialConversations);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [activeId, setActiveId] = useState(
    () => initialConversation?.conversation.id ?? ulid(),
  );
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [rename, setRename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pages = useRef(1);
  const refreshVersion = useRef(0);
  const mounted = useRef(true);
  const navigating = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const model = models.find((item) => item.id === modelId) ?? models[0];
  const { messages, isStreaming, send, stop, retry, load } = useChatStream(
    { conversationId: activeId, modelId, system, effort, maxOutputTokens },
    initialMessages,
  );
  const storedStreaming =
    !isStreaming && messages.some((message) => message.status === "streaming");
  const locked = isStreaming || busy || storedStreaming;
  const available = (model?.available ?? false) && !busy && !storedStreaming;
  const isEmpty = messages.length === 0;
  const activeSummary = saved.find((item) => item.id === activeId);
  const conversationTitle =
    activeSummary?.title ??
    record?.title ??
    messages
      .find((message) => message.role === "user")
      ?.content.replace(/\s+/g, " ")
      .slice(0, 80) ??
    "New chat";
  const conversations = [
    ...saved.filter((item) => item.id !== activeId),
    ...(!isEmpty || record
      ? [
          {
            id: activeId,
            title: conversationTitle,
            titleStatus:
              activeSummary?.titleStatus ??
              record?.titleStatus ??
              ("pending" as const),
            updatedAt: Math.max(
              activeSummary?.updatedAt ?? record?.updatedAt ?? 0,
              messages.at(-1)?.createdAt ?? 0,
            ),
          },
        ]
      : []),
  ].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
  const totalTokens = messages.reduce(
    (sum, message) =>
      sum +
      (message.usage
        ? message.usage.inputTokens +
          message.usage.outputTokens +
          message.usage.cacheReadTokens +
          message.usage.cacheWriteTokens
        : 0),
    0,
  );

  const refreshHistory = useCallback(async () => {
    const version = ++refreshVersion.current;
    const results = await Promise.all(
      Array.from({ length: pages.current }, (_, page) =>
        apiRequest<{ conversations: ConversationSummary[]; hasMore: boolean }>(
          `/api/conversations?offset=${page * 100}`,
        ),
      ),
    );
    if (mounted.current && version === refreshVersion.current) {
      setSaved(results.flatMap((result) => result.conversations));
      setHasMore(results.at(-1)!.hasMore);
    }
  }, []);

  // An automatic title runs after SSE closes. Refresh until its durable claim settles.
  const titleStatus = activeSummary?.titleStatus ?? record?.titleStatus;
  const titlePending =
    titleStatus === "generating" ||
    (titleStatus === "pending" &&
      messages.some(
        (m) =>
          m.role === "assistant" && m.status === "complete" && m.content.trim(),
      ));
  useEffect(() => {
    if (isStreaming || (!titlePending && !storedStreaming)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const detail = await apiRequest<ConversationDetail>(
          `/api/conversations/${activeId}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && !navigating.current) {
          setRecord(detail.conversation);
          if (storedStreaming) load(detail.messages.map(toUiMessage));
        }
        if (!controller.signal.aborted) await refreshHistory();
      } catch {
        if (!controller.signal.aborted)
          setError("Could not refresh saved history. Please reload to retry.");
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeId,
    isStreaming,
    storedStreaming,
    titlePending,
    load,
    refreshHistory,
  ]);

  function closeDialog() {
    if (!busy) {
      setDialog(null);
      setError("");
    }
  }
  function openSearch() {
    setError("");
    setDialog("search");
    setMobileOpen(false);
  }
  async function newChat() {
    if (locked) return;
    if (!record && isEmpty) {
      setSettings(conversationDefaults(preferences));
      setDraft("");
      setMobileOpen(false);
      setDialog(null);
      return;
    }
    setBusy(true);
    navigating.current = true;
    try {
      const next = await apiRequest<Conversation>("/api/conversations", {
        method: "POST",
        body: "{}",
      });
      router.push(`/c/${next.id}`);
    } catch (failure) {
      navigating.current = false;
      setError((failure as Error).message);
      setBusy(false);
    }
  }
  function openConversation(id: string) {
    if (locked) return;
    if (id !== activeId) {
      navigating.current = true;
      setBusy(true);
      router.push(`/c/${id}`);
    }
    setMobileOpen(false);
    setDialog(null);
  }
  async function afterTurn() {
    if (!mounted.current || navigating.current) return;
    try {
      const detail = await apiRequest<ConversationDetail>(
        `/api/conversations/${activeId}`,
      );
      if (!mounted.current || navigating.current) return;
      setRecord(detail.conversation);
      window.history.replaceState(null, "", `/c/${activeId}`);
      await refreshHistory();
    } catch {
      if (mounted.current)
        setError(
          "Could not refresh saved history. Your reply above is still available; reload to retry.",
        );
    }
  }
  function sendMessage() {
    if (!available || locked || !draft.trim()) return;
    setError("");
    void send(draft).then(afterTurn);
    setDraft("");
  }
  async function selectModel(nextModelId: string) {
    if (locked || !isEmpty || nextModelId === modelId) return;
    const next = models.find((item) => item.id === nextModelId);
    if (!next) return;
    await saveSettings(
      {
        ...settings,
        modelId: next.id,
        maxOutputTokens: Math.min(maxOutputTokens, next.maxOutputTokens),
      },
      {},
    );
  }
  async function saveSettings(
    next: ConversationSettings,
    globals: Partial<GlobalSettings>,
  ) {
    if (locked) return;
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest<Conversation>(
        record ? `/api/conversations/${activeId}` : "/api/conversations",
        {
          method: record ? "PATCH" : "POST",
          body: JSON.stringify(next),
        },
      );
      setRecord(updated);
      setActiveId(updated.id);
      setSettings(next);
      setPreferences((previous) => ({
        ...previous,
        defaultModelId: updated.modelId,
      }));
      window.history.replaceState(null, "", `/c/${updated.id}`);
      if (Object.keys(globals).length) {
        setPreferences(
          await apiRequest<GlobalSettings>("/api/settings", {
            method: "PATCH",
            body: JSON.stringify(globals),
          }),
        );
      }
      await refreshHistory();
      setDialog(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function renameConversation() {
    if (locked || !rename.trim()) return;
    setBusy(true);
    setError("");
    try {
      const updated = await apiRequest<Conversation>(
        `/api/conversations/${activeId}`,
        { method: "PATCH", body: JSON.stringify({ title: rename.trim() }) },
      );
      setRecord(updated);
      await refreshHistory();
      setDialog(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteChat() {
    if (locked) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/conversations/${activeId}`, { method: "DELETE" });
      navigating.current = true;
      router.push("/?new=1");
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }
  async function exportSaved(format: "md" | "json") {
    setError("");
    try {
      const response = await fetch(
        `/api/conversations/${activeId}/export?format=${format}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("Could not export this chat. Please retry.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? `zeus-chat.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  // Keep keyboard shortcuts current without reattaching the document listener on every streamed token.
  const shortcuts = useRef({ newChat, openSearch });
  useEffect(() => {
    shortcuts.current = { newChat, openSearch };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        shortcuts.current.openSearch();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        shortcuts.current.newChat();
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const sidebar = (mobile = false) => (
    <>
      <div className="sidebar-brand">
        <button
          className="brand-button"
          aria-label="Zeus home, new chat"
          onClick={newChat}
          disabled={locked}
        >
          <ZeusMark />
          <span>zeus</span>
        </button>
        <button
          className="icon-button sidebar-toggle"
          aria-label={mobile ? "Close sidebar" : "Collapse sidebar"}
          onClick={() =>
            mobile ? setMobileOpen(false) : setSidebarClosed(true)
          }
        >
          <Icon name="sidebar" />
        </button>
      </div>
      <nav className="sidebar-navigation" aria-label="Chat navigation">
        <button className="nav-item" onClick={newChat} disabled={locked}>
          <Icon name="compose" />
          <span>New chat</span>
          <kbd>⇧ ⌘ O</kbd>
        </button>
        <button className="nav-item" onClick={openSearch}>
          <Icon name="search" />
          <span>Search chats</span>
          <kbd>⌘ K</kbd>
        </button>
      </nav>
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        disabled={locked}
        hasMore={hasMore}
        onOpen={openConversation}
        onMore={() => {
          pages.current++;
          void refreshHistory().catch(() =>
            setError("Could not load older chats. Please retry."),
          );
        }}
      />
      <div className="sidebar-footer">
        <div className="session-note">
          <span className="status-dot" /> History saved on this server
        </div>
        <button
          className="workspace-button"
          onClick={() => {
            setDialog("settings");
            setMobileOpen(false);
          }}
        >
          <span className="workspace-avatar">Z</span>
          <span className="workspace-label">
            <strong>Personal workspace</strong>
            <span>Make yourself at home</span>
          </span>
          <Icon name="sliders" size={17} />
        </button>
      </div>
    </>
  );

  return (
    <div className={`chat-app${sidebarClosed ? " sidebar-collapsed" : ""}`}>
      <a href="#message-input" className="skip-link">
        Skip to message
      </a>
      <aside className="sidebar" aria-label="Conversation sidebar">
        {sidebar()}
      </aside>
      {mobileOpen && (
        <Dialog
          title="Your chats"
          onClose={() => setMobileOpen(false)}
          className="mobile-sidebar"
        >
          {sidebar(true)}
        </Dialog>
      )}
      <main className="chat-main">
        <header className="chat-header">
          <button
            className="header-sidebar-toggle desktop-expand"
            onClick={() => setSidebarClosed(false)}
            aria-label="Expand chats sidebar"
          >
            Chats
          </button>
          <button
            className="header-sidebar-toggle mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open chats sidebar"
          >
            Chats
          </button>
          <span className="chat-brand">Zeus Chat</span>
        </header>

        {(!isEmpty || record) && (
          <div className="conversation-heading">
            <button
              className="conversation-title"
              title="Rename conversation"
              disabled={locked}
              onClick={() => {
                setRename(conversationTitle);
                setDialog("rename");
              }}
            >
              {conversationTitle}
            </button>
            {totalTokens > 0 && (
              <span>{totalTokens.toLocaleString()} tokens</span>
            )}
          </div>
        )}

        <div className={`chat-body${isEmpty ? " is-empty" : ""}`}>
          {isEmpty ? (
            <div className="welcome">
              <div className="welcome-mark">
                <ZeusMark size={44} />
              </div>
              <p className="welcome-eyebrow">
                A little curiosity goes a long way
              </p>
              <h1>What can I help with?</h1>
            </div>
          ) : (
            <MessageList
              messages={messages}
              models={models}
              isStreaming={isStreaming || storedStreaming}
              hideThinking={preferences.hideThinking}
              available={available}
              onRetry={() => {
                void retry()?.then(afterTurn);
              }}
              onContinue={() => {
                void send("Continue.").then(afterTurn);
              }}
            />
          )}

          <div className="composer-area">
            {!model?.available && (
              <div className="setup-banner" role="status">
                <Icon name="info" size={18} />
                <span>
                  Connect {model?.displayName ?? "a model"} to start chatting.
                  Add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code>,
                  then restart the server.
                </span>
              </div>
            )}
            {error && !dialog && (
              <p className="note error" role="alert">
                {error}
              </p>
            )}
            {storedStreaming && (
              <p className="note" role="status">
                A reply is running in another tab. This chat will refresh when
                it finishes.
              </p>
            )}
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={sendMessage}
              onStop={stop}
              onSettings={() => setDialog("settings")}
              streaming={isStreaming}
              available={available}
              effort={effort}
              models={models}
              modelId={modelId}
              onModelChange={(id) => {
                void selectModel(id);
              }}
              modelLocked={locked || !isEmpty}
              inputRef={inputRef}
            />
            {isEmpty && (
              <div className="suggestions" aria-label="Conversation starters">
                {suggestions.map((item) => (
                  <button
                    key={item.title}
                    className="suggestion"
                    onClick={() => {
                      setDraft(item.text);
                      inputRef.current?.focus();
                    }}
                  >
                    <Icon name={item.icon} size={16} />
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <footer className="chat-footer" id="composer-hint">
          <span>Zeus can make mistakes. Check important information.</span>
          <span className="keyboard-hint">
            Enter to send <span>·</span> Shift + Enter for a new line
          </span>
        </footer>
      </main>

      {dialog === "search" && (
        <SearchDialog
          onClose={closeDialog}
          onOpen={openConversation}
          disabled={locked}
        />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          models={models}
          current={settings}
          preferences={preferences}
          disabled={locked}
          hasMessages={!isEmpty}
          saved={!!record}
          error={error}
          onSave={saveSettings}
          onClose={closeDialog}
          onExport={(format) => {
            void exportSaved(format);
          }}
          onDelete={() => {
            setError("");
            setDialog("delete");
          }}
        />
      )}
      {dialog === "rename" && (
        <Dialog title="Rename this chat" onClose={closeDialog}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void renameConversation();
            }}
          >
            <label className="rename-field">
              <span>Chat name</span>
              <input
                autoFocus
                value={rename}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setRename(event.target.value)}
              />
            </label>
            {error && (
              <p className="dialog-description note error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={closeDialog}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={locked || !rename.trim()}
              >
                Save name
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {dialog === "delete" && (
        <Dialog title="Delete this chat?" onClose={closeDialog}>
          <p className="dialog-description">
            “{conversationTitle}” will be hidden from your history now and
            permanently deleted after 30 days. You can export a copy first.
          </p>
          {error && (
            <p className="dialog-description note error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary-button"
              onClick={closeDialog}
              disabled={busy}
            >
              Keep chat
            </button>
            <button
              className="danger-button"
              disabled={locked}
              onClick={() => {
                void deleteChat();
              }}
            >
              Delete chat
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
