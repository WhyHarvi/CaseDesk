import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Link2,
  Loader2,
  Phone,
  PhoneCall,
  PhoneMissed,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundPlus,
  Voicemail,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../components/notifications/NotificationProvider";
import { useSoftphone } from "../components/calls/SoftphoneProvider";
import api from "../services/api";

const panel = "overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 backdrop-blur-xl";
const input = "h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100/70";

const humanize = (value) => String(value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const callDirectionLabel = (value) => value === "INBOUND" ? "Incoming" : value === "OUTBOUND" ? "Outgoing" : humanize(value);
const callStatusLabel = (value, direction) => {
  if (value === "MISSED") return direction === "OUTBOUND" ? "No answer" : "Missed call";
  if (value === "FAILED") return "Call failed";
  return humanize(value);
};
const personName = (call) => call.client?.fullName || [call.lead?.firstName, call.lead?.lastName].filter(Boolean).join(" ") || null;
const when = (value) => value ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const duration = (seconds) => {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
};

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

function EmptyCalls({ unresolved, provider }) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><PhoneCall className="h-6 w-6" /></div>
      <h2 className="mt-4 text-base font-semibold text-slate-900">{unresolved ? "No unresolved calls" : "No Twilio calls yet"}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{unresolved ? "Every call in this view has been matched or marked as spam." : "Place a call with the dialpad or call your connected Twilio number. New calls will appear here automatically."}</p>
    </div>
  );
}

