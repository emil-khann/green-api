import type { AppError } from "@application/errors/AppError";
import type { ClassifiedNotification } from "@application/notifications/notificationTypes";
import { runNotificationPump, type IgnoredNotificationSummary, type PumpRetry } from "@application/notifications/runNotificationPump";
import type { GreenApiPort } from "@application/ports/GreenApiPort";
import type { AppliedSession } from "@domain/connection";
import { useEffect, useRef, useState } from "react";

type IncomingNotification = Extract<ClassifiedNotification, { readonly kind: "direct-text" | "direct-image" }>;
export type NotificationPumpStatus = { readonly phase: "idle" } | { readonly phase: "paused"; readonly reason: "offline" } | { readonly phase: "running" } | { readonly phase: "retrying"; readonly retry: PumpRetry } | { readonly phase: "stopped"; readonly error: AppError };
export interface UseNotificationPumpOptions { readonly client: GreenApiPort | null; readonly session: AppliedSession | null; readonly isOnline: boolean; readonly onIncoming: (notification: IncomingNotification) => void; readonly onIgnored?: (summary: IgnoredNotificationSummary) => void }

export function useNotificationPump(options: UseNotificationPumpOptions): NotificationPumpStatus {
  const [status, setStatus] = useState<NotificationPumpStatus>({ phase: "idle" });
  const generationRef = useRef(0);
  const sessionRef = useRef(options.session);
  const onIncomingRef = useRef(options.onIncoming);
  const onIgnoredRef = useRef(options.onIgnored);
  sessionRef.current = options.session;
  onIncomingRef.current = options.onIncoming;
  onIgnoredRef.current = options.onIgnored;
  const sessionId = options.session?.sessionId ?? null;
  const client = options.client;
  const isOnline = options.isOnline;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const session = sessionRef.current;
    if (client === null || session === null || sessionId === null) { setStatus({ phase: "idle" }); return; }
    if (!isOnline) { setStatus({ phase: "paused", reason: "offline" }); return; }
    const controller = new AbortController();
    const isCurrent = (): boolean => generationRef.current === generation && !controller.signal.aborted;
    setStatus({ phase: "running" });
    void runNotificationPump({
      client, session, signal: controller.signal,
      onIncoming: (notification) => { if (isCurrent()) onIncomingRef.current(notification); },
      onIgnored: (summary) => { if (isCurrent()) onIgnoredRef.current?.(summary); },
      onRetry: (retry) => { if (isCurrent()) setStatus({ phase: "retrying", retry }); },
      onStopped: (error) => { if (isCurrent()) setStatus({ phase: "stopped", error }); },
    });
    return () => { generationRef.current += 1; controller.abort(); };
  }, [client, isOnline, sessionId]);
  return status;
}
