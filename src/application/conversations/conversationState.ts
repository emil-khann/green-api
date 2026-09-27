import type { AppError } from "@application/errors/AppError";
import type { ChatId } from "@domain/chatId";

export const SEEN_INBOUND_LIMIT = 500;

export interface Conversation {
  readonly chatId: ChatId;
  readonly label: string;
  readonly avatarUrl?: string;
  readonly unreadCount: number;
}

interface MessageBase {
  readonly localId: string;
  readonly chatId: ChatId;
  readonly text: string;
  readonly createdAt: number;
  readonly imageUrl?: string;
  readonly imageFile?: File;
  readonly fileName?: string;
  readonly mimeType?: string;
}

export interface IncomingMessage extends MessageBase {
  readonly direction: "incoming";
  readonly status: "received";
  readonly idMessage: string;
}

export interface OutgoingMessage extends MessageBase {
  readonly direction: "outgoing";
  readonly status: "pending" | "sent" | "error";
  readonly attemptId: string;
  readonly idMessage?: string;
  readonly error?: AppError;
}

export type ConversationMessage = IncomingMessage | OutgoingMessage;

export interface ConversationDiagnostics {
  readonly ignoredNotifications: number;
  readonly malformedNotifications: number;
}

export interface ConversationState {
  readonly sessionId: string | null;
  readonly conversationsById: Readonly<Record<string, Conversation>>;
  readonly conversationOrder: readonly ChatId[];
  readonly messagesById: Readonly<Record<string, ConversationMessage>>;
  readonly messageIdsByChatId: Readonly<Record<string, readonly string[]>>;
  readonly activeChatId: ChatId | null;
  readonly seenInboundIds: Readonly<Record<string, true>>;
  readonly seenInboundOrder: readonly string[];
  readonly diagnostics: ConversationDiagnostics;
}

export function createConversationState(sessionId: string | null = null): ConversationState {
  return {
    sessionId,
    conversationsById: {},
    conversationOrder: [],
    messagesById: {},
    messageIdsByChatId: {},
    activeChatId: null,
    seenInboundIds: {},
    seenInboundOrder: [],
    diagnostics: { ignoredNotifications: 0, malformedNotifications: 0 },
  };
}
