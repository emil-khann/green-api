// @vitest-environment node

import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import type { ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";
import { FetchGreenApiClient } from "@infrastructure/greenApi/FetchGreenApiClient";
import { runNotificationPump } from "@application/notifications/runNotificationPump";
import type { GreenApiPort, PortResult, ReceivedNotification } from "@application/ports/GreenApiPort";
import { server } from "../../test/server";

const apiUrl = "https://api.test.invalid";
const token = "secret-token";
const session: AppliedSession = { sessionId: "test", apiUrl, idInstance: "123456", apiTokenInstance: token };
const chatId: ChatId = "10000000";
const checkUrl = `${apiUrl}/waInstance123456/checkAccount/${token}`;
const sendUrl = `${apiUrl}/waInstance123456/sendMessage/${token}`;
const receiveUrl = `${apiUrl}/waInstance123456/receiveNotification/${token}`;
const deleteUrl = `${apiUrl}/waInstance123456/deleteNotification/${token}/42`;

describe("FetchGreenApiClient", () => {
  test("checks an account with the exact MAX contract", async () => {
    server.use(http.post(checkUrl, async ({ request }) => {
      expect(await request.json()).toEqual({ phoneNumber: 79991234567 });
      return HttpResponse.json({ exist: true, chatId, fromCache: true });
    }));
    await expect(new FetchGreenApiClient().checkAccount(session, "79991234567")).resolves.toEqual({ ok: true, value: { exist: true, chatId, fromCache: true } });
  });

  test.each(["7999123456", "3752912345678", "9007199254740992"])('rejects an unsafe CheckAccount phone "%s" before fetch', async (phoneNumber) => {
    let requested = false;
    server.use(http.post(checkUrl, () => { requested = true; return HttpResponse.json({ exist: false }); }));
    const result = await new FetchGreenApiClient().checkAccount(session, phoneNumber);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation", retryable: false } });
    expect(requested).toBe(false);
  });

  test.each([
    [{ exist: false, chatId: "" }, { ok: true, value: { exist: false } }],
    [{ exist: true, chatId: "" }, { ok: false, error: { kind: "protocol" } }],
    [{ status: false }, { ok: false, error: { kind: "protocol" } }],
  ])("validates CheckAccount response", async (payload, expected) => {
    server.use(http.post(checkUrl, () => HttpResponse.json(payload)));
    expect(await new FetchGreenApiClient().checkAccount(session, "79991234567")).toMatchObject(expected);
  });

  test.each([
    [401, "auth", false],
    [469, "rate-limit", false],
    [500, "network", true],
  ] as const)("maps CheckAccount HTTP %i without exposing its endpoint", async (status, kind, retryable) => {
    server.use(http.post(checkUrl, () => new HttpResponse(null, { status })));
    const result = await new FetchGreenApiClient().checkAccount(session, "79991234567");
    expect(result).toMatchObject({ ok: false, error: { kind, retryable, status } });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(apiUrl);
  });

  test("maps CheckAccount network failure and abort safely", async () => {
    server.use(http.post(checkUrl, () => HttpResponse.error()));
    const failed = await new FetchGreenApiClient().checkAccount(session, "79991234567");
    expect(failed).toMatchObject({ ok: false, error: { kind: "network", retryable: true } });
    expect(JSON.stringify(failed)).not.toContain(token);

    const controller = new AbortController();
    controller.abort();
    await expect(new FetchGreenApiClient().checkAccount(session, "79991234567", controller.signal)).resolves.toMatchObject({ ok: false, error: { kind: "aborted", retryable: false } });
  });

  test("sends the exact method, path and JSON contract", async () => {
    server.use(http.post(sendUrl, async ({ request }) => {
      expect(request.headers.get("content-type")).toContain("application/json");
      expect(await request.json()).toEqual({ chatId, message: "Привет" });
      return HttpResponse.json({ idMessage: "message-1" });
    }));

    await expect(new FetchGreenApiClient().sendMessage(session, chatId, "Привет")).resolves.toEqual({ ok: true, value: { idMessage: "message-1" } });
  });

  test.each([{ idMessage: "" }, {}, { idMessage: 1 }])("rejects malformed send response", async (payload) => {
    server.use(http.post(sendUrl, () => HttpResponse.json(payload)));
    const result = await new FetchGreenApiClient().sendMessage(session, chatId, "text");
    expect(result).toMatchObject({ ok: false, error: { kind: "protocol", retryable: false } });
  });

  test.each([
    [401, "auth", false],
    [403, "auth", false],
    [400, "validation", false],
    [500, "network", true],
  ] as const)("maps HTTP %i to %s", async (status, kind, retryable) => {
    server.use(http.post(sendUrl, () => new HttpResponse(null, { status })));
    const result = await new FetchGreenApiClient().sendMessage(session, chatId, "text");
    expect(result).toMatchObject({ ok: false, error: { kind, retryable, status } });
  });

  test("maps and caps Retry-After", async () => {
    server.use(http.post(sendUrl, () => new HttpResponse(null, { status: 429, headers: { "Retry-After": "999" } })));
    const result = await new FetchGreenApiClient().sendMessage(session, chatId, "text");
    expect(result).toMatchObject({ ok: false, error: { kind: "rate-limit", retryable: true, retryAfterMs: 60_000 } });
  });

  test("maps a network failure without exposing secrets", async () => {
    server.use(http.post(sendUrl, () => HttpResponse.error()));
    const result = await new FetchGreenApiClient().sendMessage(session, chatId, "text");
    expect(result).toMatchObject({ ok: false, error: { kind: "network", retryable: true } });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(apiUrl);
  });

  test("maps AbortError as a quiet non-retryable cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new FetchGreenApiClient().sendMessage(session, chatId, "text", controller.signal);
    expect(result).toMatchObject({ ok: false, error: { kind: "aborted", retryable: false } });
  });

  test.each([
    [null, null],
    [undefined, null],
  ])("treats an empty receive response as no notification", async (payload, expected) => {
    server.use(http.get(receiveUrl, ({ request }) => {
      expect(new URL(request.url).searchParams.get("receiveTimeout")).toBe("20");
      return payload === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(payload);
    }));
    const result = await new FetchGreenApiClient().receiveNotification(session, new AbortController().signal);
    expect(result).toEqual({ ok: true, value: expected });
  });

  test("parses the documented incoming text notification", async () => {
    server.use(http.get(receiveUrl, () => HttpResponse.json({
      receiptId: 42,
      body: {
        typeWebhook: "incomingMessageReceived",
        timestamp: 1_763_115_112,
        idMessage: "incoming-1",
        senderData: { chatId, chatType: "user", chatName: "Иван" },
        messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Здравствуйте" } },
      },
    })));
    const result = await new FetchGreenApiClient().receiveNotification(session, new AbortController().signal);
    expect(result).toEqual({ ok: true, value: { receiptId: 42, notification: { idMessage: "incoming-1", senderId: chatId, senderType: "user", senderName: "Иван", messageType: "text", text: "Здравствуйте", receivedAt: 1_763_115_112_000 } } });
  });

  test("supports the documented direct textMessage alias", async () => {
    server.use(http.get(receiveUrl, () => HttpResponse.json({ receiptId: 42, body: { typeWebhook: "incomingMessageReceived", idMessage: "incoming-2", senderData: { chatId, chatType: "user" }, messageData: { typeMessage: "textMessage", textMessage: "Alias" } } })));
    const result = await new FetchGreenApiClient().receiveNotification(session, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, value: { receiptId: 42, notification: { messageType: "text", text: "Alias" } } });
  });

  test("keeps an excessive timestamp out of the renderable notification boundary", async () => {
    server.use(http.get(receiveUrl, () => HttpResponse.json({ receiptId: 42, body: { typeWebhook: "incomingMessageReceived", timestamp: 8_640_000_000_001, idMessage: "incoming-bad-time", senderData: { chatId, chatType: "user" }, messageData: { typeMessage: "textMessage", textMessage: "Safe" } } })));
    const result = await new FetchGreenApiClient().receiveNotification(session, new AbortController().signal);
    expect(result).toEqual({ ok: true, value: { receiptId: 42, notification: { messageType: "malformed" } } });
  });

  test.each([
    [{ typeWebhook: "outgoingMessageStatus" }, "unsupported"],
    [{ typeWebhook: "incomingMessageReceived", senderData: { chatId: "-10000000", chatType: "group" }, messageData: { typeMessage: "imageMessage" } }, "imageMessage"],
    ["broken-body", "malformed"],
  ])("keeps a valid receipt ackable for unsupported or malformed body", async (body, messageType) => {
    server.use(http.get(receiveUrl, () => HttpResponse.json({ receiptId: 42, body })));
    const result = await new FetchGreenApiClient().receiveNotification(session, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, value: { receiptId: 42, notification: { messageType } } });
    expect(JSON.stringify(result)).not.toContain("broken-body");
  });

  test("does not guess a receipt for a malformed envelope", async () => {
    server.use(http.get(receiveUrl, () => HttpResponse.json({ body: {} })));
    const result = await new FetchGreenApiClient().receiveNotification(session, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind: "protocol", retryable: false } });
  });

  test("returns a safe protocol error for invalid JSON even with JSON content type", async () => {
    server.use(http.get(receiveUrl, () => new HttpResponse("token=" + token, { headers: { "Content-Type": "application/json" } })));
    const result = await new FetchGreenApiClient().receiveNotification(session, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind: "protocol" } });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test("deletes an exact receipt with DELETE and validates success", async () => {
    server.use(http.delete(deleteUrl, () => HttpResponse.json({ result: true })));
    await expect(new FetchGreenApiClient().deleteNotification(session, 42)).resolves.toEqual({ ok: true, value: undefined });
  });

  test("treats a validated false delete result as terminal idempotent success", async () => {
    server.use(http.delete(deleteUrl, () => HttpResponse.json({ result: false })));
    await expect(new FetchGreenApiClient().deleteNotification(session, 42)).resolves.toEqual({ ok: true, value: undefined });
  });

  test("lets the notification pump receive again after Delete result false", async () => {
    server.use(http.delete(deleteUrl, () => HttpResponse.json({ result: false })));
    const adapter = new FetchGreenApiClient();
    const terminalDelete = await adapter.deleteNotification(session, 42);
    expect(terminalDelete).toEqual({ ok: true, value: undefined });

    const controller = new AbortController();
    const events: string[] = [];
    let receives = 0;
    const pumpClient: GreenApiPort = {
      checkAccount: (...args) => adapter.checkAccount(...args),
      sendMessage: (...args) => adapter.sendMessage(...args),
      receiveNotification: (): Promise<PortResult<ReceivedNotification | null>> => {
        receives += 1;
        events.push(`receive-${String(receives)}`);
        if (receives === 1) return Promise.resolve({ ok: true, value: { receiptId: 42, notification: { senderId: chatId, senderType: "user", messageType: "text", idMessage: "message-42", text: "Привет" } } });
        controller.abort();
        return Promise.resolve({ ok: false, error: { kind: "aborted", retryable: false, safeMessage: "Запрос отменён." } });
      },
      deleteNotification: () => { events.push("delete-false"); return Promise.resolve(terminalDelete); },
    };
    await runNotificationPump({ client: pumpClient, session, signal: controller.signal, onIncoming: () => { events.push("incoming"); } });
    expect(events).toEqual(["receive-1", "incoming", "delete-false", "receive-2"]);
  });

  test.each([{}, { result: "true" }])("maps malformed delete response to retryable acknowledgement error", async (payload) => {
    server.use(http.delete(deleteUrl, () => HttpResponse.json(payload)));
    const result = await new FetchGreenApiClient().deleteNotification(session, 42);
    expect(result).toMatchObject({ ok: false, error: { kind: "acknowledgement", retryable: true } });
  });
});
