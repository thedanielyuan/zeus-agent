"use client";

import { useEffect, useRef, useState } from "react";
import type { UiMessage } from "@/hooks/use-chat-stream";
import type { PublicModel } from "@/lib/models/registry";
import { Icon, ZeusMark } from "@/components/ui/icon";
import { CopyButton, Markdown } from "./markdown";

interface MessageListProps {
  messages: UiMessage[];
  models: PublicModel[];
  isStreaming: boolean;
  available: boolean;
  onRetry: () => void;
  onContinue: () => void;
}

export function MessageList({
  messages,
  models,
  isStreaming,
  available,
  onRetry,
  onContinue,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const last = messages.at(-1);

  useEffect(() => {
    if (follow.current || last?.role === "user")
      endRef.current?.scrollIntoView({ block: "end" });
  }, [
    last?.content,
    last?.thinking,
    last?.status,
    last?.role,
    messages.length,
  ]);

  return (
    <section
      className="message-scroll"
      aria-label="Conversation"
      ref={scrollRef}
      onScroll={() => {
        const element = scrollRef.current;
        if (!element) return;
        follow.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        setShowJump(!follow.current);
      }}
    >
      <div className="messages">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            modelName={
              models.find((model) => model.id === m.modelId)?.displayName
            }
            canRetry={m === last && available && !isStreaming}
            onRetry={onRetry}
            onContinue={onContinue}
          />
        ))}
        <div ref={endRef} />
      </div>
      {showJump && (
        <button
          className="jump-to-bottom icon-button"
          aria-label="Scroll to latest message"
          onClick={() => {
            follow.current = true;
            endRef.current?.scrollIntoView({
              block: "end",
              behavior: "smooth",
            });
          }}
        >
          <Icon name="arrowDown" size={18} />
        </button>
      )}
      <span role="status" className="sr-only">
        {isStreaming ? "Zeus is responding" : "Response finished"}
      </span>
    </section>
  );
}

function MessageBubble({
  message: m,
  modelName,
  canRetry,
  onRetry,
  onContinue,
}: {
  message: UiMessage;
  modelName?: string;
  canRetry: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const streaming = m.status === "streaming";
  return (
    <article
      className={`message ${m.role}`}
      data-status={m.status}
      aria-label={`${m.role === "user" ? "Your" : "Assistant"} message`}
    >
      {m.role === "assistant" && (
        <div className="assistant-avatar">
          <ZeusMark size={28} />
        </div>
      )}
      <div className="message-content">
        <div className="message-meta">
          <span className="role">{m.role === "user" ? "You" : "Zeus"}</span>
          {m.createdAt && (
            <time dateTime={new Date(m.createdAt).toISOString()}>
              {new Date(m.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
        </div>

        {m.thinking && (
          <details className="thinking">
            <summary>
              <Icon name="sparkles" size={15} /> Thinking
              {streaming && !m.content ? "…" : ""}
              <Icon name="chevronRight" size={14} />
            </summary>
            <pre>{m.thinking}</pre>
          </details>
        )}

        <div
          className={`message-body${m.role === "assistant" ? " markdown" : ""}`}
        >
          {m.role === "assistant" ? (
            <Markdown>{m.content}</Markdown>
          ) : (
            m.content
          )}
          {streaming && (
            <span className="streaming-dot" aria-label="Responding" />
          )}
        </div>

        {m.status === "interrupted" && (
          <p className="note">
            {m.stopReason === "cancelled"
              ? "You stopped this response."
              : "The connection ended before the reply finished."}
          </p>
        )}
        {m.stopReason === "max_tokens" && (
          <p className="note">
            This reply reached the output limit.{" "}
            {canRetry && (
              <button className="text-button" onClick={onContinue}>
                Continue response <Icon name="arrowRight" size={14} />
              </button>
            )}
          </p>
        )}
        {m.stopReason === "context_exceeded" && (
          <p className="note">
            The conversation exceeded the model&apos;s context window.
          </p>
        )}
        {m.status === "refused" && (
          <p className="note error">
            The model declined this request
            {m.refusal?.category ? ` (${m.refusal.category})` : ""}.
            {m.refusal?.explanation ? ` ${m.refusal.explanation}` : ""}
          </p>
        )}
        {m.status === "error" && m.error && (
          <p className="note error" role="alert">
            <Icon name="info" size={17} /> {m.error.message}
          </p>
        )}
        {m.role === "assistant" && m.status === "error" && !m.error && (
          <p className="note error" role="alert">
            The response could not be completed. Please try again.
          </p>
        )}
        {!streaming && (
          <div className="message-actions">
            {m.content && <CopyButton text={m.content} />}
            {m.role === "assistant" && canRetry && (
              <button
                className="icon-button"
                onClick={onRetry}
                aria-label={
                  m.status === "error" || m.status === "interrupted"
                    ? "Retry response"
                    : "Regenerate response"
                }
                title={
                  m.status === "error" || m.status === "interrupted"
                    ? "Retry response"
                    : "Regenerate response"
                }
              >
                <Icon name="refresh" size={16} />
              </button>
            )}
            {m.role === "assistant" && (
              <span className="message-model" title={m.modelId}>
                {modelName ?? m.modelId}
              </span>
            )}
            {m.usage && (
              <span
                className="usage"
                title={`${m.usage.inputTokens} input · ${m.usage.outputTokens} output · ${m.usage.cacheReadTokens} cache read · ${m.usage.cacheWriteTokens} cache write tokens`}
              >
                {(
                  m.usage.inputTokens +
                  m.usage.outputTokens +
                  m.usage.cacheReadTokens +
                  m.usage.cacheWriteTokens
                ).toLocaleString()}{" "}
                tokens
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
