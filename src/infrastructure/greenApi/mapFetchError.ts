import type { AppError } from "@application/errors/AppError";

const RETRY_AFTER_CAP_MS = 60_000;

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  if (!Number.isFinite(delay)) return undefined;
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, Math.round(delay)));
}

export function mapHttpError(response: Response): AppError {
  const status = response.status;
  if (status === 401 || status === 403) return { kind: "auth", safeMessage: "Проверьте ID instance и API token.", retryable: false, status };
  if (status === 469) return { kind: "rate-limit", safeMessage: "Лимит запросов GREEN-API исчерпан. Повторите позже.", retryable: false, status };
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
    return { kind: "rate-limit", safeMessage: "Слишком много запросов. Повторите позже.", retryable: true, status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  }
  if (status === 400 || status === 404 || status === 422) return { kind: "validation", safeMessage: "GREEN-API отклонил параметры запроса.", retryable: false, status };
  if (status >= 500) return { kind: "network", safeMessage: "GREEN-API временно недоступен.", retryable: true, status };
  return { kind: "protocol", safeMessage: "GREEN-API вернул неожиданный HTTP-ответ.", retryable: false, status };
}

export function mapFetchError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") return { kind: "aborted", safeMessage: "Запрос отменён.", retryable: false };
  return { kind: "network", safeMessage: "Не удалось подключиться к GREEN-API.", retryable: true };
}

export function protocolError(): AppError {
  return { kind: "protocol", safeMessage: "GREEN-API вернул ответ неизвестного формата.", retryable: false };
}

export function acknowledgementError(status?: number): AppError {
  return { kind: "acknowledgement", safeMessage: "Не удалось подтвердить получение уведомления.", retryable: true, ...(status === undefined ? {} : { status }) };
}
