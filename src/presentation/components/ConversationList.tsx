import {
  useConversationActions,
  useConversationState,
} from "@presentation/ConversationProvider";
import {
  ResourcePhase,
  type ConversationMessage,
} from "@application/conversations/conversationState";
import { useState } from "react";

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5] as const;

function getLastMessageLabel(message: ConversationMessage | undefined): string {
  if (!message) {
    return "Нет сообщений";
  }
  if (message.text) {
    return message.text;
  }

  return message.imageUrl ? "Изображение" : "Сообщение";
}

function ConversationListSkeleton() {
  return (
    <div
      className="conversation-list-loading"
      role="status"
      aria-label="Загрузка списка чатов"
    >
      <ul className="conversation-list" aria-hidden="true">
        {SKELETON_ROWS.map((row) => (
          <li className="conversation-skeleton-row" key={row}>
            <span className="skeleton-block skeleton-avatar" />
            <span className="conversation-skeleton-copy">
              <span className="skeleton-block skeleton-title" />
              <span className="skeleton-block skeleton-preview" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConversationListError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="conversation-list-error" role="alert">
      <span aria-hidden="true">!</span>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

function Preview({
  message,
  phase,
  errorMessage,
  autoFetchEnabled,
}: {
  readonly message: ConversationMessage | undefined;
  readonly phase: ResourcePhase | undefined;
  readonly errorMessage: string | undefined;
  readonly autoFetchEnabled: boolean;
}) {
  if (message) {
    return <span>{getLastMessageLabel(message)}</span>;
  }
  if (phase === ResourcePhase.Loaded) {
    return <span>Нет сообщений</span>;
  }
  if (phase === ResourcePhase.Error) {
    return (
      <span className="conversation-preview-error">
        {errorMessage || "Не удалось загрузить сообщения"}
      </span>
    );
  }
  if (
    phase === ResourcePhase.Loading ||
    (phase === ResourcePhase.Idle && autoFetchEnabled)
  ) {
    return (
      <span
        className="skeleton-block conversation-preview-skeleton"
        aria-hidden="true"
      />
    );
  }

  return <span aria-hidden="true" />;
}

function ConversationAvatar({
  avatarUrl,
  label,
}: {
  readonly avatarUrl: string | undefined;
  readonly label: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!avatarUrl || failedUrl === avatarUrl) {
    return <>{label.slice(-2)}</>;
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

export function ConversationList({
  onSelect,
  query = "",
  unreadOnly = false,
}: {
  readonly onSelect?: () => void;
  readonly query?: string;
  readonly unreadOnly?: boolean;
}) {
  const { state, autoFetchEnabled } = useConversationState();
  const { activateConversation, retryChats } = useConversationActions();
  const listPhase = state.conversationList.phase;
  if (listPhase === ResourcePhase.Idle || listPhase === ResourcePhase.Loading) {
    return <ConversationListSkeleton />;
  }
  if (
    listPhase === ResourcePhase.Error &&
    state.conversationOrder.length === 0
  ) {
    return (
      <ConversationListError
        message={
          state.conversationList.error?.safeMessage ??
          "Не удалось загрузить список чатов."
        }
        onRetry={retryChats}
      />
    );
  }
  if (
    listPhase === ResourcePhase.Loaded &&
    state.conversationOrder.length === 0
  ) {
    return (
      <div className="sidebar-empty">
        <span aria-hidden="true">💬</span>
        <p>Создайте первый чат</p>
      </div>
    );
  }
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleChatIds = state.conversationOrder.filter((chatId) => {
    const conversation = state.conversationsById[chatId];
    if (!conversation || (unreadOnly && conversation.unreadCount === 0)) {
      return false;
    }

    return (
      normalizedQuery.length === 0 ||
      conversation.label.toLocaleLowerCase("ru").includes(normalizedQuery)
    );
  });
  if (visibleChatIds.length === 0) {
    return (
      <>
        {listPhase === ResourcePhase.Error ? (
          <ConversationListError
            message={
              state.conversationList.error?.safeMessage ??
              "Не удалось обновить список чатов."
            }
            onRetry={retryChats}
          />
        ) : null}
        <div className="sidebar-empty">
          <span aria-hidden="true">💬</span>
          <p>{unreadOnly ? "Новых сообщений нет" : "Чаты не найдены"}</p>
        </div>
      </>
    );
  }
  const isAnyPreviewLoading = visibleChatIds.some((chatId) => {
    const hasMessages = (state.messageIdsByChatId[chatId]?.length ?? 0) > 0;
    const phase = state.historyByChatId[chatId]?.phase;

    return (
      !hasMessages &&
      (phase === ResourcePhase.Loading ||
        (autoFetchEnabled &&
          (phase === undefined || phase === ResourcePhase.Idle)))
    );
  });

  return (
    <>
      {listPhase === ResourcePhase.Error ? (
        <ConversationListError
          message={
            state.conversationList.error?.safeMessage ??
            "Не удалось обновить список чатов."
          }
          onRetry={retryChats}
        />
      ) : null}
      <nav aria-label="Список чатов" aria-busy={isAnyPreviewLoading}>
        {isAnyPreviewLoading ? (
          <span className="sr-only" role="status">
            Загружаются последние сообщения
          </span>
        ) : null}
        <ul className="conversation-list">
          {visibleChatIds.map((chatId) => {
            const conversation = state.conversationsById[chatId];
            if (!conversation) {
              return null;
            }
            const ids = state.messageIdsByChatId[chatId] ?? [];
            const lastMessage =
              ids.length > 0
                ? state.messagesById[ids[ids.length - 1] ?? ""]
                : undefined;
            const history = state.historyByChatId[chatId];
            const avatarUrl =
              state.contactsByChatId[chatId]?.avatarUrl ??
              conversation.avatarUrl;

            return (
              <li key={chatId}>
                <button
                  className={
                    state.activeChatId === chatId
                      ? "conversation-row active"
                      : "conversation-row"
                  }
                  aria-current={
                    state.activeChatId === chatId ? "page" : undefined
                  }
                  onClick={() => {
                    activateConversation(chatId);
                    onSelect?.();
                  }}
                >
                  <span className="avatar" aria-hidden="true">
                    <ConversationAvatar
                      avatarUrl={avatarUrl}
                      label={conversation.label}
                    />
                  </span>
                  <span className="conversation-copy">
                    <strong>{conversation.label}</strong>
                    <Preview
                      message={lastMessage}
                      phase={history?.phase}
                      errorMessage={history?.error?.safeMessage}
                      autoFetchEnabled={autoFetchEnabled}
                    />
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span
                      className="unread-badge"
                      aria-label={`Непрочитанных: ${String(conversation.unreadCount)}`}
                    >
                      {conversation.unreadCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