function MobileCallCard({ call, onOpen, provider, onCall }) {
  const name = personName(call) || call.remoteNumber || "Private number";
  const detail = personName(call) ? call.remoteNumber : call.lead?.leadNumber || call.client?.clientNumber || "Not matched";
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
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${call.direction === "OUTBOUND" ? "bg-blue-50 text-blue-700" : call.status === "MISSED" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`} aria-hidden="true"><DirectionIcon value={call.direction} /></span>
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
            </span>
            <CallStatus value={call.status} direction={call.direction} />
          </span>
          <span className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <span><span className="block text-slate-400">Call</span><span className="mt-0.5 block font-medium text-slate-700">{callDirectionLabel(call.direction)} · {duration(call.durationSeconds)}</span></span>
            <span><span className="block text-slate-400">Team member</span><span className="mt-0.5 block truncate font-medium text-slate-700">{call.handledBy?.fullName || call.extensionLabel || "Not mapped"}</span></span>
          </span>
          <span className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">{when(call.startedAt)}</span>
            {call.resolution === "UNRESOLVED" ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700"><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />Match caller</span> : call.followUp?.status === "PENDING" ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Callback due</span> : <span className="text-xs text-slate-400">{humanize(call.resolution)}</span>}
          </span>
        </span>
      </span>
    </div>
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

function CallDrawer({ call, staff, onClose, onChanged, provider }) {
  const { role } = useAuth();
  const [mode, setMode] = useState(call.resolution === "UNRESOLVED" ? "resolve" : "outcome");
  const [search, setSearch] = useState(call.remoteNumber || "");
  const [candidates, setCandidates] = useState({ leads: [], clients: [] });
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leadForm, setLeadForm] = useState({ firstName: "", lastName: "", email: "", ownerUserId: call.handledBy?.id || staff[0]?.id || "", immigrationInterest: "", initialMessage: "", priority: call.status === "MISSED" ? "HIGH" : "NORMAL" });
  const [outcome, setOutcome] = useState({ outcome: call.disposition || "COMPLETED", notes: call.outcomeNotes || "", addFollowUp: false, dueAt: "", description: "Follow up after phone call", assignedUserId: call.lead?.owner?.id || call.handledBy?.id || staff[0]?.id || "" });

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

  const suggestedLeads = call.matchSummary?.leads || [];
  const suggestedClients = call.matchSummary?.clients || [];

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/25 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Twilio call details">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close call details" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-white/80 bg-slate-50 shadow-2xl">
        <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${call.status === "MISSED" ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600"}`}><DirectionIcon value={call.direction} className="h-5 w-5" /></span>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">{personName(call) || call.remoteNumber || "Unknown caller"}</h2><CallStatus value={call.status} direction={call.direction} /></div><p className="mt-1 text-sm text-slate-500">{callDirectionLabel(call.direction)} · {when(call.startedAt)}</p></div>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Number</p><p className="mt-1 truncate text-sm font-semibold text-slate-800">{call.remoteNumber || "Private"}</p></div>
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Duration</p><p className="mt-1 text-sm font-semibold text-slate-800">{duration(call.durationSeconds)}</p></div>
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Team member</p><p className="mt-1 truncate text-sm font-semibold text-slate-800">{call.handledBy?.fullName || call.extensionLabel || "Not mapped"}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {call.remoteNumber ? <a href={`tel:${call.remoteNumber}`} className="inline-flex h-9 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"><Phone className="h-3.5 w-3.5" />Call with Twilio</a> : null}
            {call.recordingUrl ? <a href={call.recordingUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Voicemail className="h-3.5 w-3.5" />Recording <ExternalLink className="h-3 w-3" /></a> : null}
            {call.lead ? <Link to={`/leads?lead=${encodeURIComponent(call.lead.id)}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700">Open {call.lead.leadNumber}</Link> : null}
            {call.client ? <Link to={`/app/clients/${call.client.id}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700">Open {call.client.clientNumber}</Link> : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex gap-1 border-b border-slate-200 bg-white px-5 py-2 sm:px-6">
            <button type="button" onClick={() => setMode("resolve")} className={`rounded-full px-3.5 py-2 text-xs font-semibold ${mode === "resolve" ? "bg-sky-50 text-sky-700" : "text-slate-500"}`}>Match caller</button>
            <button type="button" onClick={() => setMode("outcome")} className={`rounded-full px-3.5 py-2 text-xs font-semibold ${mode === "outcome" ? "bg-sky-50 text-sky-700" : "text-slate-500"}`}>Record outcome</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            {mode === "resolve" ? (
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
  const { dial, status: softphoneStatus, active: activeCall } = useSoftphone();
  const [callBackError, setCallBackError] = useState("");
  const callBack = useCallback(async (numberValue) => {
    if (!numberValue) return;
    setCallBackError("");
    try {
      await dial(numberValue);
    } catch (reason) {
      setCallBackError(reason?.message || "The call could not be placed.");
    }
  }, [dial]);
  const canCallBack = softphoneStatus === "ready" && !activeCall;
  const [params, setParams] = useSearchParams();
  const [calls, setCalls] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0, unresolved: 0, hasMore: false });
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const view = params.get("view") || "all";
  const search = params.get("search") || "";
  const requestedCallId = params.get("call") || "";
  const [searchDraft, setSearchDraft] = useState(search);

  const query = useMemo(() => {
    const next = new URLSearchParams({ page: String(page), limit: "25" });
    next.set("provider", provider);
    if (search) next.set("search", search);
    if (view === "unresolved") next.set("resolution", "UNRESOLVED");
    if (view === "missed") next.set("status", "MISSED");
    if (view === "outbound") next.set("direction", "OUTBOUND");
    return next.toString();
  }, [page, provider, search, view]);

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

  function openCall(call) {
    setSelected(call);
    setParams((current) => { const next = new URLSearchParams(current); next.set("call", call.id); return next; }, { replace: true });
  }

  function closeCall() {
    setSelected(null);
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
          </div>
          <form onSubmit={(event) => { event.preventDefault(); update({ search: searchDraft.trim() }); }}>
            <label className="block text-xs font-semibold text-slate-600">Search history</label>
            <div className="mt-2 flex gap-2"><span className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className={`${input} pl-10`} placeholder="Contact, number, or reference" /></span><button type="submit" className="min-h-11 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.97]">Search</button><button type="button" disabled={loading} onClick={() => load()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Refresh call history"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /></button></div>
          </form>
        </div>

        {error ? <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}<button type="button" onClick={() => load()} className="ml-2 font-semibold underline">Try again</button></div> : null}
        {callBackError ? <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{callBackError}<button type="button" onClick={() => setCallBackError("")} className="ml-2 font-semibold underline">Dismiss</button></div> : null}
        {loading ? <div className="space-y-3 p-5">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div> : !calls.length ? <EmptyCalls unresolved={view === "unresolved"} provider={provider} /> : (
          <>
          <div className="divide-y divide-slate-200 md:hidden">
            {calls.map((call) => <MobileCallCard key={call.id} call={call} provider={provider} onOpen={() => openCall(call)} onCall={canCallBack ? callBack : null} />)}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><th className="px-5 py-3">Call</th><th className="px-4 py-3">Caller / contact</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Team member</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Attention</th><th className="px-5 py-3" /></tr></thead>
              <tbody>{calls.map((call) => <tr key={call.id} className="border-b border-slate-100 text-sm transition-colors last:border-0 hover:bg-blue-50/30"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full ${call.direction === "OUTBOUND" ? "bg-blue-50 text-blue-700" : call.status === "MISSED" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`} aria-hidden="true"><DirectionIcon value={call.direction} /></span><div><p className="font-semibold text-slate-900">{callDirectionLabel(call.direction)}</p><p className="mt-0.5 text-xs text-slate-400">{when(call.startedAt)}</p></div></div></td><td className="px-4 py-4"><div className="flex items-center gap-2"><div className="min-w-0"><p className="font-semibold text-slate-800">{personName(call) || call.remoteNumber || "Private number"}</p><p className="mt-0.5 text-xs text-slate-400">{personName(call) ? call.remoteNumber : call.lead?.leadNumber || call.client?.clientNumber || "Not matched"}</p></div>{canCallBack && call.remoteNumber ? <button type="button" onClick={() => callBack(call.remoteNumber)} aria-label={`Call ${personName(call) || call.remoteNumber}`} title="Call" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"><Phone className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}</div></td><td className="px-4 py-4"><CallStatus value={call.status} direction={call.direction} /></td><td className="px-4 py-4"><p className="font-medium text-slate-700">{call.handledBy?.fullName || call.extensionLabel || "Not mapped"}</p></td><td className="px-4 py-4 tabular-nums text-slate-600">{duration(call.durationSeconds)}</td><td className="px-4 py-4">{call.resolution === "UNRESOLVED" ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700"><CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />Match caller</span> : call.followUp?.status === "PENDING" ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Callback due</span> : <span className="text-xs text-slate-400">{humanize(call.resolution)}</span>}</td><td className="px-5 py-4 text-right"><button type="button" onClick={() => openCall(call)} className="min-h-10 rounded-full bg-blue-50 px-3.5 text-xs font-semibold text-[#007AFF] transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" aria-label={`Open call with ${personName(call) || call.remoteNumber || "private number"}`}>Open</button></td></tr>)}</tbody>
            </table>
          </div>
          </>
        )}
        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-500"><span className="tabular-nums">{meta.total ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, meta.total)} of ${meta.total}` : "0 calls"}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => update({ page: String(page - 1) })} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button><span className="min-w-16 text-center text-xs font-semibold tabular-nums">Page {page}</span><button type="button" disabled={!meta.hasMore || loading} onClick={() => update({ page: String(page + 1) })} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></div></footer>
      </div>

      {selected ? <CallDrawer key={`${selected.id}:${selected.updatedAt}`} call={selected} staff={staff} provider={provider} onClose={closeCall} onChanged={async () => { await load({ quiet: true }); }} /> : null}
    </section>
  );
}

export default CallHistorySection;
