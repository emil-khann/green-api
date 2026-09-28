import { ResourcePhase } from "@application/conversations/conversationState";
import {
  useConversationActions,
  useConversationState,
} from "@presentation/ConversationProvider";
import { useState } from "react";

const API_TIMESTAMP_MILLISECONDS_THRESHOLD = 10_000_000_000;
const RECENTLY_SEEN_THRESHOLD_MS = 5 * 60_000;
const timeFormatter = new Intl.DateTimeFormat("ru", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "short",
});

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function toMilliseconds(timestamp: number): number {
  return timestamp < API_TIMESTAMP_MILLISECONDS_THRESHOLD
    ? timestamp * 1000
    : timestamp;
}

function formatContactStatus(
  lastSeenValue: number | null | undefined,
  now = new Date(),
): string {
  if (lastSeenValue === undefined) {
    return "Получаем статус…";
  }
  if (lastSeenValue === null) {
    return "Статус недоступен";
  }
  const milliseconds = toMilliseconds(lastSeenValue);
  const lastSeen = new Date(milliseconds);
  if (
    now.getTime() - milliseconds >= 0 &&
    now.getTime() - milliseconds < RECENTLY_SEEN_THRESHOLD_MS
  ) {
    return "Был(-а) недавно";
  }
  const time = timeFormatter.format(lastSeen);
  if (isSameDay(lastSeen, now)) {
    return `Был(-а) сегодня в ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(lastSeen, yesterday)) {
    return `Был(-а) вчера в ${time}`;
  }

  return `Был(-а) ${dateFormatter.format(lastSeen)}`;
}

function ContactAvatar({
  avatarUrl,
  label,
}: {
  readonly avatarUrl: string | undefined;
  readonly label: string | undefined;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!avatarUrl || failedUrl === avatarUrl) {
    return <>{label?.slice(-2) ?? "—"}</>;
  }

  return (
    <img
      src={avatarUrl}
      alt=""
      onError={() => {
        setFailedUrl(avatarUrl);
      }}
    />
  );
}

export function ChatHeader({ onBack }: { readonly onBack?: () => void }) {
  const { state } = useConversationState();
  const { retryContact } = useConversationActions();
  const chatId = state.activeChatId;
  const conversation = chatId ? state.conversationsById[chatId] : undefined;
  const contact = chatId ? state.contactsByChatId[chatId] : undefined;
  const contactPhase = contact?.phase ?? ResourcePhase.Idle;
  const hasCachedStatus = contact?.lastSeen !== undefined;
  const contactStatus =
    contactPhase === ResourcePhase.Error && !hasCachedStatus
      ? "Не удалось получить статус"
      : contactPhase === ResourcePhase.Idle ||
          (contactPhase === ResourcePhase.Loading && !hasCachedStatus)
        ? "Получаем статус…"
        : formatContactStatus(contact?.lastSeen);
  const contactName = contact?.name ?? conversation?.label;
  const avatarUrl = contact?.avatarUrl ?? conversation?.avatarUrl;
  const isContactLoading =
    contactPhase === ResourcePhase.Idle ||
    contactPhase === ResourcePhase.Loading;
  const contactError =
    contactPhase === ResourcePhase.Error ? contact?.error : undefined;

  return (
    <header className="chat-header">
      {onBack ? (
        <button
          className="back-button"
          onClick={onBack}
          aria-label="Вернуться к списку чатов"
        >
          <span className="mask-icon icon-back" aria-hidden="true" />
        </button>
      ) : null}
      <span className="avatar" aria-hidden="true">
        <ContactAvatar avatarUrl={avatarUrl} label={contactName} />
      </span>
      <div className="chat-heading">
        <h2>{contactName ?? "Выберите чат"}</h2>
        {conversation ? (
          <div
            className={`contact-status ${contactError ? "contact-status-error" : ""}`}
            role="status"
            aria-live="polite"
            aria-busy={isContactLoading}
          >
            <span>{contactStatus}</span>
            {contactPhase === ResourcePhase.Loading && hasCachedStatus ? (
              <span
                className="contact-refreshing"
                aria-label="Статус обновляется"
              >
                · обновляем
              </span>
            ) : null}
            {contactError ? (
              <button
                type="button"
                onClick={retryContact}
                aria-label={`Повторить загрузку статуса. ${contactError.safeMessage}`}
                title={contactError.safeMessage}
              >
                Повторить
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
