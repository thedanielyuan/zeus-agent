import { getDb, type Db } from "@/lib/db/client";
import { ChatError } from "@/lib/errors";
import { getModel } from "@/lib/models/registry";
import {
  credentialHint,
  getProvider,
  isVendorAvailable,
} from "@/lib/providers";
import type { ChatEvent, ChatProvider, Usage } from "@/lib/providers/types";
import {
  finishTurn,
  prepareTurn,
  saveProgress,
  type TurnResult,
} from "@/lib/repo/messages";
import type { TurnInput } from "./request";

export const TURN_TIMEOUT_MS = 10 * 60 * 1000;
export const CHECKPOINT_MS = 250;
type Terminal = Extract<ChatEvent, { type: "stop" | "error" }>;

async function nextEvent(
  iterator: AsyncIterator<ChatEvent>,
  signal: AbortSignal,
) {
  if (signal.aborted) return undefined;
  let onAbort: () => void;
  const cancelled = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), cancelled]);
  } finally {
    // Do not retain one pending cancellation callback for every streamed token.
    signal.removeEventListener("abort", onAbort!);
  }
}

interface TurnOptions {
  signal: AbortSignal;
  /** Offline fixtures use a real temporary database and a scripted provider. */
  db?: Db;
  provider?: ChatProvider;
  timeoutMs?: number;
}

/** Persist the claim now; consume the provider only when the SSE reader starts. */
export function runTurn(input: TurnInput, options: TurnOptions) {
  if (options.signal.aborted)
    throw new ChatError("cancelled", "Request cancelled.", true, 499);
  const model = getModel(input.modelId);
  if (!model)
    throw new ChatError("unknown_model", "Unknown model.", false, 400);
  if (!options.provider && !isVendorAvailable(model.vendor)) {
    throw new ChatError(
      "no_credentials",
      credentialHint(model.vendor),
      false,
      503,
    );
  }
  const provider = options.provider ?? getProvider(model.vendor);
  const selectedModel = model;
  const db = options.db ?? getDb();
  const turn = prepareTurn(db, input, model);
  const abort = new AbortController();
  let content = "";
  let thinking = "";
  let usage: Usage | undefined;
  let terminal: Terminal | undefined;
  let checkpoint: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    clearTimeout(checkpoint);
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", cancel);
  };

  // Disconnect/timeout persistence must not depend on another provider token
  // or the browser requesting another SSE frame.
  function finish(event: Terminal) {
    if (terminal) return;
    const interrupted =
      event.type === "stop"
        ? event.reason === "cancelled"
        : event.code === "timeout" || event.code === "network";
    const result: TurnResult = {
      content,
      thinking,
      status: interrupted
        ? "interrupted"
        : event.type === "error" || event.reason === "error"
          ? "error"
          : event.reason === "refusal"
            ? "refused"
            : "complete",
      stopReason: event.type === "stop" ? event.reason : "error",
      errorCode: event.type === "error" ? event.code : undefined,
      refusalDetails: event.type === "stop" ? event.details : undefined,
      usage: interrupted ? undefined : usage,
    };
    try {
      finishTurn(db, input.conversationId, turn.assistantMessageId, result);
      terminal = event;
    } catch {
      terminal = {
        type: "error",
        code: "server",
        message:
          "Could not save the response. Check the server's database and retry.",
        retryable: true,
      };
      usage = undefined;
    }
    if (interrupted) usage = undefined;
    cleanup();
    abort.abort();
  }

  function cancel() {
    finish({ type: "stop", reason: "cancelled" });
  }

  function scheduleCheckpoint() {
    if (checkpoint !== undefined) return;
    checkpoint = setTimeout(() => {
      checkpoint = undefined;
      if (terminal) return;
      try {
        saveProgress(db, turn.assistantMessageId, content, thinking);
      } catch {
        finish({
          type: "error",
          code: "server",
          message:
            "Could not save the response. Check the server's database and retry.",
          retryable: true,
        });
      }
    }, CHECKPOINT_MS);
  }

  options.signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(
    () =>
      finish({
        type: "error",
        code: "timeout",
        message:
          "The response timed out after 10 minutes. Your partial reply was saved. Try again.",
        retryable: true,
      }),
    options.timeoutMs ?? TURN_TIMEOUT_MS,
  );
  if (options.signal.aborted) cancel();

  async function* events(): AsyncGenerator<ChatEvent> {
    let iterator: AsyncIterator<ChatEvent> | undefined;
    try {
      if (!terminal) {
        iterator = provider
          .stream(
            {
              model: selectedModel,
              system: turn.settings.systemPrompt ?? undefined,
              messages: turn.history,
              effort: input.effort,
              maxOutputTokens: turn.settings.maxOutputTokens,
              thinkingDisplay: "summarized",
            },
            abort.signal,
          )
          [Symbol.asyncIterator]();
      }
      while (!terminal && iterator) {
        // A hung provider cannot keep the turn open beyond its deadline.
        const next = await nextEvent(iterator, abort.signal);
        if (terminal) break;
        if (!next || next.done) {
          finish({
            type: "error",
            code: "network",
            message:
              "The connection ended before the reply finished. Try again.",
            retryable: true,
          });
          break;
        }
        const event = next.value;
        switch (event.type) {
          case "text_delta":
            content += event.text;
            scheduleCheckpoint();
            yield event;
            break;
          case "thinking_delta":
            thinking += event.text;
            scheduleCheckpoint();
            yield event;
            break;
          case "usage":
            usage = event.usage;
            break;
          case "error":
          case "stop":
            finish(event);
            break;
          case "message_start":
            yield event;
            break;
        }
      }
    } catch {
      // Exception text can contain request content or credentials.
      finish({
        type: "error",
        code: "unknown",
        message: "The response could not be completed. Try again.",
        retryable: true,
      });
    } finally {
      if (!terminal) cancel();
      cleanup();
      // Abort has already been delivered; an uncooperative iterator must not
      // block cancellation forever. Still observe its rejection.
      void Promise.resolve()
        .then(() => iterator?.return?.())
        .catch(() => {});
    }
    // Commit the final row before exposing usage or a terminal frame.
    if (usage) yield { type: "usage", usage };
    if (terminal) yield terminal;
  }

  return {
    assistantMessageId: turn.assistantMessageId,
    events: events(),
    cancel,
  };
}
