import type { AppError } from "@application/errors/AppError";
import type { NotificationEnvelope } from "@application/notifications/notificationTypes";
import type { CheckAccountResult, ContactInfoResult, GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import { isDirectChatId, type ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";
import { checkAccountEndpoint, deleteNotificationEndpoint, getContactInfoEndpoint, receiveNotificationEndpoint, sendImageEndpoint, sendMessageEndpoint } from "@infrastructure/greenApi/endpoints";
import { acknowledgementError, mapFetchError, mapHttpError, protocolError } from "@infrastructure/greenApi/mapFetchError";
import { checkAccountResponseSchema, contactInfoResponseSchema, deleteResponseSchema, notificationBodySchema, notificationEnvelopeSchema, sendResponseSchema } from "@infrastructure/greenApi/schemas";

const DEFAULT_RECEIVE_TIMEOUT_SECONDS = 20;
const SUPPORTED_PHONE_PATTERN = /^(?:7\d{10}|375\d{9})$/;

class ProtocolParseError extends Error {}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProtocolParseError();
  }
}

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value && "safeMessage" in value && "retryable" in value;
}

function toSafeNotification(body: unknown): NotificationEnvelope {
  const parsed = notificationBodySchema.safeParse(body);
  if (!parsed.success) return { messageType: "malformed" };
  const value = parsed.data;
  if (value.typeWebhook !== "incomingMessageReceived") return { messageType: "unsupported" };
  const messageData = value.messageData;
  const typeMessage = messageData?.typeMessage;
  const isText = typeMessage === "textMessage";
  const isImage = typeMessage === "imageMessage";
  const text = isText ? (messageData?.textMessageData?.textMessage ?? messageData?.textMessage) : undefined;
  const file = isImage ? messageData?.fileMessageData : undefined;
  const imageUrl = file?.downloadUrlJpeg ?? file?.downloadUrl;
  return {
    ...(value.idMessage === undefined ? {} : { idMessage: value.idMessage }),
    ...(value.senderData?.chatId === undefined ? {} : { senderId: value.senderData.chatId }),
    ...(value.senderData?.chatType === undefined ? {} : { senderType: value.senderData.chatType }),
    ...(value.senderData?.chatName?.trim() ? { senderName: value.senderData.chatName.trim() } : {}),
    messageType: isText ? "text" : isImage ? "image" : (typeMessage ?? "unsupported"),
    ...(isText && text !== undefined ? { text } : {}),
    ...(isImage && file?.caption !== undefined ? { text: file.caption } : {}),
    ...(isImage && imageUrl ? { imageUrl } : {}),
    ...(isImage && file?.fileName ? { fileName: file.fileName } : {}),
    ...(isImage && file?.mimeType ? { mimeType: file.mimeType } : {}),
    ...(value.timestamp === undefined ? {} : { receivedAt: value.timestamp * 1000 }),
  };
}

export class FetchGreenApiClient implements GreenApiPort {
  readonly #receiveTimeout: number;

  constructor(receiveTimeout = DEFAULT_RECEIVE_TIMEOUT_SECONDS) {
    if (!Number.isInteger(receiveTimeout) || receiveTimeout < 5 || receiveTimeout > 60) throw new RangeError("receiveTimeout must be an integer from 5 to 60 seconds");
    this.#receiveTimeout = receiveTimeout;
  }

