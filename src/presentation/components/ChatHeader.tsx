import { useConversationState } from "@presentation/ConversationProvider";

const API_TIMESTAMP_MILLISECONDS_THRESHOLD = 10_000_000_000;
const RECENTLY_SEEN_THRESHOLD_MS = 5 * 60_000;
const timeFormatter = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function toMilliseconds(timestamp: number): number {
  return timestamp < API_TIMESTAMP_MILLISECONDS_THRESHOLD ? timestamp * 1000 : timestamp;
}

function formatContactStatus(lastSeenValue: number | null | undefined, now = new Date()): string {
  if (lastSeenValue === undefined) return "Получаем статус…";
  if (lastSeenValue === null) return "Статус недоступен";
  const milliseconds = toMilliseconds(lastSeenValue);
  const lastSeen = new Date(milliseconds);
  if (now.getTime() - milliseconds >= 0 && now.getTime() - milliseconds < RECENTLY_SEEN_THRESHOLD_MS) return "Был(-а) недавно";
  const time = timeFormatter.format(lastSeen);
  if (isSameDay(lastSeen, now)) return `Был(-а) сегодня в ${time}`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(lastSeen, yesterday)) return `Был(-а) вчера в ${time}`;
  return `Был(-а) ${dateFormatter.format(lastSeen)}`;
}

export function ChatHeader({ onBack }: { readonly onBack?: () => void }) {
  const { state, activeContactLastSeen } = useConversationState();
  const conversation = state.activeChatId ? state.conversationsById[state.activeChatId] : undefined;
  const contactStatus = formatContactStatus(activeContactLastSeen);
  return <header className="chat-header">
    {onBack && <button className="back-button" onClick={onBack} aria-label="Вернуться к списку чатов"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>}
    <span className="avatar" aria-hidden="true">{conversation?.avatarUrl ? <img src={conversation.avatarUrl} alt="" /> : (conversation?.label.slice(-2) ?? "—")}</span>
    <div className="chat-heading"><h2>{conversation?.label ?? "Выберите чат"}</h2>{conversation && <span>{contactStatus}</span>}</div>
  </header>;
}
