import { useConversationState } from "@presentation/ConversationProvider";

export function ChatHeader({ onBack }: { readonly onBack?: () => void }) {
  const { state, isOnline } = useConversationState();
  const conversation = state.activeChatId ? state.conversationsById[state.activeChatId] : undefined;
  return <header className="chat-header">
    {onBack && <button className="back-button" onClick={onBack} aria-label="Вернуться к списку чатов"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>}
    <span className="avatar" aria-hidden="true">{conversation?.label.slice(-2) ?? "—"}</span>
    <div className="chat-heading"><h2>{conversation?.label ?? "Выберите чат"}</h2><span>{isOnline ? "Сеть доступна" : "Нет сети"}</span></div>
    {conversation && <div className="chat-tools"><button aria-label="Начать звонок"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5 10 8 8.2 10c1.2 2.8 3.1 4.7 5.8 5.8L16 14l4.5 3c-.7 2.5-2.2 3.7-4.5 3.5C9.7 19.8 4.2 14.3 3.5 8 3.3 5.7 4.5 4.2 7 3.5Z"/></svg></button><button aria-label="Начать видеозвонок"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/></svg></button><button aria-label="Поиск сообщений"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></button></div>}
  </header>;
}
