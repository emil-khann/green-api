import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { AppError } from "@application/errors/AppError";
import type { CheckAccountResult, GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import type { ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";
import { ConversationProvider, useConversationActions, useConversationState } from "@presentation/ConversationProvider";
import { App } from "./App";

const networkError: AppError = { kind: "network", retryable: true, safeMessage: "Сервис временно недоступен." };

class FakeGreenApiClient implements GreenApiPort {
  readonly sends: Array<{ chatId: ChatId; text: string; resolve: (result: PortResult<{ idMessage: string }>) => void }> = [];
  private receivers: Array<(result: PortResult<ReceivedNotification | null>) => void> = [];
  checkAccountHandler: (session: AppliedSession, phoneNumber: string, signal?: AbortSignal) => Promise<PortResult<CheckAccountResult>> = (_session, phoneNumber) => Promise.resolve({ ok: true, value: { exist: true, chatId: phoneNumber.endsWith("4567") ? "10000001" : "10000002" } });

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
  expect(await screen.findByText("Слушаем новые сообщения")).toBeInTheDocument();
}

async function addChat(user: ReturnType<typeof userEvent.setup>, phone: string) {
  const field = screen.getByLabelText("Номер нового собеседника");
  await user.clear(field);
  await user.type(field, phone);
  await user.click(screen.getByRole("button", { name: "Создать чат" }));
}

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

test("counts Unicode code points and rejects the 4001st character", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  render(<App client={client} />);
  await connect(user);
  await addChat(user, "+79991234567");
  const composer = screen.getByLabelText("Сообщение");
  await user.click(composer);
  await user.paste("😀".repeat(4000));
  expect(screen.getByText("4000/4000")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeEnabled();
  await user.paste("😀");
  expect(screen.getByText("4001/4000")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeDisabled();
});

test("does not create a chat from a stale CheckAccount result after reconnect", async () => {
  const user = userEvent.setup();
  const client = new FakeGreenApiClient();
  const pending = deferred<PortResult<CheckAccountResult>>();
  client.checkAccountHandler = () => pending.promise;
  render(<App client={client} />);
  await connect(user);
  const field = screen.getByLabelText("Номер нового собеседника");
  await user.type(field, "+7 999 123-45-67");
  await user.click(screen.getByRole("button", { name: "Создать чат" }));
  await user.click(screen.getByText("Настроить подключение"));
  const settings = document.querySelector(".connection-settings");
  expect(settings).not.toBeNull();
  const settingsForm = within(settings as HTMLElement);
  await user.type(settingsForm.getByLabelText("ID instance"), "654321");
  await user.type(settingsForm.getByLabelText("API token"), "new-token");
  await user.click(settingsForm.getByRole("button", { name: "Переподключить" }));
  pending.resolve({ ok: true, value: { exist: true, chatId: "10000001" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Подключение изменилось");
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
  await addChat(user, "+79991234567");
  expect(screen.getByRole("button", { name: "Создать чат" })).toBeDisabled();
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
  await addChat(user, "+79991234567");
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
