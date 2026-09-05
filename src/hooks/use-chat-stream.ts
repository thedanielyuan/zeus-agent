"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSSE } from "@/lib/chat/sse-parse";
import type { ChatErrorCode } from "@/lib/errors";
import type {
  ChatEvent,
  ChatMessage,
  Effort,
  RefusalDetails,
  StopReason,
  Usage,
} from "@/lib/providers/types";

export type UiStatus =
  "complete" | "streaming" | "interrupted" | "error" | "refused";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  thinking: string;
  modelId?: string;
  status: UiStatus;
  stopReason?: StopReason;
  usage?: Usage;
  error?: { code: ChatErrorCode | string; message: string; retryable: boolean };
  refusal?: RefusalDetails;
}

export interface ChatSettings {
  modelId: string;
  system?: string;
  effort?: Effort;
  maxOutputTokens?: number;
}

let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function useChatStream(settings: ChatSettings) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  const messagesRef = useRef<UiMessage[]>([]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const replaceMessages = useCallback((next: UiMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const patch = useCallback(
    (id: string, fn: (m: UiMessage) => UiMessage) => {
      replaceMessages(
        messagesRef.current.map((m) => (m.id === id ? fn(m) : m)),
      );
    },
    [replaceMessages],
  );

  const sendTurn = useCallback(
    async (content: string, previous: UiMessage[]) => {
      const text = content.trim();
      if (!text || abortRef.current) return;

      const { modelId, system, effort, maxOutputTokens } = settingsRef.current;
      const userMsg: UiMessage = {
        id: nextId(),
        role: "user",
        content: text,
        thinking: "",
        status: "complete",
        createdAt: Date.now(),
      };
      const assistantId = nextId();
      const assistantMsg: UiMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        thinking: "",
        modelId,
        status: "streaming",
        createdAt: Date.now(),
      };

      // Build the provider history from what the model is allowed to see.
      const history: ChatMessage[] = previous
        .filter((m) => m.status === "complete" || m.status === "interrupted")
        .filter((m) => m.content.length > 0)
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: text });
      replaceMessages([...previous, userMsg, assistantMsg]);

      const abort = new AbortController();
      abortRef.current = abort;
      setIsStreaming(true);

      // Batch deltas per animation frame so long replies don't thrash React.
      let pendingText = "";
      let pendingThinking = "";
      let raf = 0;
      const flush = () => {
        raf = 0;
        if (!pendingText && !pendingThinking) return;
        const t = pendingText;
        const th = pendingThinking;
        pendingText = "";
        pendingThinking = "";
        patch(assistantId, (m) => ({
          ...m,
          content: m.content + t,
          thinking: m.thinking + th,
        }));
      };
      const schedule = () => {
        if (!raf) raf = requestAnimationFrame(flush);
      };
      const finish = (fn: (m: UiMessage) => UiMessage) => {
        if (raf) cancelAnimationFrame(raf);
        flush();
        patch(assistantId, fn);
      };

      const apply = (event: ChatEvent) => {
        switch (event.type) {
          case "text_delta":
            pendingText += event.text;
            schedule();
            break;
          case "thinking_delta":
            pendingThinking += event.text;
            schedule();
            break;
          case "usage":
            patch(assistantId, (m) => ({ ...m, usage: event.usage }));
            break;
          case "stop":
            finish((m) => ({
              ...m,
              stopReason: event.reason,
              status:
                event.reason === "refusal"
                  ? "refused"
                  : event.reason === "cancelled"
                    ? "interrupted"
                    : event.reason === "error"
                      ? "error"
                      : "complete",
              refusal: event.details,
            }));
            break;
          case "error":
            finish((m) => ({
              ...m,
              status: "error",
              error: {
                code: event.code,
                message: event.message,
                retryable: event.retryable,
              },
            }));
            break;
          case "message_start":
            break;
        }
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId,
            system: system || undefined,
            effort,
            maxOutputTokens,
            messages: history,
          }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as {
            code?: string;
            message?: string;
          } | null;
          finish((m) => ({
            ...m,
            status: "error",
            error: {
              code: err?.code ?? "unknown",
              message: err?.message ?? `Request failed (${res.status})`,
              retryable: res.status >= 500,
            },
          }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSSE(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) apply(event);
        }
        // A stream that ended without a terminal frame was cut off.
        finish((m) =>
          m.status === "streaming" ? { ...m, status: "interrupted" } : m,
        );
      } catch (err) {
        if (abort.signal.aborted) {
          finish((m) => ({
            ...m,
            status: "interrupted",
            stopReason: "cancelled",
          }));
        } else {
          finish((m) => ({
            ...m,
            status: "error",
            error: {
              code: "network",
              message: err instanceof Error ? err.message : "Network error",
              retryable: true,
            },
          }));
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [patch, replaceMessages],
  );

  const send = useCallback(
    (content: string) => sendTurn(content, messagesRef.current),
    [sendTurn],
  );

  const retry = useCallback(() => {
    const current = messagesRef.current;
    const userIndex = current.findLastIndex(
      (message) => message.role === "user",
    );
    if (userIndex >= 0)
      return sendTurn(current[userIndex].content, current.slice(0, userIndex));
  }, [sendTurn]);

  const load = useCallback(
    (next: UiMessage[]) => {
      if (!abortRef.current) replaceMessages(next);
    },
    [replaceMessages],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    if (!abortRef.current) replaceMessages([]);
  }, [replaceMessages]);

  return { messages, isStreaming, send, stop, reset, retry, load };
}
