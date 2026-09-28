import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import type { AppError } from "@application/errors/AppError";
import type { ChatHistoryMessage, ChatSummary, CheckAccountResult, ContactInfoResult, GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import type { ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";
import { ConversationProvider, useConversationActions, useConversationState } from "@presentation/ConversationProvider";
import { readAutoFetchPreference, writeAutoFetchPreference } from "@presentation/autoFetchPreference";
import { App } from "./App";

beforeEach(() => {
  localStorage.clear();
});

const networkError: AppError = { kind: "network", retryable: true, safeMessage: "Сервис временно недоступен." };

class FakeGreenApiClient implements GreenApiPort {
  readonly sends: Array<{ chatId: ChatId; text: string; resolve: (result: PortResult<{ idMessage: string }>) => void }> = [];
  private receivers: Array<(result: PortResult<ReceivedNotification | null>) => void> = [];
  checkAccountHandler: (session: AppliedSession, phoneNumber: string, signal?: AbortSignal) => Promise<PortResult<CheckAccountResult>> = (_session, phoneNumber) => Promise.resolve({ ok: true, value: { exist: true, chatId: phoneNumber.endsWith("4567") ? "10000001" : "10000002" } });
  getChats: (session: AppliedSession, signal?: AbortSignal) => Promise<PortResult<readonly ChatSummary[]>> = () => Promise.resolve({ ok: true, value: [] });
  getContactInfo: (session: AppliedSession, chatId: ChatId, signal?: AbortSignal) => Promise<PortResult<ContactInfoResult>> = () => Promise.resolve({ ok: true, value: { lastSeen: null } });
  getChatHistory: (session: AppliedSession, chatId: ChatId, count?: number, signal?: AbortSignal) => Promise<PortResult<readonly ChatHistoryMessage[]>> = () => Promise.resolve({ ok: true, value: [] });

  checkAccount(session: AppliedSession, phoneNumber: string, signal?: AbortSignal): Promise<PortResult<CheckAccountResult>> {
    return this.checkAccountHandler(session, phoneNumber, signal);
  }

  sendMessage(_session: AppliedSession, chatId: ChatId, text: string): Promise<PortResult<{ idMessage: string }>> {
    return new Promise((resolve) => { this.sends.push({ chatId, text, resolve }); });
  }
  receiveNotification(_session: AppliedSession, signal: AbortSignal): Promise<PortResult<ReceivedNotification | null>> {
    return new Promise((resolve) => {
      const abort = () => { resolve({ ok: false, error: { kind: "aborted", retryable: false, safeMessage: "Операция отменена." } }); };
      signal.addEventListener("abort", abort, { once: true });
      this.receivers.push(resolve);
    });
  }
  deleteNotification(): Promise<PortResult<void>> { return Promise.resolve({ ok: true, value: undefined }); }
  emit(chatId: ChatId, text: string, idMessage = `in-${String(Date.now())}`, senderType = "user") {
    this.emitNotification({ idMessage, senderId: chatId, senderType, messageType: "text", text, receivedAt: Date.now() });
  }
  emitNotification(notification: ReceivedNotification["notification"]) {
    const resolve = this.receivers.shift();
    resolve?.({ ok: true, value: { receiptId: 1, notification } });
  }
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ID instance"), "123456");
  await user.type(screen.getByLabelText("API token"), "secret-token");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));
  expect(await screen.findByRole("button", { name: "Добавить новый чат" })).toBeInTheDocument();
  expect(await screen.findByText("Создайте первый чат")).toBeInTheDocument();
}

async function submitNewChat(user: ReturnType<typeof userEvent.setup>, phone: string) {
  await user.click(screen.getByRole("button", { name: "Добавить новый чат" }));
  const dialog = screen.getByRole("dialog", { name: "Новый чат" });
  await user.type(within(dialog).getByLabelText("Номер нового собеседника"), phone);
  await user.click(within(dialog).getByRole("button", { name: "Создать чат" }));
  return dialog;
}

async function addChat(user: ReturnType<typeof userEvent.setup>, phone: string) {
  await submitNewChat(user, phone);
  await waitFor(() => { expect(screen.queryByRole("dialog", { name: "Новый чат" })).not.toBeInTheDocument(); });
}

