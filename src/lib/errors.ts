/**
 * Vendor-neutral error codes surfaced to the UI. Adapters map their SDK's
 * typed errors onto these; nothing outside src/lib/providers sees vendor errors.
 */
export type ChatErrorCode =
  | "auth"
  | "rate_limit"
  | "bad_request"
  | "server"
  | "network"
  | "no_credentials"
  | "unknown_model"
  | "unsupported_stop"
  | "unknown";

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(code: ChatErrorCode, message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}
