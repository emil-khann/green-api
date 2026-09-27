import { useConversationState } from "@presentation/ConversationProvider";
import type { NotificationPumpStatus } from "@presentation/hooks/useNotificationPump";

enum BannerTone {
  Neutral = "neutral",
  Success = "success",
  Warning = "warning",
  Danger = "danger",
}

interface BannerModel {
  readonly message: string;
  readonly tone: BannerTone;
}

function stoppedMessage(status: Extract<NotificationPumpStatus, { phase: "stopped" }>): string {
  const httpStatus = status.error.status === undefined ? "" : ` (HTTP ${String(status.error.status)})`;
  return `Получение остановлено: ${status.error.safeMessage}${httpStatus}`;
}

function getBannerModel(sessionExists: boolean, isOnline: boolean, status: NotificationPumpStatus): BannerModel {
  if (!isOnline) return { message: "Нет сети. Получение и отправка приостановлены.", tone: BannerTone.Warning };
  switch (status.phase) {
    case "running": return { message: "Слушаем новые сообщения", tone: BannerTone.Success };
    case "retrying": return { message: `Повтор подключения: ${status.retry.safeMessage}`, tone: BannerTone.Warning };
    case "stopped": return { message: stoppedMessage(status), tone: BannerTone.Danger };
    case "paused": return { message: "Получение приостановлено без сети.", tone: BannerTone.Warning };
    case "idle": return { message: sessionExists ? "Ожидание подключения…" : "Введите реквизиты для подключения.", tone: BannerTone.Neutral };
  }
}

export function StatusBanner() {
  const { session, isOnline, pumpStatus } = useConversationState();
  const { message, tone } = getBannerModel(session !== null, isOnline, pumpStatus);
  return <div className={`status-banner ${tone}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{message}</div>;
}