test("auto fetch preference defaults safely and persists only its versioned boolean", () => {
  expect(readAutoFetchPreference()).toBe(false);
  localStorage.setItem("green-api:auto-fetch-preference", JSON.stringify({ version: 0, enabled: true, token: "must-not-be-used" }));
  expect(readAutoFetchPreference()).toBe(false);
  localStorage.setItem("green-api:auto-fetch-preference", "not-json");
  expect(readAutoFetchPreference()).toBe(false);

  writeAutoFetchPreference(true);
  expect(readAutoFetchPreference()).toBe(true);
  expect(JSON.parse(localStorage.getItem("green-api:auto-fetch-preference") ?? "null")).toEqual({ version: 1, enabled: true });
});

test("settings toggle enables background chat data loading immediately", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  const historyRequests: ChatId[] = [];
  const contactRequests: ChatId[] = [];
  client.getChats = () => Promise.resolve({ ok: true, value: [{ chatId: "10000001", name: "Первый", type: "user", phoneNumber: 79990000001 }] });
  client.getChatHistory = (_session, chatId) => {
    historyRequests.push(chatId);
    return Promise.resolve({ ok: true, value: [] });
  };
  client.getContactInfo = (_session, chatId) => {
    contactRequests.push(chatId);
    return Promise.resolve({ ok: true, value: { lastSeen: null } });
  };

  render(<App client={client} />);
  await user.type(screen.getByLabelText("ID instance"), "123456");
  await user.type(screen.getByLabelText("API token"), "secret-token");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));
  expect(await screen.findByRole("button", { name: /Первый/ })).toBeInTheDocument();
  expect(screen.queryByText("Откройте чат")).not.toBeInTheDocument();
  expect(historyRequests).toEqual([]);
  expect(contactRequests).toEqual([]);

  await user.click(screen.getByRole("button", { name: "Настройки" }));
  const toggle = screen.getByRole("checkbox", { name: "Автозагрузка данных чатов" });
  expect(toggle).not.toBeChecked();
  const warning = screen.getByText(/может расходовать лимиты тарифа GREEN-API/);
  expect(warning).toBeInTheDocument();
  expect(toggle).toHaveAttribute("aria-describedby", warning.id);
  await user.click(toggle);

  expect(toggle).toBeChecked();
  await waitFor(() => {
    expect(historyRequests).toEqual(["10000001"]);
    expect(contactRequests).toEqual(["10000001"]);
  });
  expect(readAutoFetchPreference()).toBe(true);

  await user.click(toggle);
  expect(toggle).not.toBeChecked();
  client.emit("20000002", "Новое без автофетча", "auto-fetch-off");
  await user.click(screen.getByRole("button", { name: "Все" }));
  expect(await screen.findByRole("button", { name: /Чат 20000002/ })).toBeInTheDocument();
  expect(historyRequests).toEqual(["10000001"]);
  expect(contactRequests).toEqual(["10000001"]);
  expect(readAutoFetchPreference()).toBe(false);
});

test("turning auto fetch off aborts background loading and restores the idle preview", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  let historySignal: AbortSignal | undefined;
  client.getChats = () => Promise.resolve({ ok: true, value: [{ chatId: "10000001", name: "Первый", type: "user", phoneNumber: 79990000001 }] });
  client.getChatHistory = (_session, _chatId, _count, signal) => {
    historySignal = signal;
    return new Promise((resolve) => {
      signal?.addEventListener("abort", () => { resolve({ ok: false, error: { kind: "aborted", retryable: false, safeMessage: "Операция отменена." } }); }, { once: true });
    });
  };
  writeAutoFetchPreference(true);

  render(<App client={client} />);
  await user.type(screen.getByLabelText("ID instance"), "123456");
  await user.type(screen.getByLabelText("API token"), "secret-token");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Загружаются последние сообщения");

  await user.click(screen.getByRole("button", { name: "Настройки" }));
  await user.click(screen.getByRole("checkbox", { name: "Автозагрузка данных чатов" }));
  expect(historySignal?.aborted).toBe(true);
  await user.click(screen.getByRole("button", { name: "Все" }));
  expect(await screen.findByRole("button", { name: /Первый/ })).toBeInTheDocument();
  expect(screen.queryByText("Откройте чат")).not.toBeInTheDocument();
  expect(screen.queryByText("Операция отменена.")).not.toBeInTheDocument();
});

