const AUTO_FETCH_PREFERENCE_KEY = "green-api:auto-fetch-preference";
const AUTO_FETCH_PREFERENCE_VERSION = 1;

interface StoredAutoFetchPreference {
  readonly version: typeof AUTO_FETCH_PREFERENCE_VERSION;
  readonly enabled: boolean;
}

export function readAutoFetchPreference(): boolean {
  try {
    const raw = globalThis.localStorage.getItem(AUTO_FETCH_PREFERENCE_KEY);
    if (raw === null) {
      return false;
    }
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value as Partial<StoredAutoFetchPreference>;

    return (
      candidate.version === AUTO_FETCH_PREFERENCE_VERSION &&
      candidate.enabled === true
    );
  } catch {
    return false;
  }
}

export function writeAutoFetchPreference(enabled: boolean): void {
  try {
    const value: StoredAutoFetchPreference = {
      version: AUTO_FETCH_PREFERENCE_VERSION,
      enabled,
    };
    globalThis.localStorage.setItem(
      AUTO_FETCH_PREFERENCE_KEY,
      JSON.stringify(value),
    );
  } catch {
    // The setting still applies for this session when storage is unavailable.
  }
}
