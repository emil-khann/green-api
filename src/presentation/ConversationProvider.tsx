import { conversationReducer, type ConversationAction } from "@application/conversations/conversationReducer";
import { ConversationRequestCoordinator, type ConversationRequestEvent } from "@application/conversations/conversationRequestCoordinator";
import { createConversationState, type ChatHistoryState, type ConversationMessage, type ConversationState } from "@application/conversations/conversationState";
import type { GreenApiPort } from "@application/ports/GreenApiPort";
import type { IgnoredNotificationSummary } from "@application/notifications/runNotificationPump";
import { normalizePhone } from "@domain/chatId";
import type { ChatId } from "@domain/chatId";
import { applyConnection, type AppliedSession, type ConnectionDraft } from "@domain/connection";
import { validateMessageText } from "@domain/message";
/* eslint-disable react-refresh/only-export-components */
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, createContext, type ReactNode } from "react";
import { useNetworkStatus } from "@presentation/hooks/useNetworkStatus";
import { useNotificationPump, type NotificationPumpStatus } from "@presentation/hooks/useNotificationPump";
import { readAutoFetchPreference, writeAutoFetchPreference } from "@presentation/autoFetchPreference";

type IdFactory = () => string;

interface ConversationActions {
  applySession: (draft: ConnectionDraft) => { ok: true } | { ok: false; message: string };
  createConversation: (phone: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  activateConversation: (chatId: ChatId) => void;
  consumeReadBoundary: (chatId: ChatId, messageId: string) => void;
  closeConversation: () => void;
  sendMessage: (text: string) => Promise<boolean>;
  sendImage: (file: File, caption?: string) => Promise<boolean>;
  retryMessage: (localId: string) => Promise<boolean>;
  retryHistory: () => void;
  retryContact: () => void;
  retryChats: () => void;
  setAutoFetchEnabled: (enabled: boolean) => void;
}

interface ConversationContextValue {
  state: ConversationState;
  session: AppliedSession | null;
  isOnline: boolean;
  pumpStatus: NotificationPumpStatus;
  activeMessages: readonly ConversationMessage[];
  activeContactLastSeen: number | null | undefined;
  activeHistoryState: ChatHistoryState | undefined;
  autoFetchEnabled: boolean;
}

const StateContext = createContext<ConversationContextValue | null>(null);
const ActionsContext = createContext<ConversationActions | null>(null);

const defaultIdFactory: IdFactory = () => {
  try { return globalThis.crypto.randomUUID(); }
  catch { return `${String(Date.now())}-${Math.random().toString(36).slice(2)}`; }
};

export interface ConversationProviderProps {
  readonly client: GreenApiPort;
  readonly children: ReactNode;
  readonly idFactory?: IdFactory;
}

export function ConversationProvider({ client, children, idFactory = defaultIdFactory }: ConversationProviderProps) {
  const [state, dispatch] = useReducer(conversationReducer, null, () => createConversationState());
  const [session, setSession] = useState<AppliedSession | null>(null);
  const [autoFetchEnabled, setAutoFetchEnabledState] = useState(readAutoFetchPreference);
  const isOnline = useNetworkStatus();
  const ignoredTotalsRef = useRef({ ignored: 0, malformed: 0 });
  const sessionRef = useRef<AppliedSession | null>(null);
  const checkAccountControllerRef = useRef<AbortController | null>(null);
  const coordinatorRef = useRef<ConversationRequestCoordinator | null>(null);
  sessionRef.current = session;

  const abortCheckAccount = useCallback(() => {
    checkAccountControllerRef.current?.abort();
    checkAccountControllerRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOnline) abortCheckAccount();
  }, [abortCheckAccount, isOnline]);

  useEffect(() => abortCheckAccount, [abortCheckAccount]);

  const onIncoming = useCallback((notification: Parameters<typeof dispatch>[0] extends never ? never : Extract<ConversationAction, { type: "notification-classified" }>['notification']) => {
    dispatch({ type: "notification-classified", notification, localId: idFactory() });
  }, [idFactory]);

