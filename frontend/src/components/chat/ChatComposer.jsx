import { useLayoutEffect, useRef } from "react";
import { Loader2, Paperclip, SendHorizonal, X } from "lucide-react";

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
  allowAttach = true,
  sending,
  disabled,
  disabledReason,
  placeholder = "Type a message",
  accentClassName = "bg-gradient-to-br from-sky-600 to-indigo-600",
  replyTarget,
  replyTargetLabel,
  onCancelReply,
  sendLabel,
  sendingLabel = "Thinking",
  maxLength = 5000,
}) {
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onAttach?.(file);
  }

  // Tied to `value` itself (the single source of truth) via a layout effect,
  // not a native "input" event handler — that version only fired while the
  // user was actively typing, so a programmatic value change (draft cleared
  // after sending, a suggestion chip filling the box) never resized it back
  // down, leaving a tall box behind for whatever short text came next.
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 128)}px`;
  }, [value]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      {replyTarget ? (
        <div className="mb-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-700">Replying to {replyTargetLabel || "message"}</p>
            <p className="truncate text-slate-500">{replyTarget.bodyText || (replyTarget.hasAttachment ? "Attachment" : "")}</p>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <input ref={fileInputRef} type="file" className="hidden" accept={ATTACH_ACCEPT} onChange={handleFileChange} />
        {allowAttach ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            aria-label="Attach a file"
            className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
          rows={1}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={disabled && disabledReason ? disabledReason : placeholder}
          className="max-h-32 min-h-[50px] flex-1 resize-none rounded-3xl border border-slate-200 bg-white px-4 py-3 text-base leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={disabled || sending || !value.trim()}
          className={`flex h-[50px] shrink-0 items-center justify-center gap-2 rounded-full text-white shadow-[0_10px_24px_rgba(37,99,235,0.35)] transition-all duration-200 active:scale-90 disabled:opacity-40 ${sendLabel ? "min-w-[104px] px-4" : "w-[50px]"} ${accentClassName}`}
          aria-label="Send message"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
          {sendLabel ? <span className="text-xs font-semibold">{sending ? sendingLabel : sendLabel}</span> : null}
        </button>
      </div>
    </form>
  );
}
