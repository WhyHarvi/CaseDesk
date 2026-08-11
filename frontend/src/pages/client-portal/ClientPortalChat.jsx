import { ChevronLeft, CircleHelp, MessagesSquare } from "lucide-react";
import NotificationBell from "../../components/notifications/NotificationBell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchPortalChatAttachmentBlob,
  getPortalChat,
  getPortalChatRealtimeConfig,
  markPortalChatRead,
  portalErrorMessage,
  sendPortalChatMessage,
  uploadPortalChatAttachment,
} from "../../api/clientPortalApi";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";
import ChatThread from "../../components/chat/ChatThread";
import ChatComposer from "../../components/chat/ChatComposer";
import ChatImageLightbox from "../../components/chat/ChatImageLightbox";
import { useCaseRealtimeChat } from "../../hooks/useCaseRealtimeChat";
import { useChatAttachmentUrls } from "../../hooks/useChatAttachmentUrls";

const RECONCILE_POLL_MS = 45_000; // realtime connected — this is just a safety net
const FALLBACK_POLL_MS = 10_000; // realtime not configured for this conversation

export default function ClientPortalChat() {
  const { overview } = usePortalData();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]);
  const [realtime, setRealtime] = useState(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);

  const load = useCallback(async ({ silent = false, caseId = "" } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await getPortalChat(caseId);
      setCases(data.cases || []);
      setSelectedCaseId(data.selectedCaseId || "");
      setMessages(data.messages || []);
      setPending((current) => current.filter((item) => !(data.messages || []).some((message) => message.bodyText === item.bodyText)));
      setError("");
    } catch (reason) {
      if (!silent) setError(portalErrorMessage(reason, "Your messages could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // General (pre-case) chat has no realtime topic — configured stays false
  // there and this quietly falls back to polling, same as before realtime
  // existed at all.
  useEffect(() => {
    if (!selectedCaseId) { setRealtime(null); return; }
    getPortalChatRealtimeConfig(selectedCaseId).then(setRealtime).catch(() => setRealtime(null));
  }, [selectedCaseId]);

  const fetchRealtimeConfig = useCallback(() => getPortalChatRealtimeConfig(selectedCaseId), [selectedCaseId]);
  useCaseRealtimeChat({
    fetchConfig: fetchRealtimeConfig,
    enabled: Boolean(realtime?.configured),
    onMessage: () => load({ silent: true, caseId: selectedCaseId }),
  });

  useEffect(() => {
    if (!selectedCaseId) return undefined;
    const intervalMs = realtime?.configured ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load({ silent: true, caseId: selectedCaseId });
    }, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && load({ silent: true, caseId: selectedCaseId });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [selectedCaseId, realtime?.configured, load]);

  // Tell the backend this thread was seen whenever it's open and focused —
  // it's what lets staff see a "read" receipt on their side.
  useEffect(() => {
    if (!selectedCaseId || document.visibilityState !== "visible") return;
    markPortalChatRead(selectedCaseId);
  }, [selectedCaseId, messages.length]);

  const thread = useMemo(() => [...messages, ...pending], [messages, pending]);

  const fetchBlob = useCallback((messageId, attachmentId) => fetchPortalChatAttachmentBlob(messageId, attachmentId), []);
  const attachmentFileUrl = useChatAttachmentUrls(thread, fetchBlob);

  async function sendText(bodyText) {
    const clientMessageId = crypto.randomUUID();
    const optimistic = { id: `pending-${clientMessageId}`, direction: "Inbound", bodyText, occurredAt: new Date().toISOString(), pending: true };
    setPending((current) => [...current, optimistic]);
    setSending(true);
    try {
      await sendPortalChatMessage({ caseId: selectedCaseId, bodyText, clientMessageId });
      await load({ silent: true, caseId: selectedCaseId });
    } catch (reason) {
      setPending((current) => current.filter((item) => item.id !== optimistic.id));
      setDraft(bodyText);
      setError(portalErrorMessage(reason, "Your message could not be sent. Please try again."));
    } finally {
      setSending(false);
    }
  }

  async function send() {
    const bodyText = draft.trim();
    if (!bodyText || !selectedCaseId || sending) return;
    setDraft("");
    await sendText(bodyText);
  }

  async function attachFile(file) {
    if (!selectedCaseId || sending) return;
    setSending(true);
    setError("");
    try {
      const clientMessageId = crypto.randomUUID();
      const created = await sendPortalChatMessage({ caseId: selectedCaseId, bodyText: "", clientMessageId, hasAttachment: true });
      await uploadPortalChatAttachment(created.id, file);
      await load({ silent: true, caseId: selectedCaseId });
    } catch (reason) {
      setError(portalErrorMessage(reason, "Your file could not be sent. Please try again."));
    } finally {
      setSending(false);
    }
  }

  async function handleAttachmentTap(attachment, message) {
    const isImage = (attachment.mimeType || "").startsWith("image/");
    if (isImage) {
      const url = attachmentFileUrl(attachment) || URL.createObjectURL(await fetchPortalChatAttachmentBlob(message.id, attachment.id));
      setLightbox({ attachment, url });
      return;
    }
    const blob = await fetchPortalChatAttachmentBlob(message.id, attachment.id).catch(() => null);
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

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  const activeCase = cases.find((item) => item.id === selectedCaseId);

  return (
    <div className="fixed inset-0 z-40 mx-auto flex h-[100dvh] w-full max-w-[520px] flex-col overflow-hidden bg-[#eef3fa] lg:static lg:z-auto lg:h-[calc(100dvh-4rem)] lg:max-w-none lg:rounded-[1.75rem] lg:border lg:border-white/70 lg:shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-white/70 bg-white/85 px-3 py-3 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur-xl">
        <button type="button" onClick={() => navigate("/client-portal")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 active:scale-95" aria-label="Back to home">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-white">
          {(overview?.case?.consultantName || overview?.agency?.name || "CD").split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-5 text-slate-950">
            {overview?.case?.consultantName || overview?.agency?.name || "Your consultant"}
          </h1>
          {cases.length > 1 ? (
            <select
              value={selectedCaseId}
              onChange={(event) => load({ caseId: event.target.value })}
              className="mt-0.5 w-full max-w-[220px] truncate rounded-lg border-0 bg-transparent p-0 text-base text-slate-500 outline-none"
              aria-label="Switch application"
            >
              {cases.map((item) => <option key={item.id} value={item.id}>{item.caseType}</option>)}
            </select>
          ) : (
            <p className="truncate text-xs text-slate-500">{activeCase?.caseType || "Secure CaseDesk chat"}</p>
          )}
        </div>
        <NotificationBell variant="chat" />
        <Link to="/client-portal/help" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 active:scale-95" aria-label="Help and contact">
          <CircleHelp className="h-5 w-5" />
        </Link>
      </header>

      <ChatThread
        messages={thread}
        mineDirection="Inbound"
        loading={loading}
        className="min-h-0 flex-1 overscroll-contain px-4 pb-5 pt-4"
        mineBubbleClassName="rounded-br-lg bg-gradient-to-br from-sky-600 to-indigo-600 text-white"
        theirBubbleClassName="rounded-bl-lg border border-white/80 bg-white text-slate-800"
        attachmentFileUrl={attachmentFileUrl}
        onAttachmentTap={handleAttachmentTap}
        onRetryMessage={() => {}}
        senderLabelFor={(message) => message.senderUser?.fullName}
        emptyState={
          !cases.length ? (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><MessagesSquare className="h-6 w-6" /></div>
              <h2 className="mt-4 text-[15px] font-semibold text-slate-900">Chat isn't available yet</h2>
              <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">Once your consultant opens your application file, you can message your consultant here.</p>
            </>
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-600"><MessagesSquare className="h-6 w-6" /></div>
              <h2 className="mt-4 text-[15px] font-semibold text-slate-900">Say hello</h2>
              <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">
                {activeCase?.isGeneral
                  ? "Send a secure message to your agency — your team will reply right here."
                  : `Send a message about your ${activeCase?.caseType || "application"} — your consultant will reply right here.`}
              </p>
            </>
          )
        }
      />

      {error ? <p className="mx-4 mb-2 shrink-0 rounded-2xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{error}</p> : null}

      <div className="shrink-0 border-t border-white/70 bg-white/90 px-3 py-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] backdrop-blur-xl">
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={send}
          onAttach={attachFile}
          sending={sending}
          disabled={!cases.length}
          disabledReason="Chat unavailable"
          placeholder="Type a message"
          accentClassName="bg-gradient-to-br from-sky-600 to-indigo-600"
        />
      </div>

      <ChatImageLightbox attachment={lightbox?.attachment} fileUrl={lightbox?.url} onClose={() => setLightbox(null)} />
    </div>
  );
}
