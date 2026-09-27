import type { ClassifiedNotification, NotificationEnvelope } from "@application/notifications/notificationTypes";
import { isDirectChatId } from "@domain/chatId";

export function classifyNotification(notification: NotificationEnvelope): ClassifiedNotification {
  if (notification.senderType !== "user" || !notification.senderId || !isDirectChatId(notification.senderId)) {
    return { kind: "ignored", reason: "unsupported-sender" };
  }
  if (!notification.idMessage?.trim()) return { kind: "malformed", reason: "missing-message-id" };
  switch (notification.messageType) {
    case "text":
      if (typeof notification.text !== "string") return { kind: "malformed", reason: "missing-text" };
      return { kind: "direct-text", idMessage: notification.idMessage, chatId: notification.senderId, text: notification.text, receivedAt: notification.receivedAt ?? Date.now(), ...(notification.senderName ? { senderName: notification.senderName } : {}) };
    case "image":
      if (!notification.imageUrl) return { kind: "malformed", reason: "missing-media-url" };
      return { kind: "direct-image", idMessage: notification.idMessage, chatId: notification.senderId, imageUrl: notification.imageUrl, text: notification.text ?? "", receivedAt: notification.receivedAt ?? Date.now(), ...(notification.senderName ? { senderName: notification.senderName } : {}), ...(notification.fileName ? { fileName: notification.fileName } : {}), ...(notification.mimeType ? { mimeType: notification.mimeType } : {}) };
    default:
      return { kind: "ignored", reason: "unsupported-type" };
  }
}
