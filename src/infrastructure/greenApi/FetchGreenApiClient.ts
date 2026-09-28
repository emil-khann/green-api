import type { AppError } from "@application/errors/AppError";
import type { NotificationEnvelope } from "@application/notifications/notificationTypes";
import type { ChatHistoryMessage, ChatSummary, CheckAccountResult, ContactInfoResult, GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import { isChatId, isDirectChatId, type ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";
import { checkAccountEndpoint, deleteNotificationEndpoint, getChatHistoryEndpoint, getChatsEndpoint, getContactInfoEndpoint, receiveNotificationEndpoint, sendImageEndpoint, sendMessageEndpoint } from "@infrastructure/greenApi/endpoints";
import { acknowledgementError, mapFetchError, mapHttpError, protocolError } from "@infrastructure/greenApi/mapFetchError";
import { chatHistoryMessageSchema, chatsResponseSchema, checkAccountResponseSchema, contactInfoResponseSchema, deleteResponseSchema, notificationBodySchema, notificationEnvelopeSchema, sendResponseSchema } from "@infrastructure/greenApi/schemas";
import type { ChatHistoryResponseItem } from "@infrastructure/greenApi/schemas";

function normalizeAvatarUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_RECEIVE_TIMEOUT_SECONDS = 20;
const MIN_RECEIVE_TIMEOUT_SECONDS = 5;
const MAX_RECEIVE_TIMEOUT_SECONDS = 60;
const DEFAULT_HISTORY_COUNT = 100;
const SUPPORTED_PHONE_PATTERN = /^(?:7\d{10}|375\d{9})$/;

enum ApiMessageType {
  Text = "textMessage",
  Image = "imageMessage",
}

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

function mapClientError(error: unknown): AppError {
  if (error instanceof ProtocolParseError) return protocolError();
  if (isAppError(error)) return error;
  return mapFetchError(error);
}

function getNotificationMessageType(typeMessage: string | undefined): string {
  switch (typeMessage) {
    case ApiMessageType.Text: return "text";
    case ApiMessageType.Image: return "image";
    default: return typeMessage ?? "unsupported";
  }
}

function toHistoryMessage(value: ChatHistoryResponseItem): ChatHistoryMessage | null {
  if (!isChatId(value.chatId)) return null;
  const isImage = value.typeMessage === "imageMessage" || value.typeMessage === "stickerMessage" || value.mimeType?.startsWith("image/") === true;
  const imageUrl = isImage ? value.downloadUrlJpeg ?? value.downloadUrl : undefined;
  const text = value.textMessage ?? value.extendedTextMessage?.text ?? value.caption ?? "";
  return {
    idMessage: value.idMessage,
    chatId: value.chatId,
    direction: value.type,
    text,
    createdAt: value.timestamp * 1000,
    ...(imageUrl ? { imageUrl } : {}),
    ...(value.fileName ? { fileName: value.fileName } : {}),
    ...(value.mimeType ? { mimeType: value.mimeType } : {}),
  };
}

function toSafeNotification(body: unknown): NotificationEnvelope {
  const parsed = notificationBodySchema.safeParse(body);
  if (!parsed.success) return { messageType: "malformed" };
  const value = parsed.data;
  if (value.typeWebhook !== "incomingMessageReceived") return { messageType: "unsupported" };
  const messageData = value.messageData;
  const typeMessage = messageData?.typeMessage;
  const isText = typeMessage === ApiMessageType.Text;
  const isImage = typeMessage === ApiMessageType.Image;
  const text = isText ? (messageData?.textMessageData?.textMessage ?? messageData?.textMessage) : undefined;
  const file = isImage ? messageData?.fileMessageData : undefined;
  const imageUrl = file?.downloadUrlJpeg ?? file?.downloadUrl;
  return {
    ...(value.idMessage === undefined ? {} : { idMessage: value.idMessage }),
    ...(value.senderData?.chatId === undefined ? {} : { senderId: value.senderData.chatId }),
    ...(value.senderData?.chatType === undefined ? {} : { senderType: value.senderData.chatType }),
    ...(value.senderData?.chatName?.trim() ? { senderName: value.senderData.chatName.trim() } : {}),
    messageType: getNotificationMessageType(typeMessage),
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
    if (!Number.isInteger(receiveTimeout) || receiveTimeout < MIN_RECEIVE_TIMEOUT_SECONDS || receiveTimeout > MAX_RECEIVE_TIMEOUT_SECONDS) throw new RangeError(`receiveTimeout must be an integer from ${String(MIN_RECEIVE_TIMEOUT_SECONDS)} to ${String(MAX_RECEIVE_TIMEOUT_SECONDS)} seconds`);
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
      return { ok: false, error: mapClientError(error) };
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
      const name = parsed.data.contactName?.trim() || parsed.data.name?.trim() || undefined;
      const avatarUrl = normalizeAvatarUrl(parsed.data.avatar);
      return { ok: true, value: { lastSeen: typeof lastSeen === "number" && Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null, ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) } };
    } catch (error) {
      return { ok: false, error: mapClientError(error) };
    }
  }

  async getChats(session: AppliedSession, signal?: AbortSignal): Promise<PortResult<readonly ChatSummary[]>> {
    try {
      const response = await fetch(getChatsEndpoint(session), { method: "GET", signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const parsed = chatsResponseSchema.safeParse(await parseJson(response));
      if (!parsed.success) return { ok: false, error: protocolError() };
      const chats = parsed.data.flatMap((chat): ChatSummary[] => isChatId(chat.chatId) ? [{ ...chat, chatId: chat.chatId }] : []);
      return { ok: true, value: chats };
    } catch (error) {
      return { ok: false, error: mapClientError(error) };
    }
  }

  async getChatHistory(session: AppliedSession, chatId: ChatId, count = DEFAULT_HISTORY_COUNT, signal?: AbortSignal): Promise<PortResult<readonly ChatHistoryMessage[]>> {
    try {
      const response = await fetch(getChatHistoryEndpoint(session), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, count }), signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const payload = await parseJson(response);
      if (!Array.isArray(payload)) return { ok: false, error: protocolError() };
      return { ok: true, value: payload.flatMap((item) => {
        const parsed = chatHistoryMessageSchema.safeParse(item);
        if (!parsed.success) return [];
        const mapped = toHistoryMessage(parsed.data);
        return mapped ? [mapped] : [];
      }) };
    } catch (error) {
      return { ok: false, error: mapClientError(error) };
    }
  }

  async sendMessage(session: AppliedSession, chatId: ChatId, text: string, signal?: AbortSignal): Promise<PortResult<{ readonly idMessage: string }>> {
    try {
      const response = await fetch(sendMessageEndpoint(session), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message: text }), signal: signal ?? null });
      if (!response.ok) return { ok: false, error: mapHttpError(response) };
      const parsed = sendResponseSchema.safeParse(await parseJson(response));
      return parsed.success ? { ok: true, value: { idMessage: parsed.data.idMessage } } : { ok: false, error: protocolError() };
    } catch (error) {
      return { ok: false, error: mapClientError(error) };
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
      return { ok: false, error: mapClientError(error) };
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
      return { ok: false, error: mapClientError(error) };
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