  const onIgnored = useCallback((summary: IgnoredNotificationSummary) => {
    const ignored = summary.unsupportedSender + summary.unsupportedType;
    const ignoredDifference = Math.max(0, ignored - ignoredTotalsRef.current.ignored);
    const malformedDifference = Math.max(0, summary.malformed - ignoredTotalsRef.current.malformed);
    ignoredTotalsRef.current = { ignored, malformed: summary.malformed };
    for (let index = 0; index < ignoredDifference; index += 1) dispatch({ type: "notification-classified", notification: { kind: "ignored", reason: "unsupported-type" } });
    for (let index = 0; index < malformedDifference; index += 1) dispatch({ type: "notification-classified", notification: { kind: "malformed", reason: "missing-text" } });
  }, []);

  const pumpStatus = useNotificationPump({ client, session, isOnline, onIncoming, onIgnored });

  const onRequestEvent = useCallback((event: ConversationRequestEvent) => {
    switch (event.resource) {
      case "chats":
        if (event.status === "loading") {
          dispatch({ type: "conversations-loading" });
        } else if (event.status === "success") {
          dispatch({ type: "conversations-loaded", conversations: event.value });
        } else if (event.status === "cancelled") {
          dispatch({ type: "conversations-cancelled" });
        } else {
          dispatch({ type: "conversations-failed", error: event.error });
        }
        break;
      case "history":
        if (event.status === "loading") dispatch({ type: "history-loading", chatId: event.chatId });
        else if (event.status === "success") dispatch({ type: "history-loaded", chatId: event.chatId, messages: event.value });
        else if (event.status === "cancelled") dispatch({ type: "history-cancelled", chatId: event.chatId });
        else dispatch({ type: "history-failed", chatId: event.chatId, error: event.error });
        break;
      case "contact":
        if (event.status === "loading") {
          dispatch({ type: "contact-info-loading", chatId: event.chatId });
        } else if (event.status === "success") {
          dispatch({
            type: "contact-info-loaded",
            chatId: event.chatId,
            lastSeen: event.value.lastSeen,
            ...(event.value.name ? { name: event.value.name } : {}),
            ...(event.value.avatarUrl ? { avatarUrl: event.value.avatarUrl } : {}),
          });
        } else if (event.status === "cancelled") {
          dispatch({ type: "contact-info-cancelled", chatId: event.chatId });
        } else {
          dispatch({ type: "contact-info-failed", chatId: event.chatId, error: event.error });
        }
        break;
    }
  }, []);

  const coordinator = useMemo(() => new ConversationRequestCoordinator({ client, onEvent: onRequestEvent }), [client, onRequestEvent]);

  useEffect(() => {
    coordinatorRef.current = coordinator;
    if (!session || !isOnline) {
      coordinator.stopSession();
      return () => {
        if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
        coordinator.stopSession();
      };
    }
    coordinator.startSession(session);
    void coordinator.loadChats({ priority: "active" });
    return () => {
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
      coordinator.stopSession();
    };
  }, [coordinator, isOnline, session]);

  useEffect(() => {
    if (!autoFetchEnabled || !session || !isOnline) return;
    for (const chatId of state.conversationOrder) {
      void coordinator.ensureHistory(chatId, { priority: "background" });
      void coordinator.ensureContact(chatId, { priority: "background" });
    }
  }, [autoFetchEnabled, coordinator, isOnline, session, state.conversationOrder]);

  useEffect(() => {
    if (!session || !isOnline || !state.activeChatId) return;
    void coordinator.ensureHistory(state.activeChatId, { priority: "active" });
    void coordinator.ensureContact(state.activeChatId, { priority: "active" });
  }, [coordinator, isOnline, session, state.activeChatId]);

  const setAutoFetchEnabled = useCallback((enabled: boolean) => {
    if (!enabled) coordinator.cancelBackgroundJobs();
    writeAutoFetchPreference(enabled);
    setAutoFetchEnabledState(enabled);
  }, [coordinator]);

