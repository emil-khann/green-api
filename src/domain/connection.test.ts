import { applyConnection } from "@domain/connection";

describe("applyConnection", () => {
  test("normalizes a valid HTTPS endpoint and uses the supplied session id", () => {
    const result = applyConnection(
      {
        apiUrl: " https://api.green-api.com/waInstance/ ",
        idInstance: " 12345 ",
        apiTokenInstance: " secret ",
      },
      "session-2",
    );
    expect(result).toEqual({
      ok: true,
      session: {
        sessionId: "session-2",
        apiUrl: "https://api.green-api.com/waInstance",
        idInstance: "12345",
        apiTokenInstance: "secret",
      },
    });
  });

  test.each([
    "http://api.example.com",
    "https://user:pass@api.example.com",
    "https://api.example.com?q=secret",
    "https://api.example.com/#token",
  ])("rejects unsafe endpoint %s", (apiUrl) => {
    expect(
      applyConnection(
        { apiUrl, idInstance: "1", apiTokenInstance: "top-secret" },
        "session",
      ).ok,
    ).toBe(false);
  });

  test("does not disclose a rejected token in the validation message", () => {
    const result = applyConnection(
      {
        apiUrl: "https://api.example.com",
        idInstance: "123",
        apiTokenInstance: "",
      },
      "session",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.safeMessage).not.toContain("secret-token");
    }
  });

  test("rejects a non-digit instance id", () => {
    expect(
      applyConnection(
        {
          apiUrl: "https://api.example.com",
          idInstance: "12x",
          apiTokenInstance: "token",
        },
        "session",
      ).ok,
    ).toBe(false);
  });
});
