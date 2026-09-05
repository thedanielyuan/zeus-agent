import type { ChatErrorCode } from "@/lib/errors";

/** Vendors with an adapter in src/lib/providers/. Grows as adapters are added. */
export type Vendor = "anthropic";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LEVELS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface ModelSpec {
  /** Vendor model ID, e.g. "claude-sonnet-5". */
  id: string;
  vendor: Vendor;
  displayName: string;
  /** Input context window in tokens. */
  contextWindow: number;
  maxOutputTokens: number;
  /** USD per million tokens. */
  pricePerMTok: { input: number; output: number };
  capabilities: {
    thinking: boolean;
    effort: boolean;
    vision: boolean;
    tools: boolean;
    caching: boolean;
    /** temperature / top_p support. False on Claude Sonnet 5. */
    sampling: boolean;
  };
}

export interface ChatMessage {
  role: "user" | "assistant";
  /** v1 is text only; attachments extend this later. */
  content: string;
}

export interface ChatRequest {
  model: ModelSpec;
  system?: string;
  messages: ChatMessage[];
  effort?: Effort;
  maxOutputTokens: number;
  thinkingDisplay: "summarized" | "omitted";
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type StopReason =
  | "end"
  | "max_tokens"
  | "context_exceeded"
  | "refusal"
  | "cancelled"
  | "error";

export interface RefusalDetails {
  category: string | null;
  explanation?: string;
}

/**
 * The whole provider contract. UI, SSE encoder, and persistence consume these
 * and never see vendor payloads.
 */
export type ChatEvent =
  | { type: "message_start"; providerMessageId?: string }
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "stop"; reason: StopReason; details?: RefusalDetails }
  | { type: "error"; code: ChatErrorCode; message: string; retryable: boolean };

export interface ChatProvider {
  vendor: Vendor;
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
  /** Optional: cheap count for the composer's token estimate. */
  countTokens?(req: ChatRequest): Promise<number>;
}
