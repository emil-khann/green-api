import type { ChatId } from "@domain/chatId";

export const MAX_MESSAGE_CODE_POINTS = 4_000;

export type MessageTextResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "empty" | "too-long" };

export function validateMessageText(value: string): MessageTextResult {
  if (value.trim().length === 0) return { ok: false, reason: "empty" };
  if (Array.from(value).length > MAX_MESSAGE_CODE_POINTS) return { ok: false, reason: "too-long" };
  return { ok: true, text: value };
}

export interface DirectTextMessage {
  readonly idMessage: string;
  readonly chatId: ChatId;
  readonly text: string;
  readonly receivedAt: number;
}
