export interface ConnectionDraft {
  readonly apiUrl: string;
  readonly idInstance: string;
  readonly apiTokenInstance: string;
}

export interface AppliedSession {
  readonly sessionId: string;
  readonly apiUrl: string;
  readonly idInstance: string;
  readonly apiTokenInstance: string;
}

export type ConnectionResult =
  | { readonly ok: true; readonly session: AppliedSession }
  | { readonly ok: false; readonly error: ConnectionValidationError };

export interface ConnectionValidationError {
  readonly kind: "validation";
  readonly safeMessage: string;
  readonly retryable: false;
}

const validationError = (safeMessage: string): ConnectionResult => ({
  ok: false,
  error: { kind: "validation", safeMessage, retryable: false },
});

export function applyConnection(draft: ConnectionDraft, sessionId: string): ConnectionResult {
  const normalizedSessionId = sessionId.trim();
  if (normalizedSessionId.length === 0) {
    return validationError("Не удалось создать идентификатор сессии.");
  }
  let url: URL;
  try {
    url = new URL(draft.apiUrl.trim());
  } catch {
    return validationError("Укажите корректный адрес API.");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return validationError("Адрес API должен использовать HTTPS и не содержать credentials, query или hash.");
  }
  const idInstance = draft.idInstance.trim();
  if (!/^\d{1,20}$/.test(idInstance)) {
    return validationError("ID instance должен содержать от 1 до 20 цифр.");
  }
  const apiTokenInstance = draft.apiTokenInstance.trim();
  if (apiTokenInstance.length === 0) {
    return validationError("API token обязателен.");
  }
  return {
    ok: true,
    session: Object.freeze({
      sessionId: normalizedSessionId,
      apiUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
      idInstance,
      apiTokenInstance,
    }),
  };
}
