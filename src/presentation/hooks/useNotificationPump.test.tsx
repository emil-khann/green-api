import type { AppError } from "@application/errors/AppError";
import type { GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import type { AppliedSession } from "@domain/connection";
import { useNotificationPump } from "@presentation/hooks/useNotificationPump";
import { renderHook, waitFor } from "@testing-library/react";

const aborted: AppError = { kind: "aborted", safeMessage: "Операция отменена.", retryable: false };
const sessionOne: AppliedSession = { sessionId: "one", apiUrl: "https://api.example.test", idInstance: "1", apiTokenInstance: "secret" };
const sessionTwo: AppliedSession = { ...sessionOne, sessionId: "two" };

interface PendingReceive {
  readonly sessionId: string;
  readonly signal: AbortSignal;
  resolve(value: PortResult<ReceivedNotification | null>): void;
}

function controlledClient(): { client: GreenApiPort; receives: PendingReceive[] } {
  const receives: PendingReceive[] = [];
  const client: GreenApiPort = {
    checkAccount: () => Promise.resolve({ ok: true, value: { exist: false } }),
    sendMessage: (): Promise<PortResult<{ readonly idMessage: string }>> => Promise.resolve({ ok: true, value: { idMessage: "sent" } }),
    receiveNotification: (session, signal) => new Promise((resolve) => {
      const pending: PendingReceive = { sessionId: session.sessionId, signal, resolve };
      receives.push(pending);
      signal.addEventListener("abort", () => { resolve({ ok: false, error: aborted }); }, { once: true });
    }),
    deleteNotification: (): Promise<PortResult<void>> => Promise.resolve({ ok: true, value: undefined }),
  };
  return { client, receives };
}

describe("useNotificationPump", () => {
  test("does not restart for unrelated rerenders or changing callback identities", async () => {
    const { client, receives } = controlledClient();
    const incoming: string[] = [];
    const { rerender } = renderHook(
      ({ activeChat }: { activeChat: string }) => useNotificationPump({ client, session: sessionOne, isOnline: true, onIncoming: () => { incoming.push(activeChat); } }),
      { initialProps: { activeChat: "first" } },
    );
    await waitFor(() => { expect(receives).toHaveLength(1); });
    rerender({ activeChat: "second" });
    expect(receives).toHaveLength(1);
    receives[0]?.resolve({ ok: true, value: { receiptId: 1, notification: { senderId: "10000000", senderType: "user", messageType: "text", idMessage: "message-1", text: "Hi" } } });
    await waitFor(() => { expect(incoming).toEqual(["second"]); });
  });

  test("cancels a replaced session and ignores its stale completion", async () => {
    const { client, receives } = controlledClient();
    const onIncoming = vi.fn();
    const { rerender } = renderHook(
      ({ session }: { session: AppliedSession }) => useNotificationPump({ client, session, isOnline: true, onIncoming }),
      { initialProps: { session: sessionOne } },
    );
    await waitFor(() => { expect(receives).toHaveLength(1); });
    const stale = receives[0];
    rerender({ session: sessionTwo });
    await waitFor(() => { expect(receives).toHaveLength(2); });
    expect(stale?.signal.aborted).toBe(true);
    stale?.resolve({ ok: true, value: { receiptId: 1, notification: { senderId: "10000000", senderType: "user", messageType: "text", idMessage: "stale", text: "Old" } } });
    await Promise.resolve();
    expect(onIncoming).not.toHaveBeenCalled();
    expect(receives[1]?.sessionId).toBe("two");
  });

  test("pauses offline and resumes one pump for the same session", async () => {
    const { client, receives } = controlledClient();
    const { result, rerender } = renderHook(
      ({ isOnline }: { isOnline: boolean }) => useNotificationPump({ client, session: sessionOne, isOnline, onIncoming: vi.fn() }),
      { initialProps: { isOnline: true } },
    );
    await waitFor(() => { expect(receives).toHaveLength(1); });
    rerender({ isOnline: false });
    expect(result.current).toEqual({ phase: "paused", reason: "offline" });
    expect(receives[0]?.signal.aborted).toBe(true);
    rerender({ isOnline: true });
    await waitFor(() => { expect(receives).toHaveLength(2); });
    expect(result.current).toEqual({ phase: "running" });
  });

  test("StrictMode and unmount leave no live stale pump or rendered abort error", async () => {
    const { client, receives } = controlledClient();
    const { result, unmount } = renderHook(
      () => useNotificationPump({ client, session: sessionOne, isOnline: true, onIncoming: vi.fn() }),
      { reactStrictMode: true },
    );
    await waitFor(() => { expect(receives).toHaveLength(2); });
    expect(receives.filter((receive) => !receive.signal.aborted)).toHaveLength(1);
    expect(result.current.phase).toBe("running");
    unmount();
    expect(receives.every((receive) => receive.signal.aborted)).toBe(true);
  });
});
