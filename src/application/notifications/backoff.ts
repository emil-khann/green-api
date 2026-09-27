import type { AppError } from "@application/errors/AppError";

export interface BackoffOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

function normalizeRandom(randomValue: number): number {
  if (!Number.isFinite(randomValue)) return 0;
  return Math.min(1, Math.max(0, randomValue));
}

export function exponentialBackoffCap(attempt: number, options: BackoffOptions = {}): number {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError("attempt must be a non-negative integer");
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new RangeError("baseDelayMs must be non-negative");
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) throw new RangeError("maxDelayMs must be non-negative");
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
}

/** Full jitter, with Retry-After acting as a minimum requested by the server. */
export function retryDelayMs(attempt: number, error: AppError, random: () => number, options: BackoffOptions = {}): number {
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterCap = exponentialBackoffCap(attempt, options);
  const jitteredDelay = Math.floor(jitterCap * normalizeRandom(random()));
  const retryAfterMs = Math.min(maxDelayMs, Math.max(0, error.retryAfterMs ?? 0));
  return Math.max(jitteredDelay, retryAfterMs);
}
