import { useState, type SyntheticEvent } from "react";
import { useConversationActions, useConversationState } from "@presentation/ConversationProvider";

export function ConnectionForm() {
  const { applySession } = useConversationActions();
  const { session, isOnline } = useConversationState();
  const [apiUrl, setApiUrl] = useState(session?.apiUrl ?? "https://3100.api.green-api.com");
  const [idInstance, setIdInstance] = useState(session?.idInstance ?? "");
  const [apiTokenInstance, setApiTokenInstance] = useState(session?.apiTokenInstance ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = applySession({ apiUrl, idInstance, apiTokenInstance });
    setError(result.ok ? null : result.message);
  }

  return <form className="connection-form" onSubmit={submit} noValidate>
    <div className="brand"><span className="brand-mark" aria-hidden="true">M</span><div><strong>MAX Chat</strong><span>Чаты через GREEN-API</span></div></div>
    <label>Адрес API<input value={apiUrl} onChange={(event) => { setApiUrl(event.target.value); }} aria-describedby="api-help connection-error" spellCheck={false} autoComplete="url" /></label>
    <p id="api-help" className="field-help">Скопируйте apiUrl из личного кабинета GREEN-API.</p>
    <label>ID instance<input value={idInstance} onChange={(event) => { setIdInstance(event.target.value); }} inputMode="numeric" aria-describedby="connection-error" autoComplete="off" /></label>
    <label>API token<input type="password" value={apiTokenInstance} onChange={(event) => { setApiTokenInstance(event.target.value); }} aria-describedby="connection-error" autoComplete="new-password" spellCheck={false} /></label>
    {error && <p id="connection-error" className="form-error" role="alert">{error}</p>}
    {!isOnline && <p className="form-error" role="status">Нет сети — подключение временно недоступно.</p>}
    <button className="primary-button" disabled={!isOnline}>{session ? "Переподключить" : "Подключиться"}</button>
    <p className="privacy-note">Реквизиты хранятся только в памяти этой вкладки.</p>
  </form>;
}