  async checkAccount(session: AppliedSession, phoneNumber: string, signal?: AbortSignal): Promise<PortResult<CheckAccountResult>> {
    try {
      if (!SUPPORTED_PHONE_PATTERN.test(phoneNumber)) return { ok: false, error: { kind: "validation", safeMessage: "Укажите корректный номер России или Беларуси.", retryable: false } };
      const numericPhoneNumber = Number(phoneNumber);
      if (!Number.isSafeInteger(numericPhoneNumber)) return { ok: false, error: { kind: "validation", safeMessage: "Укажите корректный номер России или Беларуси.", retryable: false } };
      const response = await fetch(checkAccountEndpoint(session), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phoneNumber: numericPhoneNumber }), signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const parsed = checkAccountResponseSchema.safeParse(await parseJson(response));
      if (!parsed.success) return { ok: false, error: protocolError() };
      const { exist, chatId, fromCache } = parsed.data;
      if (!exist) return { ok: true, value: { exist: false, ...(fromCache === undefined ? {} : { fromCache }) } };
      if (!isDirectChatId(chatId)) return { ok: false, error: protocolError() };
      return { ok: true, value: { exist: true, chatId, ...(fromCache === undefined ? {} : { fromCache }) } };
    } catch (error) {
      return { ok: false, error: error instanceof ProtocolParseError ? protocolError() : (isAppError(error) ? error : mapFetchError(error)) };
    }
  }

  async getContactInfo(session: AppliedSession, chatId: ChatId, signal?: AbortSignal): Promise<PortResult<ContactInfoResult>> {
    try {
      const response = await fetch(getContactInfoEndpoint(session), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId }), signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const parsed = contactInfoResponseSchema.safeParse(await parseJson(response));
      if (!parsed.success) return { ok: false, error: protocolError() };
      const rawLastSeen = parsed.data.lastSeen;
      const lastSeen = rawLastSeen === null || rawLastSeen === undefined ? null : Number(rawLastSeen);
      return { ok: true, value: { lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null } };
    } catch (error) {
      return { ok: false, error: error instanceof ProtocolParseError ? protocolError() : (isAppError(error) ? error : mapFetchError(error)) };
    }
  }

  async sendMessage(session: AppliedSession, chatId: ChatId, text: string, signal?: AbortSignal): Promise<PortResult<{ readonly idMessage: string }>> {
    try {
      const response = await fetch(sendMessageEndpoint(session), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message: text }), signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const parsed = sendResponseSchema.safeParse(await parseJson(response));
      return parsed.success ? { ok: true, value: { idMessage: parsed.data.idMessage } } : { ok: false, error: protocolError() };
    } catch (error) {
      return { ok: false, error: error instanceof ProtocolParseError ? protocolError() : (isAppError(error) ? error : mapFetchError(error)) };
    }
  }

  async sendImage(session: AppliedSession, chatId: ChatId, file: File, caption = "", signal?: AbortSignal): Promise<PortResult<{ readonly idMessage: string }>> {
    try {
      const form = new FormData();
      form.append("chatId", chatId);
      form.append("file", file, file.name);
      form.append("fileName", file.name);
      if (caption.trim()) form.append("caption", caption);
      const response = await fetch(sendImageEndpoint(session), { method: "POST", body: form, signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const parsed = sendResponseSchema.safeParse(await parseJson(response));
      return parsed.success ? { ok: true, value: { idMessage: parsed.data.idMessage } } : { ok: false, error: protocolError() };
    } catch (error) {
      return { ok: false, error: error instanceof ProtocolParseError ? protocolError() : (isAppError(error) ? error : mapFetchError(error)) };
    }
  }

  async receiveNotification(session: AppliedSession, signal: AbortSignal): Promise<PortResult<ReceivedNotification | null>> {
    try {
      const response = await fetch(receiveNotificationEndpoint(session, this.#receiveTimeout), { method: "GET", signal });
      if (response.status === 408) return { ok: true, value: null };
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      if (response.status === 204) return { ok: true, value: null };
      const raw = await parseJson(response);
      if (raw === null) return { ok: true, value: null };
      const envelope = notificationEnvelopeSchema.safeParse(raw);
      if (!envelope.success) return { ok: false, error: protocolError() };
      return { ok: true, value: { receiptId: envelope.data.receiptId, notification: toSafeNotification(envelope.data.body) } };
    } catch (error) {
      return { ok: false, error: error instanceof ProtocolParseError ? protocolError() : (isAppError(error) ? error : mapFetchError(error)) };
    }
  }

  async deleteNotification(session: AppliedSession, receiptId: number, signal?: AbortSignal): Promise<PortResult<void>> {
    try {
      const response = await fetch(deleteNotificationEndpoint(session, receiptId), { method: "DELETE", signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const parsed = deleteResponseSchema.safeParse(await parseJson(response));
      return parsed.success ? { ok: true, value: undefined } : { ok: false, error: acknowledgementError(response.status) };
    } catch (error) {
      if (error instanceof ProtocolParseError) return { ok: false, error: acknowledgementError() };
      if (isAppError(error)) return { ok: false, error };
      return { ok: false, error: mapFetchError(error) };
    }
  }
}
