import {
  ArrowLeft,
  CheckCheck,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Search,
  SendHorizonal,
  ShieldCheck,
  SquarePen,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const formatTime = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const formatThreadTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatTime(value);
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(date);
};

const dayLabel = (value) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
};

const initials = (name) =>
  String(name || "Client")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function ConversationRow({ conversation, active, onClick }) {
  const latest = conversation.messages?.[0];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? "bg-[#e7fce3]" : "hover:bg-slate-50"}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white shadow-sm">
        {initials(conversation.client?.fullName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">
            {conversation.case?.caseType || conversation.subject || "General inquiry"}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {formatThreadTime(conversation.lastMessageAt)}
          </span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {latest?.direction === "Outbound" ? "You: " : ""}
            {latest?.bodyText || "Open conversation"}
          </span>
          {conversation.unreadCount ? (
            <span className="inline-flex min-w-5 shrink-0 justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
              {conversation.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function MessageBubble({ message }) {
  const inbound = message.direction === "Inbound";
  return (
    <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <article
        className={`relative max-w-[84%] rounded-2xl px-3.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.12)] ${
          inbound
            ? "rounded-tl-md bg-white text-slate-800"
            : "rounded-tr-md bg-[#d9fdd3] text-slate-900"
        }`}
      >
        {!inbound && message.senderUser?.fullName ? (
          <p className="mb-0.5 text-[10px] font-semibold text-emerald-700">
            {message.senderUser.fullName}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words pr-12 text-[14px] leading-5">
          {message.bodyText}
        </p>
        <span className="absolute bottom-1.5 right-2.5 inline-flex items-center gap-0.5 text-[9px] text-slate-400">
          {formatTime(message.occurredAt)}
          {!inbound ? <CheckCheck className="h-3 w-3 text-sky-500" /> : null}
        </span>
      </article>
    </div>
  );
}

export default function ClientCommunicationCard({
  clientId,
  clientName,
  cases = [],
  open,
  onClose,
  initialConversationId = null,
  canManagePortal = false,
  onManagePortalAccess,
}) {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(initialConversationId || "");
  const [conversation, setConversation] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [portalStatus, setPortalStatus] = useState(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [targetCaseId, setTargetCaseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    if (!open) return;
    if (!silent) setLoading(true);
    try {
      const [inbox, providers, portal] = await Promise.all([
        api.get(`/communications/inbox?scope=all&channel=Chat&clientId=${encodeURIComponent(clientId)}&limit=50`),
        api.get("/communications/providers"),
        api.get(`/communications/clients/${encodeURIComponent(clientId)}/portal-chat-status`),
      ]);
      setConversations(inbox.data.data || []);
      setPermissions(providers.data.meta?.permissions || {});
      setPortalStatus(portal.data.data || null);
      setError("");
    } catch (reason) {
      if (!silent)
        setError(reason.response?.data?.message || "Portal chats could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [clientId, open]);

  const loadConversation = useCallback(async (conversationId, { silent = false } = {}) => {
    if (!conversationId || !open) return;
    if (!silent) setThreadLoading(true);
    try {
      const response = await api.get(`/communications/conversations/${conversationId}?limit=200`);
      setConversation(response.data.data);
      if (response.data.data.unreadCount) {
        await api.post(`/communications/conversations/${conversationId}/read`, { read: true });
        setConversations((current) =>
          current.map((item) => item.id === conversationId ? { ...item, unreadCount: 0 } : item),
        );
      }
      setError("");
    } catch (reason) {
      if (!silent)
        setError(reason.response?.data?.message || "This portal chat could not be opened.");
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(initialConversationId || "");
    setConversation(null);
    setComposing(false);
    setTargetCaseId("");
    setDraft("");
    setError("");
    void loadConversations();
  }, [open, initialConversationId, loadConversations]);

  useEffect(() => {
    if (selectedId && open) void loadConversation(selectedId);
  }, [selectedId, open, loadConversation]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadConversations({ silent: true });
      if (selectedId) void loadConversation(selectedId, { silent: true });
    }, 10_000);
    return () => clearInterval(timer);
  }, [open, selectedId, loadConversations, loadConversation]);

  const messages = useMemo(
    () => [...(conversation?.messages || [])].reverse(),
    [conversation],
  );
  const groups = useMemo(() => {
    const result = [];
    messages.forEach((message) => {
      const label = dayLabel(message.occurredAt);
      const last = result[result.length - 1];
      if (last?.label === label) last.messages.push(message);
      else result.push({ label, messages: [message] });
    });
    return result;
  }, [messages]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((item) =>
      `${item.subject || ""} ${item.case?.caseType || ""} ${item.messages?.[0]?.bodyText || ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [conversations, search]);
  const portalReady = portalStatus?.active === true;
  const portalNotice = !portalStatus?.hasPortal
    ? "Portal access is required before your team can start a secure chat with this client."
    : portalStatus.status === "invited"
      ? "The portal invitation is pending. Chat will become available after the client activates their account."
      : portalStatus.status === "disabled"
        ? "Portal access is disabled. Restore it before sending another message."
        : portalStatus && !portalReady
          ? "The client's portal account is not ready for chat."
          : "";

  function managePortal() {
    onClose?.();
    onManagePortalAccess?.();
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, selectedId]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => event.key === "Escape" && onClose?.();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  async function send(event) {
    event.preventDefault();
    const bodyText = draft.trim();
    if (!bodyText || !conversation || sending || permissions.canUseChat === false || !portalReady) return;
    setSending(true);
    setError("");
    try {
      await api.post(
        "/communications/messages",
        {
          conversationId: conversation.id,
          caseId: conversation.caseId || undefined,
          parentMessageId: messages[messages.length - 1]?.id || undefined,
          channel: "Chat",
          direction: "Outbound",
          recipients: [],
          bodyText,
          occurredAt: new Date().toISOString(),
          sendNow: true,
          idempotencyKey: crypto.randomUUID(),
          portalAudience: true,
        },
        { timeout: 30_000 },
      );
      setDraft("");
      await Promise.all([
        loadConversation(conversation.id, { silent: true }),
        loadConversations({ silent: true }),
      ]);
    } catch (reason) {
      setError(reason.response?.data?.message || "Your reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function sendFirstMessage(event) {
    event.preventDefault();
    const bodyText = draft.trim();
    if (!bodyText || sending || permissions.canUseChat === false || !portalReady) return;
    setSending(true);
    setError("");
    try {
      const response = await api.post(
        "/communications/messages",
        {
          clientId,
          caseId: targetCaseId || undefined,
          channel: "Chat",
          direction: "Outbound",
          recipients: [],
          subject: targetCaseId ? "Client portal messages" : "General client inquiry",
          bodyText,
          occurredAt: new Date().toISOString(),
          sendNow: true,
          idempotencyKey: crypto.randomUUID(),
          portalAudience: true,
        },
        { timeout: 30_000 },
      );
      const nextConversationId = response.data.data.conversationId;
      setDraft("");
      setComposing(false);
      await loadConversations({ silent: true });
      setSelectedId(nextConversationId);
    } catch (reason) {
      setError(reason.response?.data?.message || "The portal message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[460] flex justify-end bg-slate-950/25 backdrop-blur-sm">
        <motion.button
          type="button"
          aria-label="Close portal chats"
          className="absolute inset-0 cursor-default"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.aside
          initial={{ x: "100%", opacity: 0.7 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0.7 }}
          transition={{ type: "spring", stiffness: 360, damping: 38 }}
          className="relative flex h-[100dvh] w-full max-w-[580px] flex-col overflow-hidden border-l border-white/70 bg-[#efeae2] shadow-[-28px_0_90px_rgba(15,23,42,0.24)]"
        >
          {composing ? (
            <>
              <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/95 px-3 backdrop-blur-xl">
                <button type="button" onClick={() => { setComposing(false); setDraft(""); setError(""); }} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="Back to chats">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white">{initials(clientName)}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-slate-950">{clientName}</h2>
                  <select value={targetCaseId} onChange={(event) => setTargetCaseId(event.target.value)} aria-label="Choose portal conversation" className="mt-0.5 block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-xs text-emerald-700 outline-none">
                    <option value="">General inquiry</option>
                    {cases.map((item) => <option key={item.id} value={item.id}>{item.caseType || "Client case"}</option>)}
                  </select>
                </div>
                <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="Close chat"><X className="h-5 w-5" /></button>
              </header>
              <main className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.38)_0_1px,transparent_1.5px)] bg-[length:18px_18px] px-6 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/85 text-emerald-600 shadow-sm"><MessageCircle className="h-6 w-6" /></span>
                <h3 className="mt-4 text-sm font-semibold text-slate-800">Start a portal conversation</h3>
                <p className="mt-1.5 max-w-xs text-xs leading-5 text-slate-500">Messages are private between your team and {clientName}. Choose the topic above and write below.</p>
              </main>
              <footer className="shrink-0 border-t border-white/60 bg-white/90 px-3 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-xl">
                {error ? <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
                {!portalReady ? (
                  <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <p>{portalNotice}</p>
                    {canManagePortal && onManagePortalAccess ? <button type="button" onClick={managePortal} className="mt-2 font-semibold text-amber-950 underline decoration-amber-300 underline-offset-4">Manage portal access</button> : null}
                  </div>
                ) : permissions.canUseChat === false ? (
                  <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Your administrator has disabled chat replies for your account.</p>
                ) : (
                  <form onSubmit={sendFirstMessage} className="flex items-end gap-2">
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendFirstMessage(event);
                        }
                      }}
                      onInput={(event) => {
                        event.currentTarget.style.height = "auto";
                        event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 128)}px`;
                      }}
                      rows={1}
                      maxLength={5000}
                      placeholder="Type a message"
                      className="max-h-32 min-h-[46px] flex-1 resize-none rounded-3xl border border-slate-200 bg-white px-4 py-3 text-base leading-5 text-slate-900 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                    />
                    <button type="submit" disabled={!draft.trim() || sending} className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_10px_24px_rgba(5,150,105,0.28)] transition hover:bg-emerald-700 active:scale-90 disabled:opacity-40" aria-label="Send first portal message">
                      {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
                    </button>
                  </form>
                )}
              </footer>
            </>
          ) : selectedId ? (
            <>
              <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/95 px-3 backdrop-blur-xl">
                <button type="button" onClick={() => { setSelectedId(""); setConversation(null); }} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="Back to chats">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white">
                  {initials(clientName)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-slate-950">{clientName || conversation?.client?.fullName || "Client"}</h2>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{conversation?.case?.caseType || "General portal chat"} · Secure messaging</p>
                </div>
                <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="Close chat">
                  <X className="h-5 w-5" />
                </button>
              </header>

              <main ref={scrollRef} className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.38)_0_1px,transparent_1.5px)] bg-[length:18px_18px] px-4 py-5">
                {threadLoading ? (
                  <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                ) : !messages.length ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-emerald-600 shadow-sm"><MessageCircle className="h-6 w-6" /></span>
                    <h3 className="mt-4 text-sm font-semibold text-slate-800">No messages in this chat</h3>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groups.map((group) => (
                      <section key={group.label} className="space-y-2">
                        <div className="flex justify-center"><span className="rounded-lg bg-white/80 px-3 py-1 text-[10px] font-semibold text-slate-500 shadow-sm">{group.label}</span></div>
                        {group.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                      </section>
                    ))}
                  </div>
                )}
              </main>

              <footer className="shrink-0 border-t border-white/60 bg-white/90 px-3 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-xl">
                {error ? <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
                {!portalReady ? (
                  <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <p>{portalNotice}</p>
                    {canManagePortal && onManagePortalAccess ? <button type="button" onClick={managePortal} className="mt-2 font-semibold text-amber-950 underline decoration-amber-300 underline-offset-4">Manage portal access</button> : null}
                  </div>
                ) : permissions.canUseChat === false ? (
                  <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Your administrator has disabled chat replies for your account.</p>
                ) : (
                  <form onSubmit={send} className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          send(event);
                        }
                      }}
                      onInput={(event) => {
                        event.currentTarget.style.height = "auto";
                        event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 128)}px`;
                      }}
                      rows={1}
                      maxLength={5000}
                      placeholder="Type a reply"
                      className="max-h-32 min-h-[46px] flex-1 resize-none rounded-3xl border border-slate-200 bg-white px-4 py-3 text-base leading-5 text-slate-900 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                    />
                    <button type="submit" disabled={!draft.trim() || sending} className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_10px_24px_rgba(5,150,105,0.28)] transition hover:bg-emerald-700 active:scale-90 disabled:opacity-40" aria-label="Send reply">
                      {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
                    </button>
                  </form>
                )}
              </footer>
            </>
          ) : (
            <>
              <header className="shrink-0 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><MessagesSquare className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold tracking-tight text-slate-950">Portal chats</h2>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{clientName} · Reply to secure client messages</p>
                  </div>
                  <button type="button" onClick={() => { setSelectedId(""); setConversation(null); setDraft(""); setError(""); setComposing(true); }} disabled={permissions.canUseChat === false || !portalReady} className="flex h-10 w-10 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-40" aria-label="New portal message" title={portalReady ? "New portal message" : "Activate portal access first"}><SquarePen className="h-5 w-5" /></button>
                  <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="Close portal chats"><X className="h-5 w-5" /></button>
                </div>
                {!loading && !portalReady ? (
                  <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50 px-3.5 py-3 text-amber-900">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-5">{portalNotice}</p>
                      {canManagePortal && onManagePortalAccess ? <button type="button" onClick={managePortal} className="mt-1 text-xs font-semibold underline decoration-amber-300 underline-offset-4">Set up portal access</button> : null}
                    </div>
                  </div>
                ) : null}
                <label className="relative mt-4 block">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                </label>
              </header>
              <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto bg-white p-3">
                {loading ? (
                  <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                ) : error ? (
                  <p className="m-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
                ) : !filtered.length ? (
                  <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><MessageCircle className="h-6 w-6" /></span>
                    <h3 className="mt-4 text-sm font-semibold text-slate-800">{search ? "No matching chats" : "No portal chat yet"}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-slate-500">{search ? "Try a different search." : portalReady ? "Start a private conversation with this client in their portal." : "Activate the client portal before starting a secure conversation."}</p>
                    {!search && portalReady ? <button type="button" onClick={() => { setDraft(""); setError(""); setComposing(true); }} disabled={permissions.canUseChat === false} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(5,150,105,0.2)] transition hover:bg-emerald-700 disabled:opacity-40"><SquarePen className="h-4 w-4" />New portal message</button> : null}
                    {!search && !portalReady && canManagePortal && onManagePortalAccess ? <button type="button" onClick={managePortal} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"><ShieldCheck className="h-4 w-4" />Set up portal access</button> : null}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filtered.map((item) => <ConversationRow key={item.id} conversation={item} active={false} onClick={() => setSelectedId(item.id)} />)}
                  </div>
                )}
              </main>
            </>
          )}
        </motion.aside>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
