import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { ChatErrorCode } from "@/lib/errors";
import type { ChatEvent, ChatProvider, ChatRequest, Usage } from "./types";

/**
 * The only module that imports @anthropic-ai/sdk.
 *
 * Request shape (see ARCHITECTURE.md §4.2): streaming always, adaptive thinking
 * with an explicit display mode, effort inside output_config, an explicit cache
 * breakpoint on the system prompt plus top-level automatic caching for the
 * conversation tail. Never sends temperature/top_p/top_k, budget_tokens, or an
 * assistant prefill; Claude Sonnet 5 rejects all of them.
 */
export function buildParams(req: ChatRequest): Anthropic.MessageStreamParams {
  const params: Anthropic.MessageStreamParams = {
    model: req.model.id,
    max_tokens: Math.min(req.maxOutputTokens, req.model.maxOutputTokens),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (req.system) {
    params.system = [
      {
        type: "text",
        text: req.system,
        ...(req.model.capabilities.caching ? { cache_control: { type: "ephemeral" } } : {}),
      },
    ];
  }
  if (req.model.capabilities.caching) {
    params.cache_control = { type: "ephemeral" };
  }
  if (req.model.capabilities.thinking) {
    params.thinking = { type: "adaptive", display: req.thinkingDisplay };
  }
  if (req.effort && req.model.capabilities.effort) {
    params.output_config = { effort: req.effort };
  }
  return params;
}

export function toUsage(u: Anthropic.Usage): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

export function toStopEvent(final: Anthropic.Message): ChatEvent {
  switch (final.stop_reason) {
    case null:
    case "end_turn":
    case "stop_sequence":
      return { type: "stop", reason: "end" };
    case "max_tokens":
      return { type: "stop", reason: "max_tokens" };
    case "model_context_window_exceeded":
      return { type: "stop", reason: "context_exceeded" };
    case "refusal":
      return {
        type: "stop",
        reason: "refusal",
        details: {
          category: final.stop_details?.category ?? null,
          explanation: final.stop_details?.explanation ?? undefined,
        },
      };
    case "tool_use":
    case "pause_turn":
      return {
        type: "error",
        code: "unsupported_stop",
        message: `Unsupported stop reason in v1: ${final.stop_reason}`,
        retryable: false,
      };
  }
}

export interface MappedError {
  code: ChatErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
}

/** Most specific class first; never string-match error messages. */
export function mapError(err: unknown): MappedError {
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return { code: "auth", message: "The API key was rejected.", retryable: false, status: err.status };
  }
  if (err instanceof RateLimitError) {
    return { code: "rate_limit", message: "Rate limited by the provider. Try again shortly.", retryable: true, status: err.status };
  }
  if (err instanceof BadRequestError) {
    return { code: "bad_request", message: err.message, retryable: false, status: err.status };
  }
  if (err instanceof APIConnectionError) {
    return { code: "network", message: "Could not reach the provider.", retryable: true };
  }
  if (err instanceof APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    if (status !== undefined && status >= 500) {
      return { code: "server", message: "The provider returned a server error.", retryable: true, status };
    }
    return { code: "unknown", message: err.message, retryable: false, status };
  }
  return {
    code: "unknown",
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}

export function createAnthropicProvider(client?: Anthropic): ChatProvider {
  // Credentials come from the environment (ANTHROPIC_API_KEY et al.); never pass a key explicitly.
  const anthropic = client ?? new Anthropic();

  return {
    vendor: "anthropic",
    async *stream(req, signal): AsyncIterable<ChatEvent> {
      const stream = anthropic.messages.stream(buildParams(req), { signal });
      try {
        for await (const event of stream) {
          switch (event.type) {
            case "message_start":
              yield { type: "message_start", providerMessageId: event.message.id };
              break;
            case "content_block_delta":
              if (event.delta.type === "text_delta") {
                yield { type: "text_delta", text: event.delta.text };
              } else if (event.delta.type === "thinking_delta") {
                yield { type: "thinking_delta", text: event.delta.thinking };
              }
              break;
            default:
              break;
          }
        }
        const final = await stream.finalMessage();
        yield { type: "usage", usage: toUsage(final.usage) };
        yield toStopEvent(final);
      } catch (err) {
        if (signal.aborted || err instanceof APIUserAbortError) {
          yield { type: "stop", reason: "cancelled" };
          return;
        }
        const mapped = mapError(err);
        yield { type: "error", code: mapped.code, message: mapped.message, retryable: mapped.retryable };
      } finally {
        // No-op if the request already finished; stops an in-flight request when
        // the consumer stops iterating early.
        stream.abort();
      }
    },
  };
}
