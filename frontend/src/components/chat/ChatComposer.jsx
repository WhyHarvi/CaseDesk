import { useRef } from "react";
import { Loader2, Paperclip, SendHorizonal } from "lucide-react";

const ATTACH_ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf";

// The textarea + attach + send footer, shared by all three chat surfaces.
// Stays presentational — it only hands a picked file up to onAttach and
// lets the parent page own the actual create-message/upload orchestration,
// since that differs by surface (different endpoints, different auth).
export default function ChatComposer({
  value,
  onChange,
  onSend,
  onAttach,
  sending,
  disabled,
  disabledReason,
  placeholder = "Type a message",
  accentClassName = "bg-gradient-to-br from-sky-600 to-indigo-600",
}) {
  const fileInputRef = useRef(null);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onAttach?.(file);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
      className="flex items-end gap-2"
    >
      <input ref={fileInputRef} type="file" className="hidden" accept={ATTACH_ACCEPT} onChange={handleFileChange} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach a file"
        className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        rows={1}
        maxLength={5000}
        disabled={disabled}
        placeholder={disabled && disabledReason ? disabledReason : placeholder}
        className="max-h-32 min-h-[46px] flex-1 resize-none rounded-3xl border border-slate-200 bg-white px-4 py-3 text-base leading-5 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50"
        onInput={(event) => {
          event.target.style.height = "auto";
          event.target.style.height = `${Math.min(event.target.scrollHeight, 128)}px`;
        }}
      />
      <button
        type="submit"
        disabled={disabled || sending || !value.trim()}
        className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full text-white shadow-[0_10px_24px_rgba(37,99,235,0.35)] transition-all duration-200 active:scale-90 disabled:opacity-40 ${accentClassName}`}
        aria-label="Send message"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
      </button>
    </form>
  );
}
