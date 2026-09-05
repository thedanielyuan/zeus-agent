"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Effort } from "@/lib/providers/types";
import { Icon } from "@/components/ui/icon";

const effortLabels: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onSettings,
  streaming,
  available,
  effort,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onSettings: () => void;
  streaming: boolean;
  available: boolean;
  effort: Effort;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const composing = useRef(false);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value, inputRef]);

  return (
    <form
      className={`composer${streaming ? " is-streaming" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!streaming && available && value.trim()) onSend();
      }}
    >
      <label className="sr-only" htmlFor="message-input">
        Message Zeus
      </label>
      <textarea
        id="message-input"
        ref={inputRef}
        placeholder="Ask anything"
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            !composing.current
          ) {
            event.preventDefault();
            if (!streaming && available && value.trim()) onSend();
          }
        }}
        aria-describedby="composer-hint"
      />
      <div className="composer-toolbar">
        <button
          className="composer-settings"
          type="button"
          onClick={onSettings}
          title="Conversation settings"
          aria-label="Conversation settings"
        >
          <Icon name="sliders" size={18} />
          <span>Settings</span>
        </button>
        <button
          className="effort-pill"
          type="button"
          onClick={onSettings}
          title="Change thinking effort"
        >
          <Icon name="sparkles" size={15} />
          <span>{effortLabels[effort]} effort</span>
        </button>
        <div className="composer-toolbar-spacer" />
        {value.length > 0 && (
          <span className="character-count" title="Character count">
            {value.length.toLocaleString()}
          </span>
        )}
        {streaming ? (
          <button
            className="send-button"
            type="button"
            onClick={onStop}
            aria-label="Stop response"
            title="Stop response"
          >
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button
            className="send-button"
            type="submit"
            disabled={!available || !value.trim()}
            aria-label="Send message"
            title={
              available ? "Send message" : "Connect a model to send messages"
            }
          >
            <Icon name="arrowUp" size={22} />
          </button>
        )}
      </div>
    </form>
  );
}
