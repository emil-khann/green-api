export type MaxChatId = `${number}`;
export type ChatId = MaxChatId;

export type ChatIdResult =
  | { readonly ok: true; readonly digits: string }
  | {
      readonly ok: false;
      readonly reason: "invalid-phone" | "unsupported-country";
    };

export function normalizePhone(value: string): ChatIdResult {
  const input = value.trim();
  if (!/^\+?[\d\s()-]+$/.test(input)) {
    return { ok: false, reason: "invalid-phone" };
  }
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) {
    return { ok: false, reason: "invalid-phone" };
  }
  if (/^8\d{10}$/.test(digits)) {
    digits = `7${digits.slice(1)}`;
  } else if (/^9\d{9}$/.test(digits)) {
    digits = `7${digits}`;
  }
  if (/^7\d{10}$/.test(digits) || /^375\d{9}$/.test(digits)) {
    return { ok: true, digits };
  }
  if (/^\d{11,12}$/.test(digits)) {
    return { ok: false, reason: "unsupported-country" };
  }

  return { ok: false, reason: "invalid-phone" };
}

export function isDirectChatId(value: string): value is MaxChatId {
  return /^[1-9]\d{0,19}$/.test(value);
}

export function isChatId(value: string): value is ChatId {
  return /^-?[1-9]\d{0,19}$/.test(value);
}
