import { Check, ChevronLeft, LifeBuoy, Loader2, Mail, MailPlus, MessageSquareText, MessagesSquare, RotateCcw, Search, Send, SquarePen, UserRound, Users, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import api from "../services/api";
import {
  createInternalChatThread,
  deleteInternalChatMessage,
  fetchInternalChatAttachmentBlob,
  fetchInternalChatThreadAvatarBlob,
  getInternalChatRealtimeConfig,
  getInternalChatThread,
  getInternalChatThreads,
  getMyColleagues,
  internalChatErrorMessage,
  markInternalChatThreadRead,
  sendInternalChatMessage,
  toggleInternalChatReaction,
  updateInternalChatMessage,
  uploadInternalChatAttachment,
} from "../api/internalChatApi";
import ChatThread from "../components/chat/ChatThread";
import ChatComposer from "../components/chat/ChatComposer";
import ChatImageLightbox from "../components/chat/ChatImageLightbox";
import GroupProfilePanel from "../components/chat/GroupProfilePanel";
import { useCaseRealtimeChat } from "../hooks/useCaseRealtimeChat";
import { useChatAttachmentUrls } from "../hooks/useChatAttachmentUrls";
import { useThreadAvatarUrls } from "../hooks/useThreadAvatarUrls";
import { playReceivedSound, playSentSound } from "../utils/chatSounds";
import { resetNovaChat, retryNovaMessage, sendNovaMessage, useNovaChat } from "../hooks/useNovaChat";
import { NovaAssistantAvatar, NovaChatCompanion, NovaMessageContent, NovaProactiveInsight, NovaSuggestions, NovaThinkingIndicator, useNovaProactiveInsight } from "../components/chat/NovaChatPresentation";
import SupportDeskPanel from "../components/chat/SupportDeskPanel";
import CommunicationComposer from "../components/case-profile/communication/CommunicationComposer";

const RECONCILE_POLL_MS = 5 * 60_000; // realtime connected — safety net only
const FALLBACK_POLL_MS = 60_000; // realtime unavailable
const EMAIL_DETAIL_POLL_MS = 2 * 60_000;
const LIST_POLL_MS = 2 * 60_000;

const CATEGORY_FILTERS = [
  { key: "teams", label: "Team" },
  { key: "portal", label: "Portal chat" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "groups", label: "Groups" },
];

const EMAIL_SUBJECT_MAX_WORDS = 10;
const subjectWordCount = (value) => String(value || "").trim().split(/\s+/).filter(Boolean).length;

function EmailMessageContent({ message }) {
  const safeHtml = message.bodyHtml
    ? DOMPurify.sanitize(message.bodyHtml, {
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "img"],
        FORBID_ATTR: ["style", "srcset"],
      })
    : "";
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#002FA7]">
        {message.subject || message.conversation?.subject || "Email"}
      </p>
      {safeHtml ? (
        <div
          className="[overflow-wrap:anywhere] text-[15px] leading-6 [&_a]:text-blue-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_p:last-child]:mb-0 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_ul]:list-disc"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.bodyText}</p>
      )}
    </div>
  );
}

const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function formatThreadTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(date);
}

// A shared-inbox conversation can be replied to by anyone on the case team,
// so "You: " is only accurate when the current user actually sent the last
// outbound message — otherwise the preview must name whoever really did.
function previewSenderPrefix(latestMessage, myUserId) {
  if (!latestMessage || latestMessage.direction !== "Outbound") return "";
  if (latestMessage.senderUser?.id === myUserId) return "You: ";
  const senderName = latestMessage.senderUser?.fullName;
  return senderName ? `${senderName.split(" ")[0]}: ` : "";
}

const OWNER_FILTERS = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
];

// One avatar for every row/header — color identity distinguishes what kind
// of conversation this is at a glance: client chat stays the established
// WhatsApp-green from the client-profile drawer, internal DMs are sky/
// indigo, internal groups are indigo/violet with a Users glyph. A real
// group photo (fetched via useThreadAvatarUrls) takes over from the
// gradient glyph once one has been set.
function ChatAvatar({ item, avatarUrl, className = "h-11 w-11 text-xs" }) {
  if (item?.kind === "support") {
    return <span className={`flex shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 ${className}`}><LifeBuoy className="h-5 w-5" /></span>;
  }
  if (item?.kind === "ai") {
    return <NovaAssistantAvatar className={className} />;
  }
  if (item?.kind === "email") {
    return <span className={`flex shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-[#002FA7] ${className}`}><Mail className="h-4 w-4" /></span>;
  }
  if (item?.kind === "sms") {
    return <span className={`flex shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700 ${className}`}><MessageSquareText className="h-4 w-4" /></span>;
  }
  if (avatarUrl) {
    return (
      <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}>
        <img src={avatarUrl} alt={item?.name || "Group"} className="h-full w-full object-cover" />
      </span>
    );
  }
  if (item?.kind === "internal" && item.isGroup) {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-bold text-white ${className}`}>
        <Users className="h-4 w-4" />
      </span>
    );
  }
  const gradient = item?.kind === "client" ? "from-emerald-500 to-teal-600" : "from-sky-600 to-indigo-600";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} font-bold text-white ${className}`}>
      {initials(item?.name)}
    </span>
  );
}

// The small pill that tags a row (or the open header) as a client
// conversation vs a colleague one — the color alone (avatar gradient)
// wasn't explicit enough once both kinds sit in the same list.
function KindBadge({ kind }) {
  if (kind === "support") {
    return <span className="inline-flex shrink-0 items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Help</span>;
  }
  if (kind === "ai") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
        AI
      </span>
    );
  }
  if (kind === "email") {
    return <span className="inline-flex shrink-0 items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-[#002FA7]">Email</span>;
  }
  if (kind === "sms") {
    return <span className="inline-flex shrink-0 items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">SMS</span>;
  }
  if (kind === "client") {
    return <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">Portal chat</span>;
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">Team</span>
  );
}

