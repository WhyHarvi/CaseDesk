import { Check, ChevronLeft, LifeBuoy, Loader2, MessagesSquare, RotateCcw, Search, SquarePen, UserRound, Users, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
import { NovaAssistantAvatar, NovaMessageContent, NovaProactiveInsight, NovaSuggestions, NovaThinkingIndicator } from "../components/chat/NovaChatPresentation";
import SupportDeskPanel from "../components/chat/SupportDeskPanel";

const RECONCILE_POLL_MS = 45_000; // realtime connected — safety net only
const FALLBACK_POLL_MS = 10_000; // realtime not configured
const LIST_POLL_MS = 30_000;

const CATEGORY_FILTERS = [
  { key: "teams", label: "Team" },
  { key: "clients", label: "Clients" },
  { key: "groups", label: "Groups" },
];

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
  const isClient = kind === "client";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        isClient ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
      }`}
    >
      {isClient ? "Client" : "Team"}
    </span>
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
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{item.name}</span>
          <span className="shrink-0 text-[10px] text-slate-400">{formatThreadTime(item.lastMessageAt)}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5">
          <KindBadge kind={item.kind} />
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

export default function ChatsPage() {
  const { appUser } = useAuth();
  const myUserId = appUser?.id;
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const initialKind = ["ai", "support", "client", "internal"].includes(requestedKind) ? requestedKind : "internal";
  const requestedThreadId = searchParams.get("thread") || "";
  const [internalThreads, setInternalThreads] = useState([]);
  const [clientConversations, setClientConversations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listSearch, setListSearch] = useState("");
  // Opens to Teams by default — unless a notification/deep-link landed us
  // directly on a client conversation, in which case that filter is active
  // so the opened item is actually visible (and highlighted) in the list.
  const [categoryFilter, setCategoryFilter] = useState(initialKind === "client" ? "clients" : "teams");
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
  const [groupProfileOpen, setGroupProfileOpen] = useState(false);
  const { messages: novaMessages, sending: novaSending, error: novaError } = useNovaChat();
  const novaContextPath = searchParams.get("from") || location.pathname;

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

  useEffect(() => {
    api.get("/communications/providers").then((response) => setCommPermissions(response.data.meta?.permissions || {})).catch(() => {});
  }, []);

  const loadLists = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setListLoading(true);
    const [internalResult, clientResult] = await Promise.allSettled([
      getInternalChatThreads(),
      api.get("/communications/inbox?scope=all&channel=Chat&limit=50").then((response) => response.data.data),
    ]);
    // Each source degrades independently — a permissions edge case on one
    // (e.g. client-chat view restricted for this user) must never blank
    // out the other.
    if (internalResult.status === "fulfilled") setInternalThreads(internalResult.value);
    if (clientResult.status === "fulfilled") setClientConversations(clientResult.value);
    if (!silent) setListLoading(false);
  }, []);

  const fetchDetailOnce = useCallback(async (kind, id) => {
    if (kind === "support") return { ...supportItem, messages: [], caseId: null };
    if (kind === "ai") {
      return { ...novaItem, messages: [...novaMessages].reverse(), caseId: null };
    }
    if (kind === "internal") {
      const data = await getInternalChatThread(id);
      return { kind: "internal", id, name: data.name, isGroup: data.isGroup, hasAvatar: data.hasAvatar, participants: data.participants, messages: data.messages, caseId: null };
    }
    const response = await api.get(`/communications/conversations/${id}?limit=200`);
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
    if (selectedId) void loadDetail(selectedKind, selectedId);
  }, [selectedKind, selectedId, loadDetail]);

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
    const intervalMs = realtime?.configured ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
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
    const markRead = selectedKind === "internal"
      ? () => markInternalChatThreadRead(selectedId)
      : () => api.post(`/communications/conversations/${selectedId}/read`, { read: true }).catch(() => {});
    markRead().then(() => loadLists({ silent: true }));
  }, [selectedKind, selectedId, activeDetail?.messages?.length, loadLists]);

  function selectThread(kind, id) {
    setSelectedKind(kind);
    setSelectedId(id);
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
        category: "clients",
        id: conversation.id,
        name: `${conversation.client?.fullName || "Client"}${conversation.case?.caseType ? ` · ${conversation.case.caseType}` : ""}`,
        isGroup: false,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: conversation.unreadCount || 0,
        preview: latest ? (latest.direction === "Outbound" ? "You: " : "") + (latest.bodyText || "Sent an attachment") : "",
      };
    });
    return [novaItem, supportItem, ...[...internal, ...client].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))];
  }, [internalThreads, clientConversations, novaItem, supportItem]);

  const filteredItems = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    return mergedItems.filter((item) => {
      if (!["ai", "support"].includes(item.kind) && categoryFilter && item.category !== categoryFilter) return false;
      if (!query) return true;
      return `${item.name} ${item.preview}`.toLowerCase().includes(query);
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
        await api.post(
          "/communications/messages",
          {
            conversationId: selectedId,
            caseId: activeDetail?.caseId || undefined,
            parentMessageId: replyToId || thread[thread.length - 1]?.id || undefined,
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

  function openPicker() {
    setPickerOpen(true);
    if (!colleagues.length) {
      setColleaguesLoading(true);
      getMyColleagues().then(setColleagues).catch(() => {}).finally(() => setColleaguesLoading(false));
    }
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

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      <div className="flex-shrink-0 px-6 pb-5 pt-7">
        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="text-[34px] font-semibold leading-[40px] tracking-[-0.035em] text-slate-950"
        >
          Chats
        </motion.h1>
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : 0.04, ease: [0.16, 1, 0.3, 1] }}
          className="mt-1 text-[13px] font-medium text-slate-500"
        >
          Team, clients, and groups — switch between them below.
        </motion.p>
        <div className="mt-4 inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100 p-1">
          {CATEGORY_FILTERS.map((filter) => {
            const active = categoryFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setCategoryFilter(filter.key)}
                aria-pressed={active}
                className="relative rounded-full px-4 py-1.5 text-[13px] font-semibold"
              >
                {active ? (
                  <motion.span
                    layoutId="chats-category-pill"
                    className="absolute inset-0 rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 shadow-[0_6px_16px_rgba(37,99,235,0.35)]"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }}
                  />
                ) : null}
                <span className={`relative z-10 transition-colors ${active ? "text-white" : "text-slate-600 hover:text-slate-900"}`}>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden border-y border-slate-200/80 bg-white/75 shadow-[0_24px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <aside className={`flex w-full max-w-[360px] shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/40 ${selectedId ? "hidden lg:flex" : "flex"}`}>
          <header className="shrink-0 border-b border-slate-200/70 px-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Conversations</p>
              <button type="button" onClick={openPicker} className="flex h-9 w-9 items-center justify-center rounded-full text-sky-600 transition hover:bg-sky-50" aria-label="New chat">
                <SquarePen className="h-4.5 w-4.5" />
              </button>
            </div>
            <label className="relative mt-3 block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder="Search chats"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              />
            </label>
          </header>
          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-2">
            {listLoading ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : !filteredItems.length ? (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-600"><MessagesSquare className="h-6 w-6" /></span>
                <h3 className="mt-4 text-sm font-semibold text-slate-800">
                  {listSearch ? "No matching chats" : `No ${categoryFilter} yet`}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-500">
                  {listSearch ? "Try a different search." : categoryFilter === "clients" ? "Client conversations will show up here." : "Start a chat with a colleague."}
                </p>
                {!listSearch && categoryFilter !== "clients" ? (
                  <button type="button" onClick={openPicker} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(2,132,199,0.2)] transition hover:bg-sky-700">
                    <SquarePen className="h-4 w-4" />New chat
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
                      {activeDetail?.kind === "client" ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500">Client · Secure messaging</p>
                      ) : null}
                    </div>
                    {activeDetail?.kind === "client" && activeDetail.clientId ? (
                      <Link
                        to={`/app/clients/${encodeURIComponent(activeDetail.clientId)}`}
                        aria-label={`Open ${activeDetail.name}'s client profile`}
                        title="Open client profile"
                        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition hover:border-emerald-200 hover:bg-emerald-100"
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
                  <ChatThread
                messages={displayMessages}
                mineDirection="Outbound"
                loading={detailLoading}
                className="min-h-0 flex-1 px-4 py-5"
                mineBubbleClassName={activeDetail?.kind === "ai" ? "rounded-br-lg bg-gradient-to-br from-slate-800 to-slate-950 text-white" : activeDetail?.kind === "client" ? "rounded-br-lg bg-[#d9fdd3] text-slate-900" : "rounded-br-lg bg-gradient-to-br from-sky-600 to-indigo-600 text-white"}
                theirBubbleClassName={activeDetail?.kind === "ai" ? "rounded-bl-lg border border-brand-100 bg-white/95 text-slate-800 shadow-[0_8px_24px_rgba(73,104,149,0.12)]" : "rounded-bl-lg border border-slate-200 bg-white text-slate-800"}
                attachmentFileUrl={attachmentFileUrl}
                onAttachmentTap={handleAttachmentTap}
                clientLastReadAt={readThreshold}
                senderLabelFor={activeDetail?.kind === "internal" && activeDetail.isGroup ? (message) => message.sender?.fullName : undefined}
                mineSenderLabelFor={activeDetail?.kind === "client" ? (message) => message.senderUser?.fullName : undefined}
                myUserId={myUserId}
                onReply={activeDetail?.kind === "ai" ? undefined : startReply}
                onToggleReaction={activeDetail?.kind === "ai" ? undefined : toggleReaction}
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
                ) : undefined}
                onRetryMessage={activeDetail?.kind === "ai" ? retryNova : undefined}
                emptyState={
                  <>
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm"><MessagesSquare className="h-6 w-6" /></span>
                    <h3 className="mt-4 text-sm font-semibold text-slate-800">Say hello</h3>
                    <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">Messages here are just between you and {activeDetail?.name}.</p>
                  </>
                }
              />

              {(activeDetail?.kind === "ai" ? novaError : error) ? <p className="mx-4 mb-2 shrink-0 rounded-2xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{activeDetail?.kind === "ai" ? novaError : error}</p> : null}

              <div className="shrink-0 border-t border-slate-200/70 bg-white/90 px-4 py-3 backdrop-blur-xl">
                {activeDetail?.kind === "ai" && novaMessages.length === 1 ? <NovaProactiveInsight currentPath={novaContextPath} /> : null}
                {activeDetail?.kind === "ai" && novaMessages.length === 1 ? <NovaSuggestions onSelect={setDraft} currentPath={novaContextPath} /> : null}
                <ChatComposer
                  value={draft}
                  onChange={setDraft}
                  onSend={send}
                  onAttach={activeDetail?.kind === "ai" ? undefined : attachFile}
                  allowAttach={activeDetail?.kind !== "ai"}
                  sending={activeDetail?.kind === "ai" ? novaSending : sending}
                  placeholder={activeDetail?.kind === "ai" ? "Ask Nova where to go" : "Type a message"}
                  accentClassName={activeDetail?.kind === "ai" ? "bg-gradient-to-br from-brand-600 to-brand-800" : activeDetail?.kind === "client" ? "bg-emerald-600" : "bg-gradient-to-br from-sky-600 to-indigo-600"}
                  sendLabel={activeDetail?.kind === "ai" ? "Ask Nova" : undefined}
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
