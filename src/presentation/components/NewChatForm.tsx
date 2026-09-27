import { useState, type SyntheticEvent } from "react";
import { useConversationActions } from "@presentation/ConversationProvider";

export function NewChatForm() {
  const { createConversation } = useConversationActions();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const result = await createConversation(phone);
    setError(result.ok ? null : result.message);
    if (result.ok) setPhone("");
    setSubmitting(false);
  }
  return <form className="new-chat-form" onSubmit={(event) => { void submit(event); }}>
    <label htmlFor="new-chat-phone" className="sr-only">Номер нового собеседника</label>
    <input id="new-chat-phone" placeholder="Номер телефона" value={phone} onChange={(event) => { setPhone(event.target.value); }} inputMode="tel" aria-describedby="new-chat-error" disabled={submitting} />
    <button aria-label="Создать чат" className="icon-button" disabled={submitting}>{submitting ? "…" : "+"}</button>
    {error && <p id="new-chat-error" className="form-error" role="alert">{error}</p>}
  </form>;
}
