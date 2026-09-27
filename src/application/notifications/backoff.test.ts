import { exponentialBackoffCap, retryDelayMs } from "@application/notifications/backoff";
import type { AppError } from "@application/errors/AppError";

const networkError: AppError = { kind: "network", safeMessage: "Сеть недоступна.", retryable: true };

describe("notification backoff", () => {
  test("grows exponentially and caps the attempt window", () => {
    expect([0, 1, 2, 8].map((attempt) => exponentialBackoffCap(attempt, { baseDelayMs: 100, maxDelayMs: 1_000 }))).toEqual([100, 200, 400, 1_000]);
  });

  test("uses deterministic full-jitter bounds and clamps random edges", () => {
    expect(retryDelayMs(2, networkError, () => 0, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(0);
    expect(retryDelayMs(2, networkError, () => 0.5, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(200);
    expect(retryDelayMs(2, networkError, () => 2, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(retryDelayMs(2, networkError, () => -1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(0);
  });

  test("treats Retry-After as a minimum within the configured cap", () => {
    const limited: AppError = { kind: "rate-limit", safeMessage: "Повторите позже.", retryable: true, retryAfterMs: 750 };
    expect(retryDelayMs(0, limited, () => 0.1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(750);
    expect(retryDelayMs(0, { ...limited, retryAfterMs: 5_000 }, () => 0, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);
  });

  test("rejects invalid attempts", () => {
    expect(() => exponentialBackoffCap(-1)).toThrow(RangeError);
  });
});

