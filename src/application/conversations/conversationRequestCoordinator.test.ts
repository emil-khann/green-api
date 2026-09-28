import { ConversationRequestCoordinator, type ConversationRequestEvent } from "@application/conversations/conversationRequestCoordinator";
import type { AppError } from "@application/errors/AppError";
import type { ChatHistoryMessage, ContactInfoResult, GreenApiPort, PortResult } from "@application/ports/GreenApiPort";
import type { ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";

const session = (sessionId: string): AppliedSession => ({ sessionId, apiUrl: "https://api.example.test", idInstance: "1", apiTokenInstance: "secret" });
const chatId = (value: number): ChatId => String(value) as ChatId;
const history = (id: ChatId, text = "message"): readonly ChatHistoryMessage[] => [{ idMessage: `message-${id}`, chatId: id, direction: "incoming", text, createdAt: 10 }];
const contact = (name: string): ContactInfoResult => ({ name, lastSeen: 10 });
const rateLimit = (retryAfterMs?: number): AppError => ({ kind: "rate-limit", safeMessage: "Позже", retryable: true, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
const auth: AppError = { kind: "auth", safeMessage: "Нет доступа", retryable: false };

function clientWith(overrides: Partial<GreenApiPort>): GreenApiPort {
  return {
    checkAccount: () => Promise.resolve({ ok: true, value: { exist: false } }),
    sendMessage: () => Promise.resolve({ ok: true, value: { idMessage: "sent" } }),
    receiveNotification: () => Promise.resolve({ ok: true, value: null }),
    deleteNotification: () => Promise.resolve({ ok: true, value: undefined }),
    ...overrides,
  };
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: (value) => { resolvePromise(value); } };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ConversationRequestCoordinator", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  test("enforces independent start intervals for chats, history and contacts", async () => {
    const starts = { chats: [] as number[], history: [] as number[], contact: [] as number[] };
    const client = clientWith({
      getChats: () => { starts.chats.push(Date.now()); return Promise.resolve({ ok: true, value: [] }); },
      getChatHistory: (_session, id) => { starts.history.push(Date.now()); return Promise.resolve({ ok: true, value: history(id) }); },
      getContactInfo: (_session, id) => { starts.contact.push(Date.now()); return Promise.resolve({ ok: true, value: contact(id) }); },
    });
    const coordinator = new ConversationRequestCoordinator({ client, onEvent: vi.fn() });
    coordinator.startSession(session("one"));
    void coordinator.loadChats();
    void coordinator.ensureHistory(chatId(1));
    void coordinator.ensureHistory(chatId(2));
    void coordinator.ensureContact(chatId(1));
    void coordinator.ensureContact(chatId(2));

    expect(starts).toEqual({ chats: [0], history: [0], contact: [0] });
    await vi.advanceTimersByTimeAsync(100);
    expect(starts.contact).toEqual([0, 100]);
    expect(starts.history).toEqual([0]);
    await vi.advanceTimersByTimeAsync(900);
    expect(starts.history).toEqual([0, 1_000]);
  });

  test("deduplicates jobs and promotes an already queued background history request", async () => {
    const starts: ChatId[] = [];
    const client = clientWith({ getChatHistory: (_session, id) => { starts.push(id); return Promise.resolve({ ok: true, value: history(id) }); } });
    const coordinator = new ConversationRequestCoordinator({ client, onEvent: vi.fn() });
    coordinator.startSession(session("one"));
    void coordinator.ensureHistory(chatId(1), { priority: "background" });
    const background = coordinator.ensureHistory(chatId(2), { priority: "background" });
    void coordinator.ensureHistory(chatId(3), { priority: "background" });
    const promoted = coordinator.ensureHistory(chatId(3), { priority: "active" });

    expect(starts).toEqual([chatId(1)]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(starts).toEqual([chatId(1), chatId(3)]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(starts).toEqual([chatId(1), chatId(3), chatId(2)]);
    await expect(promoted).resolves.toEqual({ ok: true, value: history(chatId(3)) });
    await expect(background).resolves.toEqual({ ok: true, value: history(chatId(2)) });
  });

  test("cancels queued and running background jobs while a promoted active job survives", async () => {
    const running = deferred<PortResult<readonly ChatHistoryMessage[]>>();
    const promoted = deferred<PortResult<readonly ChatHistoryMessage[]>>();
    const starts: ChatId[] = [];
    const signals = new Map<ChatId, AbortSignal>();
    const events: ConversationRequestEvent[] = [];
    const client = clientWith({
      getChatHistory: (_session, id, _count, signal) => {
        starts.push(id);
        if (signal) signals.set(id, signal);
        return id === chatId(1) ? running.promise : promoted.promise;
      },
    });
    const coordinator = new ConversationRequestCoordinator({ client, onEvent: (event) => { events.push(event); } });
    coordinator.startSession(session("one"));

    const cancelledRunning = coordinator.ensureHistory(chatId(1), { priority: "background" });
    const active = coordinator.ensureHistory(chatId(2), { priority: "background" });
    void coordinator.ensureHistory(chatId(3), { priority: "background" });
    void coordinator.ensureHistory(chatId(2), { priority: "active" });
    coordinator.cancelBackgroundJobs();

    expect(signals.get(chatId(1))?.aborted).toBe(true);
    await expect(cancelledRunning).resolves.toMatchObject({ ok: false, error: { kind: "aborted" } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(starts).toEqual([chatId(1), chatId(2)]);
    expect(signals.get(chatId(2))?.aborted).toBe(false);
    promoted.resolve({ ok: true, value: history(chatId(2), "active") });
    await expect(active).resolves.toEqual({ ok: true, value: history(chatId(2), "active") });
    await vi.runAllTimersAsync();
    expect(starts).not.toContain(chatId(3));

    running.resolve({ ok: true, value: history(chatId(1), "stale") });
    await flush();
    expect(events).toContainEqual({ resource: "history", status: "cancelled", chatId: chatId(1) });
    expect(events).toContainEqual({ resource: "history", status: "cancelled", chatId: chatId(3) });
    expect(events).not.toContainEqual({ resource: "history", status: "success", chatId: chatId(1), value: history(chatId(1), "stale") });
  });

  test("keeps successful caches when background cancellation runs", async () => {
    const getChatHistory = vi.fn<(_session: AppliedSession, id: ChatId) => Promise<PortResult<readonly ChatHistoryMessage[]>>>((_session, id) => Promise.resolve({ ok: true, value: history(id) }));
    const coordinator = new ConversationRequestCoordinator({ client: clientWith({ getChatHistory }), onEvent: vi.fn() });
    coordinator.startSession(session("one"));
    await coordinator.ensureHistory(chatId(1), { priority: "background" });
    coordinator.cancelBackgroundJobs();
    await expect(coordinator.ensureHistory(chatId(1), { priority: "active" })).resolves.toEqual({ ok: true, value: history(chatId(1)) });
    expect(getChatHistory).toHaveBeenCalledTimes(1);
  });

  test("retries retryable failures using Retry-After and then publishes success", async () => {
    const starts: number[] = [];
    let attempt = 0;
    const events: ConversationRequestEvent[] = [];
    const client = clientWith({
      getChatHistory: (_session, id) => {
        starts.push(Date.now());
        attempt += 1;
        if (attempt === 1) return Promise.resolve({ ok: false, error: rateLimit(2_500) });
        return Promise.resolve({ ok: true, value: history(id) });
      },
    });
    const coordinator = new ConversationRequestCoordinator({ client, onEvent: (event) => { events.push(event); }, random: () => 0 });
    coordinator.startSession(session("one"));
    const result = coordinator.ensureHistory(chatId(1));
    await flush();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: true, value: history(chatId(1)) });
    expect(starts).toEqual([0, 2_500]);
    expect(events.map((event) => event.status)).toEqual(["loading", "success"]);
  });

  test("does not retry terminal errors", async () => {
    const getContactInfo = vi.fn<() => Promise<PortResult<ContactInfoResult>>>(() => Promise.resolve({ ok: false, error: auth }));
    const events: ConversationRequestEvent[] = [];
    const coordinator = new ConversationRequestCoordinator({ client: clientWith({ getContactInfo }), onEvent: (event) => { events.push(event); } });
    coordinator.startSession(session("one"));
    await expect(coordinator.ensureContact(chatId(1))).resolves.toEqual({ ok: false, error: auth });
    await vi.runAllTimersAsync();
    expect(getContactInfo).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.status)).toEqual(["loading", "error"]);
  });

  test("aborts the old generation and ignores a stale success after a session switch", async () => {
    const oldRequest = deferred<PortResult<ContactInfoResult>>();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const events: ConversationRequestEvent[] = [];
    const client = clientWith({
      getContactInfo: (_session, _id, signal) => {
        calls += 1;
        if (signal !== undefined) signals.push(signal);
        return calls === 1 ? oldRequest.promise : Promise.resolve({ ok: true, value: contact("new") });
      },
    });
    const coordinator = new ConversationRequestCoordinator({ client, onEvent: (event) => { events.push(event); } });
    coordinator.startSession(session("old"));
    const stale = coordinator.ensureContact(chatId(1));
    coordinator.startSession(session("new"));
    expect(signals[0]?.aborted).toBe(true);
    oldRequest.resolve({ ok: true, value: contact("stale") });
    await expect(stale).resolves.toMatchObject({ ok: false, error: { kind: "aborted" } });
    await flush();
    await expect(coordinator.ensureContact(chatId(1))).resolves.toEqual({ ok: true, value: contact("new") });
    expect(events.filter((event) => event.status === "success")).toEqual([{ resource: "contact", status: "success", chatId: chatId(1), value: contact("new") }]);
  });

  test("keeps rapid A to B history completions attached to their requested chats", async () => {
    const first = deferred<PortResult<readonly ChatHistoryMessage[]>>();
    const second = deferred<PortResult<readonly ChatHistoryMessage[]>>();
    const events: ConversationRequestEvent[] = [];
    const client = clientWith({
      getChatHistory: (_session, id) => id === chatId(1) ? first.promise : second.promise,
    });
    const coordinator = new ConversationRequestCoordinator({ client, onEvent: (event) => { events.push(event); } });
    coordinator.startSession(session("one"));
    const a = coordinator.ensureHistory(chatId(1), { priority: "active" });
    const b = coordinator.ensureHistory(chatId(2), { priority: "active" });

    await vi.advanceTimersByTimeAsync(1_000);
    second.resolve({ ok: true, value: history(chatId(2), "B") });
    await expect(b).resolves.toEqual({ ok: true, value: history(chatId(2), "B") });
    first.resolve({ ok: true, value: history(chatId(1), "A") });
    await expect(a).resolves.toEqual({ ok: true, value: history(chatId(1), "A") });

    expect(events.filter((event) => event.resource === "history" && event.status === "success")).toEqual([
      { resource: "history", status: "success", chatId: chatId(2), value: history(chatId(2), "B") },
      { resource: "history", status: "success", chatId: chatId(1), value: history(chatId(1), "A") },
    ]);
  });

  test("serves contact and history cache hits without duplicate API calls and refreshes explicitly", async () => {
    let calls = 0;
    const getContactInfo = vi.fn<() => Promise<PortResult<ContactInfoResult>>>(() => {
      calls += 1;
      return Promise.resolve({ ok: true, value: contact(`name-${String(calls)}`) });
    });
    const getChatHistory = vi.fn<(_session: AppliedSession, id: ChatId) => Promise<PortResult<readonly ChatHistoryMessage[]>>>((_session, id) => Promise.resolve({ ok: true, value: history(id) }));
    const coordinator = new ConversationRequestCoordinator({ client: clientWith({ getContactInfo, getChatHistory }), onEvent: vi.fn() });
    coordinator.startSession(session("one"));
    await expect(coordinator.ensureContact(chatId(1))).resolves.toEqual({ ok: true, value: contact("name-1") });
    await expect(coordinator.ensureContact(chatId(1))).resolves.toEqual({ ok: true, value: contact("name-1") });
    expect(getContactInfo).toHaveBeenCalledTimes(1);
    await expect(coordinator.ensureHistory(chatId(1))).resolves.toEqual({ ok: true, value: history(chatId(1)) });
    await expect(coordinator.ensureHistory(chatId(1))).resolves.toEqual({ ok: true, value: history(chatId(1)) });
    expect(getChatHistory).toHaveBeenCalledTimes(1);

    const refreshed = coordinator.ensureContact(chatId(1), { refresh: true });
    await vi.advanceTimersByTimeAsync(100);
    await expect(refreshed).resolves.toEqual({ ok: true, value: contact("name-2") });
    expect(getContactInfo).toHaveBeenCalledTimes(2);
  });

  test("starts a queued background job after a bounded burst of active jobs", async () => {
    const starts: ChatId[] = [];
    const client = clientWith({
      getChatHistory: (_session, id) => {
        starts.push(id);
        return Promise.resolve({ ok: true, value: history(id) });
      },
    });
    const coordinator = new ConversationRequestCoordinator({ client, onEvent: vi.fn() });
    coordinator.startSession(session("one"));

    void coordinator.ensureHistory(chatId(1), { priority: "active" });
    void coordinator.ensureHistory(chatId(9), { priority: "background" });
    for (const id of [2, 3, 4, 5]) void coordinator.ensureHistory(chatId(id), { priority: "active" });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(starts).toEqual([chatId(1), chatId(2), chatId(3), chatId(9)]);
  });

  test("refreshes stale contacts once while keeping fresh cache hits request-free", async () => {
    const refreshed = deferred<PortResult<ContactInfoResult>>();
    const getContactInfo = vi.fn<() => Promise<PortResult<ContactInfoResult>>>()
      .mockResolvedValueOnce({ ok: true, value: contact("cached") })
      .mockImplementationOnce(() => refreshed.promise);
    const events: ConversationRequestEvent[] = [];
    const coordinator = new ConversationRequestCoordinator({
      client: clientWith({ getContactInfo }),
      onEvent: (event) => { events.push(event); },
      contactTtlMs: 1_000,
    });
    coordinator.startSession(session("one"));

    await expect(coordinator.ensureContact(chatId(1))).resolves.toEqual({ ok: true, value: contact("cached") });
    vi.setSystemTime(999);
    await expect(coordinator.ensureContact(chatId(1))).resolves.toEqual({ ok: true, value: contact("cached") });
    expect(getContactInfo).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000);
    const firstRefresh = coordinator.ensureContact(chatId(1), { priority: "active" });
    const deduplicatedRefresh = coordinator.ensureContact(chatId(1), { priority: "active" });
    expect(getContactInfo).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ resource: "contact", status: "loading", chatId: chatId(1) });
    refreshed.resolve({ ok: true, value: contact("fresh") });
    await expect(firstRefresh).resolves.toEqual({ ok: true, value: contact("fresh") });
    await expect(deduplicatedRefresh).resolves.toEqual({ ok: true, value: contact("fresh") });
    expect(getContactInfo).toHaveBeenCalledTimes(2);
  });
});
