import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Search,
  ShieldCheck,
  SquarePen,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import ChatThread from "../chat/ChatThread";
import ChatComposer from "../chat/ChatComposer";
import ChatImageLightbox from "../chat/ChatImageLightbox";
import { useCaseRealtimeChat } from "../../hooks/useCaseRealtimeChat";
import { useChatAttachmentUrls } from "../../hooks/useChatAttachmentUrls";

const RECONCILE_POLL_MS = 45_000; // realtime connected — this is just a safety net
const FALLBACK_POLL_MS = 10_000; // realtime not configured (e.g. general chat)

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
  const [realtime, setRealtime] = useState(null);
  const [lightbox, setLightbox] = useState(null);

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

  // General (pre-case) chat has no realtime topic — configured stays false
  // there and this quietly falls back to polling.
  useEffect(() => {
    if (!conversation?.caseId) { setRealtime(null); return; }
    api
      .get(`/communications/realtime/case/${conversation.caseId}`)
      .then((response) => setRealtime(response.data.data))
      .catch(() => setRealtime(null));
  }, [conversation?.caseId]);

  const fetchRealtimeConfig = useCallback(() => {
    if (!conversation?.caseId) return Promise.resolve({ configured: false });
    return api.get(`/communications/realtime/case/${conversation.caseId}`).then((response) => response.data.data);
  }, [conversation?.caseId]);

  useCaseRealtimeChat({
    fetchConfig: fetchRealtimeConfig,
    enabled: Boolean(realtime?.configured),
    onMessage: () => {
      if (selectedId) void loadConversation(selectedId, { silent: true });
      void loadConversations({ silent: true });
    },
  });

  useEffect(() => {
    if (!open) return undefined;
    const intervalMs = realtime?.configured ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadConversations({ silent: true });
      if (selectedId) void loadConversation(selectedId, { silent: true });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [open, selectedId, realtime?.configured, loadConversations, loadConversation]);

  const thread = useMemo(
    () => [...(conversation?.messages || [])].reverse(),
    [conversation],
  );
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

  const fetchAttachmentBlob = useCallback(
    (messageId, attachmentId) =>
      api.get(`/communications/messages/${messageId}/attachments/${attachmentId}/file`, { responseType: "blob" }).then((response) => response.data),
    [],
  );
  const attachmentFileUrl = useChatAttachmentUrls(thread, fetchAttachmentBlob);

  function managePortal() {
    onClose?.();
    onManagePortalAccess?.();
  }

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

  async function send() {
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
          parentMessageId: thread[thread.length - 1]?.id || undefined,
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

  async function sendFirstMessage() {
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

  async function attachFile(file) {
    if (!conversation || sending || permissions.canUseChat === false || !portalReady) return;
    setSending(true);
    setError("");
    try {
      const created = await api
        .post(
          "/communications/messages",
          {
            conversationId: conversation.id,
            caseId: conversation.caseId || undefined,
            parentMessageId: thread[thread.length - 1]?.id || undefined,
            channel: "Chat",
            direction: "Outbound",
            recipients: [],
            bodyText: "",
            hasAttachment: true,
            occurredAt: new Date().toISOString(),
            sendNow: true,
            idempotencyKey: crypto.randomUUID(),
            portalAudience: true,
          },
          { timeout: 30_000 },
        )
        .then((response) => response.data.data);
      const form = new FormData();
      form.append("file", file);
      await api.post(`/communications/messages/${created.id}/attachments`, form, { timeout: 60_000 });
      await Promise.all([
        loadConversation(conversation.id, { silent: true }),
        loadConversations({ silent: true }),
      ]);
    } catch (reason) {
      setError(reason.response?.data?.message || "Your file could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function attachFirstFile(file) {
    if (sending || permissions.canUseChat === false || !portalReady) return;
    setSending(true);
    setError("");
    try {
      const created = await api
        .post(
          "/communications/messages",
          {
            clientId,
            caseId: targetCaseId || undefined,
            channel: "Chat",
            direction: "Outbound",
            recipients: [],
            subject: targetCaseId ? "Client portal messages" : "General client inquiry",
            bodyText: "",
            hasAttachment: true,
            occurredAt: new Date().toISOString(),
            sendNow: true,
            idempotencyKey: crypto.randomUUID(),
            portalAudience: true,
          },
          { timeout: 30_000 },
        )
        .then((response) => response.data.data);
      const form = new FormData();
      form.append("file", file);
      await api.post(`/communications/messages/${created.id}/attachments`, form, { timeout: 60_000 });
      setComposing(false);
      await loadConversations({ silent: true });
      setSelectedId(created.conversationId);
    } catch (reason) {
      setError(reason.response?.data?.message || "Your file could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function handleAttachmentTap(attachment, message) {
    const isImage = (attachment.mimeType || "").startsWith("image/");
    if (isImage) {
      const url = attachmentFileUrl(attachment) || URL.createObjectURL(await fetchAttachmentBlob(message.id, attachment.id));
      setLightbox({ attachment, url });
      return;
    }
    const blob = await fetchAttachmentBlob(message.id, attachment.id).catch(() => null);
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
                  <ChatComposer
                    value={draft}
                    onChange={setDraft}
                    onSend={sendFirstMessage}
                    onAttach={attachFirstFile}
                    sending={sending}
                    placeholder="Type a message"
                    accentClassName="bg-emerald-600"
                  />
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

              <ChatThread
                messages={thread}
                mineDirection="Outbound"
                loading={threadLoading}
                className="min-h-0 flex-1 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.38)_0_1px,transparent_1.5px)] bg-[length:18px_18px] px-4 py-5"
                mineBubbleClassName="rounded-br-lg bg-[#d9fdd3] text-slate-900"
                theirBubbleClassName="rounded-bl-lg bg-white text-slate-800"
                attachmentFileUrl={attachmentFileUrl}
                onAttachmentTap={handleAttachmentTap}
                clientLastReadAt={conversation?.clientLastReadAt}
                mineSenderLabelFor={(message) => message.senderUser?.fullName}
                emptyState={
                  <>
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-emerald-600 shadow-sm"><MessageCircle className="h-6 w-6" /></span>
                    <h3 className="mt-4 text-sm font-semibold text-slate-800">No messages in this chat</h3>
                  </>
                }
              />

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
                  <ChatComposer
                    value={draft}
                    onChange={setDraft}
                    onSend={send}
                    onAttach={attachFile}
                    sending={sending}
                    placeholder="Type a reply"
                    accentClassName="bg-emerald-600"
                  />
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
