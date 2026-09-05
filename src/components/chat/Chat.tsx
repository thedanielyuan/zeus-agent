"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStream, type UiMessage } from "@/hooks/use-chat-stream";
import { useTheme } from "@/hooks/use-theme";
import type { PublicModel } from "@/lib/models/registry";
import { EFFORT_LEVELS, type Effort } from "@/lib/providers/types";
import { Dialog } from "@/components/ui/dialog";
import { Icon, ZeusMark, type IconName } from "@/components/ui/icon";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatProps {
  models: PublicModel[];
  defaultModelId: string;
}
interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  modelId: string;
  system: string;
  effort: Effort;
  maxOutputTokens: number;
  messages: UiMessage[];
}
type OpenDialog = "search" | "settings" | "rename" | "delete" | null;

const suggestions: {
  icon: IconName;
  title: string;
  text: string;
  color: string;
}[] = [
  {
    icon: "pen",
    title: "Write something",
    text: "Help me turn a rough idea into something worth reading. Ask me what I have in mind.",
    color: "orange",
  },
  {
    icon: "bulb",
    title: "Explore an idea",
    text: "Help me brainstorm a fresh idea for a small, creative project. Ask me about my interests first.",
    color: "yellow",
  },
  {
    icon: "code",
    title: "Build with code",
    text: "Be my coding partner. Help me break a project into simple steps, starting with what I want to build.",
    color: "blue",
  },
  {
    icon: "book",
    title: "Learn something",
    text: "Help me understand something new. Ask me what I am curious about and explain it with a simple example.",
    color: "green",
  },
];
const effortNames: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

function groupDate(timestamp: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return days === 0
    ? "Today"
    : days === 1
      ? "Yesterday"
      : days < 7
        ? "Previous 7 days"
        : "Older";
}

