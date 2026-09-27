import { MAX_MESSAGE_CODE_POINTS, validateMessageText } from "@domain/message";
import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent, type KeyboardEvent } from "react";
import { useConversationActions, useConversationState } from "@presentation/ConversationProvider";

export function MessageComposer() {
  const { state, isOnline, session } = useConversationState();
  const { sendImage, sendMessage } = useConversationActions();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [imageError, setImageError] = useState("");
  const [selectedImage, setSelectedImage] = useState<{ readonly file: File; readonly previewUrl: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const count = Array.from(text).length;
  const validation = validateMessageText(text);
  const composerDisabled = !session || !state.activeChatId || !isOnline;
  const captionInvalid = selectedImage !== null && text.trim().length > 0 && !validation.ok;
  const disabled = composerDisabled || submitting || (selectedImage === null ? !validation.ok : captionInvalid);
  useEffect(() => {
    if (!selectedImage) return;
    return () => URL.revokeObjectURL(selectedImage.previewUrl);
  }, [selectedImage]);
  async function submit(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    const sending = selectedImage
      ? sendImage(selectedImage.file, validation.ok ? validation.text : "")
      : sendMessage(text);
    setSelectedImage(null);
    setImageError("");
    setText("");
    textareaRef.current?.focus();
    await sending;
    setSubmitting(false);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  }
  function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !session || !state.activeChatId || !isOnline || submitting) return;
    if (!file.type.startsWith("image/")) { setImageError("Выберите файл изображения."); return; }
    if (file.size === 0 || file.size > 100 * 1024 * 1024) { setImageError("Изображение должно быть размером до 100 МБ."); return; }
    setImageError("");
    setSelectedImage({ file, previewUrl: URL.createObjectURL(file) });
    textareaRef.current?.focus();
  }
  return <form className="composer" onSubmit={(event) => void submit(event)}>
    {selectedImage && <div className="composer-preview">
      <img src={selectedImage.previewUrl} alt={`Выбрано: ${selectedImage.file.name}`} />
      <span>{selectedImage.file.name}</span>
      <button type="button" aria-label="Убрать изображение" onClick={() => setSelectedImage(null)}>×</button>
    </div>}
    <input ref={fileInputRef} className="sr-only" type="file" accept="image/*" aria-label="Выбрать изображение" onChange={onImageSelected} disabled={composerDisabled || submitting} />
    <button type="button" className="attach-button" aria-label="Прикрепить изображение" disabled={composerDisabled || submitting} onClick={() => fileInputRef.current?.click()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 12.5 5.8-5.8a3.2 3.2 0 0 1 4.5 4.5l-7.5 7.5a5 5 0 0 1-7.1-7.1l7.2-7.2"/></svg></button>
    <label htmlFor="message-text" className="sr-only">Сообщение</label>
    <textarea ref={textareaRef} id="message-text" rows={1} placeholder={!isOnline ? "Нет сети" : "Сообщение"} value={text} onChange={(event) => { setText(event.target.value); }} onKeyDown={onKeyDown} disabled={!session || !state.activeChatId || !isOnline} aria-invalid={count > MAX_MESSAGE_CODE_POINTS} />
    <button className="send-button" aria-label={selectedImage ? "Отправить изображение" : "Отправить сообщение"} disabled={disabled}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 16 8-16 8 2-7 9-1-9-1-2-7Z"/></svg></button>
    {imageError && <p className="composer-error" role="alert">{imageError}</p>}
  </form>;
}
