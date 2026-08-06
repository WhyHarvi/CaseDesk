import { ArrowLeftRight, CheckCircle2, ClipboardCheck, HeartHandshake, PhoneIncoming, UserPen, X, XCircle } from "lucide-react";
import { useState } from "react";
import api from "../../../services/api";
import { humanize } from "../leadPresentation";

const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

const ACTIVITY_TYPES = ["INCOMING_CALL", "OUTGOING_CALL", "MISSED_CALL", "WHATSAPP_RECEIVED", "WHATSAPP_SENT", "SMS_RECEIVED", "SMS_SENT", "EMAIL_RECEIVED", "EMAIL_SENT", "INTERNAL_NOTE"];
const ACTIVITY_DIRECTIONS = ["INBOUND", "OUTBOUND", "INTERNAL"];
const ACTIVITY_CHANNELS = ["PHONE", "WHATSAPP", "SMS", "EMAIL", "SOCIAL", "WEBSITE", "IN_PERSON", "OTHER"];
const FOLLOW_UP_TYPES = ["PHONE_CALL", "EMAIL", "SMS", "WHATSAPP", "MEETING", "DOCUMENT_REQUEST", "OTHER"];
const LOST_REASONS = ["NO_RESPONSE", "NOT_INTERESTED", "NOT_ELIGIBLE", "PRICE_CONCERN", "SELECTED_ANOTHER_CONSULTANT", "CONSULTATION_NO_SHOW", "AGREEMENT_NOT_SIGNED", "PAYMENT_NOT_COMPLETED", "SERVICE_NOT_OFFERED", "WRONG_CONTACT_INFORMATION", "DUPLICATE", "DO_NOT_CONTACT", "OTHER"];
const QUALIFICATION_OUTCOMES = ["QUALIFIED", "MORE_INFORMATION_REQUIRED", "CONSULTATION_REQUIRED", "NOT_ELIGIBLE", "FUTURE_OPPORTUNITY", "SERVICE_NOT_OFFERED"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

function localInput(offsetMs = 0) {
  const date = new Date(Date.now() + offsetMs);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function ActionModal({ title, subtitle, icon: Icon, onClose, onSubmit, saving, submitLabel, error, children, destructive = false }) {
  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label={`Close ${title.toLowerCase()} form`} />
      <form onSubmit={onSubmit} className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[#f7f9fc] shadow-[0_30px_100px_rgba(15,23,42,0.3)]">
        <header className="flex items-start justify-between border-b border-slate-200/70 bg-white/90 px-6 py-5">
          <div>
            <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl text-white ${destructive ? "bg-rose-600" : "bg-brand-600"}`}><Icon className="h-5 w-5" /></div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:col-span-2">{error}</div> : null}
          {children}
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button disabled={saving} className={`h-10 rounded-full px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${destructive ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700"}`}>{saving ? "Saving…" : submitLabel}</button>
        </footer>
      </form>
    </div>
  );
}

function useSubmit(request, onDone) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const result = await request();
      onDone(result);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The action could not be completed.");
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, submit };
}

export function LogActivitySheet({ lead, onClose, onSaved }) {
  const [form, setForm] = useState({ activityType: "INCOMING_CALL", direction: "INBOUND", channel: "PHONE", title: "", description: "", outcome: "", durationMinutes: "", occurredAt: localInput(), connected: true });
  const update = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((current) => {
      if (name === "activityType") {
        const received = ["INCOMING_CALL", "WHATSAPP_RECEIVED", "SMS_RECEIVED", "EMAIL_RECEIVED"].includes(value);
        const cannotConnect = ["MISSED_CALL", "INTERNAL_NOTE"].includes(value);
        return { ...current, activityType: value, connected: received ? true : cannotConnect ? false : current.connected };
      }
      return { ...current, [name]: type === "checkbox" ? checked : value };
    });
  };
  const { saving, error, submit } = useSubmit(
    () => api.post(`/leads/${lead.id}/activities`, {
      activityType: form.activityType,
      direction: form.direction,
      channel: form.channel,
      title: form.title,
      description: form.description,
      outcome: form.outcome,
      durationSeconds: form.durationMinutes === "" ? undefined : Math.round(Number(form.durationMinutes) * 60),
      occurredAt: new Date(form.occurredAt).toISOString(),
      connected: form.connected,
    }),
    onSaved,
  );

  return (
    <ActionModal title="Log communication" subtitle={`Record a call, message, or note for ${lead.firstName || "this lead"}.`} icon={PhoneIncoming} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Log activity">
      <label className="text-sm font-medium text-slate-700">Type<select name="activityType" value={form.activityType} onChange={update} className={fieldClass}>{ACTIVITY_TYPES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Direction<select name="direction" value={form.direction} onChange={update} className={fieldClass}>{ACTIVITY_DIRECTIONS.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Channel<select name="channel" value={form.channel} onChange={update} className={fieldClass}>{ACTIVITY_CHANNELS.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Occurred at<input required type="datetime-local" name="occurredAt" value={form.occurredAt} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Title<input required maxLength={200} name="title" value={form.title} onChange={update} className={fieldClass} placeholder="Initial inquiry" /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Details<textarea name="description" value={form.description} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="What was discussed?" /></label>
      <label className="text-sm font-medium text-slate-700">Outcome<input maxLength={160} name="outcome" value={form.outcome} onChange={update} className={fieldClass} placeholder="Follow-up required" /></label>
      <label className="text-sm font-medium text-slate-700">Duration (minutes)<input type="number" min="0" max="1440" name="durationMinutes" value={form.durationMinutes} onChange={update} className={fieldClass} placeholder="4" /></label>
      <label className="flex items-center gap-3 rounded-xl bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800 sm:col-span-2"><input type="checkbox" name="connected" checked={form.connected} onChange={update} className="h-4 w-4 rounded border-sky-300 text-sky-600" />We actually spoke or exchanged messages</label>
    </ActionModal>
  );
}

export function EditLeadDetailsSheet({ lead, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName: lead.firstName || "", lastName: lead.lastName || "", phone: lead.phone || "", email: lead.email || "",
    country: lead.country || "", province: lead.province || "", preferredLanguage: lead.preferredLanguage || "",
    currentImmigrationStatus: lead.currentImmigrationStatus || "", immigrationInterest: lead.immigrationInterest || "",
    preferredContactTime: lead.preferredContactTime || "", estimatedValue: lead.estimatedValue ?? "", temperature: lead.temperature || "COLD",
    inquiryDate: lead.inquiryDate ? lead.inquiryDate.slice(0, 10) : "",
  });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const { saving, error, submit } = useSubmit(
    () => api.patch(`/leads/${lead.id}`, { ...form, inquiryDate: form.inquiryDate ? new Date(form.inquiryDate).toISOString() : undefined }),
    onSaved,
  );

  return (
    <ActionModal title="Edit lead details" subtitle="Fix or fill in contact and background info." icon={UserPen} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Save changes">
      <label className="text-sm font-medium text-slate-700">First name<input maxLength={100} name="firstName" value={form.firstName} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Last name<input maxLength={100} name="lastName" value={form.lastName} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Phone<input maxLength={40} name="phone" value={form.phone} onChange={update} className={fieldClass} placeholder="e.g. 416 555 1234" /></label>
      <label className="text-sm font-medium text-slate-700">Email<input type="email" maxLength={320} name="email" value={form.email} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Country<input maxLength={100} name="country" value={form.country} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Province / state<input maxLength={100} name="province" value={form.province} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Preferred language<input maxLength={100} name="preferredLanguage" value={form.preferredLanguage} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Current immigration status<input maxLength={150} name="currentImmigrationStatus" value={form.currentImmigrationStatus} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Interest<input maxLength={150} name="immigrationInterest" value={form.immigrationInterest} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Preferred contact time<input maxLength={150} name="preferredContactTime" value={form.preferredContactTime} onChange={update} className={fieldClass} placeholder="Weekday afternoons" /></label>
      <label className="text-sm font-medium text-slate-700">Estimated value (CAD)<input type="number" min="0" name="estimatedValue" value={form.estimatedValue} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Temperature<select name="temperature" value={form.temperature} onChange={update} className={fieldClass}>{["COLD", "WARM", "HOT"].map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Inquiry date<input type="date" name="inquiryDate" value={form.inquiryDate} onChange={update} className={fieldClass} /></label>
    </ActionModal>
  );
}

export function QualifyLeadSheet({ lead, onClose, onSaved }) {
  const q = lead.qualification || {};
  const [form, setForm] = useState({
    immigrationService: q.immigrationService || lead.immigrationInterest || "",
    currentCountry: q.currentCountry || lead.country || "",
    currentImmigrationStatus: q.currentImmigrationStatus || lead.currentImmigrationStatus || "",
    statusExpiryDate: q.statusExpiryDate ? q.statusExpiryDate.slice(0, 10) : "",
    preferredDestination: q.preferredDestination || "",
    education: q.education || "",
    workExperience: q.workExperience || "",
    languageTest: q.languageTest || "",
    previousRefusals: q.previousRefusals === true ? "true" : q.previousRefusals === false ? "false" : "",
    familyStatus: q.familyStatus || "",
    estimatedBudget: q.estimatedBudget != null ? String(q.estimatedBudget) : "",
    preferredConsultationAt: toDateTimeLocal(q.preferredConsultationAt),
    urgency: q.urgency || lead.priority || "NORMAL",
    notes: q.notes || "",
    eligibilityConfidence: q.eligibilityConfidence != null ? String(q.eligibilityConfidence) : "",
    outcome: q.outcome || "QUALIFIED",
  });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const notesRequired = ["NOT_ELIGIBLE", "SERVICE_NOT_OFFERED"].includes(form.outcome);
  const { saving, error, submit } = useSubmit(
    () => api.post(`/leads/${lead.id}/qualify`, {
      immigrationService: form.immigrationService,
      currentCountry: form.currentCountry || undefined,
      currentImmigrationStatus: form.currentImmigrationStatus || undefined,
      statusExpiryDate: form.statusExpiryDate ? new Date(form.statusExpiryDate).toISOString() : undefined,
      preferredDestination: form.preferredDestination || undefined,
      education: form.education || undefined,
      workExperience: form.workExperience || undefined,
      languageTest: form.languageTest || undefined,
      previousRefusals: form.previousRefusals === "" ? undefined : form.previousRefusals === "true",
      familyStatus: form.familyStatus || undefined,
      estimatedBudget: form.estimatedBudget === "" ? undefined : Number(form.estimatedBudget),
      preferredConsultationAt: form.preferredConsultationAt ? new Date(form.preferredConsultationAt).toISOString() : undefined,
      urgency: form.urgency || undefined,
      notes: form.notes || undefined,
      eligibilityConfidence: form.eligibilityConfidence === "" ? undefined : Number(form.eligibilityConfidence),
      outcome: form.outcome,
    }),
    onSaved,
  );

  return (
    <ActionModal title="Qualify lead" subtitle="Record eligibility details and the qualification outcome." icon={ClipboardCheck} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Save qualification">
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Outcome<select required name="outcome" value={form.outcome} onChange={update} className={fieldClass}>{QUALIFICATION_OUTCOMES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Immigration service<input required maxLength={150} name="immigrationService" value={form.immigrationService} onChange={update} className={fieldClass} placeholder="Express Entry, Study Permit…" /></label>
      <label className="text-sm font-medium text-slate-700">Eligibility confidence (%)<input type="number" min="0" max="100" name="eligibilityConfidence" value={form.eligibilityConfidence} onChange={update} className={fieldClass} placeholder="70" /></label>
      <label className="text-sm font-medium text-slate-700">Current country<input maxLength={100} name="currentCountry" value={form.currentCountry} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Current immigration status<input maxLength={150} name="currentImmigrationStatus" value={form.currentImmigrationStatus} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Status expiry<input type="date" name="statusExpiryDate" value={form.statusExpiryDate} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700">Preferred destination<input maxLength={150} name="preferredDestination" value={form.preferredDestination} onChange={update} className={fieldClass} placeholder="Ontario, Canada" /></label>
      <label className="text-sm font-medium text-slate-700">Language test<input maxLength={500} name="languageTest" value={form.languageTest} onChange={update} className={fieldClass} placeholder="IELTS 7.0" /></label>
      <label className="text-sm font-medium text-slate-700">Previous refusals<select name="previousRefusals" value={form.previousRefusals} onChange={update} className={fieldClass}><option value="">Unknown</option><option value="false">No</option><option value="true">Yes</option></select></label>
      <label className="text-sm font-medium text-slate-700">Family status<input maxLength={500} name="familyStatus" value={form.familyStatus} onChange={update} className={fieldClass} placeholder="Married, 2 dependents" /></label>
      <label className="text-sm font-medium text-slate-700">Estimated budget (CAD)<input type="number" min="0" name="estimatedBudget" value={form.estimatedBudget} onChange={update} className={fieldClass} placeholder="15000" /></label>
      <label className="text-sm font-medium text-slate-700">Urgency<select name="urgency" value={form.urgency} onChange={update} className={fieldClass}>{PRIORITIES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Preferred consultation<input type="datetime-local" name="preferredConsultationAt" value={form.preferredConsultationAt} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Education<textarea maxLength={1000} name="education" value={form.education} onChange={update} rows={2} className={`${fieldClass} h-auto py-3`} /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Work experience<textarea maxLength={2000} name="workExperience" value={form.workExperience} onChange={update} rows={2} className={`${fieldClass} h-auto py-3`} /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Notes{notesRequired ? " (required for this outcome)" : ""}<textarea required={notesRequired} maxLength={5000} name="notes" value={form.notes} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="Eligibility assessment summary" /></label>
    </ActionModal>
  );
}


export function CreateFollowUpSheet({ lead, staff, currentUserId, onClose, onSaved }) {
  const [form, setForm] = useState({ assignedUserId: currentUserId || lead.ownerUserId || "", type: "PHONE_CALL", description: "", dueAt: localInput(24 * 60 * 60_000) });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const { saving, error, submit } = useSubmit(
    () => api.post(`/leads/${lead.id}/follow-ups`, { ...form, dueAt: new Date(form.dueAt).toISOString() }),
    onSaved,
  );

  return (
    <ActionModal title="Add follow-up" subtitle="Leave one clear next touchpoint with an owner and due date." icon={CheckCircle2} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Create follow-up">
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Assigned to<select required name="assignedUserId" value={form.assignedUserId} onChange={update} className={fieldClass}><option value="">Select team member</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Type<select name="type" value={form.type} onChange={update} className={fieldClass}>{FOLLOW_UP_TYPES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Due<input required type="datetime-local" name="dueAt" value={form.dueAt} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Instruction<textarea required maxLength={1000} name="description" value={form.description} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="Call the lead with appointment options" /></label>
    </ActionModal>
  );
}

export function CloseFollowUpSheet({ lead, followUp, staff, onClose, onSaved }) {
  const requiresNextFollowUp =
    (lead.status === "OPEN" || (lead.status === "NURTURE" && followUp.type === "REACTIVATE")) &&
    !(lead.followUps || []).some((item) => item.id !== followUp.id && item.status === "PENDING");
  const [form, setForm] = useState({
    status: "COMPLETED",
    completionOutcome: "",
    nextFollowUp: {
      assignedUserId: followUp.assignedUserId || lead.ownerUserId || "",
      type: "PHONE_CALL",
      description: "",
      dueAt: localInput(24 * 60 * 60_000),
    },
  });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const updateNext = (event) => setForm((current) => ({
    ...current,
    nextFollowUp: { ...current.nextFollowUp, [event.target.name]: event.target.value },
  }));
  const { saving, error, submit } = useSubmit(
    () => api.patch(`/leads/${lead.id}/follow-ups/${followUp.id}`, {
      status: form.status,
      completionOutcome: form.completionOutcome,
      ...(requiresNextFollowUp
        ? { nextFollowUp: { ...form.nextFollowUp, dueAt: new Date(form.nextFollowUp.dueAt).toISOString() } }
        : {}),
    }),
    onSaved,
  );

  return (
    <ActionModal title="Close follow-up" subtitle={followUp.description} icon={CheckCircle2} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel={form.status === "COMPLETED" ? "Mark completed" : "Cancel follow-up"}>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Result<select name="status" value={form.status} onChange={update} className={fieldClass}><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Outcome<textarea required maxLength={500} name="completionOutcome" value={form.completionOutcome} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="Consultation scheduled" /></label>
      {requiresNextFollowUp ? <><div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:col-span-2"><b>Add the next action.</b> An open lead cannot be left without an assigned follow-up.</div><label className="text-sm font-medium text-slate-700 sm:col-span-2">Assigned to<select required name="assignedUserId" value={form.nextFollowUp.assignedUserId} onChange={updateNext} className={fieldClass}><option value="">Select team member</option>{(staff || []).map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Type<select required name="type" value={form.nextFollowUp.type} onChange={updateNext} className={fieldClass}>{FOLLOW_UP_TYPES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Due<input required type="datetime-local" name="dueAt" value={form.nextFollowUp.dueAt} onChange={updateNext} className={fieldClass} /></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Instruction<textarea required maxLength={1000} name="description" value={form.nextFollowUp.description} onChange={updateNext} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="What needs to happen next?" /></label></> : null}
    </ActionModal>
  );
}

export function ReassignLeadSheet({ lead, staff, onClose, onSaved }) {
  const [form, setForm] = useState({ ownerUserId: "", reason: "" });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const { saving, error, submit } = useSubmit(
    () => api.post(`/leads/${lead.id}/assign`, form),
    onSaved,
  );
  const candidates = staff.filter((person) => person.id !== lead.ownerUserId);

  return (
    <ActionModal title="Reassign lead" subtitle={`Hand ${lead.firstName || "this lead"} to another team member.`} icon={ArrowLeftRight} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Reassign lead">
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">New owner<select required name="ownerUserId" value={form.ownerUserId} onChange={update} className={fieldClass}><option value="">Select team member</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Reason<textarea required maxLength={500} name="reason" value={form.reason} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="Transferred to evening reception queue" /></label>
    </ActionModal>
  );
}

export function NurtureLeadSheet({ lead, onClose, onSaved }) {
  const [form, setForm] = useState({ nurtureUntil: localInput(30 * 24 * 60 * 60_000), reason: "" });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const { saving, error, submit } = useSubmit(
    () => api.post(`/leads/${lead.id}/nurture`, { nurtureUntil: new Date(form.nurtureUntil).toISOString(), reason: form.reason }),
    onSaved,
  );

  return (
    <ActionModal title="Move to nurture" subtitle="Pause active work and pick the date to re-engage." icon={HeartHandshake} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Move to nurture">
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Re-engage on<input required type="datetime-local" name="nurtureUntil" value={form.nurtureUntil} onChange={update} className={fieldClass} /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Reason<textarea required maxLength={1000} name="reason" value={form.reason} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="Client requested contact next month" /></label>
    </ActionModal>
  );
}

export function MarkLostSheet({ lead, initialReasonCode = "NO_RESPONSE", onClose, onSaved }) {
  const [form, setForm] = useState({ reasonCode: initialReasonCode, notes: "", lastContactAt: "", attemptCount: "", reactivationAllowed: false, reactivationAt: "" });
  const update = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  };
  const { saving, error, submit } = useSubmit(
    () => api.post(`/leads/${lead.id}/lost`, {
      reasonCode: form.reasonCode,
      notes: form.notes,
      lastContactAt: form.lastContactAt ? new Date(form.lastContactAt).toISOString() : undefined,
      attemptCount: form.attemptCount === "" ? undefined : Number(form.attemptCount),
      reactivationAllowed: form.reactivationAllowed,
      reactivationAt: form.reactivationAllowed && form.reactivationAt ? new Date(form.reactivationAt).toISOString() : undefined,
    }),
    onSaved,
  );

  return (
    <ActionModal title="Mark lead lost" subtitle="Close this inquiry with an auditable reason." icon={XCircle} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Mark lost" destructive>
      <label className="text-sm font-medium text-slate-700">Reason<select name="reasonCode" value={form.reasonCode} onChange={update} className={fieldClass}>{LOST_REASONS.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Contact attempts<input type="number" min="0" max="100" name="attemptCount" value={form.attemptCount} onChange={update} className={fieldClass} placeholder="3" /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Notes<textarea required maxLength={2000} name="notes" value={form.notes} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="No response after three contact attempts." /></label>
      <label className="text-sm font-medium text-slate-700">Last contact<input type="datetime-local" name="lastContactAt" value={form.lastContactAt} onChange={update} className={fieldClass} /></label>
      <div className="flex flex-col justify-end gap-2">
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700"><input type="checkbox" name="reactivationAllowed" checked={form.reactivationAllowed} onChange={update} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200" />Allow future reactivation</label>
        {form.reactivationAllowed ? <input type="datetime-local" name="reactivationAt" value={form.reactivationAt} onChange={update} className={fieldClass.replace("mt-2 ", "")} aria-label="Reactivation date" /> : null}
      </div>
    </ActionModal>
  );
}

export function ReactivateLeadSheet({ lead, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const { saving, error, submit } = useSubmit(
    () => api.post(`/leads/${lead.id}/reactivate`, { reason }),
    onSaved,
  );
  return <ActionModal title="Reactivate lead" subtitle="Return this lead to the active pipeline with a clear next step." icon={HeartHandshake} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Reactivate lead">
    <label className="text-sm font-medium text-slate-700 sm:col-span-2">Reason<textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className={`${fieldClass} h-auto py-3`} placeholder="The prospective client is ready to continue." /></label>
  </ActionModal>;
}
