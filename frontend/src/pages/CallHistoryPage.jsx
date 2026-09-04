import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  History,
  Link2,
  Loader2,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Phone,
  PhoneCall,
  PhoneMissed,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../components/notifications/NotificationProvider";
import { useSoftphone } from "../components/calls/SoftphoneProvider";
import { openGlobalDialpad } from "../components/calls/GlobalDialpad";
import CallRecordingPlayer from "../components/calls/CallRecordingPlayer";
import ChatThread from "../components/chat/ChatThread";
import api from "../services/api";

const panel = "overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 backdrop-blur-xl";
const input = "h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100/70";

const humanize = (value) => String(value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const callDirectionLabel = (value) => value === "INBOUND" ? "Incoming" : value === "OUTBOUND" ? "Outgoing" : humanize(value);
const callStatusLabel = (value, direction) => {
  if (value === "COMPLETED") return "Answered";
  if (value === "ANSWERED") return "In call";
  if (value === "MISSED") return direction === "OUTBOUND" ? "No answer" : "Missed call";
  if (value === "FAILED") return "Call failed";
  return humanize(value);
};
const personName = (call) => call.client?.fullName || [call.lead?.firstName, call.lead?.lastName].filter(Boolean).join(" ") || null;
const whatsappNumber = (value) => {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (!raw.startsWith("+") && digits.length === 10) return `1${digits}`;
  return digits;
};
const when = (value) => value ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const duration = (seconds) => {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
};

function engagementSummary(call, { compact = false } = {}) {
  const engagement = call.engagement;
  if (!engagement) return { label: call.direction === "OUTBOUND" ? "Dialed by" : "Call engagement", text: call.handledBy?.fullName || call.extensionLabel || "Not recorded", title: "" };
  const names = (engagement.people || []).map((person) => person.fullName).filter(Boolean);
  const text = compact && names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ") || engagement.fallback;
  return { label: engagement.label, text, title: names.join(", ") };
}

const statusTone = {
  RINGING: "bg-sky-50 text-sky-700 ring-sky-200",
  ANSWERED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  MISSED: "bg-rose-50 text-rose-700 ring-rose-200",
  FAILED: "bg-amber-50 text-amber-700 ring-amber-200",
};

function CallStatus({ value, direction }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusTone[value] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{callStatusLabel(value, direction)}</span>;
}

function DirectionIcon({ value, className = "h-4 w-4" }) {
  return value === "OUTBOUND" ? <ArrowUpRight className={className} /> : <ArrowDownLeft className={className} />;
}

function directionTone(call) {
  if (["MISSED", "FAILED"].includes(call.status)) return "bg-rose-50 text-rose-700";
  if (call.status === "RINGING") return "bg-sky-50 text-sky-700";
  return call.direction === "OUTBOUND" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700";
}

function bundleSummary(call) {
  return call.bundle || {
    attemptCount: 1,
    attempts: [call],
    firstStartedAt: call.startedAt,
    lastStartedAt: call.startedAt,
    totalDurationSeconds: Number(call.durationSeconds || 0),
    unresolvedCount: call.resolution === "UNRESOLVED" ? 1 : 0,
    pendingFollowUpCount: call.followUp?.status === "PENDING" ? 1 : 0,
    newVoicemailCount: call.status === "MISSED" && call.recordingUrl && !call.recordingPlayedAt ? 1 : 0,
    callbackDueCount: call.direction === "INBOUND" && call.status === "MISSED" && call.callback?.status !== "CONTACTED_BACK" ? 1 : 0,
    contactedBackCount: call.direction === "INBOUND" && call.status === "MISSED" && call.callback?.status === "CONTACTED_BACK" ? 1 : 0,
    windowMinutes: 30,
  };
}

function attemptCountLabel(call) {
  const count = bundleSummary(call).attemptCount;
  return count === 1 ? "1 call" : `${count} calls`;
}

function CallAttention({ call }) {
  const bundle = bundleSummary(call);
  if (bundle.newVoicemailCount) return <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 ring-1 ring-inset ring-blue-200"><PhoneMissed className="h-3.5 w-3.5" aria-hidden="true" />{bundle.newVoicemailCount > 1 ? `${bundle.newVoicemailCount} new voicemails` : "New voicemail"}</span>;
  if (bundle.callbackDueCount) return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{bundle.callbackDueCount > 1 ? `${bundle.callbackDueCount} callbacks due` : "Callback due"}</span>;
  if (bundle.contactedBackCount) return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Contacted back</span>;
  if (bundle.unresolvedCount) return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700"><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />{bundle.unresolvedCount > 1 ? `${bundle.unresolvedCount} need matching` : "Match caller"}</span>;
  if (bundle.pendingFollowUpCount) return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Callback due</span>;
  return <span className="text-xs text-slate-400">{humanize(call.resolution)}</span>;
}

function MissedCallAttention({ call }) {
  if (call.direction !== "INBOUND" || call.status !== "MISSED") return null;
  if (call.recordingUrl && !call.recordingPlayedAt) return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">New voicemail</span>;
  if (call.callback?.status === "CONTACTED_BACK") {
    const detail = [call.callback.handledBy?.fullName, when(call.callback.contactedAt)].filter(Boolean).join(" · ");
    return <span title={detail || undefined} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Contacted back</span>;
  }
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Callback due</span>;
}

function EmptyCalls({ unresolved, provider }) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><PhoneCall className="h-6 w-6" /></div>
      <h2 className="mt-4 text-base font-semibold text-slate-900">{unresolved ? "No unresolved calls" : "No Twilio calls yet"}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{unresolved ? "Every call in this view has been matched or marked as spam." : "Place a call with the dialpad or call your connected Twilio number. New calls will appear here automatically."}</p>
    </div>
  );
}

