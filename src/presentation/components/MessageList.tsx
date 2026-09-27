import { useEffect, useRef, useState } from "react";
import { useConversationActions, useConversationState } from "@presentation/ConversationProvider";

const timeFormatter = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });

function formatMessageTime(value: number): string {
  if (!Number.isFinite(value)) return "--:--";
  try { return timeFormatter.format(new Date(value)); }
  catch { return "--:--"; }
}

export function MessageList() {
  const { activeMessages, state } = useConversationState();
  const { retryMessage } = useConversationActions();
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
    setShowScrollButton(element.scrollHeight - element.scrollTop - element.clientHeight > 120);
  }
  useEffect(() => {
    if (!lastMessageId) return;
    let reduced = false;
    try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch { reduced = false; }
    scrollToBottom(reduced ? "auto" : "smooth");
  }, [lastMessageId, state.activeChatId]);
  let content;
  if (!state.activeChatId) content = <div className="message-empty"><span aria-hidden="true">✦</span><h2>Выберите диалог</h2><p>Или создайте новый чат по номеру телефона.</p></div>;
  else if (activeMessages.length === 0) content = <div className="message-empty"><span aria-hidden="true">👋</span><h2>Начните общение</h2><p>Сообщения появятся здесь.</p></div>;
  else content = <ol className="message-list" aria-label="Сообщения">{activeMessages.map((message) => <li key={message.localId} className={`message-bubble ${message.direction}`}>
    {message.imageUrl && <a className="message-image-link" href={message.imageUrl} target="_blank" rel="noreferrer" aria-label={message.fileName ? `Открыть изображение ${message.fileName}` : "Открыть изображение"}><img className="message-image" src={message.imageUrl} alt={message.text || message.fileName || "Изображение"} loading="lazy" /></a>}
    {message.text && <p>{message.text}</p>}<span className="message-meta">{formatMessageTime(message.createdAt)} · {message.direction === "incoming" ? "получено" : message.status === "pending" ? "отправляется" : message.status === "sent" ? "отправлено" : "ошибка"}</span>
    {message.direction === "outgoing" && message.status === "error" && <div className="message-error"><span>{message.error?.safeMessage ?? "Не удалось отправить сообщение."}</span><button onClick={() => void retryMessage(message.localId)}>Повторить</button></div>}
  </li>)}<li className="scroll-anchor" aria-hidden="true"><div ref={endRef} /></li></ol>;
  return <div className="message-scroll" ref={scrollRef} onScroll={updateScrollButton}>{content}{showScrollButton && <button className="scroll-to-bottom" aria-label="Прокрутить к последнему сообщению" onClick={() => scrollToBottom()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>}</div>;
}
