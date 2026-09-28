import { FetchGreenApiClient } from "@infrastructure/greenApi/FetchGreenApiClient";
import type { GreenApiPort } from "@application/ports/GreenApiPort";
import type { ConversationState } from "@application/conversations/conversationState";
import { useState } from "react";
import {
  ConversationProvider,
  useConversationActions,
  useConversationState,
} from "@presentation/ConversationProvider";
import { ChatHeader } from "@presentation/components/ChatHeader";
import { ConnectionForm } from "@presentation/components/ConnectionForm";
import { ConversationList } from "@presentation/components/ConversationList";
import { MessageComposer } from "@presentation/components/MessageComposer";
import { MessageList } from "@presentation/components/MessageList";
import { NewChatForm } from "@presentation/components/NewChatForm";
import { StatusBanner } from "@presentation/components/StatusBanner";

const productionClient = new FetchGreenApiClient();
const MAX_VISIBLE_UNREAD_COUNT = 99;

enum SidebarView {
  Chats = "chats",
  New = "new",
  Contacts = "contacts",
  Settings = "settings",
}

function sidebarTitle(view: SidebarView): string {
  switch (view) {
    case SidebarView.Chats:
      return "Чаты";
    case SidebarView.New:
      return "Новые";
    case SidebarView.Contacts:
      return "Контакты";
    case SidebarView.Settings:
      return "Настройки";
  }
}

function navigationClass(
  view: SidebarView,
  activeView: SidebarView,
  extraClass = "",
): string {
  return ["product-nav-item", extraClass, view === activeView ? "active" : ""]
    .filter(Boolean)
    .join(" ");
}

function formatUnreadCount(count: number): string | number {
  return count > MAX_VISIBLE_UNREAD_COUNT
    ? `${String(MAX_VISIBLE_UNREAD_COUNT)}+`
    : count;
}

function countUnreadConversations(state: ConversationState): number {
  return state.conversationOrder.reduce(
    (total, chatId) =>
      total + (state.conversationsById[chatId]?.unreadCount ? 1 : 0),
    0,
  );
}

