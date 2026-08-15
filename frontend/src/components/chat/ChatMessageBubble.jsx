import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, CheckCheck, CornerUpLeft, Download, FileText, Loader2, Pencil, SmilePlus, Trash2 } from "lucide-react";

// A small fixed set, tapback-style (like iMessage's own reaction model)
// rather than a full emoji-picker library.
const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

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

function ReactionPicker({ onPick, onClose }) {
  return (
    <div
      className="absolute bottom-full z-20 mb-1.5 flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.14)]"
      onMouseLeave={onClose}
    >
      {REACTION_EMOJI.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-base transition hover:scale-125 hover:bg-slate-100"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// A native window.confirm() is what this used before — browsers silently
// suppress repeated confirm()/alert() dialogs on a page (no dialog, no
// error, the call just returns false), which made delete look like it
// did nothing at all. An inline popover, matching the reaction picker's
// pattern right below, can't be suppressed and looks intentional.
function DeleteConfirmPopover({ onConfirm, onCancel }) {
  return (
    <div
      className="absolute bottom-full z-20 mb-1.5 flex items-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-[0_8px_24px_rgba(15,23,42,0.14)]"
      onMouseLeave={onCancel}
    >
      <span className="font-medium text-slate-600">Delete this message?</span>
      <button type="button" onClick={onCancel} className="rounded-full px-2 py-1 font-semibold text-slate-500 transition hover:bg-slate-100">
        Cancel
      </button>
      <button type="button" onClick={onConfirm} className="rounded-full bg-rose-600 px-2.5 py-1 font-semibold text-white transition hover:bg-rose-700">
        Delete
      </button>
    </div>
  );
}

function groupReactions(reactions, myUserId) {
  const groups = new Map();
  for (const reaction of reactions || []) {
    const entry = groups.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, mine: false, names: [] };
    entry.count += 1;
    entry.mine = entry.mine || reaction.userId === myUserId;
    entry.names.push(reaction.user?.fullName || "Someone");
    groups.set(reaction.emoji, entry);
  }
  return [...groups.values()];
}

// One bubble, shared by the staff drawer, the authenticated client portal,
// the token-link portal, and the unified Chats page — the surfaces only
// differ in color identity (mineBubbleClassName) and how they resolve an
// attachment's file URL, not in layout or behavior. The message-action
// props (reply/react/edit/delete) are all optional — a surface that never
// passes them simply never shows that UI, so the three original chat
// surfaces stay exactly as they were.
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
  myUserId,
  onReply,
  onToggleReaction,
  canEdit = false,
  canDelete = false,
  editing = false,
  editDraft = "",
  onEditDraftChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteMessage,
  savingEdit = false,
  showDeliveryStatus = true,
  theirAvatar,
  renderMessageBody,
}) {
  const reduceMotion = useReducedMotion();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const attachments = message.attachmentRecords || [];
  const failed = Boolean(message.failed);
  const Container = failed ? "button" : "div";
  const replySource = message.replyTo || message.parentMessage;
  const replySenderName = replySource?.sender?.fullName || replySource?.senderUser?.fullName;
  const reactionGroups = groupReactions(message.reactions, myUserId);
  const showActions = !message.pending && !failed && !editing;

  return (
    <motion.div
      initial={isNew && !reduceMotion ? { opacity: 0, y: 12, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={`group/bubble flex flex-col ${mine ? "items-end" : "items-start"}`}
    >
      <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
        {!mine && theirAvatar ? theirAvatar : null}
        <div className={`relative flex items-center gap-1.5 ${mine ? "flex-row-reverse" : "flex-row"}`}>
          <Container
            type={failed ? "button" : undefined}
            onClick={failed ? () => onRetry?.(message) : undefined}
            className={`max-w-[80%] space-y-2 rounded-3xl px-4 py-2.5 text-left shadow-sm ${mine ? `rounded-br-lg ${mineBubbleClassName}` : `rounded-bl-lg ${theirBubbleClassName}`} ${message.pending ? "opacity-70" : ""} ${failed ? "cursor-pointer ring-2 ring-rose-300" : ""}`}
          >
          {mine && mineSenderLabel ? <p className="mb-0.5 text-[10px] font-semibold opacity-70">{mineSenderLabel}</p> : null}
          {!mine && senderLabel ? <p className="text-[11px] font-semibold opacity-70">{senderLabel}</p> : null}
          {replySource ? (
            <div className={`rounded-lg border-l-2 px-2 py-1 text-[12px] ${mine ? "border-white/50 bg-black/10" : "border-slate-300 bg-black/5"}`}>
              <p className="truncate font-semibold opacity-80">{replySenderName || "Someone"}</p>
              <p className="truncate opacity-70">{replySource.bodyText || (replySource.hasAttachment ? "Sent an attachment" : "")}</p>
            </div>
          ) : null}
          {attachments.map((attachment) => (
            <AttachmentThumb key={attachment.id} attachment={attachment} fileUrl={attachmentFileUrl?.(attachment, message)} onTap={(tapped) => onAttachmentTap?.(tapped, message)} />
          ))}
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                autoFocus
                value={editDraft}
                onChange={(event) => onEditDraftChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSaveEdit?.();
                  }
                  if (event.key === "Escape") onCancelEdit?.();
                }}
                rows={2}
                className="w-full resize-none rounded-xl border-0 bg-black/10 px-2.5 py-1.5 text-[15px] leading-6 text-inherit outline-none"
              />
              <div className="flex items-center justify-end gap-3 text-[11px] font-semibold">
                <button type="button" onClick={onCancelEdit} className="opacity-70 transition hover:opacity-100">Cancel</button>
                <button type="button" onClick={onSaveEdit} disabled={savingEdit || !editDraft.trim()} className="opacity-90 transition hover:opacity-100 disabled:opacity-40">
                  {savingEdit ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            message.bodyText
              ? renderMessageBody?.(message, { mine }) || <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.bodyText}</p>
              : null
          )}
          <p className={`flex items-center justify-end gap-1 text-[10px] ${mine ? "opacity-70" : "text-slate-400"}`}>
            {message.pending ? "Sending…" : failed ? "Not sent — tap to retry" : timeLabel}
            {message.editedAt ? <span className="italic">Edited</span> : null}
            {showDeliveryStatus && mine && !message.pending && !failed ? (
              readState === "read" ? <CheckCheck className="h-3 w-3 text-sky-300" /> : <Check className="h-3 w-3" />
            ) : null}
          </p>
          </Container>

          {showActions && (onReply || onToggleReaction || canEdit || canDelete) ? (
            <div className="relative flex items-center gap-0.5 opacity-0 transition-opacity group-hover/bubble:opacity-100">
            {onToggleReaction ? (
              <>
                <button
                  type="button"
                  onClick={() => setPickerOpen((current) => !current)}
                  aria-label="React"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <SmilePlus className="h-3.5 w-3.5" />
                </button>
                {pickerOpen ? <ReactionPicker onPick={(emoji) => onToggleReaction(emoji, message)} onClose={() => setPickerOpen(false)} /> : null}
              </>
            ) : null}
            {onReply ? (
              <button type="button" onClick={() => onReply(message)} aria-label="Reply" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <CornerUpLeft className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" onClick={() => onStartEdit?.(message)} aria-label="Edit" className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canDelete ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete((current) => !current)}
                  aria-label="Delete"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                {confirmingDelete ? (
                  <DeleteConfirmPopover
                    onConfirm={() => {
                      setConfirmingDelete(false);
                      onDeleteMessage?.(message);
                    }}
                    onCancel={() => setConfirmingDelete(false)}
                  />
                ) : null}
              </>
            ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {reactionGroups.length ? (
        <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
          {reactionGroups.map((group) => (
            <button
              key={group.emoji}
              type="button"
              onClick={() => onToggleReaction?.(group.emoji, message)}
              title={group.names.join(", ")}
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition ${
                group.mine ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span>{group.emoji}</span>
              {group.count > 1 ? <span className="tabular-nums">{group.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}
