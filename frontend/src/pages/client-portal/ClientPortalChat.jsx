import { ChevronLeft, CircleHelp, Loader2, MessagesSquare, SendHorizonal } from "lucide-react";
import NotificationBell from "../../components/notifications/NotificationBell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getPortalChat, sendPortalChatMessage, portalErrorMessage } from "../../api/clientPortalApi";
import { usePortalData } from "../../components/client-portal/ClientPortalLayout";

const dayLabel = (value) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
};

const timeLabel = (value) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(value));

function MessageBubble({ message }) {
  const mine = message.direction === "Inbound";
  return (
    <div className={["flex", mine ? "justify-end" : "justify-start"].join(" ")}>
      <div
        className={[
          "max-w-[80%] rounded-3xl px-4 py-2.5 shadow-sm",
          mine
            ? "rounded-br-lg bg-gradient-to-br from-sky-600 to-indigo-600 text-white"
            : "rounded-bl-lg border border-white/80 bg-white text-slate-800",
          message.pending ? "opacity-70" : "",
        ].join(" ")}
      >
        {!mine && message.senderUser?.fullName ? (
          <p className="mb-0.5 text-[11px] font-semibold text-sky-700">{message.senderUser.fullName}</p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.bodyText}</p>
        <p className={["mt-1 text-right text-[10px]", mine ? "text-sky-100/90" : "text-slate-400"].join(" ")}>
          {message.pending ? "Sending…" : timeLabel(message.occurredAt)}
        </p>
      </div>
    </div>
  );
}

export default function ClientPortalChat() {
  const { overview } = usePortalData();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);

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

  useEffect(() => {
    if (!selectedCaseId) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load({ silent: true, caseId: selectedCaseId });
    }, 10_000);
    const onVisible = () => document.visibilityState === "visible" && load({ silent: true, caseId: selectedCaseId });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [selectedCaseId, load]);

  const thread = useMemo(() => [...messages, ...pending], [messages, pending]);

  useEffect(() => {
    if (stickToBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread.length]);

  function onScroll() {
    const node = scrollRef.current;
    if (!node) return;
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  }

  async function send(event) {
    event.preventDefault();
    const bodyText = draft.trim();
    if (!bodyText || !selectedCaseId || sending) return;
    const clientMessageId = crypto.randomUUID();
    const optimistic = { id: `pending-${clientMessageId}`, direction: "Inbound", bodyText, occurredAt: new Date().toISOString(), pending: true };
    setPending((current) => [...current, optimistic]);
    setDraft("");
    setSending(true);
    stickToBottomRef.current = true;
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
  const groups = useMemo(() => {
    const byDay = [];
    thread.forEach((message) => {
      const label = dayLabel(message.occurredAt);
      const last = byDay[byDay.length - 1];
      if (last && last.label === label) last.messages.push(message);
      else byDay.push({ label, messages: [message] });
    });
    return byDay;
  }, [thread]);

  return (
    <div className="fixed inset-0 z-40 mx-auto flex h-[100dvh] w-full max-w-[520px] flex-col overflow-hidden bg-[#eef3fa]">
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

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-4">
        {loading ? (
          <div className="space-y-3 pt-4">
            {[64, 44, 72, 52].map((width, index) => (
              <div key={index} className={["h-12 animate-pulse rounded-3xl bg-white/70", index % 2 ? "ml-auto" : "", `w-[${width}%]`].join(" ")} style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : !cases.length ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><MessagesSquare className="h-6 w-6" /></div>
            <h2 className="mt-4 text-[15px] font-semibold text-slate-900">Chat isn't available yet</h2>
            <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">Once your consultant opens your application file, you can message your consultant here.</p>
          </div>
        ) : !thread.length ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-600"><MessagesSquare className="h-6 w-6" /></div>
            <h2 className="mt-4 text-[15px] font-semibold text-slate-900">Say hello</h2>
            <p className="mt-1.5 max-w-xs text-sm leading-6 text-slate-500">Send a message about your {activeCase?.caseType || "application"} — your consultant will reply right here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label} className="space-y-2.5">
                <div className="flex justify-center">
                  <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm backdrop-blur">{group.label}</span>
                </div>
                {group.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? <p className="mx-4 mb-2 shrink-0 rounded-2xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{error}</p> : null}

      <form onSubmit={send} className="shrink-0 border-t border-white/70 bg-white/90 px-3 py-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] backdrop-blur-xl">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(event);
              }
            }}
            rows={1}
            maxLength={5000}
            disabled={!cases.length}
            placeholder={cases.length ? "Type a message" : "Chat unavailable"}
            className="max-h-32 min-h-[46px] flex-1 resize-none rounded-3xl border border-slate-200 bg-white px-4 py-3 text-base leading-5 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50"
            style={{ height: "auto" }}
            onInput={(event) => {
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 128)}px`;
            }}
          />
          <button
            type="submit"
            disabled={!draft.trim() || !selectedCaseId || sending}
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.35)] transition-all duration-200 active:scale-90 disabled:opacity-40"
            aria-label="Send message"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
          </button>
        </div>
      </form>
    </div>
  );
}