function MobileCallCard({ call, onOpen, provider, onCall, onSms }) {
  const name = personName(call) || call.remoteNumber || "Private number";
  const detail = personName(call) ? call.remoteNumber : call.lead?.leadNumber || call.client?.clientNumber || "Not matched";
  const engagement = engagementSummary(call, { compact: true });
  const bundle = bundleSummary(call);
  return (
    // A <div> here, not a <button> — the Call button below needs to nest
    // inside the same card without landing inside another interactive
    // element, so "open this call" moves to a role="button" div instead.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
      className="block w-full cursor-pointer border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50/80 active:bg-slate-100 last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
      aria-label={`Open ${callDirectionLabel(call.direction)} call with ${name}`}
    >
      <span className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${directionTone(call)}`} aria-hidden="true"><DirectionIcon value={call.direction} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-950">{name}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{detail}</span>
              </span>
              {onCall && call.remoteNumber ? (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onCall(call.remoteNumber); }}
                  aria-label={`Call ${name}`}
                  title="Call"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              {onSms && call.remoteNumber ? (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onSms(); }}
                  aria-label={`Send SMS to ${name}`}
                  title="Send SMS"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                >
                  <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </span>
            <CallStatus value={call.status} direction={call.direction} />
          </span>
          <span className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <span><span className="block text-slate-400">Call</span><span className="mt-0.5 block font-medium text-slate-700">{callDirectionLabel(call.direction)} · {duration(call.durationSeconds)}</span></span>
            <span><span className="block text-slate-400">{engagement.label}</span><span className="mt-0.5 block truncate font-medium text-slate-700" title={engagement.title || undefined}>{engagement.text}</span></span>
          </span>
          <span className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">{when(call.startedAt)}{bundle.attemptCount > 1 ? ` · ${attemptCountLabel(call)}` : ""}</span>
            <CallAttention call={call} />
          </span>
        </span>
      </span>
    </div>
  );
}

function CallTimeline({ calls, loading, activeCallId, truncated, onSelect, onRecordingPlayed }) {
  if (loading) return <div className="space-y-3">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
  return (
    <section aria-labelledby="call-timeline-title">
      <div className="mb-5 flex items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div><h3 id="call-timeline-title" className="text-base font-semibold text-slate-950">Call history</h3><p className="mt-1 text-xs leading-5 text-slate-500">Every accessible call to or from this number, newest first.</p></div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{calls.length}{truncated ? "+" : ""} {calls.length === 1 ? "call" : "calls"}</span>
      </div>
      <ol className="relative ml-2 border-l border-blue-200">
        {calls.map((item) => {
          const engagement = engagementSummary(item, { compact: true });
          return (
            <li key={item.id} className="relative pb-5 pl-6 last:pb-0">
              <span className={`absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-4 border-slate-50 ${directionTone(item)}`} aria-hidden="true"><DirectionIcon value={item.direction} className="h-3.5 w-3.5" /></span>
              <article className={`rounded-2xl border bg-white px-4 py-3 shadow-sm ${item.id === activeCallId ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{callDirectionLabel(item.direction)}</p>{item.id === activeCallId ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">Selected</span> : null}<MissedCallAttention call={item} /></div><p className="mt-0.5 text-xs tabular-nums text-slate-500">{when(item.startedAt)}</p></div>
                  <CallStatus value={item.status} direction={item.direction} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs sm:grid-cols-3">
                  <div><p className="text-slate-400">Duration</p><p className="mt-1 font-semibold tabular-nums text-slate-700">{duration(item.durationSeconds)}</p></div>
                  <div><p className="text-slate-400">{engagement.label}</p><p className="mt-1 font-semibold text-slate-700">{engagement.text}</p></div>
                  <div><p className="text-slate-400">Outcome</p><p className="mt-1 font-semibold text-slate-700">{item.disposition ? humanize(item.disposition) : "Not recorded"}</p></div>
                </div>
                {item.outcomeNotes ? <p className="mt-3 border-l-2 border-blue-200 pl-3 text-xs leading-5 text-slate-600">{item.outcomeNotes}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.recordingUrl ? <CallRecordingPlayer callId={item.id} isVoicemail={item.status === "MISSED"} hasBeenPlayed={Boolean(item.recordingPlayedAt)} onPlayed={(recordingPlayedAt) => onRecordingPlayed(item.id, recordingPlayedAt)} /> : null}
                  {item.id !== activeCallId ? <button type="button" onClick={() => onSelect(item)} className="min-h-9 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-50">Manage this call</button> : null}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function MatchResults({ title, records, kind, busy, onLink }) {
  if (!records.length) return null;
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <div className="space-y-2">
        {records.map((record) => (
          <button key={record.id} type="button" disabled={busy} onClick={() => onLink(kind, record.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50 disabled:opacity-50">
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{record.fullName}</p><p className="mt-0.5 truncate text-xs text-slate-500">{record.leadNumber || record.clientNumber} · {record.phone || "No phone"}</p></div>
            <Link2 className="h-4 w-4 shrink-0 text-sky-600" />
          </button>
        ))}
      </div>
    </div>
  );
}

function CallDrawer({ call, staff, onClose, onChanged, onSelectCall, provider, initialMode }) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode || (call.resolution === "UNRESOLVED" ? "resolve" : "history"));
  const [contactHistory, setContactHistory] = useState(call.bundle?.attempts || [call]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [search, setSearch] = useState(call.remoteNumber || "");
  const [candidates, setCandidates] = useState({ leads: [], clients: [] });
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [smsOptions, setSmsOptions] = useState(null);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsBody, setSmsBody] = useState("");
  const [smsFromNumber, setSmsFromNumber] = useState("");
  const [smsSuccess, setSmsSuccess] = useState("");
  const [smsThread, setSmsThread] = useState({ matched: Boolean(call.clientId), client: call.client || null, conversation: null, messages: [] });
  const [smsThreadLoading, setSmsThreadLoading] = useState(false);
  const [smsSyncing, setSmsSyncing] = useState(false);
  const [smsIdempotencyKey, setSmsIdempotencyKey] = useState(() => crypto.randomUUID());
  const [leadForm, setLeadForm] = useState({ firstName: "", lastName: "", email: "", ownerUserId: call.handledBy?.id || staff[0]?.id || "", immigrationInterest: "", initialMessage: "", priority: call.status === "MISSED" ? "HIGH" : "NORMAL" });
  const [outcome, setOutcome] = useState({ outcome: call.disposition || "COMPLETED", notes: call.outcomeNotes || "", addFollowUp: false, dueAt: "", description: "Follow up after phone call", assignedUserId: call.lead?.owner?.id || call.handledBy?.id || staff[0]?.id || "" });
  const engagement = engagementSummary(call);

  const loadCandidates = useCallback(async (term = search) => {
    try {
      setCandidateLoading(true);
      setError("");
      const response = await api.get(`/call-history/${call.id}/candidates?search=${encodeURIComponent(term)}`);
      setCandidates(response.data.data || { leads: [], clients: [] });
    } catch (reason) {
      setError(reason.response?.data?.message || "Matching records could not be loaded.");
    } finally {
      setCandidateLoading(false);
    }
  }, [call.id, search]);

  useEffect(() => {
    if (mode !== "resolve") return undefined;
    const timer = window.setTimeout(() => loadCandidates(search), 250);
    return () => window.clearTimeout(timer);
  }, [mode, search, loadCandidates]);

  useEffect(() => {
    if (mode !== "sms" || smsOptions || smsLoading) return;
    let cancelled = false;
    setSmsLoading(true);
    setError("");
    api.get(`/call-history/${call.id}/sms-options`).then((response) => {
      if (cancelled) return;
      const options = response.data.data;
      setSmsOptions(options);
      setSmsFromNumber(options.defaultNumber || "");
    }).catch((reason) => {
      if (!cancelled) setError(reason.response?.data?.message || "SMS sending options could not be loaded.");
    }).finally(() => {
      if (!cancelled) setSmsLoading(false);
    });
    return () => { cancelled = true; };
  }, [mode, smsOptions, call.id]);

  const loadSmsThread = useCallback(async ({ sync = false } = {}) => {
    try {
      setSmsThreadLoading(true);
      if (sync && call.clientId) {
        setSmsSyncing(true);
        try {
          await api.post("/communications/sms/sync", {}, { timeout: 60_000 });
        } catch (reason) {
          setError(reason.response?.data?.message || "Saved CRM messages are shown, but Twilio history could not be refreshed.");
        }
      }
      const response = await api.get(`/call-history/${call.id}/sms-thread`);
      setSmsThread(response.data.data || { matched: true, client: call.client || null, conversation: null, messages: [] });
    } catch (reason) {
      setError(reason.response?.data?.message || "SMS conversation history could not be loaded.");
    } finally {
      setSmsThreadLoading(false);
      setSmsSyncing(false);
    }
  }, [call.client, call.clientId, call.id]);

  useEffect(() => {
    if (mode === "sms") void loadSmsThread({ sync: true });
  }, [mode, loadSmsThread]);

  useEffect(() => {
    if (mode !== "history") return undefined;
    let cancelled = false;
    setHistoryLoading(true);
    setError("");
    api.get(`/call-history/${call.id}/history`).then((response) => {
      if (cancelled) return;
      setContactHistory(response.data.data || [call]);
      setHistoryTruncated(Boolean(response.data.meta?.truncated));
    }).catch((reason) => {
      if (!cancelled) setError(reason.response?.data?.message || "Call history could not be loaded.");
    }).finally(() => {
      if (!cancelled) setHistoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [mode, call.id]);

  async function mutate(path, body = {}) {
    try {
      setBusy(true);
      setError("");
      await api.post(`/call-history/${call.id}/${path}`, body);
      await onChanged();
    } catch (reason) {
      setError(reason.response?.data?.message || "The call could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const link = (kind, id) => mutate(kind === "lead" ? "link-lead" : "link-client", kind === "lead" ? { leadId: id } : { clientId: id });

  async function createLead(event) {
    event.preventDefault();
    await mutate("create-lead", leadForm);
  }

  async function saveOutcome(event) {
    event.preventDefault();
    await mutate("outcome", {
      outcome: outcome.outcome,
      notes: outcome.notes,
      ...(outcome.addFollowUp ? { nextFollowUp: { dueAt: outcome.dueAt, description: outcome.description, assignedUserId: outcome.assignedUserId } } : {}),
    });
  }

  async function sendSms(event) {
    event.preventDefault();
    if (!smsBody.trim() || smsSending) return;
    try {
      setSmsSending(true);
      setError("");
      setSmsSuccess("");
      const response = await api.post(`/call-history/${call.id}/sms`, {
        body: smsBody.trim(),
        fromNumber: smsFromNumber || undefined,
        idempotencyKey: smsIdempotencyKey,
      });
      setSmsSuccess(`SMS accepted by Twilio from ${response.data.data.fromNumber || smsFromNumber}. Delivery status will update in this thread.`);
      setSmsBody("");
      setSmsIdempotencyKey(crypto.randomUUID());
      await loadSmsThread();
    } catch (reason) {
      setError(reason.response?.data?.message || "The SMS could not be sent.");
    } finally {
      setSmsSending(false);
    }
  }

  const suggestedLeads = call.matchSummary?.leads || [];
  const suggestedClients = call.matchSummary?.clients || [];
  const whatsAppPhone = whatsappNumber(call.remoteNumberNormalized || call.remoteNumber);
  const bundle = bundleSummary(call);

  function openBooking() {
    if (call.appointment?.id) {
      const date = call.appointment.startsAt ? String(call.appointment.startsAt).slice(0, 10) : "";
      navigate(`/app/calendar?appointment=${encodeURIComponent(call.appointment.id)}${date ? `&date=${encodeURIComponent(date)}` : ""}`);
      return;
    }
    const params = new URLSearchParams({ fromCall: call.id });
    if (call.client?.id) params.set("bookForClient", call.client.id);
    else if (call.lead?.id) params.set("bookForLead", call.lead.id);
    else params.set("bookFromCall", call.id);
    navigate(`/app/calendar?${params.toString()}`);
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/25 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Twilio call details">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close call details" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-white/80 bg-slate-50 shadow-2xl">
        <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${directionTone(call)}`}><DirectionIcon value={call.direction} className="h-5 w-5" /></span>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">{personName(call) || call.remoteNumber || "Unknown caller"}</h2><CallStatus value={call.status} direction={call.direction} /></div><p className="mt-1 text-sm text-slate-500">{callDirectionLabel(call.direction)} · {when(call.startedAt)}</p></div>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Number</p><p className="mt-1 truncate text-sm font-semibold text-slate-800">{call.remoteNumber || "Private"}</p></div>
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{bundle.attemptCount > 1 ? "Bundled activity" : "Duration"}</p><p className="mt-1 text-sm font-semibold text-slate-800">{bundle.attemptCount > 1 ? `${attemptCountLabel(call)} · ${duration(bundle.totalDurationSeconds)}` : duration(call.durationSeconds)}</p></div>
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{engagement.label}</p><p className="mt-1 text-sm font-semibold leading-5 text-slate-800">{engagement.text}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={openBooking} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-600 px-4 text-xs font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"><CalendarPlus className="h-4 w-4" />{call.appointment?.id ? "Open booking" : "Book appointment"}</button>
            {call.remoteNumber ? <button type="button" onClick={() => setMode("sms")} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"><MessageSquareText className="h-4 w-4" />Send SMS</button> : null}
            {whatsAppPhone ? <a href={`https://wa.me/${whatsAppPhone}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#25D366] px-4 text-xs font-semibold text-white transition hover:bg-[#1fb85a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2" aria-label={`Open WhatsApp chat with ${call.remoteNumber}`}><MessageCircle className="h-4 w-4" />WhatsApp <ExternalLink className="h-3 w-3" /></a> : null}
            {call.remoteNumber ? <a href={`tel:${call.remoteNumber}`} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"><Phone className="h-3.5 w-3.5" />Call with Twilio</a> : null}
            {call.recordingUrl ? <CallRecordingPlayer callId={call.id} isVoicemail={call.status === "MISSED"} hasBeenPlayed={Boolean(call.recordingPlayedAt)} onPlayed={() => { void onChanged(); }} /> : null}
            {call.lead ? <Link to={`/leads?lead=${encodeURIComponent(call.lead.id)}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700">Open {call.lead.leadNumber}</Link> : null}
            {call.client ? <Link to={`/app/clients/${call.client.id}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700">Open {call.client.clientNumber}</Link> : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-5 py-2 sm:px-6">
            <button type="button" onClick={() => setMode("history")} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${mode === "history" ? "bg-sky-50 text-sky-700" : "text-slate-500"}`}><History className="h-3.5 w-3.5" />Call history</button>
            <button type="button" onClick={() => setMode("resolve")} className={`rounded-full px-3.5 py-2 text-xs font-semibold ${mode === "resolve" ? "bg-sky-50 text-sky-700" : "text-slate-500"}`}>Match caller</button>
            <button type="button" onClick={() => setMode("outcome")} className={`rounded-full px-3.5 py-2 text-xs font-semibold ${mode === "outcome" ? "bg-sky-50 text-sky-700" : "text-slate-500"}`}>Record outcome</button>
            <button type="button" onClick={() => setMode("sms")} className={`rounded-full px-3.5 py-2 text-xs font-semibold ${mode === "sms" ? "bg-sky-50 text-sky-700" : "text-slate-500"}`}>Send SMS</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            {mode === "history" ? (
              <CallTimeline calls={contactHistory} loading={historyLoading} activeCallId={call.id} truncated={historyTruncated} onSelect={onSelectCall} onRecordingPlayed={(callId, recordingPlayedAt) => {
                setContactHistory((current) => current.map((item) => item.id === callId ? { ...item, recordingPlayedAt } : item));
                void onChanged();
              }} />
            ) : mode === "sms" ? (
              <form onSubmit={sendSms} className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="min-w-0 flex-1 text-base font-semibold text-slate-950">Text {personName(call) || call.remoteNumber}</h3>
                  {smsThread.conversation?.id ? (
                    <Link to={`/app/chats?kind=sms&thread=${encodeURIComponent(smsThread.conversation.id)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-sky-200 bg-white px-3.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2">
                      <MessagesSquare className="h-4 w-4" />Open in Chats
                    </Link>
                  ) : !call.clientId ? (
                    <button type="button" onClick={() => setMode("resolve")} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-sky-700 px-4 text-xs font-semibold text-white transition hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"><Link2 className="h-4 w-4" />Match caller</button>
                  ) : null}
                </div>
                {smsLoading ? <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-sky-600" />Loading sending number…</div> : null}
                {smsOptions && !smsOptions.configured ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Twilio SMS is not enabled for this workspace. An administrator can configure it in Settings.</div> : null}
                {smsOptions?.configured && !smsOptions.verified ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">An administrator must send a successful Twilio test SMS from Settings before client texts can be sent.</div> : null}
                {smsOptions?.requiresSelection ? (
                  <label className="block text-sm font-semibold text-slate-800">Send from
                    <select required value={smsFromNumber} onChange={(event) => setSmsFromNumber(event.target.value)} className={`${input} mt-2`}>
                      <option value="">Choose a calling number</option>
                      {smsOptions.numbers.map((number) => <option key={number.id} value={number.phoneNumber}>{number.label} · {number.phoneNumber}</option>)}
                    </select>
                    <span className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">No default calling number is set, so confirm which line should send this message.</span>
                  </label>
                ) : smsOptions?.defaultNumber ? (
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sending from</p><p className="mt-1 text-sm font-semibold text-slate-800">{smsOptions.defaultNumber} <span className="font-normal text-slate-500">· Default calling number</span></p></div>
                ) : smsOptions && !smsLoading ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No active calling number is available. Add a Twilio voice line in Settings before sending.</div> : null}
                <label className="block text-sm font-semibold text-slate-800">Message
                  <textarea required maxLength={1600} rows={7} value={smsBody} onChange={(event) => { setSmsBody(event.target.value); setSmsSuccess(""); }} className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-base leading-6 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder="Write your message…" />
                  <span className="mt-1.5 block text-right text-xs font-normal tabular-nums text-slate-400">{smsBody.length}/1600</span>
                </label>
                {smsSuccess ? <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{smsSuccess}</div> : null}
                <div className="flex justify-end"><button disabled={smsSending || smsLoading || !smsBody.trim() || !smsFromNumber || !smsOptions?.configured || !smsOptions?.verified} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50">{smsSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{smsSending ? "Sending…" : "Send SMS"}</button></div>
                <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100/70" aria-labelledby="sms-history-title">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                    <div><h4 id="sms-history-title" className="text-sm font-semibold text-slate-900">SMS history</h4><p className="mt-0.5 text-xs text-slate-500">Messages to and from {call.clientId ? "this client" : "this number"}</p></div>
                    <button type="button" onClick={() => loadSmsThread({ sync: true })} disabled={smsThreadLoading} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Refresh SMS history"><RefreshCw className={`h-4 w-4 ${smsSyncing || smsThreadLoading ? "animate-spin" : ""}`} />{smsSyncing ? "Syncing" : "Refresh"}</button>
                  </div>
                  <ChatThread
                    messages={smsThread.messages || []}
                    mineDirection="Outbound"
                    loading={smsThreadLoading}
                    className="min-h-64 px-4 py-4"
                    mineBubbleClassName="bg-sky-600 text-white"
                    theirBubbleClassName="border border-slate-200 bg-white text-slate-800"
                    mineSenderLabelFor={(message) => message.senderUser?.fullName}
                    showDeliveryStatus={false}
                    renderMessageBody={(message) => <><p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.bodyText}</p>{message.direction === "Outbound" ? <p className={`text-[10px] font-semibold ${message.status === "Failed" ? "text-rose-100" : "text-sky-100"}`}>{message.status}{message.failureReason ? ` · ${message.failureReason}` : ""}</p> : null}</>}
                    emptyState={<><span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm"><MessagesSquare className="h-5 w-5" /></span><h4 className="mt-3 text-sm font-semibold text-slate-800">No text messages yet</h4><p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{call.clientId ? "The first outgoing text or incoming reply will appear here and in Chats." : "Messages will appear here now and move into the CRM thread after you match this number to a client."}</p></>}
                  />
                </section>
              </form>
            ) : mode === "resolve" ? (
              <div className="space-y-6">
                {call.resolution !== "UNRESOLVED" ? <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Caller matched</p><p className="mt-0.5 text-xs">Currently linked to {personName(call) || humanize(call.resolution)}. Linking another record will replace this match.</p></div></div> : null}
                {(suggestedLeads.length || suggestedClients.length) ? <section className="space-y-4 rounded-3xl border border-sky-100 bg-sky-50/60 p-4"><div><p className="text-sm font-semibold text-sky-950">Exact phone matches</p><p className="mt-1 text-xs text-sky-700">CaseDesk found these records using the normalized caller number.</p></div><MatchResults title="Leads" records={suggestedLeads} kind="lead" busy={busy} onLink={link} /><MatchResults title="Clients" records={suggestedClients} kind="client" busy={busy} onLink={link} /></section> : null}

                <section>
                  <label className="text-sm font-semibold text-slate-800">Search existing records</label>
                  <div className="relative mt-2"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${input} pl-9`} placeholder="Name, lead number, client number, phone or email" />{candidateLoading ? <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-sky-500" /> : null}</div>
                  <div className="mt-4 space-y-5"><MatchResults title="Leads" records={candidates.leads || []} kind="lead" busy={busy} onLink={link} /><MatchResults title="Clients" records={candidates.clients || []} kind="client" busy={busy} onLink={link} />{!candidateLoading && !(candidates.leads?.length || candidates.clients?.length) ? <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-500">No matching records found.</p> : null}</div>
                </section>

                <form onSubmit={createLead} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center gap-2"><UserRoundPlus className="h-4 w-4 text-sky-600" /><h3 className="text-sm font-semibold text-slate-900">Create a lead from this caller</h3></div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">The phone number and phone source are filled automatically. A callback follow-up is created for the selected owner.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-slate-600">First name<input value={leadForm.firstName} onChange={(event) => setLeadForm((current) => ({ ...current, firstName: event.target.value }))} className={`${input} mt-1.5`} /></label>
                    <label className="text-xs font-semibold text-slate-600">Last name<input value={leadForm.lastName} onChange={(event) => setLeadForm((current) => ({ ...current, lastName: event.target.value }))} className={`${input} mt-1.5`} /></label>
                    <label className="text-xs font-semibold text-slate-600">Email<input type="email" value={leadForm.email} onChange={(event) => setLeadForm((current) => ({ ...current, email: event.target.value }))} className={`${input} mt-1.5`} /></label>
                    <label className="text-xs font-semibold text-slate-600">Owner<select required value={leadForm.ownerUserId} onChange={(event) => setLeadForm((current) => ({ ...current, ownerUserId: event.target.value }))} className={`${input} mt-1.5`}><option value="">Select owner</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Immigration interest<input value={leadForm.immigrationInterest} onChange={(event) => setLeadForm((current) => ({ ...current, immigrationInterest: event.target.value }))} className={`${input} mt-1.5`} /></label>
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Initial note<textarea rows={3} value={leadForm.initialMessage} onChange={(event) => setLeadForm((current) => ({ ...current, initialMessage: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="What did the caller ask about?" /></label>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-between gap-2">{["admin", "frontdesk"].includes(role) ? <button type="button" disabled={busy} onClick={() => mutate("spam", { notes: "Marked from the call history" })} className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"><ShieldAlert className="h-4 w-4" />Mark spam</button> : <span />}<button disabled={busy || !leadForm.ownerUserId || !call.remoteNumber} className="inline-flex h-10 items-center gap-2 rounded-full bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create and link lead</button></div>
                </form>
              </div>
            ) : (
              <form onSubmit={saveOutcome} className="space-y-5">
                <div><label className="text-sm font-semibold text-slate-800">Outcome<select value={outcome.outcome} onChange={(event) => setOutcome((current) => ({ ...current, outcome: event.target.value }))} className={`${input} mt-2`}><option value="COMPLETED">Completed</option><option value="FOLLOW_UP_REQUIRED">Follow-up required</option><option value="NO_ANSWER">No answer</option><option value="BUSY">Busy</option><option value="VOICEMAIL">Voicemail left</option><option value="WRONG_NUMBER">Wrong number</option><option value="NOT_INTERESTED">Not interested</option><option value="OTHER">Other</option></select></label></div>
                <label className="block text-sm font-semibold text-slate-800">Notes<textarea rows={5} value={outcome.notes} onChange={(event) => setOutcome((current) => ({ ...current, notes: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Summary, questions asked, and agreed next step" /></label>
                {call.lead ? <div className="rounded-3xl border border-slate-200 bg-white p-4"><label className="flex items-center gap-3 text-sm font-semibold text-slate-800"><input type="checkbox" checked={outcome.addFollowUp} onChange={(event) => setOutcome((current) => ({ ...current, addFollowUp: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-sky-600" />Create another follow-up</label>{outcome.addFollowUp ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Due<input required type="datetime-local" value={outcome.dueAt} onChange={(event) => setOutcome((current) => ({ ...current, dueAt: event.target.value }))} className={`${input} mt-1.5`} /></label><label className="text-xs font-semibold text-slate-600">Assigned to<select required value={outcome.assignedUserId} onChange={(event) => setOutcome((current) => ({ ...current, assignedUserId: event.target.value }))} className={`${input} mt-1.5`}><option value="">Select employee</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label><label className="text-xs font-semibold text-slate-600 sm:col-span-2">Instruction<input required value={outcome.description} onChange={(event) => setOutcome((current) => ({ ...current, description: event.target.value }))} className={`${input} mt-1.5`} /></label></div> : null}</div> : <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />Link this call to a lead before creating a lead follow-up.</div>}
                <div className="flex justify-end"><button disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save outcome</button></div>
              </form>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function CallHistorySection({ provider = "TWILIO" }) {
  const { acknowledgeDestination } = useNotifications();
  // A direct call-back next to the caller's name, from the browser softphone
  // Callback calls always go through the browser-based Twilio softphone.
  const { status: softphoneStatus, active: activeCall } = useSoftphone();
  const [callBackError, setCallBackError] = useState("");
  const callBack = useCallback((numberValue) => {
    if (!numberValue) return;
    setCallBackError("");
    openGlobalDialpad(numberValue);
  }, []);
  const canCallBack = softphoneStatus === "ready" && !activeCall;
  const [params, setParams] = useSearchParams();
  const [calls, setCalls] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0, unresolved: 0, hasMore: false });
  const [staff, setStaff] = useState([]);
  const [callStaff, setCallStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedMode, setSelectedMode] = useState("");
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const view = params.get("view") || "all";
  const search = params.get("search") || "";
  // Independent of `view` on purpose — "who called" and the existing
  // all/unresolved/missed/outbound pills are separate axes, so they combine
  // (e.g. missed calls handled by one specific team member) instead of
  // one resetting the other.
  const agent = params.get("agent") || "";
  const requestedCallId = params.get("call") || "";
  const [searchDraft, setSearchDraft] = useState(search);

  const query = useMemo(() => {
    const next = new URLSearchParams({ page: String(page), limit: "25" });
    next.set("provider", provider);
    if (search) next.set("search", search);
    if (view === "unresolved") next.set("resolution", "UNRESOLVED");
    if (view === "missed") next.set("status", "MISSED");
    if (view === "outbound") next.set("direction", "OUTBOUND");
    if (agent) next.set("handledByUserId", agent);
    return next.toString();
  }, [page, provider, search, view, agent]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError("");
      const response = await api.get(`/call-history?${query}`);
      setCalls(response.data.data || []);
      setMeta(response.data.meta || {});
      if (requestedCallId) {
        const listed = (response.data.data || []).find((item) => item.id === requestedCallId);
        if (listed) setSelected(listed);
        else {
          api.get(`/call-history/${encodeURIComponent(requestedCallId)}`)
            .then((detail) => setSelected(detail.data.data || null))
            .catch(() => setSelected(null));
        }
      }
      else setSelected((current) => current ? (response.data.data || []).find((item) => item.id === current.id) || current : null);
    } catch (reason) {
      setError(reason.response?.data?.message || "Twilio calls could not be loaded.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, requestedCallId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { void acknowledgeDestination("calls"); }, []);
  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    api.get("/leads/staff").then((response) => setStaff(response.data.data || [])).catch(() => setStaff([]));
    // A separate, calling-specific staff list (who can actually receive
    // calls) rather than /leads/staff's broader lead-owner list — this is
    // what "who called" should be filtered against.
    api.get("/twilio-calls/staff").then((response) => setCallStaff(response.data.data || [])).catch(() => setCallStaff([]));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => load({ quiet: true }), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  function update(next) {
    setParams((current) => {
      const values = new URLSearchParams(current);
      Object.entries(next).forEach(([key, value]) => value ? values.set(key, value) : values.delete(key));
      if (!Object.hasOwn(next, "page")) values.set("page", "1");
      return values;
    });
  }

  function openCall(call, nextMode = "") {
    setSelected(call);
    setSelectedMode(nextMode);
    setParams((current) => { const next = new URLSearchParams(current); next.set("call", call.id); return next; }, { replace: true });
  }

  function closeCall() {
    setSelected(null);
    setSelectedMode("");
    setParams((current) => { const next = new URLSearchParams(current); next.delete("call"); return next; }, { replace: true });
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/70 backdrop-blur-xl sm:grid-cols-3">
        <div className="border-r border-slate-200 px-4 py-4 sm:px-5"><p className="text-xs font-medium text-slate-500">Calls in view</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{meta.total || 0}</p></div>
        <button type="button" onClick={() => update({ view: "unresolved" })} className="border-slate-200 px-4 py-4 text-left transition hover:bg-amber-50 active:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:border-r sm:px-5" aria-label={`Show ${meta.unresolved || 0} calls that need matching`}><p className="text-xs font-medium text-amber-700">Needs matching</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{meta.unresolved || 0}</p></button>
        <div className="col-span-2 flex items-center gap-3 border-t border-slate-200 px-4 py-3 sm:col-span-1 sm:border-t-0 sm:px-5"><span className="relative flex h-2 w-2" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50 motion-reduce:animate-none" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" /></span><p><span className="block text-xs font-medium text-slate-700">History is live</span><span className="block text-[11px] text-slate-400">Refreshes every 15 seconds</span></p></div>
      </div>

      <div className={panel}>
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-end lg:p-5">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-600">Filter calls</p>
            <div className="flex flex-wrap gap-2">{[["all", "All"], ["unresolved", `Needs matching${meta.unresolved ? ` (${meta.unresolved})` : ""}`], ["missed", "Missed calls"], ["outbound", "Outgoing"]].map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => update({ view: value === "all" ? "" : value })} className={`min-h-10 rounded-full px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${view === value ? "bg-[#007AFF] text-white shadow-[0_6px_16px_rgba(0,122,255,0.24)]" : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"}`}>{label}</button>)}</div>
            <p className="mt-2 text-[11px] text-slate-400">Repeated calls with the same number within 30 minutes are bundled into one interaction.</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); update({ search: searchDraft.trim() }); }}>
            <label className="block text-xs font-semibold text-slate-600">Search history</label>
            <div className="mt-2 flex gap-2"><span className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className={`${input} pl-10`} placeholder="Contact, number, or reference" /></span><button type="submit" className="min-h-11 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.97]">Search</button><button type="button" disabled={loading} onClick={() => load()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Refresh call history"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /></button></div>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
          <label className="text-xs font-semibold text-slate-600" htmlFor="call-history-agent-filter">Who called</label>
          <select
            id="call-history-agent-filter"
            value={agent}
            onChange={(event) => update({ agent: event.target.value })}
            className="h-10 min-w-0 max-w-full rounded-full border border-slate-200 bg-slate-50/80 px-3.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100/70 sm:w-64"
          >
            <option value="">Everyone</option>
            {callStaff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
          </select>
          {agent ? <button type="button" onClick={() => update({ agent: "" })} className="text-xs font-semibold text-blue-700 hover:underline">Clear</button> : null}
        </div>

        {error ? <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}<button type="button" onClick={() => load()} className="ml-2 font-semibold underline">Try again</button></div> : null}
        {callBackError ? <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{callBackError}<button type="button" onClick={() => setCallBackError("")} className="ml-2 font-semibold underline">Dismiss</button></div> : null}
        {loading ? <div className="space-y-3 p-5">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div> : !calls.length ? <EmptyCalls unresolved={view === "unresolved"} provider={provider} /> : (
          <>
          <div className="divide-y divide-slate-200 md:hidden">
            {calls.map((call) => <MobileCallCard key={call.id} call={call} provider={provider} onOpen={() => openCall(call)} onCall={canCallBack ? callBack : null} onSms={call.remoteNumber ? () => openCall(call, "sms") : null} />)}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><th className="px-5 py-3">Interaction</th><th className="px-4 py-3">Caller / contact</th><th className="px-4 py-3">Latest status</th><th className="px-4 py-3">Engagement</th><th className="px-4 py-3">Talk time</th><th className="px-4 py-3">Attention</th><th className="px-5 py-3" /></tr></thead>
              <tbody>{calls.map((call) => {
                const callEngagement = engagementSummary(call, { compact: true });
                const bundle = bundleSummary(call);
                return <tr key={call.id} className="border-b border-slate-100 text-sm transition-colors last:border-0 hover:bg-blue-50/30"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full ${directionTone(call)}`} aria-hidden="true"><DirectionIcon value={call.direction} /></span><div><p className="font-semibold text-slate-900">{callDirectionLabel(call.direction)}</p><p className="mt-0.5 text-xs text-slate-400">{when(call.startedAt)}</p>{bundle.attemptCount > 1 ? <p className="mt-1 text-[11px] font-semibold text-blue-700">{attemptCountLabel(call)} bundled</p> : null}</div></div></td><td className="px-4 py-4"><div className="flex items-center gap-2"><div className="min-w-0"><p className="font-semibold text-slate-800">{personName(call) || call.remoteNumber || "Private number"}</p><p className="mt-0.5 text-xs text-slate-400">{personName(call) ? call.remoteNumber : call.lead?.leadNumber || call.client?.clientNumber || "Not matched"}</p></div>{canCallBack && call.remoteNumber ? <button type="button" onClick={() => callBack(call.remoteNumber)} aria-label={`Call ${personName(call) || call.remoteNumber}`} title="Call" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"><Phone className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}{call.remoteNumber ? <button type="button" onClick={() => openCall(call, "sms")} aria-label={`Send SMS to ${personName(call) || call.remoteNumber}`} title="Send SMS" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"><MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}</div></td><td className="px-4 py-4"><CallStatus value={call.status} direction={call.direction} /></td><td className="px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{callEngagement.label}</p><p className="mt-1 max-w-48 font-medium leading-5 text-slate-700" title={callEngagement.title || undefined}>{callEngagement.text}</p></td><td className="px-4 py-4 tabular-nums text-slate-600">{duration(bundle.totalDurationSeconds)}</td><td className="px-4 py-4"><CallAttention call={call} /></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => openCall(call, "history")} className="min-h-10 rounded-full bg-blue-50 px-3.5 text-xs font-semibold text-[#007AFF] transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" aria-label={`Open call history with ${personName(call) || call.remoteNumber || "private number"}`}>History</button></td></tr>;
              })}</tbody>
            </table>
          </div>
          </>
        )}
        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-500"><span className="tabular-nums">{meta.total ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, meta.total)} of ${meta.total} calls · ${meta.pageInteractions ?? calls.length} interactions` : "0 calls"}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => update({ page: String(page - 1) })} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button><span className="min-w-16 text-center text-xs font-semibold tabular-nums">Page {page}</span><button type="button" disabled={!meta.hasMore || loading} onClick={() => update({ page: String(page + 1) })} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></div></footer>
      </div>

      {selected ? <CallDrawer key={`${selected.id}:${selected.updatedAt}:${selectedMode}`} call={selected} staff={staff} provider={provider} initialMode={selectedMode} onClose={closeCall} onSelectCall={(call) => openCall(call, "history")} onChanged={async () => { await load({ quiet: true }); }} /> : null}
    </section>
  );
}

const PERFORMANCE_RANGES = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["all", "All time"]];

function formatTalkTime(seconds) {
  if (!seconds) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Aggregated per team member, not per call — a distinct question from the
// call list above ("who called on this one?" vs "how is everyone doing?"),
// so it gets its own tab rather than folding into the History filters.
export function CallPerformanceSection() {
  const [range, setRange] = useState("30d");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/call-history/performance?range=${encodeURIComponent(range)}`);
      setRows(response.data.data || []);
    } catch (reason) {
      setError(reason.response?.data?.message || "Team call performance could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    totalCalls: sum.totalCalls + row.totalCalls,
    answeredCalls: sum.answeredCalls + row.answeredCalls,
    missedCalls: sum.missedCalls + row.missedCalls,
    totalTalkTimeSeconds: sum.totalTalkTimeSeconds + row.totalTalkTimeSeconds,
  }), { totalCalls: 0, answeredCalls: 0, missedCalls: 0, totalTalkTimeSeconds: 0 }), [rows]);

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/70 backdrop-blur-xl sm:grid-cols-4">
        <div className="border-r border-slate-200 px-4 py-4 sm:px-5"><p className="text-xs font-medium text-slate-500">Total calls</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{totals.totalCalls}</p></div>
        <div className="border-r border-slate-200 px-4 py-4 sm:px-5"><p className="text-xs font-medium text-emerald-700">Answered</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{totals.answeredCalls}</p></div>
        <div className="border-t border-slate-200 px-4 py-4 sm:border-r sm:border-t-0 sm:px-5"><p className="text-xs font-medium text-rose-700">Missed</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{totals.missedCalls}</p></div>
        <div className="border-t border-slate-200 px-4 py-4 sm:border-t-0 sm:px-5"><p className="text-xs font-medium text-slate-500">Total talk time</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{formatTalkTime(totals.totalTalkTimeSeconds)}</p></div>
      </div>

      <div className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">Team call performance</p>
            <p className="mt-1 text-xs text-slate-500">Who's answering, who's missing calls, and how long they talk.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PERFORMANCE_RANGES.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)} className={`min-h-10 rounded-full px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${range === value ? "bg-[#007AFF] text-white shadow-[0_6px_16px_rgba(0,122,255,0.24)]" : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"}`}>{label}</button>
            ))}
          </div>
        </div>

        {error ? <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}<button type="button" onClick={() => load()} className="ml-2 font-semibold underline">Try again</button></div> : null}
        {loading ? <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}</div> : !rows.length ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><PhoneCall className="h-6 w-6" /></div>
            <p className="mt-4 text-base font-semibold text-slate-900">No calls in this range</p>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">Team performance appears once calls are handled through a connected staff phone.</p>
          </div>
        ) : (
          <>
          <div className="divide-y divide-slate-100 md:hidden">
            {rows.map((row) => (
              <div key={row.user.id} className="px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-slate-950">{row.user.fullName}</p>
                  <span className="shrink-0 text-xs font-semibold text-slate-500">{row.totalCalls} calls</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                  <span><span className="block text-slate-400">Answered</span><span className="mt-0.5 block font-medium text-emerald-700">{row.answeredCalls}{row.answerRate != null ? ` (${row.answerRate}%)` : ""}</span></span>
                  <span><span className="block text-slate-400">Missed</span><span className="mt-0.5 block font-medium text-rose-700">{row.missedCalls}</span></span>
                  <span><span className="block text-slate-400">Avg call</span><span className="mt-0.5 block font-medium text-slate-700">{duration(row.avgCallDurationSeconds)}</span></span>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><th className="px-5 py-3">Team member</th><th className="px-4 py-3">Total calls</th><th className="px-4 py-3">Answered</th><th className="px-4 py-3">Missed</th><th className="px-4 py-3">Answer rate</th><th className="px-4 py-3">Inbound</th><th className="px-4 py-3">Outbound</th><th className="px-4 py-3">Talk time</th><th className="px-5 py-3">Avg call</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.user.id} className="border-b border-slate-100 text-sm transition-colors last:border-0 hover:bg-blue-50/30">
                  <td className="px-5 py-4"><p className="font-semibold text-slate-900">{row.user.fullName}</p><p className="mt-0.5 text-xs capitalize text-slate-400">{row.user.role}</p></td>
                  <td className="px-4 py-4 tabular-nums text-slate-700">{row.totalCalls}</td>
                  <td className="px-4 py-4 tabular-nums text-emerald-700">{row.answeredCalls}</td>
                  <td className="px-4 py-4 tabular-nums text-rose-700">{row.missedCalls}</td>
                  <td className="px-4 py-4 tabular-nums text-slate-700">{row.answerRate != null ? `${row.answerRate}%` : "—"}</td>
                  <td className="px-4 py-4 tabular-nums text-slate-600">{row.inboundCalls}</td>
                  <td className="px-4 py-4 tabular-nums text-slate-600">{row.outboundCalls}</td>
                  <td className="px-4 py-4 tabular-nums text-slate-600">{formatTalkTime(row.totalTalkTimeSeconds)}</td>
                  <td className="px-5 py-4 tabular-nums text-slate-600">{duration(row.avgCallDurationSeconds)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </section>
  );
}

export default CallHistorySection;
