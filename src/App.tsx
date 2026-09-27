import { FetchGreenApiClient } from "@infrastructure/greenApi/FetchGreenApiClient";
import type { GreenApiPort } from "@application/ports/GreenApiPort";
import { useState } from "react";
import { ConversationProvider, useConversationState } from "@presentation/ConversationProvider";
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
  const [mobileListVisible, setMobileListVisible] = useState(true);
  const [sidebarView, setSidebarView] = useState<"chats" | "new" | "contacts" | "settings">("chats");
  const [searchQuery, setSearchQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  function openSidebar(view: typeof sidebarView) {
    setSidebarView(view);
    setMobileListVisible(true);
  }
  if (!session) return <main className="connection-page"><ConnectionForm /></main>;
  return <main className={mobileListVisible ? "app-shell show-list" : "app-shell show-chat"}>
    <nav className="product-nav" aria-label="Разделы MAX Chat">
      <button className={`product-nav-item ${sidebarView === "chats" ? "active" : ""}`} onClick={() => openSidebar("chats")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-7l-4.5 3v-3H5A2.5 2.5 0 0 1 2.5 14V8A2.5 2.5 0 0 1 5 5.5Z"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="11" r="1"/><circle cx="16" cy="11" r="1"/></svg><small>Все</small></button>
      <button className={`product-nav-item ${sidebarView === "new" ? "active" : ""}`} onClick={() => openSidebar("new")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h17v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z"/><path d="M6 8.5V6a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v.5"/></svg><small>Новые</small></button>
      <button className="product-nav-item" disabled title="Каналы пока не поддерживаются"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h17v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z"/><path d="M6 8.5V6a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v.5"/></svg><small>Каналы</small></button>
      <div className="product-nav-divider" />
      <button className={`product-nav-item ${sidebarView === "contacts" ? "active" : ""}`} onClick={() => openSidebar("contacts")}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M14 14c3.8-.8 6.1 1 6.5 5"/></svg><small>Контакты</small></button>
      <button className="product-nav-item" disabled title="Звонки пока не поддерживаются"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5 10 8 8.2 10c1.2 2.8 3.1 4.7 5.8 5.8L16 14l4.5 3c-.7 2.5-2.2 3.7-4.5 3.5C9.7 19.8 4.2 14.3 3.5 8 3.3 5.7 4.5 4.2 7 3.5Z"/></svg><small>Звонки</small></button>
      <button className={`product-nav-item settings ${sidebarView === "settings" ? "active" : ""}`} onClick={() => openSidebar("settings")}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg><small>Настройки</small></button>
    </nav>
    <aside className="sidebar">
      {sidebarView === "settings" ? <div className="settings-panel"><h1>Настройки</h1><h2>Подключение</h2><ConnectionForm /></div> : <>
        <div className="sidebar-top">
          <div className="brand compact"><strong>{sidebarView === "contacts" ? "Контакты" : sidebarView === "new" ? "Новые" : "Чаты"}</strong><button className="new-chat-button" aria-label="Добавить новый чат" onClick={() => setNewChatOpen(true)}>+</button></div>
          <label className="chat-search"><span className="sr-only">Поиск чатов</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Найти" /></label>
        </div>
        <div className="sidebar-list"><ConversationList query={searchQuery} unreadOnly={sidebarView === "new"} onSelect={() => { setMobileListVisible(false); }} /></div>
      </>}
    </aside>
    <section className="chat-pane"><ChatHeader onBack={() => { setMobileListVisible(true); }} /><StatusBanner /><div className="message-scroll"><MessageList /></div><MessageComposer /></section>
    <span className="sr-only" aria-live="polite">{state.activeChatId ? "Чат выбран" : "Чат не выбран"}</span>
    {newChatOpen && <div className="modal-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") setNewChatOpen(false); }} onMouseDown={(event) => { if (event.target === event.currentTarget) setNewChatOpen(false); }}><section className="new-chat-modal" role="dialog" aria-modal="true" aria-labelledby="new-chat-title"><button className="modal-close" aria-label="Закрыть" onClick={() => setNewChatOpen(false)}>×</button><h2 id="new-chat-title">Новый чат</h2><p>Введите номер телефона собеседника в международном формате.</p><NewChatForm onCreated={() => setNewChatOpen(false)} /></section></div>}
  </main>;
}

export function App({ client = productionClient }: { readonly client?: GreenApiPort }) {
  return <ConversationProvider client={client}><ChatApplication /></ConversationProvider>;
}