test("reissues active history and contact requests after offline to online recovery", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  let online = true;
  const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const historyRequests: Array<{ readonly signal: AbortSignal | undefined; readonly request: ReturnType<typeof deferred<PortResult<readonly ChatHistoryMessage[]>>> }> = [];
  const contactRequests: Array<{ readonly signal: AbortSignal | undefined; readonly request: ReturnType<typeof deferred<PortResult<ContactInfoResult>>> }> = [];
  client.getChats = () => Promise.resolve({ ok: true, value: [{ chatId: "10000001", name: "Первый", type: "user", phoneNumber: 79990000001 }] });
  client.getChatHistory = (_session, _chatId, _count, signal) => {
    const request = deferred<PortResult<readonly ChatHistoryMessage[]>>();
    historyRequests.push({ signal, request });
    return request.promise;
  };
  client.getContactInfo = (_session, _chatId, signal) => {
    const request = deferred<PortResult<ContactInfoResult>>();
    contactRequests.push({ signal, request });
    return request.promise;
  };

  render(<App client={client} />);
  await user.type(screen.getByLabelText("ID instance"), "123456");
  await user.type(screen.getByLabelText("API token"), "secret-token");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));
  await user.click(await screen.findByRole("button", { name: /Первый/ }));
  expect(historyRequests).toHaveLength(1);
  expect(contactRequests).toHaveLength(1);

  online = false;
  act(() => { window.dispatchEvent(new Event("offline")); });
  await waitFor(() => {
    expect(historyRequests[0]?.signal?.aborted).toBe(true);
    expect(contactRequests[0]?.signal?.aborted).toBe(true);
  });

  online = true;
  act(() => { window.dispatchEvent(new Event("online")); });
  await waitFor(() => {
    expect(historyRequests).toHaveLength(2);
    expect(contactRequests).toHaveLength(2);
  });
  act(() => {
    historyRequests[1]?.request.resolve({ ok: true, value: [{ idMessage: "after-online", chatId: "10000001", direction: "incoming", text: "После восстановления сети", createdAt: 10 }] });
    contactRequests[1]?.request.resolve({ ok: true, value: { name: "В сети", avatarUrl: "https://cdn.test/online.jpg", lastSeen: 10 } });
  });

  expect(await screen.findAllByText("После восстановления сети")).not.toHaveLength(0);
  expect(await screen.findAllByText("В сети")).not.toHaveLength(0);
  expect(screen.queryByText("Операция отменена.")).not.toBeInTheDocument();
  onlineSpy.mockRestore();
});

test("validates connection, resolves MAX accounts and activates a duplicate chat", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<App client={client} />);
  await user.clear(screen.getByLabelText("Адрес API"));
  await user.type(screen.getByLabelText("Адрес API"), "http://unsafe.example");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));
  expect(screen.getByRole("alert")).toHaveTextContent("HTTPS");
  await user.clear(screen.getByLabelText("Адрес API"));
  await user.type(screen.getByLabelText("Адрес API"), "https://api.green-api.com");
  await connect(user);
  await addChat(user, "8 (999) 123-45-67");
  await addChat(user, "+7 999 123 45 67");
  await addChat(user, "+7 999 222 33 44");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText("+79991234567")).toBeInTheDocument();
  expect(screen.getAllByText("+79992223344")).toHaveLength(2);
});

