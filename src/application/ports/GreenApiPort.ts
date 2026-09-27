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
}

export interface GreenApiPort {
  checkAccount(session: AppliedSession, phoneNumber: string, signal?: AbortSignal): Promise<PortResult<CheckAccountResult>>;
  getContactInfo?(session: AppliedSession, chatId: ChatId, signal?: AbortSignal): Promise<PortResult<ContactInfoResult>>;
  sendMessage(session: AppliedSession, chatId: ChatId, text: string, signal?: AbortSignal): Promise<PortResult<{ readonly idMessage: string }>>;
  sendImage?(session: AppliedSession, chatId: ChatId, file: File, caption?: string, signal?: AbortSignal): Promise<PortResult<{ readonly idMessage: string }>>;
  receiveNotification(session: AppliedSession, signal: AbortSignal): Promise<PortResult<ReceivedNotification | null>>;
  deleteNotification(session: AppliedSession, receiptId: number, signal?: AbortSignal): Promise<PortResult<void>>;
}
