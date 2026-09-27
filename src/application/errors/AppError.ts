export type AppError =
  | ErrorDetails<"validation", false>
  | ErrorDetails<"network", true>
  | ErrorDetails<"auth", false>
  | ErrorDetails<"rate-limit", boolean>
  | ErrorDetails<"protocol", false>
  | ErrorDetails<"acknowledgement", true>
  | ErrorDetails<"aborted", false>;

interface ErrorDetails<TKind extends string, TRetryable extends boolean> {
  readonly kind: TKind;
  readonly safeMessage: string;
  readonly retryable: TRetryable;
  readonly status?: number;
  readonly retryAfterMs?: number;
}