function BackgroundPreloadProbe() {
  const { activateConversation, applySession, setAutoFetchEnabled } = useConversationActions();
  const { state, autoFetchEnabled } = useConversationState();
  return <>
    <button onClick={() => { applySession({ apiUrl: "https://api.test.invalid", idInstance: "1", apiTokenInstance: "token" }); }}>preload chats</button>
    <button onClick={() => { setAutoFetchEnabled(true); }}>enable auto fetch</button>
    <button onClick={() => { setAutoFetchEnabled(false); }}>disable auto fetch</button>
    <button onClick={() => { activateConversation("10000001"); }}>open first</button>
    <button onClick={() => { activateConversation("10000002"); }}>open second</button>
    <output>{autoFetchEnabled ? "auto:on" : "auto:off"}</output>
    <output>{state.conversationOrder.flatMap((chatId) => {
      const conversation = state.conversationsById[chatId];
      const messageId = state.messageIdsByChatId[chatId]?.[0];
      const message = messageId ? state.messagesById[messageId] : undefined;
      return conversation ? [`${conversation.label}:${conversation.avatarUrl ?? ""}:${message?.text ?? ""}`] : [];
    }).join(",")}</output>
  </>;
}

test("shows chat and last-message skeletons only while their data is loading", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  const chats = deferred<PortResult<readonly ChatSummary[]>>();
  const history = deferred<PortResult<readonly ChatHistoryMessage[]>>();
  client.getChats = () => chats.promise;
  client.getChatHistory = () => history.promise;
  writeAutoFetchPreference(true);

  render(<App client={client} />);
  await user.type(screen.getByLabelText("ID instance"), "123456");
  await user.type(screen.getByLabelText("API token"), "secret-token");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));
  expect(await screen.findByRole("button", { name: "Добавить новый чат" })).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Загрузка списка чатов" })).toBeInTheDocument();

  act(() => { chats.resolve({ ok: true, value: [{ chatId: "10000001", name: "Первый", type: "user", phoneNumber: 79990000001 }] }); });
  expect(await screen.findByRole("button", { name: /Первый/ })).toBeInTheDocument();
  expect(screen.queryByText("Нет сообщений")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Загружаются последние сообщения");

  act(() => { history.resolve({ ok: true, value: [{ idMessage: "history-1", chatId: "10000001", direction: "incoming", text: "Готовое сообщение", createdAt: 1 }] }); });
  expect(await screen.findByText("Готовое сообщение")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("shows a safe chat-list error and retries through the coordinator", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  let chatRequests = 0;
  client.getChats = () => {
    chatRequests += 1;
    return Promise.resolve(chatRequests === 1
      ? { ok: false as const, error: { kind: "protocol" as const, retryable: false, safeMessage: "Не удалось получить чаты." } }
      : { ok: true as const, value: [{ chatId: "10000001", name: "После повтора", type: "user" as const, phoneNumber: 79990000001 }] });
  };

  render(<App client={client} />);
  await user.type(screen.getByLabelText("ID instance"), "123456");
  await user.type(screen.getByLabelText("API token"), "secret-token");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));

  const error = await screen.findByRole("alert");
  expect(error).toHaveTextContent("Не удалось получить чаты.");
  await user.click(within(error).getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("После повтора", {}, { timeout: 2500 })).toBeInTheDocument();
  expect(chatRequests).toBe(2);
});

