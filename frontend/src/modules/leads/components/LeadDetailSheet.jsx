import {
  Activity,
  ArrowLeftRight,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  ClipboardList,
  HeartHandshake,
  Inbox,
  Landmark,
  Mail,
  MapPin,
  MessageSquareText,
  Pencil,
  Phone,
  PhoneIncoming,
  UserRound,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import api from "../../../services/api";
import { formatDueDate, humanize, initials, leadName, LEAD_PRIORITIES, LEAD_STAGES, PAYMENT_READY_VALUES, paymentStatusTone, RETAINER_READY_VALUES, retainerStatusTone, statusTone } from "../leadPresentation";
import BookConsultationSheet from "./BookConsultationSheet";
import LeadCommercialStatusSheet from "./LeadCommercialStatusSheet";
import ConvertLeadSheet from "./ConvertLeadSheet";
import { CloseFollowUpSheet, CreateFollowUpSheet, EditLeadDetailsSheet, LogActivitySheet, MarkLostSheet, NurtureLeadSheet, QualifyLeadSheet, ReactivateLeadSheet } from "./LeadActionSheets";
import AppointmentProfileOverlay from "../../../components/appointments/AppointmentProfileOverlay";
import CompleteConsultationSheet from "./CompleteConsultationSheet";

const tabs = [
  { id: "overview", label: "Overview", icon: ClipboardList },
  { id: "work", label: "Work", icon: CalendarClock },
  { id: "history", label: "History", icon: Activity },
  { id: "payments", label: "Payments", icon: Landmark },
  { id: "messages", label: "Messages", icon: MessageSquareText },
];

// `select`, when present, replaces the plain value with a real <select> —
// pick the new value directly in the grid, no popup panel. Used for Stage
// Admins can transfer Owner directly from the same grid. The backend writes
// the audit explanation automatically, so routine transfers need no modal.
function SummaryValue({ label, value, onEdit, select, badge }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
        {badge}
        {onEdit ? <button type="button" onClick={onEdit} aria-label={`Change ${label.toLowerCase()}`} className="text-slate-300 transition hover:text-brand-600"><Pencil className="h-3 w-3" /></button> : null}
      </div>
      {select ? (
        <select
          value={select.value}
          disabled={select.disabled}
          onChange={(event) => select.onChange(event.target.value)}
          aria-label={`Change ${label.toLowerCase()}`}
          className="mt-1 -ml-1.5 w-[calc(100%+0.75rem)] max-w-full truncate rounded-lg border border-transparent bg-transparent py-0.5 pl-1.5 pr-1 text-sm font-semibold text-slate-800 outline-none transition hover:border-slate-200 hover:bg-slate-50 focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
        >
          {select.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <p className="mt-1 truncate text-sm font-semibold text-slate-800">{value || "—"}</p>
      )}
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white/45 px-4 py-6 text-center text-sm text-slate-500">{children}</div>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
      ))}
    </div>
  );
}

