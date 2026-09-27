import { FetchGreenApiClient } from "@infrastructure/greenApi/FetchGreenApiClient";
import type { GreenApiPort } from "@application/ports/GreenApiPort";
import { useState } from "react";
import { ConversationProvider, useConversationActions, useConversationState } from "@presentation/ConversationProvider";
import { ChatHeader } from "@presentation/components/ChatHeader";
import { ConnectionForm } from "@presentation/components/ConnectionForm";
import { ConversationList } from "@presentation/components/ConversationList";
import { MessageComposer } from "@presentation/components/MessageComposer";
import { MessageList } from "@presentation/components/MessageList";
import { NewChatForm } from "@presentation/components/NewChatForm";
import { StatusBanner } from "@presentation/components/StatusBanner";

const productionClient = new FetchGreenApiClient();

function ChatApplication() {
  const { session, state } = useConversationState();
  const { closeConversation } = useConversationActions();
  const [mobileListVisible, setMobileListVisible] = useState(true);
  const [sidebarView, setSidebarView] = useState<"chats" | "new" | "contacts" | "settings">("chats");
  const [searchQuery, setSearchQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const unreadConversationCount = state.conversationOrder.reduce((total, chatId) => total + (state.conversationsById[chatId]?.unreadCount ? 1 : 0), 0);
  function openSidebar(view: typeof sidebarView) {
    setSidebarView(view);
    setMobileListVisible(true);
  }
  if (!session) return <main className="connection-page"><ConnectionForm /></main>;
  return <main className={mobileListVisible ? "app-shell show-list" : "app-shell show-chat"}>
    <nav className="product-nav" aria-label="Разделы MAX Chat">
      <button className={`product-nav-item ${sidebarView === "chats" ? "active" : ""}`} onClick={() => openSidebar("chats")}><span className="product-nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7l-5 3v-3H5a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z"/><path d="M7.5 11h.01M12 11h.01M16.5 11h.01"/></svg>{unreadConversationCount > 0 && <span className="product-nav-badge" aria-label={`Непрочитанных чатов: ${String(unreadConversationCount)}`}>{unreadConversationCount > 99 ? "99+" : unreadConversationCount}</span>}</span><small>Все</small></button>
      <button className={`product-nav-item ${sidebarView === "new" ? "active" : ""}`} onClick={() => openSidebar("new")}><span className="product-nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z"/><path d="M5.5 7.5V5.7a2.2 2.2 0 0 1 2.2-2.2h2.8l2.2 2.2H19a2 2 0 0 1 2 1.8"/></svg>{unreadConversationCount > 0 && <span className="product-nav-badge" aria-hidden="true">{unreadConversationCount > 99 ? "99+" : unreadConversationCount}</span>}</span><small>Новые</small></button>
      <div className="product-nav-divider" />
      <button className={`product-nav-item ${sidebarView === "contacts" ? "active" : ""}`} onClick={() => openSidebar("contacts")}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M2.5 20c.3-4.3 2.5-6.5 6.5-6.5s6.2 2.2 6.5 6.5M15 14.5c3.8-.6 6 1.3 6.5 5.5"/></svg><small>Контакты</small></button>
      <button className={`product-nav-item settings ${sidebarView === "settings" ? "active" : ""}`} onClick={() => openSidebar("settings")}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.2 13.5a7.8 7.8 0 0 0 0-3l2-1.6-2-3.4-2.5 1a8 8 0 0 0-2.6-1.5L13.7 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.5-1-2 3.4 2 1.6a7.8 7.8 0 0 0 0 3l-2 1.6 2 3.4 2.5-1A8 8 0 0 0 9.3 19l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.5 1 2-3.4-2-1.6Z"/></svg><small>Настройки</small></button>
    </nav>
    <aside className="sidebar">
      {sidebarView === "settings" ? <div className="settings-panel"><h1>Настройки</h1><h2>Подключение</h2><ConnectionForm /></div> : <>
        <div className="sidebar-top">
          <div className="brand compact"><strong>{sidebarView === "contacts" ? "Контакты" : sidebarView === "new" ? "Новые" : "Чаты"}</strong><button className="new-chat-button" aria-label="Добавить новый чат" onClick={() => setNewChatOpen(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button></div>
          <label className="chat-search"><span className="sr-only">Поиск чатов</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Найти" /></label>
        </div>
        <div className="sidebar-list"><ConversationList query={searchQuery} unreadOnly={sidebarView === "new"} onSelect={() => { setMobileListVisible(false); }} /></div>
      </>}
    </aside>
    <section className={`chat-pane ${state.activeChatId ? "" : "chat-pane-empty"}`}>
      {state.activeChatId ? <><ChatHeader onBack={() => { closeConversation(); setMobileListVisible(true); }} /><StatusBanner /><MessageList /><MessageComposer /></> : <div className="message-scroll" aria-label="Чат не выбран" />}
    </section>
    <span className="sr-only" aria-live="polite">{state.activeChatId ? "Чат выбран" : "Чат не выбран"}</span>
    {newChatOpen && <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") setNewChatOpen(false); }} onMouseDown={(event) => { if (event.target === event.currentTarget) setNewChatOpen(false); }}><section className="new-chat-modal" role="dialog" aria-modal="true" aria-labelledby="new-chat-title"><button className="modal-close" aria-label="Закрыть" onClick={() => setNewChatOpen(false)}>×</button><h2 id="new-chat-title">Новый чат</h2><p>Введите номер телефона собеседника в международном формате.</p><NewChatForm onCreated={() => setNewChatOpen(false)} /></section></div>}
  </main>;
}

export function App({ client = productionClient }: { readonly client?: GreenApiPort }) {
  return <ConversationProvider client={client}><ChatApplication /></ConversationProvider>;
}
