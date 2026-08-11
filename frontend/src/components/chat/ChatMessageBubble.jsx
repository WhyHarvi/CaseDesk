import { motion, useReducedMotion } from "framer-motion";
import { Check, CheckCheck, Download, FileText, Loader2 } from "lucide-react";

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentThumb({ attachment, fileUrl, onTap }) {
  const isImage = (attachment.mimeType || "").startsWith("image/");
  if (isImage) {
    if (!fileUrl) {
      return (
        <div className="flex h-40 w-[200px] max-w-[240px] items-center justify-center rounded-2xl bg-black/5">
          <Loader2 className="h-5 w-5 animate-spin opacity-50" />
        </div>
      );
    }
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={() => onTap?.(attachment)}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onTap?.(attachment)}
        className="block max-w-[240px] cursor-pointer overflow-hidden rounded-2xl"
      >
        <img src={fileUrl} alt={attachment.originalFilename || "Attachment"} className="max-h-72 w-full object-cover" loading="lazy" />
      </span>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => onTap?.(attachment)}
      onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onTap?.(attachment)}
      className="flex w-full max-w-[240px] cursor-pointer items-center gap-2.5 rounded-2xl bg-black/5 px-3 py-2.5 text-left"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-600">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{attachment.originalFilename || "Document"}</span>
        <span className="block text-[11px] opacity-70">{formatFileSize(attachment.fileSize)}</span>
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 opacity-60" />
    </span>
  );
}

// One bubble, shared by the staff drawer, the authenticated client portal,
// and the token-link portal — the three surfaces only differ in color
// identity (mineBubbleClassName) and how they resolve an attachment's file
// URL, not in layout or behavior.
export default function ChatMessageBubble({
  message,
  mine,
  isNew = false,
  senderLabel,
  mineSenderLabel,
  mineBubbleClassName = "bg-[#d9fdd3] text-slate-900",
  theirBubbleClassName = "border border-slate-200 bg-white text-slate-800",
  attachmentFileUrl,
  onAttachmentTap,
  onRetry,
  readState,
  timeLabel,
}) {
  const reduceMotion = useReducedMotion();
  const attachments = message.attachmentRecords || [];
  const failed = Boolean(message.failed);
  const Container = failed ? "button" : "div";

  return (
    <motion.div
      initial={isNew && !reduceMotion ? { opacity: 0, y: 12, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={`flex ${mine ? "justify-end" : "justify-start"}`}
    >
      <Container
        type={failed ? "button" : undefined}
        onClick={failed ? () => onRetry?.(message) : undefined}
        className={`max-w-[80%] space-y-2 rounded-3xl px-4 py-2.5 text-left shadow-sm ${mine ? `rounded-br-lg ${mineBubbleClassName}` : `rounded-bl-lg ${theirBubbleClassName}`} ${message.pending ? "opacity-70" : ""} ${failed ? "cursor-pointer ring-2 ring-rose-300" : ""}`}
      >
        {mine && mineSenderLabel ? <p className="mb-0.5 text-[10px] font-semibold opacity-70">{mineSenderLabel}</p> : null}
        {!mine && senderLabel ? <p className="text-[11px] font-semibold opacity-70">{senderLabel}</p> : null}
        {attachments.map((attachment) => (
          <AttachmentThumb key={attachment.id} attachment={attachment} fileUrl={attachmentFileUrl?.(attachment, message)} onTap={(tapped) => onAttachmentTap?.(tapped, message)} />
        ))}
        {message.bodyText ? <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.bodyText}</p> : null}
        <p className={`flex items-center justify-end gap-1 text-[10px] ${mine ? "opacity-70" : "text-slate-400"}`}>
          {message.pending ? "Sending…" : failed ? "Not sent — tap to retry" : timeLabel}
          {mine && !message.pending && !failed ? (
            readState === "read" ? <CheckCheck className="h-3 w-3 text-sky-300" /> : <Check className="h-3 w-3" />
          ) : null}
        </p>
      </Container>
    </motion.div>
  );
}
