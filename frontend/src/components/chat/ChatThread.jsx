import { useEffect, useMemo, useRef, useState } from "react";
import ChatMessageBubble from "./ChatMessageBubble";

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function timeLabel(value) {
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

// The scrollable message list shared by all three chat surfaces — day
// grouping, "don't yank the scroll position while someone's reading
// history" auto-scroll, and new-message entrance animation all live here
// once instead of three times.
export default function ChatThread({
  messages,
  mineDirection,
  loading,
  emptyState,
  mineBubbleClassName,
  theirBubbleClassName,
  attachmentFileUrl,
  onAttachmentTap,
  onRetryMessage,
  clientLastReadAt,
  senderLabelFor,
  mineSenderLabelFor,
  className = "",
  myUserId,
  onReply,
  onToggleReaction,
  canEditMessage,
  canDeleteMessage,
  editingMessageId,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteMessage,
  savingEdit,
  typing = false,
  typingLabel = "Typing",
  renderTyping,
  showDeliveryStatus = true,
  theirAvatar,
  renderMessageBody,
}) {
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const seenIdsRef = useRef(new Set());
  const [mountedOnce, setMountedOnce] = useState(false);

  const groups = useMemo(() => {
    const byDay = [];
    messages.forEach((message) => {
      const label = dayLabel(message.occurredAt);
      const last = byDay[byDay.length - 1];
      if (last && last.label === label) last.messages.push(message);
      else byDay.push({ label, messages: [message] });
    });
    return byDay;
  }, [messages]);

  useEffect(() => {
    if (stickToBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    // Only entrance-animate messages appended after the first paint —
    // otherwise loading a page of history cascades a pop-in for every row.
    if (!mountedOnce) setMountedOnce(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, typing]);

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) return;
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  }

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[64, 44, 72, 52].map((width, index) => (
          <div key={index} className="h-12 animate-pulse rounded-3xl bg-slate-100/70" style={{ width: `${width}%`, marginLeft: index % 2 ? "auto" : 0 }} />
        ))}
      </div>
    );
  }

  if (!messages.length) {
    return <div className={`flex h-full flex-col items-center justify-center text-center ${className}`}>{emptyState}</div>;
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className={`overflow-y-auto ${className}`}>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.label} className="space-y-2.5">
            <div className="flex justify-center">
              <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm backdrop-blur">{group.label}</span>
            </div>
            {group.messages.map((message) => {
              const mine = message.direction === mineDirection;
              const isNew = mountedOnce && !seenIdsRef.current.has(message.id);
              seenIdsRef.current.add(message.id);
              const readState = mine && clientLastReadAt && new Date(message.occurredAt) <= new Date(clientLastReadAt) ? "read" : "sent";
              return (
                <ChatMessageBubble
                  key={message.id}
                  message={message}
                  mine={mine}
                  isNew={isNew}
                  senderLabel={senderLabelFor?.(message)}
                  mineSenderLabel={mineSenderLabelFor?.(message)}
                  mineBubbleClassName={mineBubbleClassName}
                  theirBubbleClassName={theirBubbleClassName}
                  attachmentFileUrl={attachmentFileUrl}
                  onAttachmentTap={onAttachmentTap}
                  onRetry={onRetryMessage}
                  readState={mine ? readState : undefined}
                  timeLabel={timeLabel(message.occurredAt)}
                  myUserId={myUserId}
                  onReply={onReply}
                  onToggleReaction={onToggleReaction}
                  canEdit={Boolean(canEditMessage?.(message))}
                  canDelete={Boolean(canDeleteMessage?.(message))}
                  editing={editingMessageId === message.id}
                  editDraft={editDraft}
                  onEditDraftChange={onEditDraftChange}
                  onStartEdit={onStartEdit}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                  onDeleteMessage={onDeleteMessage}
                  savingEdit={savingEdit}
                  showDeliveryStatus={showDeliveryStatus}
                  theirAvatar={theirAvatar}
                  renderMessageBody={renderMessageBody}
                />
              );
            })}
          </div>
        ))}
        {typing ? (
          renderTyping ? renderTyping() : (
            <div className="flex items-end gap-2">
              {theirAvatar || null}
              <div className="flex items-center gap-2 rounded-3xl rounded-bl-lg border border-slate-200 bg-white px-4 py-3 text-slate-500 shadow-sm">
                <span className="flex items-center gap-1" aria-hidden="true">
                  {[0, 1, 2].map((index) => <span key={index} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${index * 120}ms` }} />)}
                </span>
                <span className="text-[11px] font-semibold">{typingLabel}</span>
              </div>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
