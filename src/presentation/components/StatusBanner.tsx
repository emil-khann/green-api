import { useConversationState } from "@presentation/ConversationProvider";

export function StatusBanner() {
  const { session, isOnline, pumpStatus } = useConversationState();
  let message = session ? "Ожидание подключения…" : "Введите реквизиты для подключения.";
  let tone = "neutral";
  if (!isOnline) { message = "Нет сети. Получение и отправка приостановлены."; tone = "warning"; }
  else if (pumpStatus.phase === "running") { message = "Слушаем новые сообщения"; tone = "success"; }
  else if (pumpStatus.phase === "retrying") { message = `Повтор подключения: ${pumpStatus.retry.safeMessage}`; tone = "warning"; }
  else if (pumpStatus.phase === "stopped") { message = `Получение остановлено: ${pumpStatus.error.safeMessage}${pumpStatus.error.status === undefined ? "" : ` (HTTP ${String(pumpStatus.error.status)})`}`; tone = "danger"; }
  else if (pumpStatus.phase === "paused") { message = "Получение приостановлено без сети."; tone = "warning"; }
  return <div className={`status-banner ${tone}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{message}</div>;
}