export function Chat({ models, defaultModelId }: ChatProps) {
  const [modelId, setModelId] = useState(defaultModelId);
  const [system, setSystem] = useState("");
  const [effort, setEffort] = useState<Effort>("high");
  const [maxOutputTokens, setMaxOutputTokens] = useState(64_000);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("new-chat");
  const [title, setTitle] = useState("");
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [query, setQuery] = useState("");
  const [rename, setRename] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDetailsElement>(null);
  const { theme, setTheme } = useTheme();
  const model = models.find((item) => item.id === modelId) ?? models[0];
  const { messages, isStreaming, send, stop, reset, retry, load } =
    useChatStream({ modelId, system, effort, maxOutputTokens });
  const available = model?.available ?? false;
  const isEmpty = messages.length === 0;
  const conversationTitle =
    title ||
    messages
      .find((message) => message.role === "user")
      ?.content.replace(/\s+/g, " ")
      .slice(0, 52) ||
    "New chat";
  const current: Conversation = {
    id: activeId,
    title: conversationTitle,
    updatedAt: messages.at(-1)?.createdAt ?? 0,
    modelId,
    system,
    effort,
    maxOutputTokens,
    messages,
  };
  const conversations = [
    ...saved.filter((item) => item.id !== activeId),
    ...(isEmpty ? [] : [current]),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchResults = conversations.filter(
    (item) =>
      !normalizedQuery ||
      `${item.title} ${item.messages.map((message) => message.content).join(" ")}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
  );
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

  function closeDialog() {
    setDialog(null);
  }
  function openSearch() {
    setQuery("");
    setDialog("search");
    setMobileOpen(false);
  }
  function newChat() {
    if (isStreaming) return;
    if (!isEmpty) {
      setSaved(conversations);
      setActiveId(crypto.randomUUID());
      reset();
      setTitle("");
    }
    setDraft("");
    setMobileOpen(false);
    setDialog(null);
    inputRef.current?.focus();
  }
  function openConversation(item: Conversation) {
    if (isStreaming) return;
    setSaved(conversations);
    load(item.messages);
    setActiveId(item.id);
    setTitle(item.title);
    setModelId(item.modelId);
    setSystem(item.system);
    setEffort(item.effort);
    setMaxOutputTokens(item.maxOutputTokens);
    setDraft("");
    setMobileOpen(false);
    setDialog(null);
    inputRef.current?.focus();
  }
  function sendMessage() {
    if (!available || isStreaming || !draft.trim()) return;
    void send(draft);
    setDraft("");
  }
  function exportConversation() {
    const text = `# ${conversationTitle}\n\n${messages
      .map(
        (message) =>
          `## ${message.role === "user" ? "You" : (models.find((item) => item.id === message.modelId)?.displayName ?? "Assistant")}\n\n${message.content}${message.thinking ? `\n\n<details><summary>Thinking</summary>\n\n${message.thinking}\n\n</details>` : ""}`,
      )
      .join("\n\n---\n\n")}\n`;
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${conversationTitle.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "zeus-chat"}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        if (modelMenuRef.current) modelMenuRef.current.open = false;
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(event.target as Node)
      )
        modelMenuRef.current.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const sidebar = (mobile = false) => (
    <>
      <div className="sidebar-brand">
        <button
          className="brand-button"
          aria-label="Zeus home, new chat"
          onClick={newChat}
          disabled={isStreaming}
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
        <button className="nav-item" onClick={newChat} disabled={isStreaming}>
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
      <div className="sidebar-history">
        {conversations.length === 0 ? (
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
                groupDate(item.updatedAt) !==
                  groupDate(conversations[index - 1].updatedAt)) && (
                <h2 className="history-heading">{groupDate(item.updatedAt)}</h2>
              )}
              <button
                className={`history-item${activeId === item.id ? " active" : ""}`}
                disabled={isStreaming}
                onClick={() => openConversation(item)}
                aria-current={activeId === item.id ? "page" : undefined}
                title={item.title}
              >
                <span>{item.title}</span>
              </button>
            </div>
          ))
        )}
      </div>
      <div className="sidebar-footer">
        <div className="session-note">
          <span className="status-dot" /> Chats stay in this session
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
    <div
      className={`chat-app${sidebarClosed ? " sidebar-collapsed" : ""}`}
      data-theme={theme}
    >
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
            className="icon-button desktop-expand"
            onClick={() => setSidebarClosed(false)}
            aria-label="Expand sidebar"
          >
            <Icon name="sidebar" />
          </button>
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open sidebar"
          >
            <Icon name="sidebar" />
          </button>
          <details className="model-menu" ref={modelMenuRef}>
            <summary aria-label="Choose model">
              <span>Zeus Chat</span>
              <Icon name="chevronDown" size={18} />
              <span className="header-model">
                {model?.displayName ?? "Choose a model"}
              </span>
            </summary>
            <div className="model-popover">
              <p className="popover-label">Choose your model</p>
              {models.map((item) => (
                <button
                  key={item.id}
                  disabled={isStreaming}
                  className="model-option"
                  onClick={() => {
                    setModelId(item.id);
                    setMaxOutputTokens((value) =>
                      Math.min(value, item.maxOutputTokens),
                    );
                    if (modelMenuRef.current) modelMenuRef.current.open = false;
                  }}
                >
                  <span className="model-icon">
                    <Icon name="sparkles" />
                  </span>
                  <span>
                    <strong>{item.displayName}</strong>
                    <small>
                      {item.available
                        ? "Ready for your next idea"
                        : "Connection required"}
                    </small>
                  </span>
                  {item.id === modelId && <Icon name="check" size={17} />}
                </button>
              ))}
              <button
                className="popover-settings"
                onClick={() => {
                  if (modelMenuRef.current) modelMenuRef.current.open = false;
                  setDialog("settings");
                }}
              >
                <Icon name="sliders" size={16} /> Model settings
              </button>
            </div>
          </details>
          <div className="header-actions">
            {!isEmpty && (
              <button
                className="icon-button"
                onClick={exportConversation}
                aria-label="Export conversation as Markdown"
                title="Export conversation"
              >
                <Icon name="download" size={19} />
              </button>
            )}
            <button
              className="icon-button theme-toggle"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} size={19} />
            </button>
            <button
              className="header-avatar"
              onClick={() => setDialog("settings")}
              aria-label="Open settings"
            >
              Z
            </button>
          </div>
        </header>

        {!isEmpty && (
          <div className="conversation-heading">
            <button
              className="conversation-title"
              title="Rename conversation"
              disabled={isStreaming}
              onClick={() => {
                setRename(conversationTitle);
                setDialog("rename");
              }}
            >
              {conversationTitle}
              <Icon name="pen" size={13} />
            </button>
            {totalTokens > 0 && (
              <span>{totalTokens.toLocaleString()} tokens</span>
            )}
            <button
              className="icon-button"
              disabled={isStreaming}
              aria-label="Delete conversation"
              title="Delete conversation"
              onClick={() => setDialog("delete")}
            >
              <Icon name="trash" size={15} />
            </button>
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
              isStreaming={isStreaming}
              available={available}
              onRetry={() => {
                void retry();
              }}
              onContinue={() => {
                void send("Continue.");
              }}
            />
          )}

          <div className="composer-area">
            {!available && (
              <div className="setup-banner" role="status">
                <Icon name="info" size={18} />
                <span>
                  Connect {model?.displayName ?? "a model"} to start chatting.
                  Add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code>,
                  then restart the server.
                </span>
              </div>
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
                    <Icon
                      name={item.icon}
                      size={17}
                      className={`suggestion-${item.color}`}
                    />
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
        <Dialog
          title="Search your chats"
          onClose={closeDialog}
          className="search-dialog"
        >
          <div className="search-input">
            <Icon name="search" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title or message…"
              aria-label="Search conversations"
            />
            <kbd>esc</kbd>
          </div>
          <div className="search-results">
            {searchResults.length ? (
              searchResults.map((item) => (
                <button
                  key={item.id}
                  className="search-result"
                  disabled={isStreaming}
                  onClick={() => openConversation(item)}
                >
                  <Icon name="chat" size={20} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.messages
                        .find((message) =>
                          message.content
                            .toLocaleLowerCase()
                            .includes(normalizedQuery),
                        )
                        ?.content.slice(0, 110)}
                    </small>
                  </span>
                  <Icon name="arrowRight" size={16} />
                </button>
              ))
            ) : (
              <div className="search-empty">
                <Icon name="search" size={30} />
                <h3>
                  {query
                    ? "No chats found"
                    : "Your next conversation starts here"}
                </h3>
                <p>
                  {query
                    ? "Try a different word or phrase."
                    : "Start a chat and you can find it here."}
                </p>
              </div>
            )}
          </div>
          <div className="dialog-footnote">
            Searches conversations from this session.
          </div>
        </Dialog>
      )}

      {dialog === "settings" && (
        <Dialog title="Make Zeus your own" onClose={closeDialog}>
          <p className="dialog-description">
            A few preferences for this conversation.
          </p>
          <div className="settings-content">
            <label className="setting-field">
              <span>Model</span>
              <select
                value={modelId}
                disabled={isStreaming}
                onChange={(event) => {
                  setModelId(event.target.value);
                  const next = models.find(
                    (item) => item.id === event.target.value,
                  );
                  if (next)
                    setMaxOutputTokens((value) =>
                      Math.min(value, next.maxOutputTokens),
                    );
                }}
              >
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            {model?.capabilities.effort && (
              <label className="setting-field">
                <span>
                  Thinking effort
                  <small>Give complex questions a little more thought.</small>
                </span>
                <select
                  value={effort}
                  disabled={isStreaming}
                  onChange={(event) => setEffort(event.target.value as Effort)}
                >
                  {EFFORT_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {effortNames[level]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="setting-field">
              <span>
                Response limit<small>Maximum tokens per reply.</small>
              </span>
              <select
                value={maxOutputTokens}
                disabled={isStreaming}
                onChange={(event) =>
                  setMaxOutputTokens(Number(event.target.value))
                }
              >
                {[2048, 8192, 16384, 64000, model?.maxOutputTokens ?? 64000]
                  .filter(
                    (value, index, values) =>
                      values.indexOf(value) === index &&
                      value <= (model?.maxOutputTokens ?? 64000),
                  )
                  .map((value) => (
                    <option key={value} value={value}>
                      {value.toLocaleString()}
                    </option>
                  ))}
              </select>
            </label>
            <label className="setting-field system-setting">
              <span>
                Custom instructions
                <small>What should Zeus know about how you like to work?</small>
              </span>
              <textarea
                rows={4}
                value={system}
                maxLength={100000}
                disabled={isStreaming}
                onChange={(event) => setSystem(event.target.value)}
                placeholder="For example, keep answers concise and use practical examples."
              />
            </label>
            <div className="setting-field">
              <span>
                Appearance
                <small>Your theme is remembered on this device.</small>
              </span>
              <div className="theme-options">
                <button
                  className={theme === "light" ? "selected" : ""}
                  aria-pressed={theme === "light"}
                  onClick={() => setTheme("light")}
                >
                  <Icon name="sun" size={16} /> Light
                </button>
                <button
                  className={theme === "dark" ? "selected" : ""}
                  aria-pressed={theme === "dark"}
                  onClick={() => setTheme("dark")}
                >
                  <Icon name="moon" size={16} /> Dark
                </button>
              </div>
            </div>
          </div>
          <div className="dialog-actions">
            <span>
              {isStreaming
                ? "Conversation settings unlock when the reply finishes."
                : "Changes apply to your next message."}
            </span>
            <button className="primary-button" onClick={closeDialog}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "rename" && (
        <Dialog title="Rename this chat" onClose={closeDialog}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (rename.trim()) {
                setTitle(rename.trim());
                closeDialog();
              }
            }}
          >
            <label className="rename-field">
              <span>Chat name</span>
              <input
                autoFocus
                value={rename}
                maxLength={200}
                onChange={(event) => setRename(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={!rename.trim()}
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
            “{conversationTitle}” will be removed from this session. You can
            export a copy first.
          </p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={closeDialog}>
              Keep chat
            </button>
            <button
              className="danger-button"
              onClick={() => {
                setSaved(conversations.filter((item) => item.id !== activeId));
                reset();
                setActiveId(crypto.randomUUID());
                setTitle("");
                setDraft("");
                closeDialog();
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
