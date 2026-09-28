import { useEffect, useRef, useState } from "react";
import {
  ResourcePhase,
  type ConversationMessage,
} from "@application/conversations/conversationState";
import {
  useConversationActions,
  useConversationState,
} from "@presentation/ConversationProvider";

const INVALID_TIME_LABEL = "--:--";
const SCROLL_BUTTON_THRESHOLD_PX = 120;
const timeFormatter = new Intl.DateTimeFormat("ru", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatMessageTime(value: number): string {
  if (!Number.isFinite(value)) {
    return INVALID_TIME_LABEL;
  }
  try {
    return timeFormatter.format(new Date(value));
  } catch {
    return INVALID_TIME_LABEL;
  }
}

function getMessageStatusLabel(message: ConversationMessage): string {
  if (message.direction === "incoming") {
    return "получено";
  }
  switch (message.status) {
    case "pending":
      return "отправляется";
    case "sent":
      return "отправлено";
    case "error":
      return "ошибка";
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function MessageBubble({
  message,
  onRetry,
  elementRef,
}: {
  readonly message: ConversationMessage;
  readonly onRetry: (localId: string) => void;
  readonly elementRef: (element: HTMLLIElement | null) => void;
}) {
  const imageAlt = message.text || message.fileName || "Изображение";
  const imageLabel = message.fileName
    ? `Открыть изображение ${message.fileName}`
    : "Открыть изображение";

  return (
    <li ref={elementRef} className={`message-bubble ${message.direction}`}>
      {message.imageUrl ? (
        <a
          className="message-image-link"
          href={message.imageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={imageLabel}
        >
          <img
            className="message-image"
            src={message.imageUrl}
            alt={imageAlt}
            loading="lazy"
          />
        </a>
      ) : null}
      {message.text ? <p>{message.text}</p> : null}
      <span className="message-meta">
        {formatMessageTime(message.createdAt)} ·{" "}
        {getMessageStatusLabel(message)}
      </span>
      {message.direction === "outgoing" && message.status === "error" ? (
        <div className="message-error">
          <span>
            {message.error?.safeMessage ?? "Не удалось отправить сообщение."}
          </span>
          <button
            onClick={() => {
              onRetry(message.localId);
            }}
          >
            Повторить
          </button>
        </div>
      ) : null}
    </li>
  );
}

function HistorySkeleton() {
  return (
    <div
      className="message-history-skeleton"
      role="status"
      aria-label="Загрузка сообщений"
    >
      <span className="sr-only">Загружаем сообщения…</span>
      <span
        className="message-skeleton-bubble message-skeleton-short skeleton-block"
        aria-hidden="true"
      />
      <span
        className="message-skeleton-bubble message-skeleton-outgoing skeleton-block"
        aria-hidden="true"
      />
      <span
        className="message-skeleton-bubble message-skeleton-long skeleton-block"
        aria-hidden="true"
      />
    </div>
  );
}

function HistoryError({
  message,
  onRetry,
  inline = false,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly inline?: boolean;
}) {
  return (
    <div
      className={inline ? "history-error" : "message-history-error"}
      role="alert"
    >
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function MessageList() {
  const { activeHistoryState, activeMessages, state } = useConversationState();
  const { consumeReadBoundary, retryHistory, retryMessage } =
    useConversationActions();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageNodesRef = useRef(new Map<string, HTMLLIElement>());
  const activeChatRef = useRef<string | null>(null);
  const positionedChatRef = useRef<string | null>(null);
  const followLatestRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const lastMessageId = activeMessages.at(-1)?.localId;

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    try {
      endRef.current?.scrollIntoView({ behavior, block: "end" });
    } catch {
      /* jsdom and older embedded browsers may not implement scrolling */
    }
  }

  function updateScrollButton() {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distanceToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    followLatestRef.current = distanceToBottom <= SCROLL_BUTTON_THRESHOLD_PX;
    setShowScrollButton(distanceToBottom > SCROLL_BUTTON_THRESHOLD_PX);
  }

  useEffect(() => {
    const chatId = state.activeChatId;
    if (activeChatRef.current !== chatId) {
      activeChatRef.current = chatId;
      positionedChatRef.current = null;
      followLatestRef.current = true;
    }
    if (!chatId || !lastMessageId) {
      return;
    }
    if (positionedChatRef.current !== chatId) {
      const lastReadMessageId =
        state.conversationsById[chatId]?.lastReadMessageId;
      const lastReadMessage = lastReadMessageId
        ? messageNodesRef.current.get(lastReadMessageId)
        : undefined;
      if (lastReadMessage) {
        lastReadMessage.scrollIntoView({ behavior: "auto", block: "end" });
      } else {
        scrollToBottom("auto");
      }
      positionedChatRef.current = chatId;
      followLatestRef.current = lastReadMessage === undefined;
      if (lastReadMessageId) {
        consumeReadBoundary(chatId, lastReadMessageId);
      }

      return;
    }
    if (followLatestRef.current) {
      scrollToBottom("auto");
    }
  }, [
    consumeReadBoundary,
    lastMessageId,
    state.activeChatId,
    state.conversationsById,
  ]);
  const historyPhase = activeHistoryState?.phase ?? ResourcePhase.Idle;
  const isHistoryLoading =
    historyPhase === ResourcePhase.Idle ||
    historyPhase === ResourcePhase.Loading;
  const historyError =
    historyPhase === ResourcePhase.Error
      ? activeHistoryState?.error
      : undefined;
  let content;
  if (activeMessages.length > 0) {
    content = (
      <>
        {historyError ? (
          <HistoryError
            message={historyError.safeMessage}
            onRetry={retryHistory}
            inline
          />
        ) : null}
        <ol className="message-list" aria-label="Сообщения">
          {isHistoryLoading ? (
            <li className="history-inline-status" role="status">
              <span
                className="history-spinner history-spinner-small"
                aria-hidden="true"
              />
              Обновляем сообщения…
            </li>
          ) : null}
          {activeMessages.map((message) => (
            <MessageBubble
              key={message.localId}
              message={message}
              onRetry={(localId) => void retryMessage(localId)}
              elementRef={(element) => {
                if (element) {
                  messageNodesRef.current.set(message.localId, element);
                } else {
                  messageNodesRef.current.delete(message.localId);
                }
              }}
            />
          ))}
          <li className="scroll-anchor" aria-hidden="true">
            <div ref={endRef} />
          </li>
        </ol>
      </>
    );
  } else if (historyError) {
    content = (
      <HistoryError message={historyError.safeMessage} onRetry={retryHistory} />
    );
  } else if (isHistoryLoading) {
    content = <HistorySkeleton />;
  } else {
    content = (
      <div className="message-empty">
        <span aria-hidden="true">👋</span>
        <h2>Начните общение</h2>
        <p>Сообщений пока нет.</p>
      </div>
    );
  }

  return (
    <div
      className="message-scroll"
      ref={scrollRef}
      onScroll={updateScrollButton}
      aria-busy={isHistoryLoading}
    >
      {content}
      {showScrollButton ? (
        <button
          className="scroll-to-bottom"
          aria-label="Прокрутить к последнему сообщению"
          onClick={() => {
            followLatestRef.current = true;
            scrollToBottom(prefersReducedMotion() ? "auto" : "smooth");
          }}
        >
          <span className="mask-icon icon-down" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