test("distinguishes empty and failed previews while keeping realtime as the latest message", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  const firstHistory = deferred<PortResult<readonly ChatHistoryMessage[]>>();
  client.getChats = () => Promise.resolve({ ok: true, value: [
    { chatId: "10000001", name: "В реальном времени", type: "user", phoneNumber: 79990000001 },
    { chatId: "10000002", name: "Пустой", type: "user", phoneNumber: 79990000002 },
    { chatId: "10000003", name: "Ошибка", type: "user", phoneNumber: 79990000003 },
  ] });
  client.getChatHistory = (_session, chatId) => {
    if (chatId === "10000001") return firstHistory.promise;
    if (chatId === "10000002") return Promise.resolve({ ok: true, value: [] });
    return Promise.resolve({ ok: false, error: { kind: "protocol", retryable: false, safeMessage: "История недоступна." } });
  };
  client.getContactInfo = (_session, chatId) => Promise.resolve({ ok: true, value: {
    lastSeen: null,
    ...(chatId === "10000001" ? { avatarUrl: "https://cdn.test/avatar.jpg" } : {}),
  } });
  writeAutoFetchPreference(true);

  render(<App client={client} />);
  await user.type(screen.getByLabelText("ID instance"), "123456");
  await user.type(screen.getByLabelText("API token"), "secret-token");
  await user.click(screen.getByRole("button", { name: "Подключиться" }));

  const realtimeRow = await screen.findByRole("button", { name: /В реальном времени/ });
  client.emit("10000001", "Новое сообщение", "realtime-1");
  expect(await within(realtimeRow).findByText("Новое сообщение")).toBeInTheDocument();
  expect(within(realtimeRow).queryByText("Нет сообщений")).not.toBeInTheDocument();
  await waitFor(() => { expect(realtimeRow.querySelector("img")).toHaveAttribute("src", "https://cdn.test/avatar.jpg"); });
  expect(realtimeRow.querySelector("img")).not.toHaveAttribute("loading", "lazy");
  fireEvent.error(realtimeRow.querySelector("img") as HTMLImageElement);
  expect(realtimeRow.querySelector("img")).not.toBeInTheDocument();

  const emptyRow = screen.getByRole("button", { name: /Пустой/ });
  expect(await within(emptyRow).findByText("Нет сообщений", {}, { timeout: 2500 })).toBeInTheDocument();
  const failedRow = screen.getByRole("button", { name: /Ошибка/ });
  expect(await within(failedRow).findByText("История недоступна.", {}, { timeout: 3500 })).toBeInTheDocument();

  act(() => { firstHistory.resolve({ ok: true, value: [] }); });
  expect(await within(realtimeRow).findByText("Новое сообщение")).toBeInTheDocument();
});

test("keeps unknown realtime chat local while auto fetch is off and loads it when opened", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  const contactRequests: ChatId[] = [];
  const historyRequests: ChatId[] = [];
  client.getContactInfo = (_session, chatId) => {
    contactRequests.push(chatId);
    return Promise.resolve({ ok: true, value: { lastSeen: null, name: "Новый контакт", avatarUrl: "https://cdn.test/realtime.jpg" } });
  };
  client.getChatHistory = (_session, chatId) => {
    historyRequests.push(chatId);
    return Promise.resolve({ ok: true, value: [] });
  };

  render(<App client={client} />);
  await connect(user);
  client.emit("20000002", "Сообщение без открытия", "unknown-realtime");

  const row = await screen.findByRole("button", { name: /Чат 20000002/ });
  expect(historyRequests).toEqual([]);
  expect(contactRequests).toEqual([]);
  expect(row.querySelector("img")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Сообщение")).not.toBeInTheDocument();

  await user.click(row);
  await waitFor(() => {
    expect(historyRequests).toEqual(["20000002"]);
    expect(contactRequests).toEqual(["20000002"]);
    expect(row.querySelector("img")).toHaveAttribute("src", "https://cdn.test/realtime.jpg");
  });
});

test("auto fetch is off by default and immediately preloads history and contacts when enabled", async () => {
  vi.useFakeTimers();
  const client = new FakeGreenApiClient();
  let contactRequests = 0;
  let historyRequests = 0;
  client.getChats = (): Promise<PortResult<readonly ChatSummary[]>> => Promise.resolve({ ok: true, value: [
    { chatId: "10000001", name: "Первый", type: "user", phoneNumber: 79990000001 },
    { chatId: "10000002", name: "Второй", type: "user", phoneNumber: 79990000002 },
  ] });
  client.getContactInfo = (_session, chatId): Promise<PortResult<ContactInfoResult>> => {
    contactRequests += 1;
    return Promise.resolve({ ok: true, value: { lastSeen: null, name: `Контакт ${chatId}`, avatarUrl: `https://cdn.test/${chatId}.jpg` } });
  };
  client.getChatHistory = (_session, chatId): Promise<PortResult<readonly ChatHistoryMessage[]>> => {
    historyRequests += 1;
    return Promise.resolve({ ok: true, value: [{ idMessage: `history-${chatId}`, chatId, direction: "incoming", text: `Сообщение ${chatId}`, createdAt: 1 }] });
  };

  render(<ConversationProvider client={client}><BackgroundPreloadProbe /></ConversationProvider>);
  fireEvent.click(screen.getByRole("button", { name: "preload chats" }));
  await act(async () => { await vi.runAllTimersAsync(); });

  expect(screen.getByText("auto:off")).toBeInTheDocument();
  expect(contactRequests).toBe(0);
  expect(historyRequests).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "enable auto fetch" }));
  await act(async () => { await vi.runAllTimersAsync(); });

  expect(screen.getByText("auto:on")).toBeInTheDocument();
  expect(contactRequests).toBe(2);
  expect(historyRequests).toBe(2);
  expect(screen.getByText("Контакт 10000001:https://cdn.test/10000001.jpg:Сообщение 10000001,Контакт 10000002:https://cdn.test/10000002.jpg:Сообщение 10000002")).toBeInTheDocument();
  vi.useRealTimers();
});