  const applySession = useCallback((draft: ConnectionDraft) => {
    if (!isOnline) return { ok: false as const, message: "Подключение недоступно без сети." };
    const result = applyConnection(draft, idFactory());
    if (!result.ok) return { ok: false as const, message: result.error.safeMessage };
    abortCheckAccount();
    coordinator.stopSession();
    ignoredTotalsRef.current = { ignored: 0, malformed: 0 };
    setSession(result.session);
    dispatch({ type: "session-applied", sessionId: result.session.sessionId });
    return { ok: true as const };
  }, [abortCheckAccount, coordinator, idFactory, isOnline]);

  const createConversation = useCallback(async (phone: string) => {
    const result = normalizePhone(phone);
    if (!result.ok) return { ok: false as const, message: result.reason === "unsupported-country" ? "MAX поддерживает номера России и Беларуси." : "Укажите корректный номер России или Беларуси." };
    const capturedSession = session;
    if (!capturedSession || !isOnline) return { ok: false as const, message: "Проверка номера недоступна без подключения к сети." };
    abortCheckAccount();
    const controller = new AbortController();
    checkAccountControllerRef.current = controller;
    const checked = await client.checkAccount(capturedSession, result.digits, controller.signal);
    if (checkAccountControllerRef.current === controller) checkAccountControllerRef.current = null;
    if (sessionRef.current?.sessionId !== capturedSession.sessionId) return { ok: false as const, message: "Подключение изменилось. Повторите проверку номера." };
    if (controller.signal.aborted) return { ok: false as const, message: "" };
    if (!checked.ok) return { ok: false as const, message: checked.error.kind === "aborted" ? "" : checked.error.safeMessage };
    if (!checked.value.exist) return { ok: false as const, message: "Для этого номера не найден аккаунт MAX." };
    dispatch({ type: "conversation-created", chatId: checked.value.chatId, label: `+${result.digits}` });
    void coordinator.ensureHistory(checked.value.chatId, { priority: "active" });
    void coordinator.ensureContact(checked.value.chatId, { priority: "active" });
    return { ok: true as const };
  }, [abortCheckAccount, client, coordinator, isOnline, session]);

  const activateConversation = useCallback((chatId: ChatId) => {
    dispatch({ type: "conversation-activated", chatId });
    void coordinator.ensureHistory(chatId, { priority: "active" });
    void coordinator.ensureContact(chatId, { priority: "active" });
  }, [coordinator]);
  const consumeReadBoundary = useCallback((chatId: ChatId, messageId: string) => {
    dispatch({ type: "read-boundary-consumed", chatId, messageId });
  }, []);
  const closeConversation = useCallback(() => { dispatch({ type: "conversation-closed" }); }, []);
  const retryHistory = useCallback(() => {
    if (state.activeChatId) void coordinator.ensureHistory(state.activeChatId, { priority: "active", refresh: true });
  }, [coordinator, state.activeChatId]);
  const retryContact = useCallback(() => {
    if (state.activeChatId) void coordinator.ensureContact(state.activeChatId, { priority: "active", refresh: true });
  }, [coordinator, state.activeChatId]);
  const retryChats = useCallback(() => {
    void coordinator.loadChats({ priority: "active", refresh: true });
  }, [coordinator]);

  const executeSend = useCallback(async (chatId: ChatId, localId: string, attemptId: string, text: string) => {
    const capturedSession = session;
    if (!capturedSession || !isOnline) return false;
    const result = await client.sendMessage(capturedSession, chatId, text);
    dispatch(result.ok
      ? { type: "outgoing-sent", chatId, localId, attemptId, idMessage: result.value.idMessage }
      : { type: "outgoing-failed", chatId, localId, attemptId, error: result.error });
    return result.ok;
  }, [client, isOnline, session]);

  const sendMessage = useCallback(async (rawText: string) => {
    const chatId = state.activeChatId;
    if (!chatId || !session || !isOnline) return false;
    const result = validateMessageText(rawText);
    if (!result.ok) return false;
    const localId = idFactory();
    const attemptId = idFactory();
    dispatch({ type: "outgoing-created", chatId, localId, attemptId, text: result.text, createdAt: Date.now() });
    return executeSend(chatId, localId, attemptId, result.text);
  }, [executeSend, idFactory, isOnline, session, state.activeChatId]);

