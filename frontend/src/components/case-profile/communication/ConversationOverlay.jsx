import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Loader2,
  MessageCircleReply,
  MoreHorizontal,
  Paperclip,
  PlayCircle,
  RotateCcw,
  SendHorizonal,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../../services/api";

const states = [
  "Open",
  "WaitingOnAgency",
  "WaitingOnClient",
  "Snoozed",
  "Closed",
];
const priorities = ["Low", "Normal", "High", "Urgent"];
const stateLabel = (value) =>
  ({
    WaitingOnAgency: "Waiting on agency",
    WaitingOnClient: "Waiting on client",
  })[value] || value;
const formatWhen = (value) =>
  new Date(value).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const statusTone = (status) => {
  if (["Failed", "Bounced", "Blocked", "Missed"].includes(status))
    return "bg-rose-50 text-rose-700";
  if (["Draft", "Scheduled", "Queued", "Sending"].includes(status))
    return "bg-amber-50 text-amber-700";
  if (["Delivered", "Received", "Completed"].includes(status))
    return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-600";
};

function MessageCard({ message }) {
  const inbound = message.direction === "Inbound";
  const attachments = message.attachmentRecords || [];
  return (
    <article className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`w-full max-w-[88%] rounded-[1.4rem] border p-4 shadow-sm ${inbound ? "border-slate-200 bg-white" : "border-sky-100 bg-sky-50/70"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${inbound ? "bg-slate-100 text-slate-500" : "bg-sky-100 text-sky-700"}`}
            >
              {inbound ? (
                <ArrowDownLeft className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">
                {message.senderUser?.fullName ||
                  message.senderAddress ||
                  (inbound ? "Client" : "Agency")}
              </p>
              <p className="text-[10px] text-slate-400">
                {formatWhen(message.occurredAt)}
              </p>
            </div>
          </div>
          <span
            className={`rounded-full px-2 py-1 text-[9px] font-semibold ${statusTone(message.status)}`}
          >
            {message.status}
          </span>
        </div>
        {message.subject ? (
          <p className="mt-3 text-sm font-semibold text-slate-950">
            {message.subject}
          </p>
        ) : null}
        {message.bodyText ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {message.bodyText}
          </p>
        ) : null}
        {message.channel === "Call" ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-slate-600">
              {message.callDisposition || "Call"}
              {message.durationSeconds
                ? ` · ${Math.max(1, Math.round(message.durationSeconds / 60))} min`
                : ""}
            </p>
            {message.callRecordingUrl ? (
              <a
                href={message.callRecordingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Open call recording
              </a>
            ) : null}
            {message.callTranscript ? (
              <details className="rounded-xl bg-slate-50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                  Call transcript
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                  {message.callTranscript}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
        {attachments.length ? (
          <div className="mt-3 space-y-2">
            {attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={`${api.defaults.baseURL}/communications/messages/${message.id}/attachments/${attachment.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {attachment.originalFilename}
                  </span>
                </span>
                <Download className="h-3.5 w-3.5 text-slate-400" />
              </a>
            ))}
          </div>
        ) : null}
        {message.failureReason ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
            {message.failureReason}
          </p>
        ) : null}
        {message.deliveryEvents?.length ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Delivery history
            </summary>
            <div className="mt-2 space-y-1 border-l border-slate-200 pl-3">
              {message.deliveryEvents.map((event) => (
                <p key={event.id} className="text-[10px] text-slate-500">
                  <span className="font-semibold">{event.type}</span> ·{" "}
                  {formatWhen(event.providerTimestamp || event.createdAt)}
                  {event.details ? ` — ${event.details}` : ""}
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

const quickReplyPermission = { Chat: "canUseChat", Sms: "canSendSms", Email: "canSendEmail" };

function QuickReplyComposer({ conversation, lastMessage, permissions, onSent, onOpenFullComposer }) {
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const channel = conversation.channel;
  const allowed = permissions?.[quickReplyPermission[channel]] !== false;

  if (channel === "Call" || !allowed) {
    return (
      <button
        type="button"
        onClick={onOpenFullComposer}
        className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white"
      >
        <MessageCircleReply className="h-4 w-4" /> Reply
      </button>
    );
  }

  const inboundAddress = lastMessage?.direction === "Inbound" ? lastMessage.senderAddress : null;
  const recipients =
    channel === "Chat"
      ? []
      : [
          (channel === "Email"
            ? (inboundAddress?.includes("@") ? inboundAddress : conversation.client?.email)
            : inboundAddress && !inboundAddress.startsWith("client:") ? inboundAddress : conversation.client?.phone) || "",
        ].filter(Boolean);

  async function send(event) {
    event.preventDefault();
    const trimmed = bodyText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      await api.post(
        "/communications/messages",
        {
          caseId: conversation.caseId,
          conversationId: conversation.id,
          parentMessageId: lastMessage?.id || undefined,
          channel,
          direction: "Outbound",
          recipients,
          subject:
            channel === "Email" && lastMessage?.subject
              ? `${/^re:/i.test(lastMessage.subject) ? "" : "Re: "}${lastMessage.subject}`
              : null,
          bodyText: trimmed,
          occurredAt: new Date().toISOString(),
          sendNow: true,
          idempotencyKey: crypto.randomUUID(),
        },
        { timeout: 30_000 },
      );
      setBodyText("");
      await onSent();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="min-w-0 flex-1">
      {error ? <p className="mb-2 rounded-xl bg-rose-50 px-3.5 py-2 text-xs text-rose-700">{error}</p> : null}
      <div className="flex items-end gap-2">
        <textarea
          value={bodyText}
          onChange={(event) => setBodyText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(event);
            }
          }}
          onInput={(event) => {
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
          }}
          rows={1}
          maxLength={20000}
          placeholder={channel === "Chat" ? "Message the client…" : `Reply by ${channel.toLowerCase()}…`}
          className="max-h-30 min-h-[42px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm leading-5 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
        />
        <button
          type="button"
          onClick={onOpenFullComposer}
          title="Open full composer"
          aria-label="Open full composer"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
        >
          <MessageCircleReply className="h-4 w-4" />
        </button>
        <button
          type="submit"
          disabled={!bodyText.trim() || sending}
          aria-label="Send reply"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm transition hover:bg-slate-800 active:scale-95 disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}

export default function ConversationOverlay({
  conversationId,
  permissions,
  onClose,
  onReply,
  onChanged,
  onTrash,
}) {
  const [conversation, setConversation] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const load = async () => {
    try {
      setError("");
      const [detail, team] = await Promise.all([
        api.get(`/communications/conversations/${conversationId}?limit=100`),
        api.get("/users?limit=100"),
      ]);
      setConversation(detail.data.data);
      setUsers(team.data.data || []);
      if (detail.data.data.unreadCount)
        await api.post(`/communications/conversations/${conversationId}/read`, {
          read: true,
        });
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Conversation could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [conversationId]);
  const messages = useMemo(
    () => [...(conversation?.messages || [])].reverse(),
    [conversation],
  );
  const update = async (values) => {
    try {
      setSaving(true);
      const response = await api.patch(
        `/communications/conversations/${conversationId}`,
        values,
      );
      setConversation((current) => ({ ...current, ...response.data.data }));
      onChanged?.(response.data.data);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Conversation could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  };
  const createTask = async () => {
    if (!conversation) return;
    try {
      setSaving(true);
      await api.post(`/cases/${conversation.caseId}/tasks`, {
        title: `Follow up: ${conversation.subject || `${conversation.channel} conversation`}`,
        description: `Follow up with ${conversation.client?.fullName || "client"} regarding this communication.`,
        assignedToId: conversation.assignedToId || null,
        priority: conversation.priority === "Urgent" ? "Urgent" : "Normal",
        status: "Pending",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      setError("");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Follow-up task could not be created.",
      );
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[430] flex justify-end bg-slate-950/20 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close conversation"
      />
      <motion.section
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 30 }}
        className="relative flex h-full w-full max-w-3xl flex-col border-l border-white/80 bg-slate-50 shadow-[-24px_0_80px_rgba(15,23,42,0.18)]"
      >
        <header className="shrink-0 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600">
                Conversation
              </p>
              <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">
                {conversation?.subject ||
                  conversation?.client?.fullName ||
                  "Communication"}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {conversation
                  ? `${conversation.client?.fullName} · ${conversation.case?.caseType} · ${conversation.channel}`
                  : "Loading conversation…"}
              </p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen && conversation ? (
                  <div className="absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        update({ isArchived: !conversation.isArchived });
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      {conversation.isArchived
                        ? "Restore from archive"
                        : "Archive conversation"}
                    </button>
                    {permissions?.canDelete ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onTrash?.(messages[messages.length - 1]);
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Move latest message to trash
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {conversation ? (
            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <label className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  value={conversation.assignedToId || ""}
                  onChange={(event) =>
                    update({ assignedToId: event.target.value || null })
                  }
                  className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-8 pr-7 text-xs font-semibold outline-none"
                >
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              </label>
              <label className="relative">
                <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  value={conversation.state}
                  onChange={(event) => update({ state: event.target.value })}
                  className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-8 pr-7 text-xs font-semibold outline-none"
                >
                  {states.map((state) => (
                    <option key={state} value={state}>
                      {stateLabel(state)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative">
                <Tag className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  value={conversation.priority}
                  onChange={(event) => update({ priority: event.target.value })}
                  className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-8 pr-7 text-xs font-semibold outline-none"
                >
                  {priorities.map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={createTask}
                disabled={saving}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold"
              >
                <CalendarPlus className="h-3.5 w-3.5" /> Create follow-up
              </button>
            </div>
          ) : null}
        </header>
        <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : error && !conversation ? (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : (
            <div className="space-y-4">
              {error ? (
                <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}
              {messages.map((message) => (
                <MessageCard key={message.id} message={message} />
              ))}
              {!messages.length ? (
                <p className="py-16 text-center text-sm text-slate-400">
                  This conversation has no active messages.
                </p>
              ) : null}
            </div>
          )}
        </main>
        {conversation ? (
          <footer className="shrink-0 border-t border-slate-200 bg-white px-5 py-3.5">
            <QuickReplyComposer
              conversation={conversation}
              lastMessage={messages[messages.length - 1]}
              permissions={permissions}
              onSent={async () => {
                await load();
                onChanged?.(conversation);
              }}
              onOpenFullComposer={() =>
                onReply({
                  conversationId: conversation.id,
                  message: messages[messages.length - 1],
                  channel: conversation.channel,
                  caseItem: {
                    ...conversation.case,
                    id: conversation.caseId,
                    client: conversation.client,
                  },
                })
              }
            />
          </footer>
        ) : null}
      </motion.section>
    </div>,
    document.body,
  );
}
