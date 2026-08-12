import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Loader2, Maximize2, MessagesSquare, Search, Users, X } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useNotifications } from "../notifications/NotificationProvider";
import api from "../../services/api";
import {
  fetchInternalChatAttachmentBlob,
  fetchInternalChatThreadAvatarBlob,
  getInternalChatRealtimeConfig,
  getInternalChatThread,
  getInternalChatThreads,
  internalChatErrorMessage,
  markInternalChatThreadRead,
  sendInternalChatMessage,
  uploadInternalChatAttachment,
} from "../../api/internalChatApi";
import ChatThread from "./ChatThread";
import ChatComposer from "./ChatComposer";
import ChatImageLightbox from "./ChatImageLightbox";
import { useCaseRealtimeChat } from "../../hooks/useCaseRealtimeChat";
import { useChatAttachmentUrls } from "../../hooks/useChatAttachmentUrls";
import { useThreadAvatarUrls } from "../../hooks/useThreadAvatarUrls";
import { playReceivedSound, playSentSound } from "../../utils/chatSounds";

const RECONCILE_POLL_MS = 45_000;
const FALLBACK_POLL_MS = 10_000;
const AMBIENT_LIST_POLL_MS = 20_000; // keeps the badge/preview live even while the widget is collapsed

const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function QuickAvatar({ item, avatarUrl, className = "h-9 w-9 text-[11px]" }) {
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
        <Users className="h-3.5 w-3.5" />
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

function QuickRow({ item, active, avatarUrl, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-left transition ${active ? "bg-sky-50" : "hover:bg-slate-50"}`}
    >
      <QuickAvatar item={item} avatarUrl={avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-950">{item.name}</span>
        <span className="block truncate text-[11px] text-slate-500">{item.preview || "Say hello"}</span>
      </span>
      {item.unreadCount ? (
        <span className="inline-flex min-w-4.5 shrink-0 justify-center rounded-full bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white">{item.unreadCount}</span>
      ) : null}
    </button>
  );
}

// A floating launcher, always in reach from any internal page, for the
// single most common chat action: reply to whoever you were just talking
// to. Opening it lands on the list of recent conversations — never jumps
// straight into one — so switching who you're replying to costs nothing.
// While collapsed it still watches for new messages: the badge updates,
// a sound plays, and a preview bubble surfaces the sender + snippet
// without requiring the widget to be opened at all. Anything beyond quick
// send/receive (reply-to, react, edit, delete, filters) stays on the full
// Chats page, one tap away via the expand icon.
export default function FloatingChatWidget() {
  const location = useLocation();
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const myUserId = appUser?.id;
  const reduceMotion = useReducedMotion();
  const { sidebarCounts, acknowledgeDestination } = useNotifications();
  const isChatsRoute = location.pathname === "/app/chats"; // the full page already polls/plays sound itself

  const [open, setOpen] = useState(false);
  const [view, setView] = useState("list");
  const [internalThreads, setInternalThreads] = useState([]);
  const [clientConversations, setClientConversations] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [selectedKind, setSelectedKind] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [activeDetail, setActiveDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [realtime, setRealtime] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [incomingPreview, setIncomingPreview] = useState(null);
  const previewTimerRef = useRef(null);

  const loadLists = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setListLoading(true);
    const [internalResult, clientResult] = await Promise.allSettled([
      getInternalChatThreads(),
      api.get("/communications/inbox?scope=all&channel=Chat&limit=50").then((response) => response.data.data),
    ]);
    if (internalResult.status === "fulfilled") setInternalThreads(internalResult.value);
    if (clientResult.status === "fulfilled") setClientConversations(clientResult.value);
    if (!silent) setListLoading(false);
  }, []);

  // Opening still forces an immediate (non-silent) refresh for a crisp
  // loading state, but the list is otherwise kept warm at all times below —
  // that's what lets the badge/sound/preview work while collapsed.
  useEffect(() => {
    if (!open) return;
    void loadLists();
  }, [open, loadLists]);

  useEffect(() => {
    if (isChatsRoute) return undefined;
    void loadLists({ silent: true });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadLists({ silent: true });
    }, AMBIENT_LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [isChatsRoute, loadLists]);

  const mergedItems = useMemo(() => {
    const internal = internalThreads.map((item) => ({
      kind: "internal",
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
        id: conversation.id,
        name: `${conversation.client?.fullName || "Client"}${conversation.case?.caseType ? ` · ${conversation.case.caseType}` : ""}`,
        isGroup: false,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: conversation.unreadCount || 0,
        preview: latest ? (latest.direction === "Outbound" ? "You: " : "") + (latest.bodyText || "Sent an attachment") : "",
      };
    });
    return [...internal, ...client].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }, [internalThreads, clientConversations]);

  const filteredItems = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    if (!query) return mergedItems;
    return mergedItems.filter((item) => `${item.name} ${item.preview}`.toLowerCase().includes(query));
  }, [mergedItems, listSearch]);

  // Ambient new-message detection — runs whether the widget is open or
  // collapsed. Compares each conversation's unread count against what was
  // last seen; a rise means something new landed. The first pass after
  // mount only records a baseline (otherwise every already-unread
  // conversation would "arrive" the moment the page loads). The
  // conversation currently open in thread view is excluded so this never
  // double-fires the sound the per-thread effect below already plays.
  const knownUnreadRef = useRef(new Map());
  const initializedUnreadRef = useRef(false);
  useEffect(() => {
    if (!mergedItems.length) return;
    const known = knownUnreadRef.current;
    if (!initializedUnreadRef.current) {
      mergedItems.forEach((item) => known.set(`${item.kind}:${item.id}`, item.unreadCount));
      initializedUnreadRef.current = true;
      return;
    }
    let newest = null;
    for (const item of mergedItems) {
      const key = `${item.kind}:${item.id}`;
      const previousCount = known.get(key) ?? 0;
      const isActivelyOpen = open && view === "thread" && selectedKind === item.kind && selectedId === item.id;
      if (item.unreadCount > previousCount && !isActivelyOpen) {
        if (!newest || new Date(item.lastMessageAt) > new Date(newest.lastMessageAt)) newest = item;
      }
      known.set(key, item.unreadCount);
    }
    if (newest) {
      playReceivedSound();
      if (!open) {
        setIncomingPreview(newest);
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        previewTimerRef.current = window.setTimeout(() => setIncomingPreview(null), 6000);
      }
    }
  }, [mergedItems, open, view, selectedKind, selectedId]);

  useEffect(() => () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); }, []);

  function openFromPreview() {
    if (!incomingPreview) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    setIncomingPreview(null);
    setOpen(true);
    selectConversation(incomingPreview);
  }

  const fetchDetailOnce = useCallback(async (kind, id) => {
    if (kind === "internal") {
      const data = await getInternalChatThread(id);
      return { kind: "internal", id, name: data.name, isGroup: data.isGroup, hasAvatar: data.hasAvatar, participants: data.participants, messages: data.messages, caseId: null };
    }
    const response = await api.get(`/communications/conversations/${id}?limit=100`);
    const data = response.data.data;
    if (data.unreadCount) await api.post(`/communications/conversations/${id}/read`, { read: true });
    return {
      kind: "client",
      id,
      name: `${data.client?.fullName || "Client"}${data.case?.caseType ? ` · ${data.case.caseType}` : ""}`,
      isGroup: false,
      caseId: data.caseId || null,
      clientId: data.clientId,
      messages: data.messages,
      clientLastReadAt: data.clientLastReadAt,
    };
  }, []);

  const loadDetail = useCallback(async (kind, id, { silent = false } = {}) => {
    if (!id) return;
    if (!silent) setDetailLoading(true);
    try {
      let normalized;
      try {
        normalized = await fetchDetailOnce(kind, id);
      } catch (firstError) {
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

  useEffect(() => {
    if (selectedId) void loadDetail(selectedKind, selectedId);
  }, [selectedKind, selectedId, loadDetail]);

  const fetchRealtimeConfig = useCallback(() => {
    if (!open || !selectedId) return Promise.resolve({ configured: false });
    if (selectedKind === "internal") return getInternalChatRealtimeConfig(selectedId);
    if (activeDetail?.kind === "client" && activeDetail.id === selectedId && activeDetail.caseId) {
      return api.get(`/communications/realtime/case/${activeDetail.caseId}`).then((response) => response.data.data);
    }
    return Promise.resolve({ configured: false });
  }, [open, selectedKind, selectedId, activeDetail]);

  useEffect(() => {
    fetchRealtimeConfig().then(setRealtime).catch(() => setRealtime(null));
  }, [fetchRealtimeConfig]);

  useCaseRealtimeChat({
    fetchConfig: fetchRealtimeConfig,
    enabled: Boolean(open && realtime?.configured),
    onMessage: () => {
      if (selectedId) void loadDetail(selectedKind, selectedId, { silent: true });
      void loadLists({ silent: true });
    },
  });

  useEffect(() => {
    if (!open || !selectedId) return undefined;
    const intervalMs = realtime?.configured ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDetail(selectedKind, selectedId, { silent: true });
        void loadLists({ silent: true });
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [open, selectedKind, selectedId, realtime?.configured, loadDetail, loadLists]);

  useEffect(() => {
    if (!open || !selectedId || document.visibilityState !== "visible") return;
    const markRead = selectedKind === "internal"
      ? () => markInternalChatThreadRead(selectedId)
      : () => api.post(`/communications/conversations/${selectedId}/read`, { read: true }).catch(() => {});
    markRead().then(() => {
      void loadLists({ silent: true });
      void acknowledgeDestination("chats");
    });
  }, [open, selectedKind, selectedId, activeDetail?.messages?.length, loadLists, acknowledgeDestination]);

  const thread = useMemo(() => {
    if (!activeDetail) return [];
    const messages = [...(activeDetail.messages || [])].reverse();
    if (activeDetail.kind === "internal") {
      return messages.map((message) => ({ ...message, direction: message.senderId === myUserId ? "Outbound" : "Inbound" }));
    }
    return messages;
  }, [activeDetail, myUserId]);
  const displayMessages = useMemo(() => [...thread, ...pending], [thread, pending]);

  const seenMessageIdsRef = useRef(new Map());
  useEffect(() => {
    if (!open || !selectedId) return;
    const key = `${selectedKind}:${selectedId}`;
    const currentIds = new Set(thread.map((message) => message.id));
    const previousIds = seenMessageIdsRef.current.get(key);
    if (previousIds) {
      const hasNewInbound = thread.some((message) => message.direction === "Inbound" && !previousIds.has(message.id));
      if (hasNewInbound) playReceivedSound();
    }
    seenMessageIdsRef.current.set(key, currentIds);
  }, [open, thread, selectedKind, selectedId]);

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

  const avatarItems = useMemo(() => (activeDetail ? [...mergedItems, activeDetail] : mergedItems), [mergedItems, activeDetail]);
  const [threadAvatarUrl] = useThreadAvatarUrls(avatarItems, fetchInternalChatThreadAvatarBlob);

  async function send() {
    const bodyText = draft.trim();
    if (!bodyText || !selectedId || sending) return;
    const clientMessageId = crypto.randomUUID();
    const optimistic = { id: `pending-${clientMessageId}`, clientMessageId, senderId: myUserId, direction: "Outbound", bodyText, occurredAt: new Date().toISOString(), pending: true };
    setPending((current) => [...current, optimistic]);
    setDraft("");
    setSending(true);
    setError("");
    playSentSound();
    try {
      if (selectedKind === "internal") {
        await sendInternalChatMessage(selectedId, { bodyText, clientMessageId });
      } else {
        await api.post(
          "/communications/messages",
          {
            conversationId: selectedId,
            caseId: activeDetail?.caseId || undefined,
            parentMessageId: thread[thread.length - 1]?.id || undefined,
            channel: "Chat",
            direction: "Outbound",
            recipients: [],
            bodyText,
            occurredAt: new Date().toISOString(),
            sendNow: true,
            idempotencyKey: clientMessageId,
            portalAudience: true,
          },
          { timeout: 30_000 },
        );
      }
      await Promise.all([loadDetail(selectedKind, selectedId, { silent: true }), loadLists({ silent: true })]);
    } catch (reason) {
      setPending((current) => current.filter((item) => item.id !== optimistic.id));
      setDraft(bodyText);
      setError(internalChatErrorMessage(reason, "Your message could not be sent."));
    } finally {
      setSending(false);
    }
  }

  async function attachFile(file) {
    if (!selectedId || sending) return;
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

  function selectConversation(item) {
    setSelectedKind(item.kind);
    setSelectedId(item.id);
    setActiveDetail(null);
    setPending([]);
    setDraft("");
    setError("");
    setView("thread");
  }

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      if (next) {
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        setIncomingPreview(null);
      } else {
        setSelectedId("");
        setSelectedKind("");
        setActiveDetail(null);
        setView("list");
        setError("");
        setListSearch("");
      }
      return next;
    });
  }

  function expandToFullPage() {
    setOpen(false);
    navigate(selectedId ? `/app/chats?thread=${selectedId}&kind=${selectedKind}` : "/app/chats");
  }

  if (typeof document === "undefined" || location.pathname === "/app/chats") return null;

  const unreadTotal = sidebarCounts?.chats?.total || 0;

  return createPortal(
    <div className="fixed bottom-6 right-6 z-[400] flex flex-col items-end">
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="mb-3 flex h-[560px] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[1.75rem] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.25)]"
          >
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-100 bg-white/95 px-3 backdrop-blur-xl">
              {view === "thread" ? (
                <button type="button" onClick={() => setView("list")} aria-label="See all chats" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100">
                  <ChevronLeft className="h-4.5 w-4.5" />
                </button>
              ) : null}
              {view === "thread" && activeDetail ? (
                <>
                  <QuickAvatar item={activeDetail} avatarUrl={threadAvatarUrl(activeDetail)} />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{activeDetail.name}</p>
                </>
              ) : (
                <p className="flex-1 text-sm font-semibold text-slate-950">{view === "list" ? "Chats" : "Quick Chat"}</p>
              )}
              <button type="button" onClick={expandToFullPage} aria-label="Open in Chats" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <Maximize2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={toggleOpen} aria-label="Close quick chat" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4.5 w-4.5" />
              </button>
            </header>

            <div className="min-h-0 flex-1">
              {listLoading && !mergedItems.length ? (
                <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : !mergedItems.length ? (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600"><MessagesSquare className="h-5 w-5" /></span>
                  <p className="mt-3 text-sm font-semibold text-slate-800">No conversations yet</p>
                  <button type="button" onClick={expandToFullPage} className="mt-3 text-xs font-semibold text-sky-600 hover:underline">Start one in Chats</button>
                </div>
              ) : view === "list" ? (
                <div className="flex h-full flex-col">
                  <div className="shrink-0 px-2.5 pb-1.5 pt-2">
                    <label className="relative block">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        value={listSearch}
                        onChange={(event) => setListSearch(event.target.value)}
                        placeholder="Search chats"
                        className="h-9 w-full rounded-full border border-slate-200 bg-slate-50 pl-8 pr-3 text-[13px] outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                  </div>
                  <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-2 pt-0.5">
                    {!filteredItems.length ? (
                      <p className="px-4 py-8 text-center text-xs text-slate-500">No matching chats.</p>
                    ) : (
                      filteredItems.map((item) => (
                        <QuickRow
                          key={`${item.kind}-${item.id}`}
                          item={item}
                          active={item.kind === selectedKind && item.id === selectedId}
                          avatarUrl={threadAvatarUrl(item)}
                          onClick={() => selectConversation(item)}
                        />
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <ChatThread
                  messages={displayMessages}
                  mineDirection="Outbound"
                  loading={detailLoading}
                  className="h-full px-3 py-4"
                  mineBubbleClassName={activeDetail?.kind === "client" ? "rounded-br-lg bg-[#d9fdd3] text-slate-900" : "rounded-br-lg bg-gradient-to-br from-sky-600 to-indigo-600 text-white"}
                  theirBubbleClassName="rounded-bl-lg border border-slate-200 bg-white text-slate-800"
                  attachmentFileUrl={attachmentFileUrl}
                  onAttachmentTap={handleAttachmentTap}
                  clientLastReadAt={readThreshold}
                  senderLabelFor={activeDetail?.kind === "internal" && activeDetail.isGroup ? (message) => message.sender?.fullName : undefined}
                  mineSenderLabelFor={activeDetail?.kind === "client" ? (message) => message.senderUser?.fullName : undefined}
                  emptyState={
                    <>
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm"><MessagesSquare className="h-5 w-5" /></span>
                      <p className="mt-3 text-sm font-semibold text-slate-800">Say hello</p>
                    </>
                  }
                />
              )}
            </div>

            {view === "thread" && selectedId ? (
              <div className="shrink-0 border-t border-slate-100 bg-white p-2.5">
                {error ? <p className="mb-2 rounded-xl bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">{error}</p> : null}
                <ChatComposer
                  value={draft}
                  onChange={setDraft}
                  onSend={send}
                  onAttach={attachFile}
                  sending={sending}
                  placeholder="Type a message"
                  accentClassName={activeDetail?.kind === "client" ? "bg-emerald-600" : "bg-gradient-to-br from-sky-600 to-indigo-600"}
                />
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {incomingPreview && !open ? (
          <motion.button
            type="button"
            key={`${incomingPreview.kind}-${incomingPreview.id}`}
            onClick={openFromPreview}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.92 }}
            transition={reduceMotion ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 30 }}
            className="mb-3 flex max-w-[280px] items-center gap-2.5 rounded-2xl border border-white/70 bg-white/95 py-2.5 pl-2.5 pr-4 text-left shadow-[0_20px_50px_rgba(15,23,42,0.22)] backdrop-blur-xl transition hover:shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
          >
            <QuickAvatar item={incomingPreview} avatarUrl={threadAvatarUrl(incomingPreview)} className="h-10 w-10 text-[11px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-slate-950">{incomingPreview.name}</span>
              <span className="block truncate text-xs text-slate-500">{incomingPreview.preview || "Sent a message"}</span>
            </span>
            <span className="h-2 w-2 shrink-0 rounded-full bg-sky-600" />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={toggleOpen}
        whileTap={{ scale: 0.92 }}
        aria-label={open ? "Close quick chat" : "Open quick chat"}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-white shadow-[0_16px_40px_rgba(37,99,235,0.35)] transition hover:shadow-[0_20px_48px_rgba(37,99,235,0.45)]"
      >
        {open ? <X className="h-6 w-6" /> : <MessagesSquare className="h-6 w-6" />}
        {!open && unreadTotal ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        ) : null}
      </motion.button>
    </div>,
    document.body,
  );
}
