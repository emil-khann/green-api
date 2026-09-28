import type { ChatId } from "@domain/chatId";

export interface NotificationEnvelope {
  readonly idMessage?: string;
  readonly senderId?: string;
  readonly senderType?: string;
  readonly senderName?: string;
  readonly messageType?: string;
  readonly text?: string;
  readonly imageUrl?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly receivedAt?: number;
}

export type ClassifiedNotification =
  | {
      readonly kind: "direct-text";
      readonly idMessage: string;
      readonly chatId: ChatId;
      readonly text: string;
      readonly receivedAt: number;
      readonly senderName?: string;
    }
  | {
      readonly kind: "direct-image";
      readonly idMessage: string;
      readonly chatId: ChatId;
      readonly imageUrl: string;
      readonly text: string;
      readonly receivedAt: number;
      readonly senderName?: string;
      readonly fileName?: string;
      readonly mimeType?: string;
    }
  | {
      readonly kind: "ignored";
      readonly reason: "unsupported-sender" | "unsupported-type";
    }
  | {
      readonly kind: "malformed";
      readonly reason:
        | "missing-message-id"
        | "missing-text"
        | "missing-media-url";
    };
