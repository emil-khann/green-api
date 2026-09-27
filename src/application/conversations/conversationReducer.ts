import { ChatHistoryPhase, createConversationState, SEEN_INBOUND_LIMIT } from "@application/conversations/conversationState";
import type { Conversation, ConversationState, OutgoingMessage } from "@application/conversations/conversationState";
import type { AppError } from "@application/errors/AppError";
import type { ClassifiedNotification } from "@application/notifications/notificationTypes";
import type { ChatHistoryMessage, ChatSummary } from "@application/ports/GreenApiPort";
import type { ChatId } from "@domain/chatId";

export type ConversationAction =
  | { readonly type: "session-applied"; readonly sessionId: string }
  | { readonly type: "conversation-created"; readonly chatId: ChatId; readonly label: string }
  | { readonly type: "conversations-loaded"; readonly conversations: readonly ChatSummary[] }
  | { readonly type: "conversation-activated"; readonly chatId: ChatId }
  | { readonly type: "conversation-closed" }
  | { readonly type: "contact-info-loaded"; readonly chatId: ChatId; readonly name?: string; readonly avatarUrl?: string }
  | { readonly type: "history-loading"; readonly chatId: ChatId }
  | { readonly type: "history-loaded"; readonly chatId: ChatId; readonly messages: readonly ChatHistoryMessage[] }
  | { readonly type: "history-failed"; readonly chatId: ChatId; readonly error: AppError }
  | { readonly type: "notification-classified"; readonly notification: ClassifiedNotification; readonly localId?: string }
  | { readonly type: "outgoing-created"; readonly chatId: ChatId; readonly localId: string; readonly attemptId: string; readonly text: string; readonly createdAt: number; readonly imageUrl?: string; readonly imageFile?: File; readonly fileName?: string; readonly mimeType?: string }
  | { readonly type: "outgoing-sent"; readonly chatId: ChatId; readonly localId: string; readonly attemptId: string; readonly idMessage: string }
  | { readonly type: "outgoing-failed"; readonly chatId: ChatId; readonly localId: string; readonly attemptId: string; readonly error: AppError }
  | { readonly type: "outgoing-retried"; readonly chatId: ChatId; readonly localId: string; readonly attemptId: string };

function addConversation(state: ConversationState, chatId: ChatId, label: string, activate: boolean): ConversationState {
  const existing = state.conversationsById[chatId];
  if (existing) {
    return activate ? activateConversation(state, chatId) : state;
  }
  const conversation: Conversation = { chatId, label, unreadCount: 0 };
  return {
    ...state,
    conversationsById: { ...state.conversationsById, [chatId]: conversation },
    conversationOrder: [...state.conversationOrder, chatId],
    messageIdsByChatId: { ...state.messageIdsByChatId, [chatId]: [] },
    activeChatId: activate ? chatId : state.activeChatId,
  };
}

function activateConversation(state: ConversationState, chatId: ChatId): ConversationState {
  const conversation = state.conversationsById[chatId];
  if (!conversation) return state;
  return {
    ...state,
    activeChatId: chatId,
    conversationsById: conversation.unreadCount === 0 ? state.conversationsById : {
      ...state.conversationsById,
      [chatId]: { ...conversation, unreadCount: 0 },
    },
  };
}

function recordConversations(state: ConversationState, summaries: readonly ChatSummary[]): ConversationState {
  const conversationsById = { ...state.conversationsById };
  const conversationOrder = [...state.conversationOrder];
  const messageIdsByChatId = { ...state.messageIdsByChatId };
  for (const summary of summaries) {
    const existing = conversationsById[summary.chatId];
    conversationsById[summary.chatId] = existing
      ? { ...existing, label: summary.name.trim() || existing.label }
      : { chatId: summary.chatId, label: summary.name.trim() || `Чат ${summary.chatId}`, unreadCount: 0 };
    if (!existing) conversationOrder.push(summary.chatId);
    messageIdsByChatId[summary.chatId] ??= [];
  }
  return { ...state, conversationsById, conversationOrder, messageIdsByChatId };
}

