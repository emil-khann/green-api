import type { AppError } from "@application/errors/AppError";
import { retryDelayMs, type BackoffOptions } from "@application/notifications/backoff";
import { classifyNotification } from "@application/notifications/classifyNotification";
import type { ClassifiedNotification } from "@application/notifications/notificationTypes";
import type { GreenApiPort } from "@application/ports/GreenApiPort";
import type { AppliedSession } from "@domain/connection";

export type PumpOperation = "receive" | "delete";
export interface IgnoredNotificationSummary { readonly total: number; readonly unsupportedSender: number; readonly unsupportedType: number; readonly malformed: number }
export interface PumpRetry { readonly operation: PumpOperation; readonly attempt: number; readonly delayMs: number; readonly safeMessage: string }
export type PumpSleep = (delayMs: number, signal: AbortSignal) => Promise<void>;

export interface NotificationPumpOptions extends BackoffOptions {
  readonly client: GreenApiPort;
  readonly session: AppliedSession;
  readonly signal: AbortSignal;
  readonly sleep?: PumpSleep;
  readonly random?: () => number;
  readonly onIncoming: (notification: Extract<ClassifiedNotification, { readonly kind: "direct-text" | "direct-image" }>) => void;
  readonly onIgnored?: (summary: IgnoredNotificationSummary) => void;
  readonly onRetry?: (retry: PumpRetry) => void;
  readonly onStopped?: (error: AppError) => void;
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, delayMs);
    function onAbort(): void { globalThis.clearTimeout(timeoutId); reject(new DOMException("Aborted", "AbortError")); }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function waitForRetry(options: NotificationPumpOptions, operation: PumpOperation, attempt: number, error: AppError): Promise<boolean> {
  if (options.signal.aborted || error.kind === "aborted") return false;
  const canRecoverAutomatically = error.retryable || (operation === "receive" && error.kind === "protocol");
  if (!canRecoverAutomatically) { options.onStopped?.(error); return false; }
  const delayMs = retryDelayMs(attempt, error, options.random ?? Math.random, options);
  options.onRetry?.({ operation, attempt: attempt + 1, delayMs, safeMessage: error.safeMessage });
  try {
    await (options.sleep ?? defaultSleep)(delayMs, options.signal);
    return !options.signal.aborted;
  } catch (sleepError) {
    if (isAbort(sleepError, options.signal)) return false;
    throw sleepError;
  }
}

function recordIgnored(classified: Exclude<ClassifiedNotification, { readonly kind: "direct-text" | "direct-image" }>, counts: { unsupportedSender: number; unsupportedType: number; malformed: number }): IgnoredNotificationSummary {
  switch (classified.kind) {
    case "malformed": counts.malformed += 1; break;
    case "ignored":
      switch (classified.reason) {
        case "unsupported-sender": counts.unsupportedSender += 1; break;
        case "unsupported-type": counts.unsupportedType += 1; break;
      }
      break;
  }
  return { total: counts.unsupportedSender + counts.unsupportedType + counts.malformed, ...counts };
}

export async function runNotificationPump(options: NotificationPumpOptions): Promise<void> {
  const ignoredCounts = { unsupportedSender: 0, unsupportedType: 0, malformed: 0 };
  let receiveAttempt = 0;
  while (!isAborted(options.signal)) {
    const received = await options.client.receiveNotification(options.session, options.signal);
    if (isAborted(options.signal)) return;
    if (!received.ok) {
      if (!(await waitForRetry(options, "receive", receiveAttempt, received.error))) return;
      receiveAttempt += 1;
      continue;
    }
    receiveAttempt = 0;
    if (received.value === null) continue;
    const classified = classifyNotification(received.value.notification);
    if (classified.kind === "direct-text" || classified.kind === "direct-image") options.onIncoming(classified);
    else options.onIgnored?.(recordIgnored(classified, ignoredCounts));
    if (isAborted(options.signal)) return;
    let deleteAttempt = 0;
    while (!isAborted(options.signal)) {
      const deleted = await options.client.deleteNotification(options.session, received.value.receiptId, options.signal);
      if (isAborted(options.signal)) return;
      if (deleted.ok) break;
      if (!(await waitForRetry(options, "delete", deleteAttempt, deleted.error))) return;
      deleteAttempt += 1;
    }
  }
}
