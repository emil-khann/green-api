import { classifyNotification } from "@application/notifications/classifyNotification";

describe("classifyNotification", () => {
  test("classifies a normalized direct text notification", () => {
    expect(classifyNotification({ senderId: "10000000", senderType: "user", senderName: "Иван", idMessage: "wamid-1", messageType: "text", text: "Привет", receivedAt: 10 })).toEqual({ kind: "direct-text", chatId: "10000000", senderName: "Иван", idMessage: "wamid-1", text: "Привет", receivedAt: 10 });
  });

  test("ignores group and unsupported message types safely", () => {
    expect(classifyNotification({ senderId: "-10000000", senderType: "group", messageType: "text", idMessage: "1", text: "x" })).toEqual({ kind: "ignored", reason: "unsupported-sender" });
    expect(classifyNotification({ senderId: "10000000", senderType: "bot", messageType: "text", idMessage: "1", text: "x" })).toEqual({ kind: "ignored", reason: "unsupported-sender" });
    expect(classifyNotification({ senderId: "10000000", senderType: "channel", messageType: "text", idMessage: "1", text: "x" })).toEqual({ kind: "ignored", reason: "unsupported-sender" });
    expect(classifyNotification({ senderId: "10000000", senderType: "user", messageType: "image", idMessage: "1" })).toEqual({ kind: "ignored", reason: "unsupported-type" });
  });

  test("reports malformed direct text without exposing payload details", () => {
    expect(classifyNotification({ senderId: "10000000", senderType: "user", messageType: "text", text: "x" })).toEqual({ kind: "malformed", reason: "missing-message-id" });
  });
});
