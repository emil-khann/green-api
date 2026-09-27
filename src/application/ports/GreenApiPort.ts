import type { AppError } from "@application/errors/AppError";
import type { NotificationEnvelope } from "@application/notifications/notificationTypes";
import type { ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";

export type PortResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AppError };

export interface ReceivedNotification {
  readonly receiptId: number;
  readonly notification: NotificationEnvelope;
}

export type CheckAccountResult =
  | { readonly exist: true; readonly chatId: ChatId; readonly fromCache?: boolean }
  | { readonly exist: false; readonly fromCache?: boolean };

export interface ContactInfoResult {
  readonly lastSeen: number | null;
  readonly avatarUrl?: string;
  readonly name?: string;
}

export interface ChatSummary {
  readonly chatId: ChatId;
  readonly name: string;
  readonly type: "user" | "group" | "channel" | "bot";
  readonly phoneNumber: number;
}

export interface ChatHistoryMessage {
  readonly idMessage: string;
  readonly chatId: ChatId;
  readonly direction: "incoming" | "outgoing";
  readonly text: string;
  readonly createdAt: number;
  readonly imageUrl?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
}

export interface GreenApiPort {
  checkAccount(session: AppliedSession, phoneNumber: string, signal?: AbortSignal): Promise<PortResult<CheckAccountResult>>;
  getContactInfo?(session: AppliedSession, chatId: ChatId, signal?: AbortSignal): Promise<PortResult<ContactInfoResult>>;
  getChats?(session: AppliedSession, signal?: AbortSignal): Promise<PortResult<readonly ChatSummary[]>>;
  getChatHistory?(session: AppliedSession, chatId: ChatId, count?: number, signal?: AbortSignal): Promise<PortResult<readonly ChatHistoryMessage[]>>;
  sendMessage(session: AppliedSession, chatId: ChatId, text: string, signal?: AbortSignal): Promise<PortResult<{ readonly idMessage: string }>>;
  sendImage?(session: AppliedSession, chatId: ChatId, file: File, caption?: string, signal?: AbortSignal): Promise<PortResult<{ readonly idMessage: string }>>;
  receiveNotification(session: AppliedSession, signal: AbortSignal): Promise<PortResult<ReceivedNotification | null>>;
  deleteNotification(session: AppliedSession, receiptId: number, signal?: AbortSignal): Promise<PortResult<void>>;
}
