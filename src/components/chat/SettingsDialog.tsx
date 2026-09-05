"use client";

import { useState } from "react";
import type { PublicModel } from "@/lib/models/registry";
import { EFFORT_LEVELS, type Effort } from "@/lib/providers/types";
import type { ConversationSettings, GlobalSettings } from "@/lib/settings";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";

export function SettingsDialog({
  models,
  current,
  preferences,
  disabled,
  hasMessages,
  saved,
  error,
  onSave,
  onClose,
  onExport,
  onDelete,
}: {
  models: PublicModel[];
  current: ConversationSettings;
  preferences: GlobalSettings;
  disabled: boolean;
  hasMessages: boolean;
  saved: boolean;
  error: string;
  onSave: (
    settings: ConversationSettings,
    preferences: Partial<GlobalSettings>,
  ) => Promise<void>;
  onClose: () => void;
  onExport: (format: "md" | "json") => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(current);
  const [theme, setTheme] = useState(preferences.theme);
  const [hideThinking, setHideThinking] = useState(preferences.hideThinking);
  const [defaults, setDefaults] = useState(false);
  const model = models.find((item) => item.id === draft.modelId)!;
  return (
    <Dialog title="Make Zeus your own" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(draft, {
            theme,
            hideThinking,
            ...(defaults
              ? {
                  defaultModelId: draft.modelId,
                  defaultSystemPrompt: draft.systemPrompt,
                  defaultEffort: draft.effort,
                }
              : {}),
          });
        }}
      >
        <p className="dialog-description">
          Conversation settings apply to the next message.
        </p>
        <div className="settings-content">
          <label className="setting-field">
            <span>Model</span>
            <select
              value={draft.modelId}
              disabled={disabled || hasMessages}
              onChange={(event) => {
                const next = models.find(
                  (item) => item.id === event.target.value,
                )!;
                setDraft({
                  ...draft,
                  modelId: next.id,
                  maxOutputTokens: Math.min(
                    draft.maxOutputTokens,
                    next.maxOutputTokens,
                  ),
                });
              }}
            >
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field">
            <span>
              Thinking effort
              <small>Give complex questions a little more thought.</small>
            </span>
            <select
              value={draft.effort}
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, effort: event.target.value as Effort })
              }
            >
              {EFFORT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level === "xhigh"
                    ? "Extra high"
                    : level === "max"
                      ? "Maximum"
                      : level[0].toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field">
            <span>
              Response limit<small>Maximum tokens per reply.</small>
            </span>
            <input
              type="number"
              min={1}
              max={model.maxOutputTokens}
              required
              value={draft.maxOutputTokens}
              disabled={disabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  maxOutputTokens: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="setting-field system-setting">
            <span>
              Custom instructions
              <small>What should Zeus know about how you like to work?</small>
            </span>
            <textarea
              rows={4}
              value={draft.systemPrompt}
              maxLength={100000}
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, systemPrompt: event.target.value })
              }
              placeholder="For example, keep answers concise and use practical examples."
            />
          </label>
          <label className="setting-field">
            <span>
              Use for new chats
              <small>
                Save this model, effort and instructions as your defaults.
              </small>
            </span>
            <input
              type="checkbox"
              checked={defaults}
              disabled={disabled}
              onChange={(event) => setDefaults(event.target.checked)}
            />
          </label>
          <label className="setting-field">
            <span>
              Hide thinking summaries
              <small>
                Applies to all chats. Summaries remain in saved exports.
              </small>
            </span>
            <input
              type="checkbox"
              checked={hideThinking}
              disabled={disabled}
              onChange={(event) => setHideThinking(event.target.checked)}
            />
          </label>
          <div className="setting-field">
            <span>
              Appearance<small>Saved for your workspace.</small>
            </span>
            <div className="theme-options">
              {(["light", "dark"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={theme === value ? "selected" : ""}
                  aria-pressed={theme === value}
                  disabled={disabled}
                  onClick={() => setTheme(value)}
                >
                  <Icon name={value === "light" ? "sun" : "moon"} size={16} />
                  {value === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>
          {saved && (
            <div className="setting-field">
              <span>Conversation</span>
              <div className="conversation-settings-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onExport("md")}
                  aria-label="Export conversation as Markdown"
                >
                  Markdown
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onExport("json")}
                  aria-label="Export conversation as JSON"
                >
                  JSON
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  onClick={onDelete}
                  aria-label="Delete conversation"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
        {error && (
          <p className="dialog-description note error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={disabled}
          >
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={disabled}>
            Save settings
          </button>
        </div>
      </form>
    </Dialog>
  );
}
