import { Check, ChevronLeft, Loader2, MessagesSquare, Search, SquarePen, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  createInternalChatThread,
  fetchInternalChatAttachmentBlob,
  getInternalChatRealtimeConfig,
  getInternalChatThread,
  getInternalChatThreads,
  getMyColleagues,
  internalChatErrorMessage,
  markInternalChatThreadRead,
  sendInternalChatMessage,
  uploadInternalChatAttachment,
} from "../api/internalChatApi";
import ChatThread from "../components/chat/ChatThread";
import ChatComposer from "../components/chat/ChatComposer";
import ChatImageLightbox from "../components/chat/ChatImageLightbox";
import { useCaseRealtimeChat } from "../hooks/useCaseRealtimeChat";
import { useChatAttachmentUrls } from "../hooks/useChatAttachmentUrls";

const RECONCILE_POLL_MS = 45_000; // realtime connected — safety net only
const FALLBACK_POLL_MS = 10_000; // realtime not configured
const LIST_POLL_MS = 30_000;

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

function ThreadAvatar({ thread, className = "h-11 w-11 text-xs" }) {
  if (thread?.isGroup) {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-bold text-white ${className}`}>
        <Users className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 font-bold text-white ${className}`}>
      {initials(thread?.name)}
    </span>
  );
}

