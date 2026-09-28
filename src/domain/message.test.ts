import { MAX_MESSAGE_CODE_POINTS, validateMessageText } from "@domain/message";

describe("validateMessageText", () => {
  test("preserves meaningful leading and trailing whitespace", () => {
    expect(validateMessageText("  hello  ")).toEqual({
      ok: true,
      text: "  hello  ",
    });
  });

  test("rejects whitespace-only content", () => {
    expect(validateMessageText(" \n\t ")).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  test("counts emoji as Unicode code points rather than UTF-16 code units", () => {
    expect(validateMessageText("😀".repeat(MAX_MESSAGE_CODE_POINTS)).ok).toBe(
      true,
    );
    expect(
      validateMessageText("😀".repeat(MAX_MESSAGE_CODE_POINTS + 1)),
    ).toEqual({ ok: false, reason: "too-long" });
  });
});