function ChatRow({ item, active, avatarUrl, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? "bg-sky-50" : "hover:bg-slate-50"}`}
    >
      <ChatAvatar item={item} avatarUrl={avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-slate-950">{item.name}</span>
          {item.kind === "email" && item.messageCount ? (
            <span className="shrink-0 rounded-full bg-blue-100/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[#002FA7]">
              {item.messageCount} {item.messageCount === 1 ? "email" : "emails"}
            </span>
          ) : null}
          <span className="min-w-0 flex-1" />
          <span className="shrink-0 text-[10px] text-slate-400">{formatThreadTime(item.lastMessageAt)}</span>
        </span>
        {["client", "email", "sms"].includes(item.kind) ? (
          <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-400">
            {item.assignedToName ? `Assigned to ${item.assignedToName}` : "Unassigned"}
          </span>
        ) : null}
        <span className="mt-1 flex items-center gap-1.5">
          {!["email", "client"].includes(item.kind) ? <KindBadge kind={item.kind} /> : null}
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{item.preview || "Say hello"}</span>
          {item.unreadCount ? (
            <span className="inline-flex min-w-5 shrink-0 justify-center rounded-full bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
              {item.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function NewChatModal({ colleagues, loading, creating, onClose, onCreate }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState("");
  const isGroup = selected.length > 1;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return colleagues;
    return colleagues.filter((user) => user.fullName.toLowerCase().includes(query) || user.email.toLowerCase().includes(query));
  }, [colleagues, search]);

  function toggle(user) {
    setSelected((current) =>
      current.some((item) => item.id === user.id) ? current.filter((item) => item.id !== user.id) : [...current, user],
    );
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.18 }}
          className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-[1.75rem] border border-white/70 bg-white shadow-2xl"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">New chat</h2>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X className="h-4.5 w-4.5" />
            </button>
          </header>
          {selected.length ? (
            <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-5 py-3">
              {selected.map((user) => (
                <span key={user.id} className="inline-flex items-center gap-1 rounded-full bg-sky-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-sky-700">
                  {user.fullName}
                  <button type="button" onClick={() => toggle(user)} aria-label={`Remove ${user.fullName}`} className="rounded-full p-0.5 hover:bg-sky-100">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {isGroup ? (
            <div className="shrink-0 border-b border-slate-100 px-5 py-3">
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Name this group (optional)"
                maxLength={120}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />
            </div>
          ) : null}
          <div className="shrink-0 px-5 py-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search colleagues"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />
            </label>
          </div>
          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : !filtered.length ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No colleagues match your search.</p>
            ) : (
              filtered.map((user) => {
                const active = selected.some((item) => item.id === user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => toggle(user)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-xs font-bold text-white">
                      {initials(user.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{user.fullName}</span>
                      <span className="block truncate text-xs capitalize text-slate-500">{user.role}</span>
                    </span>
                    {active ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <footer className="shrink-0 border-t border-slate-100 px-5 py-4">
            <button
              type="button"
              disabled={!selected.length || creating}
              onClick={() => onCreate(selected.map((user) => user.id), isGroup ? groupName : undefined)}
              className="flex h-11 w-full items-center justify-center rounded-full bg-sky-600 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-40"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : isGroup ? "Create group" : "Start chat"}
            </button>
          </footer>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}

function NewEmailModal({ sending, provider, onClose, onSend }) {
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const subjectWords = subjectWordCount(subject);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api.get(`/clients?limit=20${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`)
        .then((response) => {
          if (active) setClients(response.data.data || []);
        })
        .catch(() => {
          if (active) setError("Clients could not be loaded.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search]);

  async function submit(event) {
    event.preventDefault();
    if (!selectedClient?.email || !subject.trim() || !body.trim() || subjectWords > EMAIL_SUBJECT_MAX_WORDS) return;
    setError("");
    const result = await onSend({ client: selectedClient, subject: subject.trim(), body: body.trim() });
    if (result?.error) setError(result.error);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && !sending && onClose()}>
        <motion.form
          onSubmit={submit}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.16 }}
          className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex shrink-0 items-start justify-between border-b border-slate-300 px-5 py-4 sm:px-6">
            <div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-[#002FA7]" />
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">New email</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">Choose a client record. The email will stay linked to that client.</p>
            </div>
            <button type="button" disabled={sending} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="Close new email">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="grid border-b border-slate-300 lg:grid-cols-[220px_1fr]">
              <div className="border-b border-slate-300 p-4 lg:border-b-0 lg:border-r">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="new-email-client-search">Client</label>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input id="new-email-client-search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients" className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#002FA7] focus:ring-4 focus:ring-blue-100" />
                </div>
                <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-slate-200">
                  {loading ? <div className="flex justify-center py-7"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div> : clients.length ? clients.map((client) => {
                    const active = selectedClient?.id === client.id;
                    return (
                      <button key={client.id} type="button" disabled={!client.email} onClick={() => setSelectedClient(client)} className={`w-full border-b border-slate-200 px-3 py-2.5 text-left last:border-b-0 disabled:cursor-not-allowed disabled:opacity-45 ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                        <span className="block truncate text-sm font-semibold text-slate-900">{client.fullName}</span>
                        <span className={`mt-0.5 block truncate text-xs ${client.email ? "text-slate-500" : "text-rose-600"}`}>{client.email || "No email on file"}</span>
                      </button>
                    );
                  }) : <p className="px-3 py-7 text-center text-xs text-slate-500">No clients found.</p>}
                </div>
              </div>

              <div className="p-4 sm:p-5">
                <div className="grid grid-cols-[64px_1fr] items-center border-b border-slate-200 py-2 text-sm">
                  <span className="text-xs font-semibold text-slate-500">To</span>
                  <span className={selectedClient?.email ? "truncate font-medium text-slate-900" : "text-slate-400"}>{selectedClient?.email || "Select a client"}</span>
                </div>
                <label className="grid grid-cols-[64px_1fr] items-start border-b border-slate-200 py-2">
                  <span className="pt-2 text-xs font-semibold text-slate-500">Subject</span>
                  <span>
                    <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Email subject" maxLength={300} className="h-9 w-full bg-transparent text-sm font-medium text-slate-950 outline-none placeholder:text-slate-400" />
                    <span className={`block text-right text-[10px] ${subjectWords > EMAIL_SUBJECT_MAX_WORDS ? "font-semibold text-rose-600" : "text-slate-400"}`}>{subjectWords}/{EMAIL_SUBJECT_MAX_WORDS} words</span>
                  </span>
                </label>
                <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={10} placeholder="Write your email" className="mt-4 w-full resize-y bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400" />
              </div>
            </section>
            {error ? <p className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</p> : null}
            {!provider?.sendConfigured ? <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">Connect your email mailbox in Personal Settings before sending.</p> : null}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-300 px-5 py-4 sm:px-6">
            <p className="truncate text-xs text-slate-500">{provider?.provider || "Email"}</p>
            <button type="submit" disabled={sending || !provider?.sendConfigured || !selectedClient?.email || !subject.trim() || !body.trim() || subjectWords > EMAIL_SUBJECT_MAX_WORDS} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#002FA7] px-5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Sending…" : "Send email"}
            </button>
          </footer>
        </motion.form>
      </div>
    </AnimatePresence>,
    document.body,
  );
}

