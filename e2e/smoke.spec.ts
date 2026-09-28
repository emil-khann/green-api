import { expect, test, type Route } from "@playwright/test";

const apiOrigin = "https://green-api.test.invalid";
const idInstance = "123456";
const token = "fake-token-for-browser-smoke";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function fulfillEmptyLongPoll(route: Route): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
  await route.fulfill({ status: 204 });
}

test("routes an incoming message to an inactive chat and acknowledges it", async ({
  page,
}) => {
  const releaseFirstReceive = deferred();
  const secondReceiveStarted = deferred();
  const networkEvents: string[] = [];
  let receiveCount = 0;

  await page.route(`${apiOrigin}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      url.pathname.endsWith(`/checkAccount/${token}`) &&
      request.method() === "POST"
    ) {
      const { phoneNumber } = (await request.postDataJSON()) as {
        phoneNumber: number;
      };
      expect(Number.isInteger(phoneNumber)).toBe(true);
      const chatId = phoneNumber === 79991112233 ? "10000001" : "10000002";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ exist: true, chatId }),
      });

      return;
    }

    if (
      url.pathname.endsWith(`/sendMessage/${token}`) &&
      request.method() === "POST"
    ) {
      networkEvents.push("send");
      expect(await request.postDataJSON()).toEqual({
        chatId: "10000002",
        message: "Исходящее сообщение",
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ idMessage: "outgoing-1" }),
      });

      return;
    }

    if (
      url.pathname.endsWith(`/receiveNotification/${token}`) &&
      request.method() === "GET"
    ) {
      receiveCount += 1;
      networkEvents.push(`receive:${String(receiveCount)}`);
      if (receiveCount === 1) {
        await releaseFirstReceive.promise;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            receiptId: 71,
            body: {
              typeWebhook: "incomingMessageReceived",
              timestamp: 1_763_115_112,
              idMessage: "incoming-1",
              senderData: { chatId: "10000001", chatType: "user" },
              messageData: {
                typeMessage: "textMessage",
                textMessageData: { textMessage: "Входящее в первый чат" },
              },
            },
          }),
        });

        return;
      }
      if (receiveCount === 2) {
        secondReceiveStarted.resolve();
        await route.fulfill({ status: 204 });

        return;
      }
      await route.abort("aborted");

      return;
    }

    if (
      url.pathname.endsWith(`/deleteNotification/${token}/71`) &&
      request.method() === "DELETE"
    ) {
      networkEvents.push("delete:71");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: true }),
      });

      return;
    }

    throw new Error(
      `Unexpected GREEN-API request: ${request.method()} ${url.pathname}`,
    );
  });

  await page.goto("/");
  await page.getByLabel("Адрес API").fill(apiOrigin);
  await page.getByLabel("ID instance").fill(idInstance);
  await page.getByLabel("API token").fill(token);
  await page.getByRole("button", { name: "Подключиться" }).click();

  const phone = page.getByLabel("Номер нового собеседника");
  await phone.fill("8 (999) 111-22-33");
  await page.getByRole("button", { name: "Создать чат" }).click();
  await phone.fill("+7 999 111 22 33");
  await page.getByRole("button", { name: "Создать чат" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Список чатов" })
      .getByRole("button", { name: /^\+79991112233/ }),
  ).toHaveCount(1);

  await phone.fill("+7 999 222-33-44");
  await page.getByRole("button", { name: "Создать чат" }).click();
  await expect(
    page.getByRole("navigation", { name: "Список чатов" }).getByRole("button"),
  ).toHaveCount(2);

  await page
    .getByRole("textbox", { name: "Сообщение", exact: true })
    .fill("Исходящее сообщение");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  const messageList = page.getByRole("list", { name: "Сообщения" });
  await expect(messageList.getByText("Исходящее сообщение")).toBeVisible();
  await expect(messageList.getByText(/отправлено$/)).toBeVisible();

  releaseFirstReceive.resolve();
  await secondReceiveStarted.promise;
  expect(
    networkEvents.filter(
      (event) => event.startsWith("receive:") || event.startsWith("delete:"),
    ),
  ).toEqual(["receive:1", "delete:71", "receive:2"]);

  const firstChat = page
    .getByRole("navigation", { name: "Список чатов" })
    .getByRole("button", { name: /^\+79991112233/ });
  await expect(firstChat.getByLabel("Непрочитанных: 1")).toBeVisible();
  await firstChat.click();
  await expect(
    page
      .getByRole("list", { name: "Сообщения" })
      .getByText("Входящее в первый чат"),
  ).toBeVisible();
  await expect(firstChat.getByLabel("Непрочитанных: 1")).toHaveCount(0);
});

test("pauses offline, resumes one receive loop and clears chats on reconnect", async ({
  page,
  context,
}) => {
  let receiveCount = 0;

  await page.route(`${apiOrigin}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname.endsWith(`/checkAccount/${token}`) &&
      request.method() === "POST"
    ) {
      expect(await request.postDataJSON()).toEqual({
        phoneNumber: 79991112233,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ exist: true, chatId: "10000001" }),
      });

      return;
    }
    if (
      url.pathname.endsWith(`/receiveNotification/${token}`) &&
      request.method() === "GET"
    ) {
      receiveCount += 1;
      await fulfillEmptyLongPoll(route);

      return;
    }
    throw new Error(
      `Unexpected GREEN-API request: ${request.method()} ${url.pathname}`,
    );
  });

  await page.goto("/");
  await page.getByLabel("Адрес API").fill(apiOrigin);
  await page.getByLabel("ID instance").fill(idInstance);
  await page.getByLabel("API token").fill(token);
  await page.getByRole("button", { name: "Подключиться" }).click();
  await expect.poll(() => receiveCount).toBeGreaterThan(0);

  const phone = page.getByLabel("Номер нового собеседника");
  await phone.fill("+7 999 111-22-33");
  await page.getByRole("button", { name: "Создать чат" }).click();

  await context.setOffline(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
  });
  await expect(
    page.getByText("Нет сети. Получение и отправка приостановлены."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отправить сообщение" }),
  ).toBeDisabled();
  const receivesWhileOffline = receiveCount;
  await page.waitForTimeout(100);
  expect(receiveCount).toBe(receivesWhileOffline);

  await context.setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.getByText("Слушаем новые сообщения")).toBeVisible();
  await expect.poll(() => receiveCount).toBeGreaterThan(receivesWhileOffline);

  await page.getByText("Настроить подключение").click();
  const settings = page.locator(".connection-settings");
  await settings.getByLabel("Адрес API").fill(apiOrigin);
  await settings.getByLabel("ID instance").fill(idInstance);
  await settings.getByLabel("API token").fill(token);
  await settings.getByRole("button", { name: "Переподключить" }).click();
  await expect(
    page.getByRole("navigation", { name: "Список чатов" }).getByRole("button"),
  ).toHaveCount(0);
  await expect(page.getByText("Создайте первый чат")).toBeVisible();
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps connection, two-chat navigation and composer usable without horizontal overflow", async ({
    page,
  }) => {
    await page.route(`${apiOrigin}/**`, async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.pathname.endsWith(`/checkAccount/${token}`) &&
        request.method() === "POST"
      ) {
        const { phoneNumber } = (await request.postDataJSON()) as {
          phoneNumber: number;
        };
        expect(Number.isInteger(phoneNumber)).toBe(true);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            exist: true,
            chatId: phoneNumber === 79991112233 ? "10000001" : "10000002",
          }),
        });

        return;
      }
      if (
        url.pathname.endsWith(`/receiveNotification/${token}`) &&
        request.method() === "GET"
      ) {
        await fulfillEmptyLongPoll(route);

        return;
      }
      throw new Error(
        `Unexpected GREEN-API request: ${request.method()} ${url.pathname}`,
      );
    });

    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Подключиться" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.getByLabel("Адрес API").fill(apiOrigin);
    await page.getByLabel("ID instance").fill(idInstance);
    await page.getByLabel("API token").fill(token);
    await page.getByRole("button", { name: "Подключиться" }).click();

    const phone = page.getByLabel("Номер нового собеседника");
    await phone.fill("+7 999 111-22-33");
    await page.getByRole("button", { name: "Создать чат" }).click();
    await page
      .getByRole("navigation", { name: "Список чатов" })
      .getByRole("button", { name: /^\+79991112233/ })
      .click();
    await page
      .getByRole("button", { name: "Вернуться к списку чатов" })
      .click();
    await phone.fill("+7 999 222-33-44");
    await page.getByRole("button", { name: "Создать чат" }).click();
    await page
      .getByRole("navigation", { name: "Список чатов" })
      .getByRole("button", { name: /^\+79992223344/ })
      .click();

    await expect(
      page.getByRole("textbox", { name: "Сообщение", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page
      .getByRole("button", { name: "Вернуться к списку чатов" })
      .click();
    const chatList = page.getByRole("navigation", { name: "Список чатов" });
    await expect(chatList.getByRole("button")).toHaveCount(2);
    await chatList.getByRole("button", { name: /^\+79991112233/ }).click();
    await expect(
      page.getByRole("heading", { name: "+79991112233" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