function ThreadRow({ thread, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? "bg-sky-50" : "hover:bg-slate-50"}`}
    >
      <ThreadAvatar thread={thread} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{thread.name}</span>
          <span className="shrink-0 text-[10px] text-slate-400">{formatThreadTime(thread.lastMessageAt)}</span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {thread.latestMessage?.bodyText || (thread.latestMessage ? "Sent an attachment" : "Say hello")}
          </span>
          {thread.unreadCount ? (
            <span className="inline-flex min-w-5 shrink-0 justify-center rounded-full bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
              {thread.unreadCount}
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

export default function TeamChatPage() {
  const { appUser } = useAuth();
  const myUserId = appUser?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [listSearch, setListSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState(searchParams.get("thread") || "");
  const [activeThread, setActiveThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
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

  const loadThreads = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setThreadsLoading(true);
    try {
      const data = await getInternalChatThreads();
      setThreads(data);
    } catch {
      // Silent — the thread list isn't the primary surface for errors.
    } finally {
      if (!silent) setThreadsLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (threadId, { silent = false } = {}) => {
    if (!threadId) return;
    if (!silent) setThreadLoading(true);
    try {
      const data = await getInternalChatThread(threadId);
      setActiveThread(data);
      setPending((current) => current.filter((item) => !data.messages.some((message) => message.clientMessageId === item.clientMessageId)));
      setError("");
    } catch (reason) {
      if (!silent) setError(internalChatErrorMessage(reason, "This conversation could not be opened."));
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadThreads({ silent: true });
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [loadThreads]);

  useEffect(() => {
    setActiveThread(null);
    setPending([]);
    setDraft("");
    setError("");
    if (selectedThreadId) void loadThread(selectedThreadId);
  }, [selectedThreadId, loadThread]);

  useEffect(() => {
    if (!selectedThreadId) { setRealtime(null); return; }
    getInternalChatRealtimeConfig(selectedThreadId).then(setRealtime).catch(() => setRealtime(null));
  }, [selectedThreadId]);

  const fetchRealtimeConfig = useCallback(
    () => (selectedThreadId ? getInternalChatRealtimeConfig(selectedThreadId) : Promise.resolve({ configured: false })),
    [selectedThreadId],
  );
  useCaseRealtimeChat({
    fetchConfig: fetchRealtimeConfig,
    enabled: Boolean(realtime?.configured),
    onMessage: () => {
      if (selectedThreadId) void loadThread(selectedThreadId, { silent: true });
      void loadThreads({ silent: true });
    },
  });

  useEffect(() => {
    if (!selectedThreadId) return undefined;
    const intervalMs = realtime?.configured ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadThread(selectedThreadId, { silent: true });
        void loadThreads({ silent: true });
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [selectedThreadId, realtime?.configured, loadThread, loadThreads]);

  useEffect(() => {
    if (!selectedThreadId || document.visibilityState !== "visible") return;
    markInternalChatThreadRead(selectedThreadId).then(() => loadThreads({ silent: true }));
  }, [selectedThreadId, activeThread?.messages?.length, loadThreads]);

  function selectThread(threadId) {
    setSelectedThreadId(threadId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("thread", threadId);
      return next;
    }, { replace: true });
  }

  const thread = useMemo(() => {
    const messages = [...(activeThread?.messages || [])].reverse();
    return messages.map((message) => ({ ...message, direction: message.senderId === myUserId ? "Outbound" : "Inbound" }));
  }, [activeThread, myUserId]);
  const displayMessages = useMemo(() => [...thread, ...pending], [thread, pending]);

  // Blue tick only when every OTHER participant has read up to this
  // message — reusing ChatThread's single-value clientLastReadAt prop by
  // feeding it the minimum lastReadAt across everyone else (null if any
  // of them hasn't read at all yet, which ChatThread already treats as
  // "not read").
  const readThreshold = useMemo(() => {
    const others = (activeThread?.participants || []).filter((participant) => participant.id !== myUserId);
    if (!others.length || others.some((participant) => !participant.lastReadAt)) return null;
    return others.reduce((min, participant) => (!min || new Date(participant.lastReadAt) < new Date(min) ? participant.lastReadAt : min), null);
  }, [activeThread, myUserId]);

  const fetchBlob = useCallback(
    (messageId, attachmentId) => fetchInternalChatAttachmentBlob(selectedThreadId, attachmentId),
    [selectedThreadId],
  );
  const attachmentFileUrl = useChatAttachmentUrls(displayMessages, fetchBlob);

  const filteredThreads = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((item) => `${item.name} ${item.latestMessage?.bodyText || ""}`.toLowerCase().includes(query));
  }, [threads, listSearch]);

  async function send() {
    const bodyText = draft.trim();
    if (!bodyText || !selectedThreadId || sending) return;
    const clientMessageId = crypto.randomUUID();
    const optimistic = { id: `pending-${clientMessageId}`, clientMessageId, senderId: myUserId, direction: "Outbound", bodyText, occurredAt: new Date().toISOString(), pending: true };
    setPending((current) => [...current, optimistic]);
    setDraft("");
    setSending(true);
    setError("");
    try {
      await sendInternalChatMessage(selectedThreadId, { bodyText, clientMessageId });
      await Promise.all([loadThread(selectedThreadId, { silent: true }), loadThreads({ silent: true })]);
    } catch (reason) {
      setPending((current) => current.filter((item) => item.id !== optimistic.id));
      setDraft(bodyText);
      setError(internalChatErrorMessage(reason, "Your message could not be sent."));
    } finally {
      setSending(false);
    }
  }

  async function attachFile(file) {
    if (!selectedThreadId || sending) return;
    setSending(true);
    setError("");
    try {
      const clientMessageId = crypto.randomUUID();
      const created = await sendInternalChatMessage(selectedThreadId, { bodyText: "", clientMessageId, hasAttachment: true });
      await uploadInternalChatAttachment(selectedThreadId, created.id, file);
      await Promise.all([loadThread(selectedThreadId, { silent: true }), loadThreads({ silent: true })]);
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "Your file could not be sent."));
    } finally {
      setSending(false);
    }
  }

  async function handleAttachmentTap(attachment, message) {
    const isImage = (attachment.mimeType || "").startsWith("image/");
    if (isImage) {
      const url = attachmentFileUrl(attachment) || URL.createObjectURL(await fetchInternalChatAttachmentBlob(selectedThreadId, attachment.id));
      setLightbox({ attachment, url });
      return;
    }
    const blob = await fetchInternalChatAttachmentBlob(selectedThreadId, attachment.id).catch(() => null);
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
      await loadThreads({ silent: true });
      selectThread(created.id);
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "That conversation could not be started."));
    } finally {
      setCreatingThread(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      <div className="flex-shrink-0 px-6 pb-5 pt-6">
        <h1 className="text-[34px] font-semibold leading-[40px] tracking-[-0.035em] text-slate-950">Team Chat</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-500">Message any colleague in your agency directly, or start a group.</p>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden border-y border-slate-200/80 bg-white/75 shadow-[0_24px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl">
        <aside className={`flex w-full max-w-[360px] shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/40 ${selectedThreadId ? "hidden lg:flex" : "flex"}`}>
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
            {threadsLoading ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : !filteredThreads.length ? (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-50 text-sky-600"><MessagesSquare className="h-6 w-6" /></span>
                <h3 className="mt-4 text-sm font-semibold text-slate-800">{listSearch ? "No matching chats" : "No conversations yet"}</h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-500">{listSearch ? "Try a different search." : "Start a chat with a colleague."}</p>
                {!listSearch ? (
                  <button type="button" onClick={openPicker} className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(2,132,199,0.2)] transition hover:bg-sky-700">
                    <SquarePen className="h-4 w-4" />New chat
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredThreads.map((item) => (
                  <ThreadRow key={item.id} thread={item} active={item.id === selectedThreadId} onClick={() => selectThread(item.id)} />
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className={`flex min-w-0 flex-1 flex-col bg-slate-50/30 ${selectedThreadId ? "flex" : "hidden lg:flex"}`}>
          {!selectedThreadId ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm"><MessagesSquare className="h-6 w-6" /></span>
              <h2 className="mt-4 text-sm font-semibold text-slate-800">Select a conversation</h2>
              <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">Choose a chat on the left, or start a new one.</p>
            </div>
          ) : (
            <>
              <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur-xl">
                <button type="button" onClick={() => selectThread("")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 lg:hidden" aria-label="Back to chats">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <ThreadAvatar thread={activeThread} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-slate-950">{activeThread?.name}</h2>
                  {activeThread?.isGroup ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{(activeThread.participants || []).length} people</p>
                  ) : null}
                </div>
              </header>

              <ChatThread
                messages={displayMessages}
                mineDirection="Outbound"
                loading={threadLoading}
                className="min-h-0 flex-1 px-4 py-5"
                mineBubbleClassName="rounded-br-lg bg-gradient-to-br from-sky-600 to-indigo-600 text-white"
                theirBubbleClassName="rounded-bl-lg border border-slate-200 bg-white text-slate-800"
                attachmentFileUrl={attachmentFileUrl}
                onAttachmentTap={handleAttachmentTap}
                clientLastReadAt={readThreshold}
                senderLabelFor={activeThread?.isGroup ? (message) => message.sender?.fullName : undefined}
                emptyState={
                  <>
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm"><MessagesSquare className="h-6 w-6" /></span>
                    <h3 className="mt-4 text-sm font-semibold text-slate-800">Say hello</h3>
                    <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">Messages here are just between {activeThread?.isGroup ? "this group" : activeThread?.name}.</p>
                  </>
                }
              />

              {error ? <p className="mx-4 mb-2 shrink-0 rounded-2xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{error}</p> : null}

              <div className="shrink-0 border-t border-slate-200/70 bg-white/90 px-4 py-3 backdrop-blur-xl">
                <ChatComposer
                  value={draft}
                  onChange={setDraft}
                  onSend={send}
                  onAttach={attachFile}
                  sending={sending}
                  placeholder="Type a message"
                  accentClassName="bg-gradient-to-br from-sky-600 to-indigo-600"
                />
              </div>
            </>
          )}
        </section>
      </div>

      <ChatImageLightbox attachment={lightbox?.attachment} fileUrl={lightbox?.url} onClose={() => setLightbox(null)} />
      {pickerOpen ? (
        <NewChatModal colleagues={colleagues} loading={colleaguesLoading} creating={creatingThread} onClose={() => setPickerOpen(false)} onCreate={handleCreateThread} />
      ) : null}
    </section>
  );
}