export default function ChatsPage() {
  const { appUser } = useAuth();
  const myUserId = appUser?.id;
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const initialKind = ["ai", "support", "client", "email", "sms", "internal"].includes(requestedKind) ? requestedKind : "internal";
  const requestedThreadId = searchParams.get("thread") || "";
  const [internalThreads, setInternalThreads] = useState([]);
  const [clientConversations, setClientConversations] = useState([]);
  const [emailConversations, setEmailConversations] = useState([]);
  const [smsConversations, setSmsConversations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listSearch, setListSearch] = useState("");
  // Opens to Teams by default — unless a notification/deep-link landed us
  // directly on a client conversation, in which case that filter is active
  // so the opened item is actually visible (and highlighted) in the list.
  const [categoryFilter, setCategoryFilter] = useState(initialKind === "client" ? "portal" : initialKind === "email" ? "email" : initialKind === "sms" ? "sms" : "teams");
  // "all" | "mine" | "unassigned" | a specific colleague's user id — only
  // meaningful for the assignable channels (portal/email/sms), so it's
  // ignored server-side (see loadLists) once categoryFilter is teams/groups.
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const reassignMenuRef = useRef(null);
  const [selectedKind, setSelectedKind] = useState(initialKind);
  const [selectedId, setSelectedId] = useState(initialKind === "ai" && requestedThreadId ? "nova" : requestedThreadId);
  const [activeDetail, setActiveDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [realtime, setRealtime] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colleagues, setColleagues] = useState([]);
  const [colleaguesLoading, setColleaguesLoading] = useState(false);
  const [creatingThread, setCreatingThread] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [commPermissions, setCommPermissions] = useState({});
  const [communicationProviders, setCommunicationProviders] = useState({});
  const [communicationTemplates, setCommunicationTemplates] = useState([]);
  const [groupProfileOpen, setGroupProfileOpen] = useState(false);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [smsComposerOpen, setSmsComposerOpen] = useState(false);
  const [smsOptions, setSmsOptions] = useState(null);
  const [smsFromNumber, setSmsFromNumber] = useState("");
  const [smsSyncing, setSmsSyncing] = useState(false);
  const { messages: novaMessages, sending: novaSending, error: novaError } = useNovaChat();
  const novaContextPath = searchParams.get("from") || location.pathname;
  const novaPanelVisible = activeDetail?.kind === "ai" && novaMessages.length === 1;
  const novaInsight = useNovaProactiveInsight(novaContextPath, { enabled: novaPanelVisible });

  const novaItem = useMemo(() => {
    const latest = novaMessages[novaMessages.length - 1];
    return {
      kind: "ai",
      category: "teams",
      id: "nova",
      name: "Nova",
      isGroup: false,
      lastMessageAt: latest?.occurredAt || new Date().toISOString(),
      unreadCount: 0,
      preview: latest?.bodyText || "CaseDesk AI",
    };
  }, [novaMessages]);
  const supportItem = useMemo(() => ({
    kind: "support",
    category: "teams",
    id: "help",
    name: "Help & Support",
    isGroup: false,
    lastMessageAt: null,
    unreadCount: 0,
    preview: "Report a problem to CaseDesk",
  }), []);

  // getMyColleagues() deliberately excludes the current user (it backs the
  // "new chat" picker, and you can't DM yourself) — but reassigning or
  // filtering by owner both need "me" as a selectable option too.
  const reassignableColleagues = useMemo(() => {
    if (!myUserId) return colleagues;
    const self = { id: myUserId, fullName: appUser?.fullName ? `${appUser.fullName} (you)` : "You" };
    return [self, ...colleagues.filter((user) => user.id !== myUserId)];
  }, [colleagues, myUserId, appUser?.fullName]);

  useEffect(() => {
    Promise.all([
      api.get("/communications/providers"),
      api.get("/communications/templates"),
      api.get("/communications/sms-options").catch(() => null),
    ]).then(([providerResponse, templateResponse, smsResponse]) => {
      setCommunicationProviders(providerResponse.data.data || {});
      setCommPermissions(providerResponse.data.meta?.permissions || {});
      setCommunicationTemplates(templateResponse.data.data || []);
      const nextSmsOptions = smsResponse?.data?.data || null;
      setSmsOptions(nextSmsOptions);
      setSmsFromNumber(nextSmsOptions?.defaultNumber || "");
    }).catch(() => {});
  }, []);

  // "mine"/"unassigned" map straight to the backend's own scope values;
  // anything else is a specific colleague's id, sent as an explicit
  // assignedToId filter (scope stays "all" so it isn't also narrowed to me).
  const ownerQuery = ownerFilter === "mine" || ownerFilter === "unassigned"
    ? `scope=${ownerFilter}`
    : ownerFilter && ownerFilter !== "all"
      ? `scope=all&assignedToId=${encodeURIComponent(ownerFilter)}`
      : "scope=all";

  const loadLists = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setListLoading(true);
    const [internalResult, clientResult, emailResult, smsResult] = await Promise.allSettled([
      getInternalChatThreads(),
      api.get(`/communications/inbox?${ownerQuery}&channel=Chat&limit=100`).then((response) => response.data.data),
      api.get(`/communications/inbox?${ownerQuery}&channel=Email&limit=100`).then((response) => response.data.data),
      api.get(`/communications/inbox?${ownerQuery}&channel=Sms&limit=100`).then((response) => response.data.data),
    ]);
    // Each source degrades independently — a permissions edge case on one
    // (e.g. client-chat view restricted for this user) must never blank
    // out the other.
    if (internalResult.status === "fulfilled") setInternalThreads(internalResult.value);
    if (clientResult.status === "fulfilled") setClientConversations(clientResult.value);
    if (emailResult.status === "fulfilled") setEmailConversations(emailResult.value);
    if (smsResult.status === "fulfilled") setSmsConversations(smsResult.value);
    if (!silent) setListLoading(false);
  }, [ownerQuery]);

  const syncSms = useCallback(async () => {
    if (smsSyncing) return;
    setSmsSyncing(true);
    try {
      await api.post("/communications/sms/sync", {}, { timeout: 60_000 });
      await loadLists({ silent: true });
    } catch (reason) {
      setError(reason.response?.data?.message || "Twilio SMS history could not be synced.");
    } finally {
      setSmsSyncing(false);
    }
  }, [loadLists, smsSyncing]);

  const fetchDetailOnce = useCallback(async (kind, id) => {
    if (kind === "support") return { ...supportItem, messages: [], caseId: null };
    if (kind === "ai") {
      return { ...novaItem, messages: [...novaMessages].reverse(), caseId: null };
    }
    if (kind === "internal") {
      const data = await getInternalChatThread(id);
      return { kind: "internal", id, name: data.name, isGroup: data.isGroup, hasAvatar: data.hasAvatar, participants: data.participants, messages: data.messages, caseId: null };
    }
    if (kind === "email") {
      const response = await api.get(`/communications/clients/${id}/email-thread`);
      const data = response.data.data;
      const latestConversation = data.conversations?.[0];
      const latestMessage = data.messages?.[0];
      const conversationIds = (data.conversations || []).map((conversation) => conversation.id);
      const unreadConversationIds = (data.conversations || [])
        .filter((conversation) => conversation.unreadCount)
        .map((conversation) => conversation.id);
      if (unreadConversationIds.length) {
        await Promise.all(unreadConversationIds.map((conversationId) =>
          api.post(`/communications/conversations/${conversationId}/read`, { read: true }).catch(() => {}),
        ));
      }
      return {
        kind: "email",
        channel: "Email",
        id,
        name: data.client?.fullName || "Client",
        isGroup: false,
        clientId: data.client?.id || id,
        clientEmail: data.client?.email || null,
        conversationIds,
        replyConversationId: latestConversation?.id || null,
        replyCaseId: latestConversation?.caseId || null,
        replyParentMessageId: latestMessage?.id || null,
        messageCount: data.totalMessages || data.messages?.length || 0,
        subject: latestConversation?.subject || latestMessage?.subject || latestMessage?.conversation?.subject || "",
        assignedToId: latestConversation?.assignedTo?.id || null,
        assignedToName: latestConversation?.assignedTo?.fullName || null,
        messages: data.messages || [],
      };
    }
    const response = await api.get(`/communications/conversations/${id}?limit=200`);
    const data = response.data.data;
    if (data.unreadCount) await api.post(`/communications/conversations/${id}/read`, { read: true });
    return {
      kind: data.channel === "Email" ? "email" : data.channel === "Sms" ? "sms" : "client",
      channel: data.channel,
      id,
      name: `${data.client?.fullName || "Client"}${data.case?.caseType ? ` · ${data.case.caseType}` : ""}`,
      isGroup: false,
      caseId: data.caseId || null,
      clientId: data.clientId,
      clientEmail: data.client?.email || null,
      clientPhone: data.client?.phone || null,
      subject: data.subject || data.messages?.find((message) => message.subject)?.subject || "",
      assignedToId: data.assignedTo?.id || null,
      assignedToName: data.assignedTo?.fullName || null,
      messages: data.messages,
      clientLastReadAt: data.clientLastReadAt,
    };
  }, [novaItem, novaMessages, supportItem]);

  const loadDetail = useCallback(async (kind, id, { silent = false } = {}) => {
    if (!id) return;
    if (!silent) setDetailLoading(true);
    try {
      let normalized;
      try {
        normalized = await fetchDetailOnce(kind, id);
      } catch (firstError) {
        // A conversation opened the instant it's created can occasionally
        // hit this before its own write has fully settled — one short,
        // silent retry clears that up on its own instead of making the
        // user reload the page.
        if (silent) throw firstError;
        await new Promise((resolve) => setTimeout(resolve, 700));
        normalized = await fetchDetailOnce(kind, id);
      }
      setActiveDetail(normalized);
      setPending((current) =>
        current.filter((item) => !normalized.messages.some((message) => message.clientMessageId === item.clientMessageId || message.idempotencyKey === item.clientMessageId)),
      );
      setError("");
    } catch (reason) {
      if (!silent) setError(internalChatErrorMessage(reason, "This conversation could not be opened."));
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, [fetchDetailOnce]);

  useEffect(() => { void loadLists(); }, [loadLists]);
  const initialSmsSyncStarted = useRef(false);
  useEffect(() => {
    if (initialSmsSyncStarted.current) return;
    initialSmsSyncStarted.current = true;
    void syncSms();
  }, [syncSms]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadLists({ silent: true });
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [loadLists]);

  useEffect(() => {
    setActiveDetail(null);
    setPending([]);
    setDraft("");
    setError("");
    setReplyTarget(null);
    setEditingMessageId("");
    setEditDraft("");
    setGroupProfileOpen(false);
    setReassignOpen(false);
    if (selectedId) void loadDetail(selectedKind, selectedId);
  }, [selectedKind, selectedId, loadDetail]);

  useEffect(() => {
    if (!reassignOpen) return undefined;
    function handleClickOutside(event) {
      if (reassignMenuRef.current && !reassignMenuRef.current.contains(event.target)) setReassignOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [reassignOpen]);

  const fetchRealtimeConfig = useCallback(() => {
    if (!selectedId) return Promise.resolve({ configured: false });
    if (["ai", "support"].includes(selectedKind)) return Promise.resolve({ configured: false });
    if (selectedKind === "internal") return getInternalChatRealtimeConfig(selectedId);
    if (activeDetail?.kind === "client" && activeDetail.id === selectedId && activeDetail.caseId) {
      return api.get(`/communications/realtime/case/${activeDetail.caseId}`).then((response) => response.data.data);
    }
    return Promise.resolve({ configured: false });
  }, [selectedKind, selectedId, activeDetail]);

  useEffect(() => {
    fetchRealtimeConfig().then(setRealtime).catch(() => setRealtime(null));
  }, [fetchRealtimeConfig]);

  useCaseRealtimeChat({
    fetchConfig: fetchRealtimeConfig,
    enabled: Boolean(realtime?.configured),
    onMessage: () => {
      if (selectedId) void loadDetail(selectedKind, selectedId, { silent: true });
      void loadLists({ silent: true });
    },
  });

  useEffect(() => {
    if (!selectedId) return undefined;
    const intervalMs = selectedKind === "email"
      ? EMAIL_DETAIL_POLL_MS
      : realtime?.configured ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDetail(selectedKind, selectedId, { silent: true });
        void loadLists({ silent: true });
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [selectedKind, selectedId, realtime?.configured, loadDetail, loadLists]);

  useEffect(() => {
    if (!selectedId || ["ai", "support"].includes(selectedKind) || document.visibilityState !== "visible") return;
    if (selectedKind === "email") return;
    const markRead = selectedKind === "internal"
      ? () => markInternalChatThreadRead(selectedId)
      : () => api.post(`/communications/conversations/${selectedId}/read`, { read: true }).catch(() => {});
    markRead().then(() => loadLists({ silent: true }));
  }, [selectedKind, selectedId, activeDetail?.messages?.length, loadLists]);

  function selectThread(kind, id) {
    setSelectedKind(kind);
    setSelectedId(id);
    if (kind === "client") setCategoryFilter("portal");
    if (kind === "email") setCategoryFilter("email");
    if (kind === "sms") setCategoryFilter("sms");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("thread", id);
      next.set("kind", kind);
      return next;
    }, { replace: true });
  }

  const thread = useMemo(() => {
    if (selectedKind === "ai") return novaMessages;
    if (!activeDetail) return [];
    const messages = [...(activeDetail.messages || [])].reverse();
    if (activeDetail.kind === "internal") {
      return messages.map((message) => ({ ...message, direction: message.senderId === myUserId ? "Outbound" : "Inbound" }));
    }
    return messages; // client messages already carry a real direction field
  }, [activeDetail, myUserId, selectedKind, novaMessages]);
  const displayMessages = useMemo(() => [...thread, ...pending], [thread, pending]);

  // Plays the receive chime for a genuinely new inbound message (not one of
  // mine echoing back, and not the initial batch when a conversation is
  // first opened) — keyed per conversation so switching threads doesn't
  // false-trigger off the newly-loaded thread's existing history.
  const seenMessageIdsRef = useRef(new Map());
  useEffect(() => {
    if (!selectedId) return;
    const key = `${selectedKind}:${selectedId}`;
    const currentIds = new Set(thread.map((message) => message.id));
    const previousIds = seenMessageIdsRef.current.get(key);
    if (previousIds) {
      const hasNewInbound = thread.some((message) => message.direction === "Inbound" && !previousIds.has(message.id));
      if (hasNewInbound) playReceivedSound();
    }
    seenMessageIdsRef.current.set(key, currentIds);
  }, [thread, selectedKind, selectedId]);

  // Blue tick only when everyone else in the conversation has read up to
  // this message. For a client conversation that's just clientLastReadAt;
  // for an internal thread it's the minimum lastReadAt across every other
  // participant, reusing ChatThread's single-value prop either way.
  const readThreshold = useMemo(() => {
    if (!activeDetail) return null;
    if (activeDetail.kind === "client") return activeDetail.clientLastReadAt;
    const others = (activeDetail.participants || []).filter((participant) => participant.id !== myUserId);
    if (!others.length || others.some((participant) => !participant.lastReadAt)) return null;
    return others.reduce((min, participant) => (!min || new Date(participant.lastReadAt) < new Date(min) ? participant.lastReadAt : min), null);
  }, [activeDetail, myUserId]);

  const fetchBlob = useCallback(
    (messageId, attachmentId) =>
      selectedKind === "internal"
        ? fetchInternalChatAttachmentBlob(selectedId, attachmentId)
        : api.get(`/communications/messages/${messageId}/attachments/${attachmentId}/file`, { responseType: "blob" }).then((response) => response.data),
    [selectedKind, selectedId],
  );
  const attachmentFileUrl = useChatAttachmentUrls(displayMessages, fetchBlob);

  const mergedItems = useMemo(() => {
    const internal = internalThreads.map((item) => ({
      kind: "internal",
      category: item.isGroup ? "groups" : "teams",
      id: item.id,
      name: item.name,
      isGroup: item.isGroup,
      hasAvatar: item.hasAvatar,
      lastMessageAt: item.lastMessageAt,
      unreadCount: item.unreadCount,
      preview: item.latestMessage?.bodyText || (item.latestMessage ? "Sent an attachment" : ""),
    }));
    const client = clientConversations.map((conversation) => {
      const latest = conversation.messages?.[0];
      return {
        kind: "client",
        category: "portal",
        id: conversation.id,
        name: `${conversation.client?.fullName || "Client"}${conversation.case?.caseType ? ` · ${conversation.case.caseType}` : ""}`,
        isGroup: false,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: conversation.unreadCount || 0,
        assignedToId: conversation.assignedTo?.id || null,
        assignedToName: conversation.assignedTo?.fullName || null,
        preview: latest ? previewSenderPrefix(latest, myUserId) + (latest.bodyText || "Sent an attachment") : "",
      };
    });
    const emailByClient = new Map();
    emailConversations.forEach((conversation) => {
      const clientId = conversation.clientId || conversation.client?.id;
      if (!clientId) return;
      const current = emailByClient.get(clientId) || [];
      current.push(conversation);
      emailByClient.set(clientId, current);
    });
    const email = [...emailByClient.entries()].map(([clientId, conversations]) => {
      const sorted = [...conversations].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      const latestConversation = sorted[0];
      const latest = latestConversation.messages?.[0];
      const subject = latestConversation.subject || latest?.subject || "Email";
      return {
        kind: "email",
        channel: "Email",
        category: "email",
        id: clientId,
        name: latestConversation.client?.fullName || "Client",
        email: latestConversation.client?.email || "",
        subject,
        messageCount: sorted.reduce((total, conversation) => total + (conversation._count?.messages || 0), 0),
        conversationIds: sorted.map((conversation) => conversation.id),
        isGroup: false,
        lastMessageAt: latestConversation.lastMessageAt,
        unreadCount: sorted.reduce((total, conversation) => total + (conversation.unreadCount || 0), 0),
        assignedToId: latestConversation.assignedTo?.id || null,
        assignedToName: latestConversation.assignedTo?.fullName || null,
        preview: latest ? `${subject} — ${previewSenderPrefix(latest, myUserId)}${latest.bodyText || "Email message"}` : subject,
      };
    });
    const sms = smsConversations.map((conversation) => {
      const latest = conversation.messages?.[0];
      return {
        kind: "sms",
        channel: "Sms",
        category: "sms",
        id: conversation.id,
        name: conversation.client?.fullName || "Client",
        phone: conversation.client?.phone || "",
        isGroup: false,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: conversation.unreadCount || 0,
        assignedToId: conversation.assignedTo?.id || null,
        assignedToName: conversation.assignedTo?.fullName || null,
        preview: latest ? `${previewSenderPrefix(latest, myUserId)}${latest.bodyText || "SMS message"}` : "",
      };
    });
    return [novaItem, supportItem, ...[...internal, ...client, ...email, ...sms].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))];
  }, [internalThreads, clientConversations, emailConversations, smsConversations, novaItem, supportItem, myUserId]);

  const filteredItems = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    return mergedItems.filter((item) => {
      if (!["ai", "support"].includes(item.kind) && categoryFilter && item.category !== categoryFilter) return false;
      if (!query) return true;
      return `${item.name} ${item.email || ""} ${item.phone || ""} ${item.subject || ""} ${item.preview}`.toLowerCase().includes(query);
    });
  }, [mergedItems, listSearch, categoryFilter]);

  // Covers both the list rows and the currently open header/profile panel
  // with one cache — activeDetail is included since it can be a thread not
  // yet reflected in mergedItems (e.g. right after creating one).
  const avatarItems = useMemo(() => (activeDetail ? [...mergedItems, activeDetail] : mergedItems), [mergedItems, activeDetail]);
  const [threadAvatarUrl, refreshThreadAvatar] = useThreadAvatarUrls(avatarItems, fetchInternalChatThreadAvatarBlob);

  async function send() {
    const bodyText = draft.trim();
    if (!bodyText || !selectedId || sending || (selectedKind === "ai" && novaSending)) return;
    if (selectedKind === "ai") {
      setDraft("");
      setError("");
      setReplyTarget(null);
      playSentSound();
      await sendNovaMessage(bodyText, novaContextPath);
      return;
    }
    const emailConversation = selectedKind === "email" || activeDetail?.channel === "Email";
    const smsConversation = selectedKind === "sms" || activeDetail?.channel === "Sms";
    if (emailConversation && !activeDetail?.clientEmail) {
      setError("Add an email address to this client's profile before replying.");
      return;
    }
    if (smsConversation && !activeDetail?.clientPhone) {
      setError("Add a phone number to this client's profile before sending an SMS.");
      return;
    }
    if (smsConversation && (!smsOptions?.configured || !smsOptions?.verified)) {
      setError(!smsOptions?.configured
        ? "Twilio SMS is not enabled for this workspace."
        : "An administrator must send a successful test SMS from Settings first.");
      return;
    }
    if (smsConversation && !smsFromNumber) {
      setError("Choose which calling number should send this SMS.");
      return;
    }
    const clientMessageId = crypto.randomUUID();
    const replyToId = replyTarget?.id || undefined;
    const optimistic = { id: `pending-${clientMessageId}`, clientMessageId, senderId: myUserId, direction: "Outbound", bodyText, occurredAt: new Date().toISOString(), pending: true };
    setPending((current) => [...current, optimistic]);
    setDraft("");
    setReplyTarget(null);
    setSending(true);
    setError("");
    playSentSound();
    try {
      if (selectedKind === "internal") {
        await sendInternalChatMessage(selectedId, { bodyText, clientMessageId, replyToId });
      } else {
        const conversationId = emailConversation ? activeDetail?.replyConversationId : selectedId;
        if (!conversationId) throw new Error("This conversation is not ready yet.");
        await api.post(
          "/communications/messages",
          {
            conversationId,
            caseId: emailConversation ? activeDetail?.replyCaseId || undefined : activeDetail?.caseId || undefined,
            parentMessageId: replyToId || (emailConversation ? activeDetail?.replyParentMessageId : thread[thread.length - 1]?.id) || undefined,
            channel: emailConversation ? "Email" : smsConversation ? "Sms" : "Chat",
            direction: "Outbound",
            recipients: emailConversation ? [activeDetail.clientEmail] : smsConversation ? [activeDetail.clientPhone] : [],
            senderAddress: smsConversation ? smsFromNumber : undefined,
            subject: emailConversation ? activeDetail.subject : undefined,
            bodyText,
            occurredAt: new Date().toISOString(),
            sendNow: true,
            idempotencyKey: clientMessageId,
            portalAudience: !emailConversation && !smsConversation,
          },
          { timeout: 30_000 },
        );
      }
      await Promise.all([loadDetail(selectedKind, selectedId, { silent: true }), loadLists({ silent: true })]);
    } catch (reason) {
      setPending((current) => current.filter((item) => item.id !== optimistic.id));
      setDraft(bodyText);
      setReplyTarget(replyTarget);
      setError(internalChatErrorMessage(reason, "Your message could not be sent."));
    } finally {
      setSending(false);
    }
  }

  async function retryNova(message) {
    if (novaSending) return;
    playSentSound();
    await retryNovaMessage(message.id, novaContextPath);
  }

  async function attachFile(file) {
    if (!selectedId || sending || selectedKind === "email") return;
    setSending(true);
    setError("");
    playSentSound();
    try {
      const clientMessageId = crypto.randomUUID();
      if (selectedKind === "internal") {
        const created = await sendInternalChatMessage(selectedId, { bodyText: "", clientMessageId, hasAttachment: true });
        await uploadInternalChatAttachment(selectedId, created.id, file);
      } else {
        const created = await api
          .post(
            "/communications/messages",
            {
              conversationId: selectedId,
              caseId: activeDetail?.caseId || undefined,
              parentMessageId: thread[thread.length - 1]?.id || undefined,
              channel: "Chat",
              direction: "Outbound",
              recipients: [],
              bodyText: "",
              hasAttachment: true,
              occurredAt: new Date().toISOString(),
              sendNow: true,
              idempotencyKey: clientMessageId,
              portalAudience: true,
            },
            { timeout: 30_000 },
          )
          .then((response) => response.data.data);
        const form = new FormData();
        form.append("file", file);
        await api.post(`/communications/messages/${created.id}/attachments`, form, { timeout: 60_000 });
      }
      await Promise.all([loadDetail(selectedKind, selectedId, { silent: true }), loadLists({ silent: true })]);
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "Your file could not be sent."));
    } finally {
      setSending(false);
    }
  }

  async function handleAttachmentTap(attachment, message) {
    const isImage = (attachment.mimeType || "").startsWith("image/");
    if (isImage) {
      const url = attachmentFileUrl(attachment) || URL.createObjectURL(await fetchBlob(message.id, attachment.id));
      setLightbox({ attachment, url });
      return;
    }
    const blob = await fetchBlob(message.id, attachment.id).catch(() => null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.originalFilename || "document";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function startReply(message) {
    setReplyTarget(message);
  }

  function cancelReply() {
    setReplyTarget(null);
  }

  function startEdit(message) {
    setEditingMessageId(message.id);
    setEditDraft(message.bodyText || "");
  }

  function cancelEdit() {
    setEditingMessageId("");
    setEditDraft("");
  }

  async function saveEdit() {
    const bodyText = editDraft.trim();
    if (!bodyText || !editingMessageId) return;
    setSavingEdit(true);
    setError("");
    try {
      await updateInternalChatMessage(selectedId, editingMessageId, bodyText);
      cancelEdit();
      await loadDetail(selectedKind, selectedId, { silent: true });
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "Your edit could not be saved."));
    } finally {
      setSavingEdit(false);
    }
  }

  // Confirmation happens in ChatMessageBubble's own popover before this is
  // ever called — not a native window.confirm(), which browsers can
  // silently suppress after repeated use (no dialog, no error, the delete
  // just silently no-ops), making the button look broken.
  async function deleteMessage(message) {
    setError("");
    try {
      if (selectedKind === "internal") {
        await deleteInternalChatMessage(selectedId, message.id);
      } else {
        await api.delete(`/communications/messages/${message.id}`);
      }
      await Promise.all([loadDetail(selectedKind, selectedId, { silent: true }), loadLists({ silent: true })]);
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "This message could not be deleted."));
    }
  }

  async function toggleReaction(emoji, message) {
    setError("");
    try {
      if (selectedKind === "internal") {
        await toggleInternalChatReaction(selectedId, message.id, emoji);
      } else {
        await api.post(`/communications/messages/${message.id}/reactions`, { emoji });
      }
      await loadDetail(selectedKind, selectedId, { silent: true });
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "That reaction could not be saved."));
    }
  }

  // Edit only ever applies to internal chat — client-chat messages are part
  // of the case record and have no edit endpoint at all (see the backend
  // plan/decision), so this stays false for every client message.
  function canEditMessage(message) {
    return selectedKind === "internal" && message.senderId === myUserId && !message.pending && !message.failed;
  }

  // Internal: only your own message. Client: reuses the same admin-gated
  // canDelete permission the existing communications trash system already
  // enforces server-side — showing the button only when it would actually
  // succeed, without duplicating that policy client-side.
  function canDeleteMessage(message) {
    if (message.pending || message.failed) return false;
    if (selectedKind === "ai") return false;
    if (selectedKind === "internal") return message.senderId === myUserId;
    return Boolean(commPermissions.canDelete);
  }

  const replyTargetLabel = replyTarget
    ? replyTarget.senderId === myUserId || replyTarget.direction === "Outbound"
      ? "yourself"
      : selectedKind === "internal"
        ? replyTarget.sender?.fullName
        : replyTarget.senderUser?.fullName || activeDetail?.name
    : "";

  function ensureColleaguesLoaded() {
    if (colleagues.length || colleaguesLoading) return;
    setColleaguesLoading(true);
    getMyColleagues().then(setColleagues).catch(() => {}).finally(() => setColleaguesLoading(false));
  }

  function openPicker() {
    setPickerOpen(true);
    ensureColleaguesLoaded();
  }

  async function handleCreateThread(participantUserIds, name) {
    setCreatingThread(true);
    try {
      const created = await createInternalChatThread({ participantUserIds, name });
      setPickerOpen(false);
      // Open it right away — the list refresh doesn't need to finish
      // first, and waiting on it here just delayed the thread appearing
      // and stacked an extra pair of network calls right before the one
      // that actually loads the new conversation.
      selectThread("internal", created.id);
      void loadLists({ silent: true });
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "That conversation could not be started."));
    } finally {
      setCreatingThread(false);
    }
  }

  function handleEmailSaved(message, { client } = {}) {
    setEmailComposerOpen(false);
    setCategoryFilter("email");
    const clientId = client?.id || message?.clientId;
    if (clientId) selectThread("email", clientId);
    void loadLists({ silent: true });
  }

  function handleSmsSaved(message) {
    setSmsComposerOpen(false);
    setCategoryFilter("sms");
    if (message?.conversationId) selectThread("sms", message.conversationId);
    void loadLists({ silent: true });
  }

  function handleGroupUpdated({ avatarChanged } = {}) {
    if (avatarChanged) refreshThreadAvatar(selectedId);
    void loadDetail(selectedKind, selectedId, { silent: true });
    void loadLists({ silent: true });
  }

  function handleGroupLeave() {
    setGroupProfileOpen(false);
    setSelectedId("");
    void loadLists({ silent: true });
  }

  async function reassignConversation(userId) {
    // Email threads are grouped by client in this UI, but the backend
    // assigns ownership per underlying conversation — reassign the latest
    // one, same conversation the row-level "Assigned to" already reflects.
    const conversationId = activeDetail?.kind === "email" ? activeDetail?.replyConversationId : selectedId;
    if (!conversationId || reassigning) return;
    setReassigning(true);
    setError("");
    try {
      await api.patch(`/communications/conversations/${conversationId}`, { assignedToId: userId || null });
      setReassignOpen(false);
      await Promise.all([loadDetail(selectedKind, selectedId, { silent: true }), loadLists({ silent: true })]);
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "This conversation could not be reassigned."));
    } finally {
      setReassigning(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      <div className="flex-shrink-0 px-6 pb-5 pt-7">
        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="text-[34px] font-semibold leading-[40px] tracking-[-0.035em] text-slate-950"
        >
          Communications
        </motion.h1>
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : 0.04, ease: [0.16, 1, 0.3, 1] }}
          className="mt-1 text-[13px] font-medium text-slate-500"
        >
          Team conversations, portal messages, client email, and SMS in one workspace.
        </motion.p>
        <div className="mt-4 inline-flex max-w-full items-center overflow-x-auto rounded-xl border border-slate-300 bg-white">
          {CATEGORY_FILTERS.map((filter) => {
            const active = categoryFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setCategoryFilter(filter.key)}
                aria-pressed={active}
                className={`relative shrink-0 border-r border-slate-300 px-4 py-2 text-[13px] font-semibold last:border-r-0 ${active ? "bg-[#002FA7] text-white" : "bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-4 mb-4 flex min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/75 shadow-[0_24px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <aside className={`flex w-full max-w-[360px] shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/40 ${selectedId ? "hidden lg:flex" : "flex"}`}>
          <header className="shrink-0 border-b border-slate-200/70 px-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Conversations</p>
              <div className="flex items-center gap-1">
                {categoryFilter === "sms" ? (
                  <button type="button" onClick={syncSms} disabled={smsSyncing} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 disabled:opacity-40" aria-label="Sync SMS from Twilio" title="Sync SMS from Twilio">
                    <RotateCcw className={`h-4 w-4 ${smsSyncing ? "animate-spin" : ""}`} />
                  </button>
                ) : null}
                <button type="button" onClick={() => setSmsComposerOpen(true)} disabled={!commPermissions.canSendSms} className="flex h-10 w-10 items-center justify-center rounded-full text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label="New client SMS" title={commPermissions.canSendSms ? "New client SMS" : "You do not have permission to send SMS"}>
                  <MessageSquareText className="h-4.5 w-4.5" />
                </button>
                <button type="button" onClick={() => setEmailComposerOpen(true)} disabled={!commPermissions.canSendEmail} className="flex h-9 w-9 items-center justify-center rounded-full text-[#002FA7] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label="New client email" title={commPermissions.canSendEmail ? "New client email" : "You do not have permission to send email"}>
                  <MailPlus className="h-4.5 w-4.5" />
                </button>
                <button type="button" onClick={openPicker} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100" aria-label="New team chat" title="New team chat">
                  <SquarePen className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
            <label className="relative mt-3 block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder="Search conversations"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              />
            </label>
            {["portal", "email", "sms"].includes(categoryFilter) ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {OWNER_FILTERS.map((filter) => {
                  const active = ownerFilter === filter.key;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setOwnerFilter(filter.key)}
                      aria-pressed={active}
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${active ? "border-[#002FA7] bg-[#002FA7] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
                <select
                  value={OWNER_FILTERS.some((filter) => filter.key === ownerFilter) ? "" : ownerFilter}
                  onChange={(event) => setOwnerFilter(event.target.value || "all")}
                  onFocus={ensureColleaguesLoaded}
                  aria-label="Filter by team member"
                  className="h-[26px] min-w-0 max-w-[130px] rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 outline-none transition focus:border-sky-300"
                >
                  <option value="">Team member…</option>
                  {reassignableColleagues.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                </select>
              </div>
            ) : null}
          </header>
          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-2">
            {listLoading ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : !filteredItems.length ? (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-600"><MessagesSquare className="h-6 w-6" /></span>
                <h3 className="mt-4 text-sm font-semibold text-slate-800">
                  {listSearch ? "No matching conversations" : categoryFilter === "portal" ? "No portal chats yet" : categoryFilter === "email" ? "No emails yet" : categoryFilter === "sms" ? "No SMS conversations yet" : `No ${categoryFilter} yet`}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-500">
                  {listSearch ? "Try a different search." : categoryFilter === "portal" ? "Portal conversations will appear when clients send or receive secure messages." : categoryFilter === "email" ? "Emails linked to client records will appear here." : categoryFilter === "sms" ? "Send a text to a client to start a tracked SMS thread." : "Start a chat with a colleague."}
                </p>
                {!listSearch && categoryFilter === "email" ? (
                  <button type="button" onClick={() => setEmailComposerOpen(true)} disabled={!commPermissions.canSendEmail} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[#002FA7] px-5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-40">
                    <MailPlus className="h-4 w-4" />New email
                  </button>
                ) : !listSearch && categoryFilter === "sms" ? (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={syncSms} disabled={smsSyncing} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-sky-200 bg-white px-5 text-sm font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-40"><RotateCcw className={`h-4 w-4 ${smsSyncing ? "animate-spin" : ""}`} />{smsSyncing ? "Syncing…" : "Sync Twilio"}</button>
                    <button type="button" onClick={() => setSmsComposerOpen(true)} disabled={!commPermissions.canSendSms} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-40"><MessageSquareText className="h-4 w-4" />New SMS</button>
                  </div>
                ) : !listSearch && !["portal"].includes(categoryFilter) ? (
                  <button type="button" onClick={openPicker} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(2,132,199,0.2)] transition hover:bg-sky-700">
                    <SquarePen className="h-4 w-4" />New team chat
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredItems.map((item) => (
                  <ChatRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    active={item.kind === selectedKind && item.id === selectedId}
                    avatarUrl={threadAvatarUrl(item)}
                    onClick={() => selectThread(item.kind, item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className={`flex min-w-0 flex-1 flex-col ${activeDetail?.kind === "ai" ? "bg-gradient-to-b from-brand-50/70 via-slate-50/40 to-white" : "bg-slate-50/30"} ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {!selectedId ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><MessagesSquare className="h-6 w-6" /></span>
              <h2 className="mt-4 text-sm font-semibold text-slate-800">Select a conversation</h2>
              <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">Choose a chat on the left, or start a new one.</p>
            </div>
          ) : (
            <>
              <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur-xl">
                <button type="button" onClick={() => setSelectedId("")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 lg:hidden" aria-label="Back to chats">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {activeDetail?.kind === "ai" ? (
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="rounded-full ring-4 ring-brand-50"><ChatAvatar item={activeDetail} /></span>
                    <div className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-slate-950">Nova</h2>
                        <KindBadge kind="ai" />
                      </span>
                      <p className="mt-0.5 truncate text-xs text-slate-500">CaseDesk guide · Uses this page as context</p>
                    </div>
                    <button type="button" disabled={novaSending} onClick={resetNovaChat} aria-label="Start a new Nova chat" title="Start a new Nova chat" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40">
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
                ) : activeDetail?.kind === "internal" && activeDetail.isGroup ? (
                  <button
                    type="button"
                    onClick={() => setGroupProfileOpen(true)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left transition hover:opacity-80"
                  >
                    <ChatAvatar item={activeDetail} avatarUrl={threadAvatarUrl(activeDetail)} />
                    <div className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-slate-950">{activeDetail.name}</h2>
                        <KindBadge kind={activeDetail.kind} />
                      </span>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{(activeDetail.participants || []).length} people</p>
                    </div>
                  </button>
                ) : (
                  <>
                    <ChatAvatar item={activeDetail} avatarUrl={threadAvatarUrl(activeDetail)} />
                    <div className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-slate-950">{activeDetail?.name}</h2>
                        {activeDetail ? <KindBadge kind={activeDetail.kind} /> : null}
                      </span>
                      {["client", "email", "sms"].includes(activeDetail?.kind) ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {activeDetail.kind === "email" ? `${activeDetail.clientEmail || "No client email"} · ${activeDetail.messageCount || 0} ${(activeDetail.messageCount || 0) === 1 ? "email" : "emails"}` : activeDetail.kind === "sms" ? `${activeDetail.clientPhone || "No client phone"} · Twilio SMS` : "Client portal · Secure messaging"}
                        </p>
                      ) : null}
                    </div>
                    {["client", "email", "sms"].includes(activeDetail?.kind) ? (
                      <div className="relative shrink-0" ref={reassignMenuRef}>
                        <button
                          type="button"
                          onClick={() => {
                            ensureColleaguesLoaded();
                            setReassignOpen((open) => !open);
                          }}
                          aria-label="Conversation owner — click to reassign"
                          title="Conversation owner — click to reassign"
                          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#002FA7] hover:text-[#002FA7]"
                        >
                          <UserRound className="h-4 w-4" />
                          <span className="hidden max-w-[130px] truncate sm:inline">
                            {activeDetail.assignedToName ? `Owner: ${activeDetail.assignedToName}` : "Unassigned"}
                          </span>
                        </button>
                        {reassignOpen ? (
                          <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-xl">
                            <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reassign conversation</p>
                            <div className="max-h-64 overflow-y-auto">
                              <button
                                type="button"
                                onClick={() => reassignConversation(null)}
                                disabled={reassigning}
                                className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-slate-50 disabled:opacity-50 ${!activeDetail.assignedToId ? "font-semibold text-[#002FA7]" : "text-slate-700"}`}
                              >
                                Unassigned
                              </button>
                              {colleaguesLoading ? (
                                <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
                              ) : reassignableColleagues.map((user) => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => reassignConversation(user.id)}
                                  disabled={reassigning}
                                  className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-slate-50 disabled:opacity-50 ${activeDetail.assignedToId === user.id ? "font-semibold text-[#002FA7]" : "text-slate-700"}`}
                                >
                                  {user.fullName}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {["client", "email", "sms"].includes(activeDetail?.kind) && activeDetail.clientId ? (
                      <Link
                        to={`/app/clients/${encodeURIComponent(activeDetail.clientId)}`}
                        aria-label={`Open ${activeDetail.name}'s client profile`}
                        title="Open client profile"
                        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#002FA7] hover:text-[#002FA7]"
                      >
                        <UserRound className="h-4 w-4" />
                        <span className="hidden sm:inline">Client profile</span>
                      </Link>
                    ) : null}
                  </>
                )}
              </header>

              {activeDetail?.kind === "support" ? (
                <SupportDeskPanel />
              ) : (
                <>
                  <div className="relative min-h-0 flex-1">
                    {activeDetail?.kind === "ai" ? <NovaChatCompanion active sending={novaSending} /> : null}
                    <ChatThread
                messages={displayMessages}
                mineDirection="Outbound"
                loading={detailLoading}
                className="h-full px-4 py-5"
                mineBubbleClassName={activeDetail?.kind === "ai" ? "rounded-br-lg bg-gradient-to-br from-slate-800 to-slate-950 text-white" : activeDetail?.kind === "email" ? "rounded-br-sm border border-blue-200 bg-blue-50 text-slate-900" : activeDetail?.kind === "sms" ? "rounded-br-lg bg-sky-600 text-white" : activeDetail?.kind === "client" ? "rounded-br-sm border border-slate-300 bg-white text-slate-900" : "rounded-br-lg bg-gradient-to-br from-sky-600 to-indigo-600 text-white"}
                theirBubbleClassName={activeDetail?.kind === "ai" ? "rounded-bl-lg border border-brand-100 bg-white/95 text-slate-800 shadow-[0_8px_24px_rgba(73,104,149,0.12)]" : "rounded-bl-lg border border-slate-200 bg-white text-slate-800"}
                attachmentFileUrl={attachmentFileUrl}
                onAttachmentTap={handleAttachmentTap}
                clientLastReadAt={activeDetail?.kind === "email" ? null : readThreshold}
                senderLabelFor={activeDetail?.kind === "internal" && activeDetail.isGroup ? (message) => message.sender?.fullName : undefined}
                mineSenderLabelFor={["client", "email", "sms"].includes(activeDetail?.kind) ? (message) => message.senderUser?.fullName : undefined}
                myUserId={myUserId}
                onReply={["ai", "email", "sms"].includes(activeDetail?.kind) ? undefined : startReply}
                onToggleReaction={["ai", "email", "sms"].includes(activeDetail?.kind) ? undefined : toggleReaction}
                canEditMessage={canEditMessage}
                canDeleteMessage={canDeleteMessage}
                editingMessageId={editingMessageId}
                editDraft={editDraft}
                onEditDraftChange={setEditDraft}
                onStartEdit={startEdit}
                onSaveEdit={saveEdit}
                onCancelEdit={cancelEdit}
                onDeleteMessage={deleteMessage}
                savingEdit={savingEdit}
                typing={activeDetail?.kind === "ai" && novaSending}
                renderTyping={activeDetail?.kind === "ai" ? () => <NovaThinkingIndicator /> : undefined}
                showDeliveryStatus={activeDetail?.kind !== "ai"}
                theirAvatar={activeDetail?.kind === "ai" ? <NovaAssistantAvatar /> : undefined}
                renderMessageBody={activeDetail?.kind === "ai" ? (message, { mine, isNew }) => (
                  mine
                    ? <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.bodyText}</p>
                    : <NovaMessageContent text={message.bodyText} animate={isNew} />
                ) : activeDetail?.kind === "email" ? (message) => <EmailMessageContent message={message} /> : undefined}
                onRetryMessage={activeDetail?.kind === "ai" ? retryNova : undefined}
                emptyState={
                  <>
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm"><MessagesSquare className="h-6 w-6" /></span>
                    <h3 className="mt-4 text-sm font-semibold text-slate-800">{activeDetail?.kind === "email" ? "No email messages yet" : activeDetail?.kind === "sms" ? "No text messages yet" : "Say hello"}</h3>
                    <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">{activeDetail?.kind === "email" ? `Replies will be sent to ${activeDetail.clientEmail || "the client's email address"}.` : activeDetail?.kind === "sms" ? `Texts will be sent to ${activeDetail.clientPhone || "the client's phone number"}.` : `Messages here are just between you and ${activeDetail?.name}.`}</p>
                  </>
                }
              />
                  </div>

              {(activeDetail?.kind === "ai" ? novaError : error) ? <p className="mx-4 mb-2 shrink-0 rounded-2xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{activeDetail?.kind === "ai" ? novaError : error}</p> : null}

              <div className="relative z-10 shrink-0 border-t border-slate-200/70 bg-white/90 px-4 py-3 backdrop-blur-xl">
                {novaPanelVisible ? <NovaProactiveInsight insight={novaInsight} /> : null}
                {novaPanelVisible ? <NovaSuggestions onSelect={setDraft} currentPath={novaContextPath} persona={novaInsight?.persona} /> : null}
                {activeDetail?.kind === "sms" ? (
                  <div className="mb-2 flex min-h-10 items-center gap-3 rounded-xl border border-sky-100 bg-sky-50/70 px-3">
                    <label htmlFor="chat-sms-sender" className="shrink-0 text-xs font-semibold text-sky-800">Send from</label>
                    {smsOptions?.requiresSelection ? (
                      <select id="chat-sms-sender" value={smsFromNumber} onChange={(event) => setSmsFromNumber(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-sky-200 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100">
                        <option value="">Choose a calling number</option>
                        {(smsOptions?.numbers || []).map((number) => <option key={number.id} value={number.phoneNumber}>{number.label} · {number.phoneNumber}</option>)}
                      </select>
                    ) : (
                      <span id="chat-sms-sender" className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{smsOptions?.defaultNumber || "No sending number configured"}</span>
                    )}
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{draft.length}/1600</span>
                  </div>
                ) : null}
                <ChatComposer
                  value={draft}
                  onChange={activeDetail?.kind === "sms" ? (value) => setDraft(value.slice(0, 1600)) : setDraft}
                  onSend={send}
                  onAttach={["ai", "email", "sms"].includes(activeDetail?.kind) ? undefined : attachFile}
                  allowAttach={!["ai", "email", "sms"].includes(activeDetail?.kind)}
                  sending={activeDetail?.kind === "ai" ? novaSending : sending}
                  placeholder={activeDetail?.kind === "ai" ? "Ask Nova where to go" : activeDetail?.kind === "email" ? "Write an email reply" : activeDetail?.kind === "sms" ? "Write a text message" : "Type a message"}
                  accentClassName={activeDetail?.kind === "ai" ? "bg-gradient-to-br from-brand-600 to-brand-800" : activeDetail?.kind === "email" ? "bg-[#002FA7]" : activeDetail?.kind === "sms" ? "bg-sky-600" : activeDetail?.kind === "client" ? "bg-slate-800" : "bg-gradient-to-br from-sky-600 to-indigo-600"}
                  sendLabel={activeDetail?.kind === "ai" ? "Ask Nova" : activeDetail?.kind === "email" ? "Send email" : activeDetail?.kind === "sms" ? "Send SMS" : undefined}
                  sendingLabel={activeDetail?.kind === "sms" ? "Sending…" : undefined}
                  maxLength={activeDetail?.kind === "sms" ? 1600 : 5000}
                  replyTarget={replyTarget}
                  replyTargetLabel={replyTargetLabel}
                  onCancelReply={cancelReply}
                />
              </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      <ChatImageLightbox attachment={lightbox?.attachment} fileUrl={lightbox?.url} onClose={() => setLightbox(null)} />
      {pickerOpen ? (
        <NewChatModal colleagues={colleagues} loading={colleaguesLoading} creating={creatingThread} onClose={() => setPickerOpen(false)} onCreate={handleCreateThread} />
      ) : null}
      <AnimatePresence>
        {emailComposerOpen ? (
          <CommunicationComposer
            initialChannel="Email"
            caseItem={{ id: null, client: null }}
            providers={communicationProviders}
            permissions={commPermissions}
            templates={communicationTemplates}
            allowClientSelection
            lockChannel
            onClose={() => setEmailComposerOpen(false)}
            onSaved={handleEmailSaved}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {smsComposerOpen ? (
          <CommunicationComposer
            initialChannel="Sms"
            caseItem={{ id: null, client: null }}
            providers={communicationProviders}
            permissions={commPermissions}
            templates={communicationTemplates}
            allowClientSelection
            lockChannel
            onClose={() => setSmsComposerOpen(false)}
            onSaved={handleSmsSaved}
          />
        ) : null}
      </AnimatePresence>
      {groupProfileOpen && activeDetail?.kind === "internal" && activeDetail.isGroup ? (
        <GroupProfilePanel
          thread={activeDetail}
          avatarUrl={threadAvatarUrl(activeDetail)}
          myUserId={myUserId}
          onClose={() => setGroupProfileOpen(false)}
          onUpdated={handleGroupUpdated}
          onLeave={handleGroupLeave}
        />
      ) : null}
    </section>
  );
}
