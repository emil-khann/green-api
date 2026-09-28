import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import type { AppError } from "@application/errors/AppError";
import type { ChatHistoryMessage, ChatSummary, CheckAccountResult, ContactInfoResult, GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import type { ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";
import { ConversationProvider, useConversationActions, useConversationState } from "@presentation/ConversationProvider";
import { ChatHeader } from "@presentation/components/ChatHeader";
import { MessageList } from "@presentation/components/MessageList";

const CHAT_ID: ChatId = "10000001";
const requestError: AppError = { kind: "protocol", retryable: false, safeMessage: "История недоступна." };
const contactError: AppError = { kind: "protocol", retryable: false, safeMessage: "Статус временно недоступен." };

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class ActiveChatClient implements GreenApiPort {
  getHistory: () => Promise<PortResult<readonly ChatHistoryMessage[]>> = () => Promise.resolve({ ok: true, value: [] });
  getContact: () => Promise<PortResult<ContactInfoResult>> = () => Promise.resolve({ ok: true, value: { lastSeen: null } });

  checkAccount(): Promise<PortResult<CheckAccountResult>> {
    return Promise.resolve({ ok: true, value: { exist: true, chatId: CHAT_ID } });
  }
  getChats(): Promise<PortResult<readonly ChatSummary[]>> {
    return Promise.resolve({ ok: true, value: [] });
  }
  getChatHistory(): Promise<PortResult<readonly ChatHistoryMessage[]>> {
    return this.getHistory();
  }
  getContactInfo(): Promise<PortResult<ContactInfoResult>> {
    return this.getContact();
  }
  sendMessage(): Promise<PortResult<{ idMessage: string }>> {
    return Promise.resolve({ ok: true, value: { idMessage: "sent-1" } });
  }
  receiveNotification(_session: AppliedSession, signal: AbortSignal): Promise<PortResult<ReceivedNotification | null>> {
    return new Promise((resolve) => {
      signal.addEventListener("abort", () => { resolve({ ok: false, error: { kind: "aborted", retryable: false, safeMessage: "Операция отменена." } }); }, { once: true });
    });
  }
  deleteNotification(): Promise<PortResult<void>> {
    return Promise.resolve({ ok: true, value: undefined });
  }
}

function ActiveChatHarness() {
  const { applySession, createConversation, retryContact, sendMessage } = useConversationActions();
  const { session, state } = useConversationState();
  return <>
    <button onClick={() => { applySession({ apiUrl: "https://api.test.invalid", idInstance: "1", apiTokenInstance: "token" }); }}>Подключить тест</button>
    <button onClick={() => { void createConversation("+79991234567"); }}>Открыть тестовый чат</button>
    <button onClick={retryContact}>Обновить контакт</button>
    <button onClick={() => { void sendMessage("Сохранённое сообщение"); }}>Добавить сообщение</button>
    <output>{session ? "Подключено" : "Не подключено"}</output>
    {state.activeChatId ? <><ChatHeader /><MessageList /></> : null}
  </>;
}

function renderHarness(client: GreenApiPort) {
  render(<ConversationProvider client={client}><ActiveChatHarness /></ConversationProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Подключить тест" }));
  return waitFor(() => { expect(screen.getByText("Подключено")).toBeInTheDocument(); });
}

async function openChat() {
  fireEvent.click(screen.getByRole("button", { name: "Открыть тестовый чат" }));
  await waitFor(() => { expect(screen.getAllByRole("heading").length).toBeGreaterThan(0); });
}

test("shows an active-history skeleton, error retry and empty state only after a successful empty response", async () => {
  const client = new ActiveChatClient();
  const firstHistory = deferred<PortResult<readonly ChatHistoryMessage[]>>();
  const retriedHistory = deferred<PortResult<readonly ChatHistoryMessage[]>>();
  let request = 0;
  client.getHistory = () => {
    request += 1;
    return request === 1 ? firstHistory.promise : retriedHistory.promise;
  };

  await renderHarness(client);
  await openChat();
  expect(screen.getByRole("status", { name: "Загрузка сообщений" })).toBeInTheDocument();
  expect(screen.queryByText("Сообщений пока нет.")).not.toBeInTheDocument();

  act(() => { firstHistory.resolve({ ok: false, error: requestError }); });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(requestError.safeMessage);
  fireEvent.click(within(alert).getByRole("button", { name: "Повторить" }));
  expect(screen.getByRole("status", { name: "Загрузка сообщений" })).toBeInTheDocument();

  act(() => { retriedHistory.resolve({ ok: true, value: [] }); });
  expect(await screen.findByText("Сообщений пока нет.")).toBeInTheDocument();
  expect(screen.queryByRole("status", { name: "Загрузка сообщений" })).not.toBeInTheDocument();
});

test("keeps rendered messages during an errored refresh and follows the latest message near the bottom", async () => {
  const client = new ActiveChatClient();
  const firstHistory = deferred<PortResult<readonly ChatHistoryMessage[]>>();
  const retriedHistory = deferred<PortResult<readonly ChatHistoryMessage[]>>();
  let request = 0;
  client.getHistory = () => {
    request += 1;
    return request === 1 ? firstHistory.promise : retriedHistory.promise;
  };
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });

  await renderHarness(client);
  await openChat();
  fireEvent.click(screen.getByRole("button", { name: "Добавить сообщение" }));
  expect(await screen.findByText("Сохранённое сообщение")).toBeInTheDocument();
  await waitFor(() => { expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "end" }); });

  act(() => { firstHistory.resolve({ ok: false, error: requestError }); });
  const alert = await screen.findByRole("alert");
  expect(screen.getByText("Сохранённое сообщение")).toBeInTheDocument();
  fireEvent.click(within(alert).getByRole("button", { name: "Повторить" }));
  expect(screen.getByText("Сохранённое сообщение")).toBeInTheDocument();
  expect(screen.getByText("Обновляем сообщения…")).toBeInTheDocument();

  act(() => { retriedHistory.resolve({ ok: true, value: [] }); });
  await waitFor(() => { expect(screen.queryByText("Обновляем сообщения…")).not.toBeInTheDocument(); });
  expect(screen.getByText("Сохранённое сообщение")).toBeInTheDocument();
});