test("loads active contacts once and reuses their cached avatars when chats are reopened", async () => {
  vi.useFakeTimers();
  const client = new FakeGreenApiClient();
  const contactRequests: ChatId[] = [];
  client.getChats = (): Promise<PortResult<readonly ChatSummary[]>> => Promise.resolve({ ok: true, value: [
    { chatId: "10000001", name: "Первый", type: "user", phoneNumber: 79990000001 },
    { chatId: "10000002", name: "Второй", type: "user", phoneNumber: 79990000002 },
  ] });
  client.getContactInfo = (_session, chatId): Promise<PortResult<ContactInfoResult>> => {
    contactRequests.push(chatId);
    return Promise.resolve({ ok: true, value: { lastSeen: null, avatarUrl: `https://cdn.test/${chatId}.jpg` } });
  };
  client.getChatHistory = (): Promise<PortResult<readonly ChatHistoryMessage[]>> => Promise.resolve({ ok: true, value: [] });

  render(<ConversationProvider client={client}><BackgroundPreloadProbe /></ConversationProvider>);
  fireEvent.click(screen.getByRole("button", { name: "preload chats" }));
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(contactRequests).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "open first" }));
  await act(async () => { await vi.runAllTimersAsync(); });
  fireEvent.click(screen.getByRole("button", { name: "open second" }));
  await act(async () => { await vi.runAllTimersAsync(); });
  fireEvent.click(screen.getByRole("button", { name: "open first" }));
  await act(async () => { await vi.runAllTimersAsync(); });

  expect(contactRequests).toEqual(["10000001", "10000002"]);
  expect(screen.getByText("Первый:https://cdn.test/10000001.jpg:,Второй:https://cdn.test/10000002.jpg:")).toBeInTheDocument();
  vi.useRealTimers();
});

test("keeps completion attached to original chat when user switches chats", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<App client={client} />);
  await connect(user);
  await addChat(user, "+79991234567");
  await user.type(screen.getByLabelText("Сообщение"), "Первому");
  await user.click(screen.getByRole("button", { name: "Отправить сообщение" }));
  await addChat(user, "+79992223344");
  client.sends[0]?.resolve({ ok: true, value: { idMessage: "sent-1" } });
  expect(screen.queryByRole("list", { name: "Сообщения" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /\+79991234567/ }));
  const messages = await screen.findByRole("list", { name: "Сообщения" });
  expect(within(messages).getByText("Первому")).toBeInTheDocument();
  expect(within(messages).getByText(/отправлено/)).toBeInTheDocument();
});

test("shows safe send failure and retries the same visual message", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<App client={client} />);
  await connect(user);
  await addChat(user, "+79991234567");
  await user.type(screen.getByLabelText("Сообщение"), "Попробуй ещё");
  await user.click(screen.getByRole("button", { name: "Отправить сообщение" }));
  client.sends[0]?.resolve({ ok: false, error: networkError });
  expect(await screen.findByText(networkError.safeMessage)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Повторить" }));
  client.sends[1]?.resolve({ ok: true, value: { idMessage: "sent-2" } });
  await waitFor(() => { expect(screen.queryByRole("button", { name: "Повторить" })).not.toBeInTheDocument(); });
  const messages = screen.getByRole("list", { name: "Сообщения" });
  expect(within(messages).getAllByText("Попробуй ещё")).toHaveLength(1);
});