  const executeSendImage = useCallback(async (chatId: ChatId, localId: string, attemptId: string, file: File, caption: string) => {
    const capturedSession = session;
    if (!capturedSession || !isOnline || !client.sendImage) return false;
    const result = await client.sendImage(capturedSession, chatId, file, caption);
    dispatch(result.ok
      ? { type: "outgoing-sent", chatId, localId, attemptId, idMessage: result.value.idMessage }
      : { type: "outgoing-failed", chatId, localId, attemptId, error: result.error });
    return result.ok;
  }, [client, isOnline, session]);

  const sendImage = useCallback(async (file: File, caption = "") => {
    const chatId = state.activeChatId;
    if (!chatId || !session || !isOnline || !file.type.startsWith("image/") || file.size === 0 || file.size > 100 * 1024 * 1024) return false;
    const captionResult = caption.trim() ? validateMessageText(caption) : { ok: true as const, text: "" };
    if (!captionResult.ok) return false;
    const localId = idFactory();
    const attemptId = idFactory();
    const imageUrl = URL.createObjectURL(file);
    dispatch({ type: "outgoing-created", chatId, localId, attemptId, text: captionResult.text, createdAt: Date.now(), imageUrl, imageFile: file, fileName: file.name, mimeType: file.type });
    return executeSendImage(chatId, localId, attemptId, file, captionResult.text);
  }, [executeSendImage, idFactory, isOnline, session, state.activeChatId]);

  const retryMessage = useCallback(async (localId: string) => {
    const message = state.messagesById[localId];
    if (!message || message.direction !== "outgoing" || message.status !== "error" || !session || !isOnline) return false;
    const attemptId = idFactory();
    dispatch({ type: "outgoing-retried", chatId: message.chatId, localId, attemptId });
    return message.imageFile
      ? executeSendImage(message.chatId, localId, attemptId, message.imageFile, message.text)
      : executeSend(message.chatId, localId, attemptId, message.text);
  }, [executeSend, executeSendImage, idFactory, isOnline, session, state.messagesById]);

  const activeMessages = useMemo(() => {
    if (!state.activeChatId) return [];
    return (state.messageIdsByChatId[state.activeChatId] ?? []).flatMap((id) => state.messagesById[id] ? [state.messagesById[id]] : []);
  }, [state.activeChatId, state.messageIdsByChatId, state.messagesById]);

  const activeHistoryState = state.activeChatId ? state.historyByChatId[state.activeChatId] : undefined;
  const activeContactLastSeen = state.activeChatId ? state.contactsByChatId[state.activeChatId]?.lastSeen : undefined;

  const stateValue = useMemo(() => ({ state, session, isOnline, pumpStatus, activeMessages, activeContactLastSeen, activeHistoryState, autoFetchEnabled }), [activeContactLastSeen, activeHistoryState, activeMessages, autoFetchEnabled, isOnline, pumpStatus, session, state]);
  const actionsValue = useMemo(() => ({ applySession, createConversation, activateConversation, consumeReadBoundary, closeConversation, sendMessage, sendImage, retryMessage, retryHistory, retryContact, retryChats, setAutoFetchEnabled }), [activateConversation, applySession, closeConversation, consumeReadBoundary, createConversation, retryChats, retryContact, retryHistory, retryMessage, sendImage, sendMessage, setAutoFetchEnabled]);

  return <ActionsContext value={actionsValue}><StateContext value={stateValue}>{children}</StateContext></ActionsContext>;
}

export function useConversationState(): ConversationContextValue {
  const value = useContext(StateContext);
  if (!value) throw new Error("useConversationState must be used inside ConversationProvider");
  return value;
}

export function useConversationActions(): ConversationActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("useConversationActions must be used inside ConversationProvider");
  return value;
}
