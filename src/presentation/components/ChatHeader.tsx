import { useConversationState } from "@presentation/ConversationProvider";

export function ChatHeader({ onBack }: { readonly onBack?: () => void }) {
  const { state, activeContactLastSeen } = useConversationState();
  const conversation = state.activeChatId ? state.conversationsById[state.activeChatId] : undefined;
  let contactStatus = "Получаем статус…";
  if (activeContactLastSeen === null) contactStatus = "Статус недоступен";
  else if (activeContactLastSeen !== undefined) {
    const milliseconds = activeContactLastSeen < 10_000_000_000 ? activeContactLastSeen * 1000 : activeContactLastSeen;
    const lastSeen = new Date(milliseconds);
    const elapsed = Date.now() - milliseconds;
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
    const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(lastSeen);
    contactStatus = elapsed >= 0 && elapsed < 5 * 60_000 ? "Был(-а) недавно" : sameDay(lastSeen, today) ? `Был(-а) сегодня в ${time}` : sameDay(lastSeen, yesterday) ? `Был(-а) вчера в ${time}` : `Был(-а) ${new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" }).format(lastSeen)}`;
  }
  return <header className="chat-header">
    {onBack && <button className="back-button" onClick={onBack} aria-label="Вернуться к списку чатов"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>}
    <span className="avatar" aria-hidden="true">{conversation?.label.slice(-2) ?? "—"}</span>
    <div className="chat-heading"><h2>{conversation?.label ?? "Выберите чат"}</h2>{conversation && <span>{contactStatus}</span>}</div>
  </header>;
}
