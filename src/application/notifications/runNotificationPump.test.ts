import type { AppError } from "@application/errors/AppError";
import { runNotificationPump } from "@application/notifications/runNotificationPump";
import type { GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import type { AppliedSession } from "@domain/connection";

const session: AppliedSession = { sessionId: "session-1", apiUrl: "https://api.example.test", idInstance: "1", apiTokenInstance: "secret" };
const aborted: AppError = { kind: "aborted", safeMessage: "Операция отменена.", retryable: false };
const network: AppError = { kind: "network", safeMessage: "Сеть недоступна.", retryable: true };

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function notification(receiptId: number, senderId = "10000000", senderType = "user"): ReceivedNotification {
  return { receiptId, notification: { senderId, senderType, messageType: "text", idMessage: `message-${String(receiptId)}`, text: "Привет", receivedAt: 10 } };
}

function clientWith(overrides: Partial<GreenApiPort>): GreenApiPort {
  return {
    checkAccount: (): Promise<PortResult<{ readonly exist: false }>> => Promise.resolve({ ok: true, value: { exist: false } }),
    sendMessage: (): Promise<PortResult<{ readonly idMessage: string }>> => Promise.resolve({ ok: true, value: { idMessage: "sent" } }),
    receiveNotification: (): Promise<PortResult<ReceivedNotification | null>> => Promise.resolve({ ok: false, error: aborted }),
    deleteNotification: (): Promise<PortResult<void>> => Promise.resolve({ ok: true, value: undefined }),
    ...overrides,
  };
}

describe("runNotificationPump", () => {
  test("keeps receive, classify, emit and delete strictly ordered with one receive in flight", async () => {
    const controller = new AbortController();
    const firstReceive = deferred<PortResult<ReceivedNotification | null>>();
    const events: string[] = [];
    let receives = 0;
    const client = clientWith({
      receiveNotification: () => { receives += 1; events.push(`receive-${String(receives)}`); return firstReceive.promise; },
      deleteNotification: (_session, receiptId) => { events.push(`delete-${String(receiptId)}`); controller.abort(); return Promise.resolve({ ok: true, value: undefined }); },
    });
    const running = runNotificationPump({ client, session, signal: controller.signal, onIncoming: () => { events.push("incoming"); } });
    await Promise.resolve();
    expect(receives).toBe(1);
    firstReceive.resolve({ ok: true, value: notification(7) });
    await running;
    expect(events).toEqual(["receive-1", "incoming", "delete-7"]);
    expect(receives).toBe(1);
  });

  test("retries the same acknowledgement before another receive", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    let deleteCalls = 0;
    const client = clientWith({
      receiveNotification: () => { events.push("receive"); return Promise.resolve({ ok: true, value: notification(4) }); },
      deleteNotification: (_session, receiptId) => {
        deleteCalls += 1;
        events.push(`delete-${String(receiptId)}-${String(deleteCalls)}`);
        if (deleteCalls === 1) return Promise.resolve({ ok: false, error: network });
        controller.abort();
        return Promise.resolve({ ok: true, value: undefined });
      },
    });
    await runNotificationPump({ client, session, signal: controller.signal, random: () => 0.5, sleep: (delay) => { events.push(`sleep-${String(delay)}`); return Promise.resolve(); }, onIncoming: () => { events.push("incoming"); } });
    expect(events).toEqual(["receive", "incoming", "delete-4-1", "sleep-250", "delete-4-2"]);
  });

  test("continues to the next receive after a terminal idempotent acknowledgement", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    let receives = 0;
    const client = clientWith({
      receiveNotification: () => {
        receives += 1;
        events.push(`receive-${String(receives)}`);
        if (receives === 1) return Promise.resolve({ ok: true, value: notification(5) });
        controller.abort();
        return Promise.resolve({ ok: false, error: aborted });
      },
      deleteNotification: () => { events.push("delete-terminal"); return Promise.resolve({ ok: true, value: undefined }); },
    });
    await runNotificationPump({ client, session, signal: controller.signal, onIncoming: () => { events.push("incoming"); } });
    expect(events).toEqual(["receive-1", "incoming", "delete-terminal", "receive-2"]);
  });

  test("resets receive backoff after a successful receive", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    let call = 0;
    const client = clientWith({
      receiveNotification: () => {
        call += 1;
        if (call === 1 || call === 3) return Promise.resolve({ ok: false, error: network });
        if (call === 2) return Promise.resolve({ ok: true, value: null });
        controller.abort();
        return Promise.resolve({ ok: false, error: aborted });
      },
    });
    await runNotificationPump({ client, session, signal: controller.signal, random: () => 1, sleep: (delay) => { delays.push(delay); return Promise.resolve(); }, onIncoming: vi.fn() });
    expect(delays).toEqual([500, 500]);
  });

  test("acks ignored and malformed envelopes and reports only aggregate safe counts", async () => {
    const controller = new AbortController();
    const summaries: unknown[] = [];
    const queue = [
      { ok: true as const, value: notification(1, "-10000000", "group") },
      { ok: true as const, value: notification(2, "10000000", "bot") },
      { ok: true as const, value: notification(3, "10000000", "channel") },
      { ok: true as const, value: { receiptId: 4, notification: { senderId: "10000000", senderType: "user", messageType: "text", text: "secret payload" } } },
    ];
    const client = clientWith({
      receiveNotification: () => Promise.resolve(queue.shift() ?? { ok: false, error: aborted }),
      deleteNotification: (_session, receiptId) => { if (receiptId === 4) controller.abort(); return Promise.resolve({ ok: true, value: undefined }); },
    });
    await runNotificationPump({ client, session, signal: controller.signal, onIncoming: vi.fn(), onIgnored: (summary) => { summaries.push(summary); } });
    expect(summaries).toEqual([
      { total: 1, unsupportedSender: 1, unsupportedType: 0, malformed: 0 },
      { total: 2, unsupportedSender: 2, unsupportedType: 0, malformed: 0 },
      { total: 3, unsupportedSender: 3, unsupportedType: 0, malformed: 0 },
      { total: 4, unsupportedSender: 3, unsupportedType: 0, malformed: 1 },
    ]);
    expect(JSON.stringify(summaries)).not.toContain("secret payload");
  });

  test("stops safely on non-retryable errors and stays silent after abort", async () => {
    const auth: AppError = { kind: "auth", safeMessage: "Проверьте доступ.", retryable: false };
    const onStopped = vi.fn();
    await runNotificationPump({ client: clientWith({ receiveNotification: () => Promise.resolve({ ok: false, error: auth }) }), session, signal: new AbortController().signal, onIncoming: vi.fn(), onStopped });
    expect(onStopped).toHaveBeenCalledWith(auth);

    const controller = new AbortController();
    controller.abort();
    const receiveNotification = vi.fn();
    await runNotificationPump({ client: clientWith({ receiveNotification }), session, signal: controller.signal, onIncoming: vi.fn(), onStopped });
    expect(receiveNotification).not.toHaveBeenCalled();
    expect(onStopped).toHaveBeenCalledTimes(1);
  });
});
