import { MAX_MESSAGE_CODE_POINTS, validateMessageText } from "@domain/message";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
  type KeyboardEvent,
} from "react";
import {
  useConversationActions,
  useConversationState,
} from "@presentation/ConversationProvider";

const IMAGE_MIME_PREFIX = "image/";
const MAX_IMAGE_SIZE_BYTES = 100 * 1024 * 1024;
const IMAGE_SIZE_ERROR = "Изображение должно быть размером до 100 МБ.";
const IMAGE_TYPE_ERROR = "Выберите файл изображения.";

type ImageValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

function validateImage(file: File): ImageValidationResult {
  if (!file.type.startsWith(IMAGE_MIME_PREFIX)) {
    return { ok: false, message: IMAGE_TYPE_ERROR };
  }
  if (file.size === 0 || file.size > MAX_IMAGE_SIZE_BYTES) {
    return { ok: false, message: IMAGE_SIZE_ERROR };
  }

  return { ok: true };
}

function sendButtonLabel(hasImage: boolean): string {
  return hasImage ? "Отправить изображение" : "Отправить сообщение";
}

export function MessageComposer() {
  const { state, isOnline, session } = useConversationState();
  const { sendImage, sendMessage } = useConversationActions();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [imageError, setImageError] = useState("");
  const [selectedImage, setSelectedImage] = useState<{
    readonly file: File;
    readonly previewUrl: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const count = Array.from(text).length;
  const validation = validateMessageText(text);
  const composerDisabled = !session || !state.activeChatId || !isOnline;
  const captionInvalid =
    selectedImage !== null && text.trim().length > 0 && !validation.ok;
  const disabled =
    composerDisabled ||
    submitting ||
    (selectedImage === null ? !validation.ok : captionInvalid);
  useEffect(() => {
    if (!selectedImage) {
      return;
    }

    return () => {
      URL.revokeObjectURL(selectedImage.previewUrl);
    };
  }, [selectedImage]);

  async function submit(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (disabled) {
      return;
    }
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !session || !state.activeChatId || !isOnline || submitting) {
      return;
    }
    const imageValidation = validateImage(file);
    if (!imageValidation.ok) {
      setImageError(imageValidation.message);

      return;
    }
    setImageError("");
    setSelectedImage({ file, previewUrl: URL.createObjectURL(file) });
    textareaRef.current?.focus();
  }

  return (
    <form className="composer" onSubmit={(event) => void submit(event)}>
      {selectedImage ? (
        <div className="composer-preview">
          <img
            src={selectedImage.previewUrl}
            alt={`Выбрано: ${selectedImage.file.name}`}
          />
          <span>{selectedImage.file.name}</span>
          <button
            type="button"
            aria-label="Убрать изображение"
            onClick={() => {
              setSelectedImage(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        aria-label="Выбрать изображение"
        onChange={onImageSelected}
        disabled={composerDisabled || submitting}
      />
      <button
        type="button"
        className="attach-button"
        aria-label="Прикрепить изображение"
        disabled={composerDisabled || submitting}
        onClick={() => fileInputRef.current?.click()}
      >
        <span className="mask-icon icon-attach" aria-hidden="true" />
      </button>
      <label htmlFor="message-text" className="sr-only">
        Сообщение
      </label>
      <textarea
        ref={textareaRef}
        id="message-text"
        rows={1}
        placeholder={!isOnline ? "Нет сети" : "Сообщение"}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={onKeyDown}
        disabled={!session || !state.activeChatId || !isOnline}
        aria-invalid={count > MAX_MESSAGE_CODE_POINTS}
      />
      <button
        className="send-button"
        aria-label={sendButtonLabel(selectedImage !== null)}
        disabled={disabled}
      >
        <span className="mask-icon icon-send" aria-hidden="true" />
      </button>
      {imageError ? (
        <p className="composer-error" role="alert">
          {imageError}
        </p>
      ) : null}
    </form>
  );
}