export default function LeadDetailSheet({ lead: initialLead, staff = [], onClose, onChanged = () => {} }) {
  const { role, appUser } = useAuth();
  const isFrontdesk = role === "frontdesk";
  const [lead, setLead] = useState(initialLead);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [consultations, setConsultations] = useState([]);
  const [consultationError, setConsultationError] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [commercialStatusOpen, setCommercialStatusOpen] = useState(false);
  const [conversionOpen, setConversionOpen] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [closingFollowUp, setClosingFollowUp] = useState(null);
  const [completingConsultation, setCompletingConsultation] = useState(null);
  const [qualificationPrompt, setQualificationPrompt] = useState(null);
  const [suggestedLostReason, setSuggestedLostReason] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
  const [selectedAppointmentTab, setSelectedAppointmentTab] = useState("details");
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const [stageSaving, setStageSaving] = useState(false);
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowNotice, setWorkflowNotice] = useState("");

  useEffect(() => {
    setLead(initialLead);
    setTab("overview");
    setLoading(true);
    setError("");
    api.getFresh(`/leads/${initialLead.id}`)
      .then((response) => setLead(response.data.data))
      .catch((requestError) => setError(requestError.response?.data?.message || "Complete lead details could not be loaded."))
      .finally(() => setLoading(false));

    api.get(`/leads/${initialLead.id}/consultations`)
      .then((response) => {
        setConsultations(response.data.data);
        setConsultationError("");
      })
      .catch((requestError) => setConsultationError(requestError.response?.data?.message || "Consultations could not be loaded."));
  }, [initialLead]);

  useEffect(() => {
    const close = (event) => event.key === "Escape" && !bookingOpen && !commercialStatusOpen && !conversionOpen && !activeAction && !qualificationPrompt && !closingFollowUp && !selectedAppointmentId && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [bookingOpen, commercialStatusOpen, conversionOpen, activeAction, qualificationPrompt, closingFollowUp, selectedAppointmentId, onClose]);

  useEffect(() => {
    if (tab !== "messages") return;
    api.getFresh(`/leads/${initialLead.id}`)
      .then((response) => setLead(response.data.data))
      .catch(() => {});
  }, [tab, initialLead.id]);

  function refreshLead() {
    api.getFresh(`/leads/${lead.id}`).then((response) => setLead(response.data.data)).catch(() => {});
    onChanged();
  }

  async function promoteLead() {
    try {
      setPromoting(true);
      setPromoteError("");
      const response = await api.post(`/leads/${lead.id}/promote`);
      setLead((current) => ({ ...current, ...response.data.data }));
      onChanged();
    } catch (requestError) {
      setPromoteError(requestError.response?.data?.message || "This lead could not be promoted.");
    } finally {
      setPromoting(false);
    }
  }

  async function updateStage(nextStage) {
    if (nextStage === lead.stage) return;
    try {
      setStageSaving(true);
      setWorkflowError("");
      const response = await api.patch(`/leads/${lead.id}/stage`, { stage: nextStage });
      setLead((current) => ({ ...current, ...response.data.data }));
      onChanged();
    } catch (requestError) {
      setWorkflowError(requestError.response?.data?.message || "Stage could not be changed.");
    } finally {
      setStageSaving(false);
    }
  }

  async function updatePriority(nextPriority) {
    if (nextPriority === lead.priority) return;
    try {
      setPrioritySaving(true);
      setWorkflowError("");
      const response = await api.patch(`/leads/${lead.id}/priority`, { priority: nextPriority });
      setLead((current) => ({ ...current, ...response.data.data }));
      onChanged();
    } catch (requestError) {
      setWorkflowError(requestError.response?.data?.message || "Priority could not be changed.");
    } finally {
      setPrioritySaving(false);
    }
  }

  async function updateOwner(ownerUserId) {
    if (!ownerUserId || ownerUserId === lead.ownerUserId) return;
    try {
      setOwnerSaving(true);
      setWorkflowError("");
      setWorkflowNotice("");
      if (role === "admin") {
        const response = await api.post(`/leads/${lead.id}/assign`, { ownerUserId });
        setLead((current) => ({ ...current, ...response.data.data, transferRequests: [] }));
        setWorkflowNotice("Lead transferred.");
        onChanged();
      } else {
        const response = await api.post(`/leads/${lead.id}/transfer-requests`, { ownerUserId });
        setLead((current) => ({ ...current, transferRequests: [response.data.data] }));
        setWorkflowNotice("Transfer request sent for administrator approval. Ownership has not changed yet.");
      }
    } catch (requestError) {
      setWorkflowError(
        requestError.response?.data?.message ||
          "The lead could not be transferred.",
      );
    } finally {
      setOwnerSaving(false);
    }
  }

  function actionCompleted() {
    setActiveAction(null);
    setClosingFollowUp(null);
    refreshLead();
  }

  function qualificationCompleted(qualification) {
    setActiveAction(null);
    refreshLead();
    if (["NOT_ELIGIBLE", "SERVICE_NOT_OFFERED"].includes(qualification?.outcome)) {
      setQualificationPrompt({ action: "lost", reasonCode: qualification.outcome });
    } else if (qualification?.outcome === "FUTURE_OPPORTUNITY") {
      setQualificationPrompt({ action: "nurture" });
    }
  }

  const due = formatDueDate(lead.nextActionAt);
  const activities = lead.activities || [];
  const followUps = lead.followUps || [];
  const leadMessages = useMemo(() => [
    ...(lead.messageDeliveries || []).map((delivery) => ({ ...delivery, source: "lead" })),
    ...(lead.appointments || []).flatMap((appointment) => (appointment.messageDeliveries || []).map((delivery) => ({ ...delivery, source: "appointment", appointment }))),
  ].sort((left, right) => new Date(right.sentAt || right.failedAt || right.createdAt).getTime() - new Date(left.sentAt || left.failedAt || left.createdAt).getTime()), [lead.appointments, lead.messageDeliveries]);
  const isWorkable = ["OPEN", "NURTURE"].includes(lead.status);
  const ownsLead = lead.ownerUserId === appUser?.id;
  // Owner changes are admin-only and may target any active lead-team member,
  // including front desk. Stage and priority remain editable only by an admin
  // or the consultant currently responsible for the lead.
  const canReassign = isWorkable && role === "admin";
  const canRequestTransfer = isWorkable && role === "consultant" && ownsLead;
  const pendingTransfer = lead.transferRequests?.[0] || null;
  const leadOwners = staff.filter(
    (person) => ["admin", "consultant", "frontdesk"].includes(person.role),
  );
  const canEditWorkflow = isWorkable && (role === "admin" || (role === "consultant" && ownsLead));
  const canCloseFollowUp = (item) => item.status === "PENDING" && (!isFrontdesk || item.assignedUserId === appUser?.id);
  // The three separate things convertLead() checks server-side, mirrored
  // here so the UI never shows a Convert button the backend would reject —
  // and so the path-to-conversion checklist below can show each on its own.
  const stageReady = lead.stage === "READY_TO_CONVERT";
  const retainerReady = RETAINER_READY_VALUES.includes(lead.retainerStatus);
  const paymentReady = PAYMENT_READY_VALUES.includes(lead.initialPaymentStatus);
  const readyToConvert = stageReady && retainerReady && paymentReady;
  // The consultation fee (paid at booking time) is a separate amount from
  // the initial case payment tracked above — flagged here so a paid
  // consultation doesn't read as "payment received" toward conversion.
  const paidConsultationFee = consultations.find((item) => item.paymentStatus === "PAID" && item.fee != null);
  const workActions = isWorkable
    ? [
        { id: "activity", label: "Log activity", icon: PhoneIncoming, show: true },
        { id: "follow-up", label: "Add follow-up", icon: CheckCircle2, show: true },
        { id: "nurture", label: "Nurture", icon: HeartHandshake, show: lead.status === "OPEN" },
        { id: "lost", label: "Mark lost", icon: XCircle, show: true, destructive: true },
      ].filter((action) => action.show)
    : lead.status === "LOST" && lead.lostDetail?.reactivationAllowed
      ? [{ id: "reactivate", label: "Reactivate", icon: HeartHandshake, show: true }]
      : [];

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-slate-950/20 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="lead-detail-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close lead details" />
      <aside className="relative flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-white/80 bg-[#f4f7fa] shadow-[0_30px_100px_rgba(15,23,42,0.28)]">
        <header className="bg-white px-6 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{initials(lead)}</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="lead-detail-title" className="truncate text-xl font-semibold tracking-tight text-slate-950">{leadName(lead)}</h2>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${statusTone[lead.status] || statusTone.ARCHIVED}`}>{humanize(lead.status)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{lead.leadNumber} · {lead.phone}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {lead.phone ? <a href={`tel:${lead.phone}`} title="Open this number in the Windows phone app (set Ooma Desktop as the default)" className="inline-flex h-9 items-center gap-2 rounded-full bg-sky-600 px-3.5 text-xs font-semibold text-white transition hover:bg-sky-500"><Phone className="h-3.5 w-3.5" />Call</a> : null}
              <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>

          <nav className="mt-5 flex gap-1" aria-label="Lead details">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button key={item.id} type="button" onClick={() => setTab(item.id)} className={[
                  "relative inline-flex h-11 items-center gap-2 px-4 text-sm font-medium transition",
                  active ? "text-brand-700" : "text-slate-500 hover:text-slate-800",
                ].join(" ")}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {item.id === "messages" && leadMessages.length ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{leadMessages.length}</span> : null}
                  {active ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" /> : null}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200/70 overscroll-contain">
          {loading ? <DetailSkeleton /> : (
            <div className="p-6">
              {error ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error} Showing the available summary.</div> : null}

              {tab === "overview" ? (
                <div className="space-y-5">
                  {lead.pipelineSegment === "IMPORT_REVIEW" ? (
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900"><Inbox className="h-4 w-4" />Import Review</h3>
                          <p className="mt-1 text-xs leading-5 text-amber-700">This lead came from the bulk import and isn't part of the active pipeline yet. Fix up its details, then promote it once it's ready to work like any other lead.</p>
                        </div>
                        {!isFrontdesk ? <button type="button" onClick={promoteLead} disabled={promoting} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60">{promoting ? "Promoting…" : "Promote to pipeline"}</button> : null}
                      </div>
                      {promoteError ? <p className="mt-3 text-xs font-medium text-rose-700">{promoteError}</p> : null}
                    </section>
                  ) : null}

                  <section className="rounded-2xl border border-slate-200/70 bg-white p-5">
                    {workflowError ? <p className="mb-3 text-xs font-medium text-rose-600">{workflowError}</p> : null}
                    {workflowNotice ? <p className="mb-3 text-xs font-medium text-emerald-700">{workflowNotice}</p> : null}
                    {pendingTransfer ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><p className="text-xs font-semibold text-amber-900">Transfer to {pendingTransfer.toOwner?.fullName || "the selected team member"} is waiting for administrator approval.</p><p className="mt-0.5 text-[11px] text-amber-700">The current owner and pending work stay unchanged until it is approved.</p></div> : null}
                    <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
                      <SummaryValue
                        label="Stage"
                        value={humanize(lead.stage)}
                        select={canEditWorkflow ? { value: lead.stage, disabled: stageSaving, onChange: updateStage, options: LEAD_STAGES.map((value) => ({ value, label: humanize(value) })) } : null}
                        badge={stageReady && !readyToConvert ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Ready to Convert, but retainer or payment still isn't — see Path to conversion below" /> : null}
                      />
                      <SummaryValue
                        label="Owner"
                        value={lead.owner?.fullName || "Unassigned"}
                        select={canReassign || canRequestTransfer ? {
                          value: lead.ownerUserId || "",
                          disabled: ownerSaving || Boolean(pendingTransfer),
                          onChange: updateOwner,
                          options: [
                            ...(!lead.ownerUserId
                              ? [{ value: "", label: "Select team member" }]
                              : []),
                            ...(!leadOwners.some((person) => person.id === lead.ownerUserId) && lead.ownerUserId
                              ? [{ value: lead.ownerUserId, label: lead.owner?.fullName || "Current owner" }]
                              : []),
                            ...leadOwners.map((person) => ({
                              value: person.id,
                              label: `${person.fullName} · ${person.role === "frontdesk" ? "Front desk" : humanize(person.role)}`,
                            })),
                          ],
                        } : null}
                      />
                      <SummaryValue label="Source" value={lead.originalSource?.name || "Unknown"} />
                      <SummaryValue
                        label="Priority"
                        value={humanize(lead.priority)}
                        select={canEditWorkflow ? { value: lead.priority, disabled: prioritySaving, onChange: updatePriority, options: LEAD_PRIORITIES.map((value) => ({ value, label: humanize(value) })) } : null}
                      />
                      <SummaryValue label="Temperature" value={humanize(lead.temperature)} onEdit={lead.status !== "CONVERTED" ? () => setActiveAction("edit-details") : null} />
                      <SummaryValue label="Estimated value" value={lead.estimatedValue != null ? `$${Number(lead.estimatedValue).toLocaleString("en-CA")}` : "Not set"} onEdit={lead.status !== "CONVERTED" ? () => setActiveAction("edit-details") : null} />
                    </div>
                  </section>

                  {!isFrontdesk && (lead.status === "OPEN" || lead.qualification) ? <section className="rounded-2xl border border-slate-200/70 bg-white p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ClipboardCheck className="h-4 w-4 text-slate-400" />Qualification</h3><p className="mt-1 text-xs text-slate-500">Eligibility assessment and outcome</p></div>
                      {lead.status === "OPEN" ? <button type="button" onClick={() => setActiveAction("qualify")} className="h-9 rounded-full border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{lead.qualification ? "Update" : "Qualify"}</button> : null}
                    </div>
                    {lead.qualification ? (
                      <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs text-slate-400">Outcome</p><p className="mt-1 text-sm font-semibold text-slate-800">{humanize(lead.qualification.outcome)}</p></div>
                          <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs text-slate-400">Eligibility confidence</p><p className="mt-1 text-sm font-semibold text-slate-800">{lead.qualification.eligibilityConfidence != null ? `${lead.qualification.eligibilityConfidence}%` : "—"}</p></div>
                        </div>
                        {lead.qualification.notes ? <p className="mt-3 text-sm leading-6 text-slate-600">{lead.qualification.notes}</p> : null}
                      </>
                    ) : <p className="mt-4 text-sm text-slate-500">Not yet qualified.</p>}
                  </section> : null}

                  <section className="rounded-2xl border border-slate-200/70 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <h3 className="text-sm font-semibold text-slate-900">Contact</h3>
                      {lead.status !== "CONVERTED" ? <button type="button" onClick={() => setActiveAction("edit-details")} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"><Pencil className="h-3.5 w-3.5" />Edit</button> : lead.convertedClientId ? <Link to={`/app/clients/${lead.convertedClientId}`} className="text-xs font-semibold text-brand-700">Edit on client →</Link> : null}
                    </div>
                    <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
                      <div className="bg-white px-5 py-4"><p className="flex items-center gap-2 text-xs text-slate-400"><Phone className="h-3.5 w-3.5" />Phone</p><p className="mt-1.5 text-sm font-medium text-slate-800">{lead.phone}</p></div>
                      <div className="bg-white px-5 py-4"><p className="flex items-center gap-2 text-xs text-slate-400"><Mail className="h-3.5 w-3.5" />Email</p><p className="mt-1.5 break-words text-sm font-medium text-slate-800">{lead.email || "Not provided"}</p></div>
                      <div className="bg-white px-5 py-4"><p className="flex items-center gap-2 text-xs text-slate-400"><MapPin className="h-3.5 w-3.5" />Location</p><p className="mt-1.5 text-sm font-medium text-slate-800">{[lead.province, lead.country].filter(Boolean).join(", ") || "Not provided"}</p></div>
                      <div className="bg-white px-5 py-4"><p className="flex items-center gap-2 text-xs text-slate-400"><UserRound className="h-3.5 w-3.5" />Interest</p><p className="mt-1.5 text-sm font-medium text-slate-800">{lead.immigrationInterest || "Not specified"}</p></div>
                      <div className="bg-white px-5 py-4"><p className="text-xs text-slate-400">Preferred contact time</p><p className="mt-1.5 text-sm font-medium text-slate-800">{lead.preferredContactTime || "Not provided"}</p></div>
                      <div className="bg-white px-5 py-4"><p className="text-xs text-slate-400">Consent</p><p className={`mt-1.5 text-sm font-medium ${lead.consentGiven ? "text-emerald-700" : "text-slate-500"}`}>{lead.consentGiven ? `Consent on file${lead.consentGivenAt ? ` · ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(lead.consentGivenAt))}` : ""}` : "No consent on record"}</p></div>
                    </div>
                  </section>

                  {!isFrontdesk ? <section className="rounded-2xl border border-slate-200/70 bg-white p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Landmark className="h-4 w-4 text-slate-400" />Path to conversion</h3><p className="mt-1 text-xs text-slate-500">{[stageReady, retainerReady, paymentReady].filter(Boolean).length} of 3 requirements met</p></div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-4 py-3">
                        {stageReady ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-slate-300" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">Stage: Ready to Convert</p>
                          <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${stageReady ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>Currently: {humanize(lead.stage)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {retainerReady ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-slate-300" />}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800">Retainer signed</p>
                            <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${retainerStatusTone[lead.retainerStatus] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{humanize(lead.retainerStatus)}</span>
                            {!retainerReady && role !== "admin" && !ownsLead ? <p className="mt-1 text-[11px] leading-4 text-amber-700">Only an admin or this lead's assigned consultant can confirm this as Signed.</p> : null}
                          </div>
                        </div>
                        {lead.status === "OPEN" ? <button type="button" onClick={() => setCommercialStatusOpen(true)} className="h-8 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100">Update</button> : null}
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {paymentReady ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-slate-300" />}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800">Initial payment received</p>
                            <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${paymentStatusTone[lead.initialPaymentStatus] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{humanize(lead.initialPaymentStatus)}</span>
                            {!paymentReady && role !== "admin" && !ownsLead ? <p className="mt-1 text-[11px] leading-4 text-amber-700">Only an admin or this lead's assigned consultant can confirm this as Paid.</p> : null}
                            {paidConsultationFee ? <p className="mt-1 text-[11px] leading-4 text-slate-400">Separate from the ${Number(paidConsultationFee.fee).toLocaleString("en-CA")} consultation fee, already paid.</p> : null}
                          </div>
                        </div>
                        {lead.status === "OPEN" ? <button type="button" onClick={() => setCommercialStatusOpen(true)} className="h-8 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100">Update</button> : null}
                      </div>
                    </div>

                    {lead.status === "OPEN" && stageReady && !readyToConvert ? <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">Stage reached Ready to Convert, but retainer and/or payment still need confirming before this lead can convert.</p> : null}
                    {lead.status === "OPEN" && lead.earlyClientId ? <p className="mt-3 rounded-xl bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">A client and case were created automatically to hold the retainer sent for this lead's confirmed consultation — this lead is still open and working its own pipeline. <Link to={`/app/clients/${lead.earlyClientId}`} className="font-semibold underline">View the retainer case →</Link></p> : null}
                    {lead.status === "OPEN" && readyToConvert ? <button type="button" onClick={() => setConversionOpen(true)} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" />Convert to client</button> : null}
                    {lead.status === "CONVERTED" && lead.convertedClientId ? <Link to={`/app/clients/${lead.convertedClientId}`} className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl bg-emerald-50 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">Open linked client</Link> : null}
                  </section> : null}

                  {lead.initialMessage ? <section className="rounded-2xl border border-slate-200/70 bg-white p-5"><h3 className="text-sm font-semibold text-slate-900">Initial inquiry</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{lead.initialMessage}</p></section> : null}
                </div>
              ) : null}

              {tab === "work" ? (
                <div className="space-y-5">
                  {workActions.length ? (
                    <section className="flex flex-wrap gap-2">
                      {workActions.map((action) => {
                        const ActionIcon = action.icon;
                        return (
                          <button
                            key={action.id}
                            type="button"
                            onClick={() => setActiveAction(action.id)}
                            className={[
                              "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-xs font-semibold transition",
                              action.destructive
                                ? "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                                : "border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700",
                            ].join(" ")}
                          >
                            <ActionIcon className="h-4 w-4" />
                            {action.label}
                          </button>
                        );
                      })}
                    </section>
                  ) : null}
                  <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
                    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand-600">Current next action</p><h3 className="mt-2 text-lg font-semibold text-brand-950">{lead.nextActionDescription || "No next action"}</h3><p className="mt-1 text-sm text-brand-700">{humanize(lead.nextActionType)}</p></div><span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${due.overdue && lead.status === "OPEN" ? "bg-rose-100 text-rose-700" : "bg-white text-brand-700"}`}>{due.overdue && lead.status === "OPEN" ? "Overdue · " : ""}{due.label}</span></div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between"><div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Video className="h-4 w-4 text-slate-400" />Consultations</h3><p className="mt-1 text-xs text-slate-500">{consultations.length} records</p></div>{lead.status === "OPEN" ? <button type="button" onClick={() => setBookingOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-xs font-semibold text-white hover:bg-brand-700"><CalendarPlus className="h-3.5 w-3.5" />Book</button> : null}</div>
                    {consultationError ? <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">{consultationError}</div> : null}
                    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">{consultations.length ? consultations.map((item, index) => <div key={item.id} role={item.appointment?.id ? "button" : undefined} tabIndex={item.appointment?.id ? 0 : undefined} onClick={() => { if (item.appointment?.id) { setSelectedAppointmentTab("details"); setSelectedAppointmentId(item.appointment.id); } }} onKeyDown={(event) => { if (event.key === "Enter" && item.appointment?.id) { setSelectedAppointmentTab("details"); setSelectedAppointmentId(item.appointment.id); } }} className={[
                      "px-5 py-4 transition",
                      item.appointment?.id ? "cursor-pointer hover:bg-sky-50/50" : "",
                      index ? "border-t border-slate-100" : "",
                    ].join(" ")}><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-800">{humanize(item.appointmentType)} · {item.consultant?.fullName || "Consultant"}</p><p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startAt))}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{humanize(item.status)}</span>{["SCHEDULED", "CONFIRMED"].includes(item.status) && role !== "frontdesk" ? <button type="button" onClick={(event) => { event.stopPropagation(); setCompletingConsultation(item); }} className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">Complete</button> : null}</div></div>{item.outcome ? <p className="mt-2 text-xs font-semibold text-brand-700">{humanize(item.outcome)}</p> : null}</div>) : <EmptyState>No consultations booked.</EmptyState>}</div>
                  </section>

                  <section>
                    <div className="mb-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CheckCircle2 className="h-4 w-4 text-slate-400" />Follow-ups</h3><p className="mt-1 text-xs text-slate-500">{followUps.length} records</p></div>
                    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">{followUps.length ? followUps.map((item, index) => { const itemDue = formatDueDate(item.dueAt); return <div key={item.id} className={`flex items-start justify-between gap-4 px-5 py-4 ${index ? "border-t border-slate-100" : ""}`}><div><p className="text-sm font-medium text-slate-800">{item.description}</p><p className="mt-1 text-xs text-slate-500">{humanize(item.status)} · {humanize(item.type)}{item.completionOutcome ? ` · ${item.completionOutcome}` : ""}</p></div><div className="flex shrink-0 items-center gap-3"><span className="text-xs text-slate-400">{itemDue.label}</span>{canCloseFollowUp(item) ? <button type="button" onClick={() => setClosingFollowUp(item)} className="h-8 rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">Close</button> : null}</div></div>; }) : <EmptyState>No follow-ups recorded.</EmptyState>}</div>
                  </section>
                </div>
              ) : null}

              {tab === "history" ? (
                <section>
                  <div className="mb-4"><h3 className="text-sm font-semibold text-slate-900">Activity timeline</h3><p className="mt-1 text-xs text-slate-500">A chronological record of work completed on this lead.</p></div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">{activities.length ? activities.map((item, index) => <div key={item.id} className={`flex gap-4 px-5 py-4 ${index ? "border-t border-slate-100" : ""}`}><div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Activity className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-500">{humanize(item.activityType)}{item.outcome ? ` · ${humanize(item.outcome)}` : ""}</p></div><time className="shrink-0 text-xs text-slate-400">{new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.occurredAt))}</time></div>{item.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p> : null}</div></div>) : <EmptyState>No activity recorded.</EmptyState>}</div>
                </section>
              ) : null}

              {tab === "payments" ? <section className="rounded-2xl border border-slate-200/70 bg-white px-5 py-8 text-center"><Landmark className="mx-auto h-5 w-5 text-slate-400" /><h3 className="mt-3 text-sm font-semibold text-slate-900">Financial records move with the client</h3><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">Leads no longer have an editable notepad ledger. Book a consultation or convert the lead, then record its invoice and payment through the evidence-backed billing flow.</p></section> : null}

              {tab === "messages" ? (
                <section>
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div><h3 className="text-sm font-semibold text-slate-900">Lead messages</h3><p className="mt-1 text-xs text-slate-500">Automatic acknowledgements, stale-lead check-ins, and appointment messages sent to this lead.</p></div>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{leadMessages.length} deliveries</span>
                  </div>
                  <div className="space-y-3">
                    {leadMessages.length ? leadMessages.map((delivery) => {
                      const deliveryAt = delivery.sentAt || delivery.failedAt || delivery.createdAt;
                      const normalizedStatus = String(delivery.status || "").toLowerCase();
                      const sent = ["sent", "delivered"].includes(normalizedStatus);
                      const failed = ["failed", "bounced"].includes(normalizedStatus);
                      const untracked = normalizedStatus === "untracked";
                      const ChannelIcon = String(delivery.channel || "").toLowerCase() === "email" ? Mail : MessageSquareText;
                      const channelLabel = String(delivery.channel || "").toLowerCase() === "sms" ? "SMS" : humanize(delivery.channel);
                      const recipientLabel = String(delivery.channel || "").toLowerCase() === "staff" ? "Agency team" : delivery.recipient;
                      const MessageRow = delivery.appointment ? "button" : "article";
                      return (
                        <MessageRow
                          key={`${delivery.source}-${delivery.id}`}
                          {...(delivery.appointment ? { type: "button", onClick: () => { setSelectedAppointmentTab("messages"); setSelectedAppointmentId(delivery.appointment.id); } } : {})}
                          className={`group w-full rounded-2xl border border-slate-200/70 bg-white p-4 text-left shadow-sm ${delivery.appointment ? "transition hover:border-brand-200 hover:bg-brand-50/30" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${sent ? "bg-emerald-50 text-emerald-600" : failed ? "bg-rose-50 text-rose-600" : untracked ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-600"}`}><ChannelIcon className="h-4 w-4" /></span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div><p className="text-sm font-semibold text-slate-800">{humanize(delivery.kind)} · {channelLabel}</p><p className="mt-1 break-all text-xs text-slate-400">To {recipientLabel}</p></div>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${sent ? "bg-emerald-50 text-emerald-700" : failed ? "bg-rose-50 text-rose-700" : untracked ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{humanize(delivery.status)}</span>
                              </div>
                              {delivery.subject ? <p className="mt-3 text-xs font-semibold text-slate-700">{delivery.subject}</p> : null}
                              {delivery.body ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-500">{delivery.body}</p> : null}
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                                <span className="text-xs font-medium text-slate-500">{delivery.appointment ? `${delivery.appointment.subject} · ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(delivery.appointment.startsAt))}` : `${humanize(delivery.sourceChannel || "website")} · ${delivery.kind === "stale_outreach" ? "Automatic consultation check-in" : "Automatic welcome"}${delivery.provider ? ` · ${delivery.provider}` : ""}`}</span>
                                <time className="text-[11px] text-slate-400">{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(deliveryAt))}</time>
                              </div>
                              {delivery.lastError ? <p className={`mt-2 rounded-xl px-3 py-2 text-xs ${failed ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}>{delivery.lastError}</p> : null}
                            </div>
                          </div>
                        </MessageRow>
                      );
                    }) : <EmptyState>No lead or appointment messages have been recorded for this lead.</EmptyState>}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </aside>

      {activeAction === "edit-details" ? <EditLeadDetailsSheet lead={lead} onClose={() => setActiveAction(null)} onSaved={actionCompleted} /> : null}
      {activeAction === "qualify" ? <QualifyLeadSheet lead={lead} onClose={() => setActiveAction(null)} onSaved={qualificationCompleted} /> : null}
      {activeAction === "activity" ? <LogActivitySheet lead={lead} onClose={() => setActiveAction(null)} onSaved={actionCompleted} /> : null}
      {activeAction === "follow-up" ? <CreateFollowUpSheet lead={lead} staff={staff} currentUserId={appUser?.id} onClose={() => setActiveAction(null)} onSaved={actionCompleted} /> : null}
      {activeAction === "nurture" ? <NurtureLeadSheet lead={lead} onClose={() => setActiveAction(null)} onSaved={actionCompleted} /> : null}
      {activeAction === "lost" ? <MarkLostSheet lead={lead} initialReasonCode={suggestedLostReason || "NO_RESPONSE"} onClose={() => { setActiveAction(null); setSuggestedLostReason(""); }} onSaved={() => { setSuggestedLostReason(""); actionCompleted(); }} /> : null}
      {activeAction === "reactivate" ? <ReactivateLeadSheet lead={lead} onClose={() => setActiveAction(null)} onSaved={actionCompleted} /> : null}
      {closingFollowUp ? <CloseFollowUpSheet lead={lead} followUp={closingFollowUp} staff={staff} onClose={() => setClosingFollowUp(null)} onSaved={actionCompleted} /> : null}
      {bookingOpen ? <BookConsultationSheet lead={lead} staff={staff} onClose={() => setBookingOpen(false)} onCreated={(consultation) => { setConsultations((current) => [consultation, ...current]); setBookingOpen(false); api.getFresh(`/leads/${lead.id}`).then((response) => setLead(response.data.data)).catch(() => {}); }} /> : null}
      {commercialStatusOpen ? <LeadCommercialStatusSheet lead={lead} onClose={() => setCommercialStatusOpen(false)} onUpdated={(updated) => { setLead((current) => ({ ...current, ...updated })); setCommercialStatusOpen(false); }} /> : null}
      {conversionOpen ? <ConvertLeadSheet lead={lead} onClose={() => setConversionOpen(false)} onConverted={(conversion) => { setLead((current) => ({ ...current, status: "CONVERTED", convertedClientId: conversion.client.id, convertedCaseId: conversion.case.id, convertedAt: conversion.convertedAt, nextActionType: null, nextActionDescription: null, nextActionAt: null, conversion })); setConversionOpen(false); onChanged(); }} /> : null}
      {selectedAppointmentId ? <AppointmentProfileOverlay appointmentId={selectedAppointmentId} initialTab={selectedAppointmentTab} onClose={() => setSelectedAppointmentId(null)} onChanged={() => { api.get(`/leads/${lead.id}/consultations`).then((response) => setConsultations(response.data.data)).catch(() => {}); refreshLead(); }} /> : null}
      {completingConsultation ? <CompleteConsultationSheet lead={lead} consultation={completingConsultation} onClose={() => setCompletingConsultation(null)} onSaved={() => { setCompletingConsultation(null); api.getFresh(`/leads/${lead.id}/consultations`).then((response) => setConsultations(response.data.data)).catch(() => {}); refreshLead(); }} /> : null}
      {qualificationPrompt ? <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Qualification next step"><button type="button" className="absolute inset-0" onClick={() => setQualificationPrompt(null)} aria-label="Close next-step suggestion" /><div className="relative w-full max-w-md rounded-3xl border border-white/80 bg-white p-6 shadow-[0_30px_100px_rgba(15,23,42,0.3)]"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><ArrowLeftRight className="h-5 w-5" /></div><h2 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">Finish the next step?</h2><p className="mt-2 text-sm leading-6 text-slate-500">{qualificationPrompt.action === "lost" ? "This outcome is not an active opportunity. Mark the lead lost now with the matching reason already selected." : "This is a future opportunity. Move the lead to nurture now and choose when the team should reconnect."}</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setQualificationPrompt(null)} className="h-10 rounded-full px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Not now</button><button type="button" onClick={() => { const next = qualificationPrompt; setQualificationPrompt(null); if (next.reasonCode) setSuggestedLostReason(next.reasonCode); setActiveAction(next.action); }} className="h-10 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">{qualificationPrompt.action === "lost" ? "Mark lost" : "Move to nurture"}</button></div></div></div> : null}
    </div>
  );
}
