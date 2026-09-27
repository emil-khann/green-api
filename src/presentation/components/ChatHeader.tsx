import { useConversationState } from "@presentation/ConversationProvider";

export function ChatHeader({ onBack }: { readonly onBack?: () => void }) {
  const { state, isOnline } = useConversationState();
  const conversation = state.activeChatId ? state.conversationsById[state.activeChatId] : undefined;
  return <header className="chat-header">
    {onBack && <button className="back-button" onClick={onBack} aria-label="Вернуться к списку чатов">←</button>}
    <span className="avatar" aria-hidden="true">{conversation?.label.slice(-2) ?? "—"}</span>
    <div className="chat-heading"><h2>{conversation?.label ?? "Выберите чат"}</h2><span>{isOnline ? "Сеть доступна" : "Нет сети"}</span></div>
    {conversation && <div className="chat-tools" aria-hidden="true"><span>⌕</span><span>⋮</span></div>}
  </header>;
}