function recordHistory(state: ConversationState, chatId: ChatId, history: readonly ChatHistoryMessage[]): ConversationState {
  const existingIds = state.messageIdsByChatId[chatId] ?? [];
  const knownRemoteIds = new Set(existingIds.flatMap((localId) => {
    const idMessage = state.messagesById[localId]?.idMessage;
    return idMessage ? [idMessage] : [];
  }));
  const messagesById = { ...state.messagesById };
  let seenInboundIds: Record<string, true> = { ...state.seenInboundIds };
  const seenInboundOrder = [...state.seenInboundOrder];
  const addedIds: string[] = [];
  for (const message of history) {
    if (message.chatId !== chatId || knownRemoteIds.has(message.idMessage)) continue;
    knownRemoteIds.add(message.idMessage);
    const localId = `history:${chatId}:${message.idMessage}`;
    messagesById[localId] = message.direction === "incoming"
      ? { ...message, localId, direction: "incoming", status: "received" }
      : { ...message, localId, direction: "outgoing", status: "sent", attemptId: localId };
    if (message.direction === "incoming") {
      const dedupeKey = `${chatId}:${message.idMessage}`;
      seenInboundIds[dedupeKey] = true;
      seenInboundOrder.push(dedupeKey);
    }
    addedIds.push(localId);
  }
  while (seenInboundOrder.length > SEEN_INBOUND_LIMIT) {
    const evicted = seenInboundOrder.shift();
    if (evicted) seenInboundIds = Object.fromEntries(Object.entries(seenInboundIds).filter(([key]) => key !== evicted));
  }
  const messageIdsByChatId = [...existingIds, ...addedIds].sort((leftId, rightId) => {
    const createdAtDifference = (messagesById[leftId]?.createdAt ?? 0) - (messagesById[rightId]?.createdAt ?? 0);
    return createdAtDifference || leftId.localeCompare(rightId);
  });
  return {
    ...state,
    messagesById,
    messageIdsByChatId: { ...state.messageIdsByChatId, [chatId]: messageIdsByChatId },
    seenInboundIds,
    seenInboundOrder,
    historyByChatId: { ...state.historyByChatId, [chatId]: { phase: ChatHistoryPhase.Loaded } },
  };
}

function updateOutgoing(
  state: ConversationState,
  chatId: ChatId,
  localId: string,
  attemptId: string,
  update: (message: OutgoingMessage) => OutgoingMessage,
): ConversationState {
  const message = state.messagesById[localId];
  if (!message || message.direction !== "outgoing" || message.chatId !== chatId || message.attemptId !== attemptId) return state;
  return { ...state, messagesById: { ...state.messagesById, [localId]: update(message) } };
}

function recordIncoming(
  state: ConversationState,
  notification: Extract<ClassifiedNotification, { kind: "direct-text" | "direct-image" }>,
  localId: string,
): ConversationState {
  const dedupeKey = `${notification.chatId}:${notification.idMessage}`;
  if (state.seenInboundIds[dedupeKey]) return state;

  const safeName = notification.senderName?.trim();
  const label = safeName ? safeName.slice(0, 100) : `Чат ${notification.chatId}`;
  const next = addConversation(state, notification.chatId, label, false);
  const seenInboundIds: Record<string, true> = { ...next.seenInboundIds, [dedupeKey]: true };
  const seenInboundOrder = [...next.seenInboundOrder, dedupeKey];
  if (seenInboundOrder.length > SEEN_INBOUND_LIMIT) {
    const evicted = seenInboundOrder.shift();
    if (evicted) {
      return recordIncomingWithSeenState(next, notification, localId, seenInboundOrder, Object.fromEntries(Object.entries(seenInboundIds).filter(([key]) => key !== evicted)));
    }
  }
  return recordIncomingWithSeenState(next, notification, localId, seenInboundOrder, seenInboundIds);
}

