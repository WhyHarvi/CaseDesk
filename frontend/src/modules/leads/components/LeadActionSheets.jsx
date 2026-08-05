import { ArrowLeftRight, CheckCircle2, HeartHandshake, PhoneIncoming, UserPen, X, XCircle } from "lucide-react";
import { useState } from "react";
import api from "../../../services/api";
import { humanize } from "../leadPresentation";

const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

const ACTIVITY_TYPES = ["INCOMING_CALL", "OUTGOING_CALL", "MISSED_CALL", "WHATSAPP_RECEIVED", "WHATSAPP_SENT", "SMS_RECEIVED", "SMS_SENT", "EMAIL_RECEIVED", "EMAIL_SENT", "INTERNAL_NOTE"];
const ACTIVITY_DIRECTIONS = ["INBOUND", "OUTBOUND", "INTERNAL"];
const ACTIVITY_CHANNELS = ["PHONE", "WHATSAPP", "SMS", "EMAIL", "SOCIAL", "WEBSITE", "IN_PERSON", "OTHER"];
const FOLLOW_UP_TYPES = ["PHONE_CALL", "EMAIL", "SMS", "WHATSAPP", "MEETING", "DOCUMENT_REQUEST", "OTHER"];
const LOST_REASONS = ["NO_RESPONSE", "NOT_INTERESTED", "NOT_ELIGIBLE", "PRICE_CONCERN", "SELECTED_ANOTHER_CONSULTANT", "CONSULTATION_NO_SHOW", "AGREEMENT_NOT_SIGNED", "PAYMENT_NOT_COMPLETED", "SERVICE_NOT_OFFERED", "WRONG_CONTACT_INFORMATION", "DUPLICATE", "DO_NOT_CONTACT", "OTHER"];

function localInput(offsetMs = 0) {
  const date = new Date(Date.now() + offsetMs);
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
  const [form, setForm] = useState({ activityType: "INCOMING_CALL", direction: "INBOUND", channel: "PHONE", title: "", description: "", outcome: "", durationMinutes: "", occurredAt: localInput() });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
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
    </ActionModal>
  );
}

export function EditLeadDetailsSheet({ lead, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName: lead.firstName || "", lastName: lead.lastName || "", phone: lead.phone || "", email: lead.email || "",
    country: lead.country || "", province: lead.province || "", preferredLanguage: lead.preferredLanguage || "",
    currentImmigrationStatus: lead.currentImmigrationStatus || "", immigrationInterest: lead.immigrationInterest || "",
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
      <label className="text-sm font-medium text-slate-700">Inquiry date<input type="date" name="inquiryDate" value={form.inquiryDate} onChange={update} className={fieldClass} /></label>
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

export function CloseFollowUpSheet({ lead, followUp, onClose, onSaved }) {
  const [form, setForm] = useState({ status: "COMPLETED", completionOutcome: "" });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const { saving, error, submit } = useSubmit(
    () => api.patch(`/leads/${lead.id}/follow-ups/${followUp.id}`, form),
    onSaved,
  );

  return (
    <ActionModal title="Close follow-up" subtitle={followUp.description} icon={CheckCircle2} onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel={form.status === "COMPLETED" ? "Mark completed" : "Cancel follow-up"}>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Result<select name="status" value={form.status} onChange={update} className={fieldClass}><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Outcome<textarea required maxLength={500} name="completionOutcome" value={form.completionOutcome} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="Consultation scheduled" /></label>
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

export function MarkLostSheet({ lead, onClose, onSaved }) {
  const [form, setForm] = useState({ reasonCode: "NO_RESPONSE", notes: "", lastContactAt: "", attemptCount: "", reactivationAllowed: false, reactivationAt: "" });
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
