import { isDirectChatId, normalizePhone } from "@domain/chatId";

describe("normalizePhone", () => {
  test.each([
    ["8 (999) 123-45-67", "79991234567"],
    ["999 123 45 67", "79991234567"],
    ["+375 29 123-45-67", "375291234567"],
  ])("normalizes supported MAX phone %s", (phone, digits) => {
    expect(normalizePhone(phone)).toEqual({ ok: true, digits });
  });

  test.each(["00 44 20 7946 0958", "+12.34", "abc", "123456"])("rejects malformed phone %s", (phone) => {
    expect(normalizePhone(phone)).toEqual({ ok: false, reason: "invalid-phone" });
  });

  test("rejects a well-formed unsupported country", () => {
    expect(normalizePhone("+44 7700 900123")).toEqual({ ok: false, reason: "unsupported-country" });
  });

  test("accepts only positive numeric MAX user chat ids", () => {
    expect(isDirectChatId("10000000")).toBe(true);
    expect(isDirectChatId("-10000000")).toBe(false);
    expect(isDirectChatId("79991234567@c.us")).toBe(false);
  });
});
