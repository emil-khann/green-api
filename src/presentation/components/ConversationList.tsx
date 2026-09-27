import { useConversationActions, useConversationState } from "@presentation/ConversationProvider";
import type { ConversationMessage } from "@application/conversations/conversationState";

function getLastMessageLabel(message: ConversationMessage | undefined): string {
  if (!message) return "Нет сообщений";
  if (message.text) return message.text;
  return message.imageUrl ? "Изображение" : "Сообщение";
}

export function ConversationList({ onSelect, query = "", unreadOnly = false }: { readonly onSelect?: () => void; readonly query?: string; readonly unreadOnly?: boolean }) {
  const { state } = useConversationState();
  const { activateConversation } = useConversationActions();
  if (state.conversationOrder.length === 0) return <div className="sidebar-empty"><span aria-hidden="true">💬</span><p>Создайте первый чат</p></div>;
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleChatIds = state.conversationOrder.filter((chatId) => {
    const conversation = state.conversationsById[chatId];
    if (!conversation || (unreadOnly && conversation.unreadCount === 0)) return false;
    return normalizedQuery.length === 0 || conversation.label.toLocaleLowerCase("ru").includes(normalizedQuery);
  });
  if (visibleChatIds.length === 0) return <div className="sidebar-empty"><span aria-hidden="true">💬</span><p>{unreadOnly ? "Новых сообщений нет" : "Чаты не найдены"}</p></div>;
  return <nav aria-label="Список чатов"><ul className="conversation-list">{visibleChatIds.map((chatId) => {
    const conversation = state.conversationsById[chatId];
    if (!conversation) return null;
    const ids = state.messageIdsByChatId[chatId] ?? [];
    const lastMessage = ids.length > 0 ? state.messagesById[ids[ids.length - 1] ?? ""] : undefined;
    return <li key={chatId}><button className={state.activeChatId === chatId ? "conversation-row active" : "conversation-row"} aria-current={state.activeChatId === chatId ? "page" : undefined} onClick={() => { activateConversation(chatId); onSelect?.(); }}>
      <span className="avatar" aria-hidden="true">{conversation.avatarUrl ? <img src={conversation.avatarUrl} alt="" loading="lazy" /> : conversation.label.slice(-2)}</span><span className="conversation-copy"><strong>{conversation.label}</strong><span>{getLastMessageLabel(lastMessage)}</span></span>
      {conversation.unreadCount > 0 && <span className="unread-badge" aria-label={`Непрочитанных: ${String(conversation.unreadCount)}`}>{conversation.unreadCount}</span>}
    </button></li>;
  })}</ul></nav>;
}
