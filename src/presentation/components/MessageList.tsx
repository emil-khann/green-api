import { useEffect, useRef, useState } from "react";
import { ChatHistoryPhase, type ConversationMessage } from "@application/conversations/conversationState";
import { useConversationActions, useConversationState } from "@presentation/ConversationProvider";

const INVALID_TIME_LABEL = "--:--";
const SCROLL_BUTTON_THRESHOLD_PX = 120;
const timeFormatter = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });

function formatMessageTime(value: number): string {
  if (!Number.isFinite(value)) return INVALID_TIME_LABEL;
  try { return timeFormatter.format(new Date(value)); }
  catch { return INVALID_TIME_LABEL; }
}

function getMessageStatusLabel(message: ConversationMessage): string {
  if (message.direction === "incoming") return "получено";
  switch (message.status) {
    case "pending": return "отправляется";
    case "sent": return "отправлено";
    case "error": return "ошибка";
  }
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

function MessageBubble({ message, onRetry }: { readonly message: ConversationMessage; readonly onRetry: (localId: string) => void }) {
  const imageAlt = message.text || message.fileName || "Изображение";
  const imageLabel = message.fileName ? `Открыть изображение ${message.fileName}` : "Открыть изображение";
  return <li className={`message-bubble ${message.direction}`}>
    {message.imageUrl ? <a className="message-image-link" href={message.imageUrl} target="_blank" rel="noreferrer" aria-label={imageLabel}><img className="message-image" src={message.imageUrl} alt={imageAlt} loading="lazy" /></a> : null}
    {message.text ? <p>{message.text}</p> : null}
    <span className="message-meta">{formatMessageTime(message.createdAt)} · {getMessageStatusLabel(message)}</span>
    {message.direction === "outgoing" && message.status === "error" ? <div className="message-error"><span>{message.error?.safeMessage ?? "Не удалось отправить сообщение."}</span><button onClick={() => { onRetry(message.localId); }}>Повторить</button></div> : null}
  </li>;
}

export function MessageList() {
  const { activeHistoryState, activeMessages, state } = useConversationState();
  const { retryHistory, retryMessage } = useConversationActions();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const lastMessageId = activeMessages.at(-1)?.localId;
  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    try { endRef.current?.scrollIntoView({ behavior, block: "end" }); }
    catch { /* jsdom and older embedded browsers may not implement scrolling */ }
  }
  function updateScrollButton() {
    const element = scrollRef.current;
    if (!element) return;
    setShowScrollButton(element.scrollHeight - element.scrollTop - element.clientHeight > SCROLL_BUTTON_THRESHOLD_PX);
  }
  useEffect(() => {
    if (!lastMessageId) return;
    scrollToBottom(prefersReducedMotion() ? "auto" : "smooth");
  }, [lastMessageId, state.activeChatId]);
  const isHistoryLoading = activeHistoryState?.phase === ChatHistoryPhase.Loading;
  const historyError = activeHistoryState?.phase === ChatHistoryPhase.Error ? activeHistoryState.error : undefined;
  const content = activeMessages.length === 0
    ? isHistoryLoading
      ? <div className="message-empty history-loading"><span className="history-spinner" aria-hidden="true" /><p>Загружаем историю…</p></div>
      : <div className="message-empty"><span aria-hidden="true">👋</span><h2>Начните общение</h2><p>Сообщения появятся здесь.</p></div>
    : <ol className="message-list" aria-label="Сообщения">{isHistoryLoading ? <li className="history-inline-status">Загружаем предыдущие сообщения…</li> : null}{activeMessages.map((message) => <MessageBubble key={message.localId} message={message} onRetry={(localId) => void retryMessage(localId)} />)}<li className="scroll-anchor" aria-hidden="true"><div ref={endRef} /></li></ol>;
  return <div className="message-scroll" ref={scrollRef} onScroll={updateScrollButton}>{historyError ? <div className="history-error" role="status"><span>{historyError.safeMessage}</span><button type="button" onClick={retryHistory}>Повторить</button></div> : null}{content}{showScrollButton ? <button className="scroll-to-bottom" aria-label="Прокрутить к последнему сообщению" onClick={() => { scrollToBottom(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button> : null}</div>;
}