test("uses the shared contact cache and keeps the last successful status when refresh fails", async () => {
  const client = new ActiveChatClient();
  const refreshContact = deferred<PortResult<ContactInfoResult>>();
  let request = 0;
  client.getContact = () => {
    request += 1;
    if (request === 1) return Promise.resolve({ ok: true, value: { lastSeen: Date.now() - 60_000, name: "Общее имя", avatarUrl: "https://cdn.test/avatar.jpg" } });
    return refreshContact.promise;
  };

  await renderHarness(client);
  await openChat();
  expect(await screen.findByRole("heading", { name: "Общее имя" })).toBeInTheDocument();
  expect(screen.getByText("Был(-а) недавно")).toBeInTheDocument();
  expect(screen.getByRole("presentation", { hidden: true })).toHaveAttribute("src", "https://cdn.test/avatar.jpg");

  const avatar = screen.getByRole("presentation", { hidden: true });
  const avatarContainer = avatar.parentElement;
  fireEvent.error(avatar);
  expect(avatarContainer).toHaveTextContent("мя");
  expect(screen.queryByRole("presentation", { hidden: true })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Обновить контакт" }));
  expect(screen.getByText("Был(-а) недавно")).toBeInTheDocument();
  expect(screen.getByLabelText("Статус обновляется")).toBeInTheDocument();
  act(() => { refreshContact.resolve({ ok: false, error: contactError }); });

  expect(screen.getByText("Был(-а) недавно")).toBeInTheDocument();
  const retry = await screen.findByRole("button", { name: /Повторить загрузку статуса/ });
  expect(retry).toHaveAccessibleName(new RegExp(contactError.safeMessage));
});