test("routes an unknown sender to an inactive unread chat without stealing focus", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<App client={client} />);
  await connect(user);
  await addChat(user, "+79991234567");
  client.emit("20000002", "Входящее", "incoming-1");
  expect(await screen.findByLabelText("Непрочитанных: 1")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "+79991234567" })).toBeInTheDocument();
  const unknownRow = screen.getByRole("button", { name: /Чат 20000002/ });
  await user.click(unknownRow);
  const messages = await screen.findByRole("list", { name: "Сообщения" });
  expect(within(messages).getByText("Входящее")).toBeInTheDocument();
  expect(within(unknownRow).queryByLabelText(/Непрочитанных/)).not.toBeInTheDocument();
});

test("positions an unread chat at its read boundary once and goes to bottom after reopening", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  const scrolledElements: HTMLElement[] = [];
  const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement) { scrolledElements.push(this); },
  });

  try {
    render(<App client={client} />);
    await connect(user);
    await addChat(user, "+79991234567");
    await addChat(user, "+79992223344");
    await user.type(screen.getByLabelText("Сообщение"), "Последнее прочитанное");
    await user.click(screen.getByRole("button", { name: "Отправить сообщение" }));

    await user.click(screen.getByRole("button", { name: /\+79991234567/ }));
    client.emit("10000002", "Новое непрочитанное", "incoming-after-read");
    expect(await screen.findByLabelText("Непрочитанных: 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /\+79992223344/ }));

    await waitFor(() => {
      expect(scrolledElements.some((element) => element.textContent.includes("Последнее прочитанное"))).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: /\+79991234567/ }));
    expect(await screen.findByRole("heading", { name: "+79991234567" })).toBeInTheDocument();
    const beforeReopen = scrolledElements.length;
    await user.click(screen.getByRole("button", { name: /\+79992223344/ }));
    await waitFor(() => { expect(scrolledElements.length).toBeGreaterThan(beforeReopen); });
    expect(scrolledElements.at(-1)?.textContent).not.toContain("Последнее прочитанное");
  } finally {
    if (originalScrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoViewDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

test("counts Unicode code points and rejects the 4001st character", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<App client={client} />);
  await connect(user);
  await addChat(user, "+79991234567");
  const composer = screen.getByLabelText("Сообщение");
  await user.click(composer);
  await user.paste("😀".repeat(4000));
  expect(composer).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeEnabled();
  await user.paste("😀");
  expect(composer).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeDisabled();
});

test("does not create a chat from a stale CheckAccount result after reconnect", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  const pending = deferred<PortResult<CheckAccountResult>>();
  client.checkAccountHandler = () => pending.promise;
  render(<App client={client} />);
  await connect(user);
  await user.click(screen.getByRole("button", { name: "Добавить новый чат" }));
  const dialog = screen.getByRole("dialog", { name: "Новый чат" });
  const field = within(dialog).getByLabelText("Номер нового собеседника");
  await user.type(field, "+7 999 123-45-67");
  await user.click(within(dialog).getByRole("button", { name: "Создать чат" }));
  await user.click(screen.getByRole("button", { name: "Настройки" }));
  const settings = await screen.findByRole("heading", { name: "Подключение" });
  const settingsPanel = settings.closest(".settings-panel");
  expect(settingsPanel).not.toBeNull();
  const settingsForm = within(settingsPanel as HTMLElement);
  await user.clear(settingsForm.getByLabelText("ID instance"));
  await user.type(settingsForm.getByLabelText("ID instance"), "654321");
  await user.clear(settingsForm.getByLabelText("API token"));
  await user.type(settingsForm.getByLabelText("API token"), "new-token");
  await user.click(settingsForm.getByRole("button", { name: "Переподключить" }));
  pending.resolve({ ok: true, value: { exist: true, chatId: "10000001" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Подключение изменилось");
  await user.click(screen.getByRole("button", { name: "Все" }));
  expect(screen.getByText("Создайте первый чат")).toBeInTheDocument();
});

test("aborts a pending CheckAccount quietly when the app goes offline and clears submitting", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  let capturedSignal: AbortSignal | undefined;
  client.checkAccountHandler = (_session, _phone, signal) => {
    capturedSignal = signal;
    return new Promise((resolve) => {
      signal?.addEventListener("abort", () => { resolve({ ok: false, error: { kind: "aborted", retryable: false, safeMessage: "Запрос отменён." } }); }, { once: true });
    });
  };
  render(<App client={client} />);
  await connect(user);
  const dialog = await submitNewChat(user, "+79991234567");
  expect(within(dialog).getByRole("button", { name: "Создаём…" })).toBeDisabled();
  const onlineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => { window.dispatchEvent(new Event("offline")); });
  await waitFor(() => { expect(capturedSignal?.aborted).toBe(true); });
  await waitFor(() => { expect(screen.getByRole("button", { name: "Создать чат" })).toBeEnabled(); });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  onlineSpy.mockRestore();
});

test("aborts a pending CheckAccount when the provider unmounts", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  let capturedSignal: AbortSignal | undefined;
  client.checkAccountHandler = (_session, _phone, signal) => {
    capturedSignal = signal;
    return new Promise(() => {});
  };
  const view = render(<App client={client} />);
  await connect(user);
  await submitNewChat(user, "+79991234567");
  view.unmount();
  expect(capturedSignal?.aborted).toBe(true);
});