function ChatApplication() {
  const { session, state, autoFetchEnabled } = useConversationState();
  const { closeConversation, setAutoFetchEnabled } = useConversationActions();
  const [mobileListVisible, setMobileListVisible] = useState(true);
  const [sidebarView, setSidebarView] = useState<SidebarView>(
    SidebarView.Chats,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const unreadConversationCount = countUnreadConversations(state);

  function openSidebar(view: SidebarView) {
    setSidebarView(view);
    setMobileListVisible(true);
  }

  if (!session) {
    return (
      <main className="connection-page">
        <ConnectionForm />
      </main>
    );
  }

  return (
    <main
      className={
        mobileListVisible ? "app-shell show-list" : "app-shell show-chat"
      }
    >
      <nav className="product-nav" aria-label="Разделы MAX Chat">
        <button
          className={navigationClass(SidebarView.Chats, sidebarView)}
          onClick={() => {
            openSidebar(SidebarView.Chats);
          }}
        >
          <span className="product-nav-icon">
            <span className="mask-icon icon-chats" aria-hidden="true" />
            {unreadConversationCount > 0 ? (
              <span
                className="product-nav-badge"
                aria-label={`Непрочитанных чатов: ${String(unreadConversationCount)}`}
              >
                {formatUnreadCount(unreadConversationCount)}
              </span>
            ) : null}
          </span>
          <small>Все</small>
        </button>
        <button
          className={navigationClass(SidebarView.New, sidebarView)}
          onClick={() => {
            openSidebar(SidebarView.New);
          }}
        >
          <span className="product-nav-icon">
            <span className="mask-icon icon-new" aria-hidden="true" />
            {unreadConversationCount > 0 ? (
              <span className="product-nav-badge" aria-hidden="true">
                {formatUnreadCount(unreadConversationCount)}
              </span>
            ) : null}
          </span>
          <small>Новые</small>
        </button>
        <div className="product-nav-divider" />
        <button
          className={navigationClass(SidebarView.Contacts, sidebarView)}
          onClick={() => {
            openSidebar(SidebarView.Contacts);
          }}
        >
          <span className="mask-icon icon-contacts" aria-hidden="true" />
          <small>Контакты</small>
        </button>
        <button
          className={navigationClass(
            SidebarView.Settings,
            sidebarView,
            "settings",
          )}
          onClick={() => {
            openSidebar(SidebarView.Settings);
          }}
        >
          <span className="mask-icon icon-settings" aria-hidden="true" />
          <small>Настройки</small>
        </button>
      </nav>
      <aside className="sidebar">
        {sidebarView === SidebarView.Settings ? (
          <div className="settings-panel">
            <h1>Настройки</h1>
            <section
              className="settings-section"
              aria-labelledby="data-loading-settings"
            >
              <h2 id="data-loading-settings">Загрузка данных</h2>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={autoFetchEnabled}
                  aria-describedby="auto-fetch-warning"
                  onChange={(event) => {
                    setAutoFetchEnabled(event.currentTarget.checked);
                  }}
                />
                <span className="settings-switch-control" aria-hidden="true" />
                <span>Автозагрузка данных чатов</span>
              </label>
              <p className="settings-warning" id="auto-fetch-warning">
                В фоне загружаются история, статусы и аватары всех чатов. Это
                может расходовать лимиты тарифа GREEN-API.
              </p>
            </section>
            <section
              className="settings-section"
              aria-labelledby="connection-settings"
            >
              <h2 id="connection-settings">Подключение</h2>
              <ConnectionForm />
            </section>
          </div>
        ) : (
          <>
            <div className="sidebar-top">
              <div className="brand compact">
                <strong>{sidebarTitle(sidebarView)}</strong>
                <button
                  className="new-chat-button"
                  aria-label="Добавить новый чат"
                  onClick={() => {
                    setNewChatOpen(true);
                  }}
                >
                  <span className="mask-icon icon-plus" aria-hidden="true" />
                </button>
              </div>
              <label className="chat-search">
                <span className="sr-only">Поиск чатов</span>
                <span className="mask-icon icon-search" aria-hidden="true" />
                <input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                  }}
                  placeholder="Найти"
                />
              </label>
            </div>
            <div className="sidebar-list">
              <ConversationList
                query={searchQuery}
                unreadOnly={sidebarView === SidebarView.New}
                onSelect={() => {
                  setMobileListVisible(false);
                }}
              />
            </div>
          </>
        )}
      </aside>
      <section
        className={`chat-pane ${state.activeChatId ? "" : "chat-pane-empty"}`}
      >
        {state.activeChatId ? (
          <>
            <ChatHeader
              onBack={() => {
                closeConversation();
                setMobileListVisible(true);
              }}
            />
            <StatusBanner />
            <MessageList />
            <MessageComposer />
          </>
        ) : (
          <div className="message-scroll" aria-label="Чат не выбран" />
        )}
      </section>
      <span className="sr-only" aria-live="polite">
        {state.activeChatId ? "Чат выбран" : "Чат не выбран"}
      </span>
      {newChatOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setNewChatOpen(false);
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setNewChatOpen(false);
            }
          }}
        >
          <section
            className="new-chat-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-chat-title"
          >
            <button
              className="modal-close"
              aria-label="Закрыть"
              onClick={() => {
                setNewChatOpen(false);
              }}
            >
              ×
            </button>
            <h2 id="new-chat-title">Новый чат</h2>
            <p>Введите номер телефона собеседника в международном формате.</p>
            <NewChatForm
              onCreated={() => {
                setNewChatOpen(false);
              }}
            />
          </section>
        </div>
      )}
    </main>
  );
}

export function App({
  client = productionClient,
}: {
  readonly client?: GreenApiPort;
}) {
  return (
    <ConversationProvider client={client}>
      <ChatApplication />
    </ConversationProvider>
  );
}