function recordIncomingWithSeenState(
  next: ConversationState,
  notification: Extract<ClassifiedNotification, { kind: "direct-text" | "direct-image" }>,
  localId: string,
  seenInboundOrder: readonly string[],
  seenInboundIds: Readonly<Record<string, true>>,
): ConversationState {
  const conversation = next.conversationsById[notification.chatId];
  if (!conversation) return next;
  const unreadCount = next.activeChatId === notification.chatId ? conversation.unreadCount : conversation.unreadCount + 1;
  return {
    ...next,
    conversationsById: unreadCount === conversation.unreadCount ? next.conversationsById : {
      ...next.conversationsById,
      [notification.chatId]: { ...conversation, unreadCount },
    },
    messagesById: {
      ...next.messagesById,
      [localId]: {
        direction: "incoming",
        status: "received",
        localId,
        chatId: notification.chatId,
        idMessage: notification.idMessage,
        text: notification.text,
        createdAt: notification.receivedAt,
        ...(notification.kind === "direct-image" ? {
          imageUrl: notification.imageUrl,
          ...(notification.fileName ? { fileName: notification.fileName } : {}),
          ...(notification.mimeType ? { mimeType: notification.mimeType } : {}),
        } : {}),
      },
    },
    messageIdsByChatId: {
      ...next.messageIdsByChatId,
      [notification.chatId]: [...(next.messageIdsByChatId[notification.chatId] ?? []), localId],
    },
    seenInboundIds,
    seenInboundOrder,
  };
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "session-applied":
      return createConversationState(action.sessionId);
    case "conversation-created":
      return addConversation(state, action.chatId, action.label, true);
    case "conversations-loaded":
      return recordConversations(state, action.conversations);
    case "conversation-activated":
      return activateConversation(state, action.chatId);
    case "conversation-closed":
      return state.activeChatId === null ? state : { ...state, activeChatId: null };
    case "contact-info-loaded": {
      const conversation = state.conversationsById[action.chatId];
      if (!conversation) return state;
      return { ...state, conversationsById: { ...state.conversationsById, [action.chatId]: { ...conversation, ...(action.name ? { label: action.name } : {}), ...(action.avatarUrl ? { avatarUrl: action.avatarUrl } : {}) } } };
    }
    case "history-loading":
      return { ...state, historyByChatId: { ...state.historyByChatId, [action.chatId]: { phase: ChatHistoryPhase.Loading } } };
    case "history-loaded":
      return recordHistory(state, action.chatId, action.messages);
    case "history-failed":
      return { ...state, historyByChatId: { ...state.historyByChatId, [action.chatId]: { phase: ChatHistoryPhase.Error, error: action.error } } };
    case "notification-classified": {
      if (action.notification.kind === "direct-text" || action.notification.kind === "direct-image") {
        return recordIncoming(state, action.notification, action.localId ?? `${action.notification.chatId}:${action.notification.idMessage}`);
      }
      const key = action.notification.kind === "ignored" ? "ignoredNotifications" : "malformedNotifications";
      return { ...state, diagnostics: { ...state.diagnostics, [key]: state.diagnostics[key] + 1 } };
    }
    case "outgoing-created": {
      if (!state.conversationsById[action.chatId] || state.messagesById[action.localId]) return state;
      return {
        ...state,
        messagesById: {
          ...state.messagesById,
          [action.localId]: { direction: "outgoing", status: "pending", chatId: action.chatId, localId: action.localId, attemptId: action.attemptId, text: action.text, createdAt: action.createdAt, ...(action.imageUrl ? { imageUrl: action.imageUrl } : {}), ...(action.imageFile ? { imageFile: action.imageFile } : {}), ...(action.fileName ? { fileName: action.fileName } : {}), ...(action.mimeType ? { mimeType: action.mimeType } : {}) },
        },
        messageIdsByChatId: { ...state.messageIdsByChatId, [action.chatId]: [...(state.messageIdsByChatId[action.chatId] ?? []), action.localId] },
      };
    }
    case "outgoing-sent":
      return updateOutgoing(state, action.chatId, action.localId, action.attemptId, (message) => {
        if (message.status !== "pending") return message;
        return { ...message, status: "sent", idMessage: action.idMessage };
      });
    case "outgoing-failed":
      return updateOutgoing(state, action.chatId, action.localId, action.attemptId, (message) => message.status === "pending" ? { ...message, status: "error", error: action.error } : message);
    case "outgoing-retried": {
      const message = state.messagesById[action.localId];
      if (!message || message.direction !== "outgoing" || message.chatId !== action.chatId || message.status !== "error") return state;
      const retryableMessage: OutgoingMessage = { ...message, status: "pending", attemptId: action.attemptId };
      return { ...state, messagesById: { ...state.messagesById, [action.localId]: retryableMessage } };
    }
  }
}