function ConcurrentCheckProbe() {
  const { applySession, createConversation } = useConversationActions();
  const { state } = useConversationState();
  return <>
    <button onClick={() => { applySession({ apiUrl: "https://api.test.invalid", idInstance: "1", apiTokenInstance: "token" }); }}>connect checks</button>
    <button onClick={() => { void createConversation("+79991234567"); }}>first check</button>
    <button onClick={() => { void createConversation("+79992223344"); }}>second check</button>
    <output>{state.conversationOrder.join(",")}</output>
  </>;
}

test("aborts an older CheckAccount when a newer check starts", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  let firstSignal: AbortSignal | undefined;
  let call = 0;
  client.checkAccountHandler = (_session, _phone, signal) => {
    call += 1;
    if (call === 1) {
      firstSignal = signal;
      return new Promise((resolve) => {
        signal?.addEventListener("abort", () => { resolve({ ok: false, error: { kind: "aborted", retryable: false, safeMessage: "Запрос отменён." } }); }, { once: true });
      });
    }
    return Promise.resolve({ ok: true, value: { exist: true, chatId: "10000002" } });
  };
  render(<ConversationProvider client={client}><ConcurrentCheckProbe /></ConversationProvider>);
  await user.click(screen.getByRole("button", { name: "connect checks" }));
  await user.click(screen.getByRole("button", { name: "first check" }));
  await user.click(screen.getByRole("button", { name: "second check" }));
  expect(firstSignal?.aborted).toBe(true);
  expect(await screen.findByText("10000002")).toBeInTheDocument();
});

test("renders a safe fallback for an invalid message timestamp", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<App client={client} />);
  await connect(user);
  await addChat(user, "+79991234567");
  client.emitNotification({ idMessage: "bad-time", senderId: "10000001", senderType: "user", messageType: "text", text: "Безопасное время", receivedAt: Number.POSITIVE_INFINITY });
  const messages = await screen.findByRole("list", { name: "Сообщения" });
  expect(within(messages).getByText("Безопасное время")).toBeInTheDocument();
  expect(within(messages).getByText("--:-- · получено")).toBeInTheDocument();
});

function DiagnosticsProbe() {
  const { applySession } = useConversationActions();
  const { state } = useConversationState();
  return <><button onClick={() => { applySession({ apiUrl: "https://api.test.invalid", idInstance: "1", apiTokenInstance: "token" }); }}>connect</button><output>{state.diagnostics.ignoredNotifications}:{state.diagnostics.malformedNotifications}</output></>;
}

test("counts an ignored notification as ignored after an earlier malformed one", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<ConversationProvider client={client}><DiagnosticsProbe /></ConversationProvider>);
  await user.click(screen.getByRole("button", { name: "connect" }));
  client.emitNotification({ senderId: "10000000", senderType: "user", messageType: "text", text: "missing id" });
  expect(await screen.findByText("0:1")).toBeInTheDocument();
  await waitFor(() => { client.emitNotification({ senderId: "-10000000", senderType: "group", messageType: "text", idMessage: "group", text: "ignored" }); });
  expect(await screen.findByText("1:1")).toBeInTheDocument();
});
