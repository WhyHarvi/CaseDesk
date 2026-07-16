import { CalendarPlus, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import api from "../../../services/api";

function localInput(date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return copy.toISOString().slice(0, 16);
}

function initialForm(ownerId, timezone) {
  const start = new Date(Date.now() + 24 * 60 * 60_000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { consultantUserId: ownerId || "", startAt: localInput(start), endAt: localInput(end), timezone: timezone || "America/Toronto", appointmentType: "VIDEO", location: "", meetingUrl: "", fee: "", paymentStatus: "UNPAID", notes: "" };
}

const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

export default function BookConsultationSheet({ lead, staff, onClose, onCreated }) {
  const { agency } = useAuth();
  const consultants = staff.filter((person) => person.role === "consultant");
  const preferredConsultant = consultants.some((person) => person.id === lead.ownerUserId) ? lead.ownerUserId : consultants[0]?.id;
  const [form, setForm] = useState(() => initialForm(preferredConsultant, agency?.timezone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const response = await api.post(`/leads/${lead.id}/consultations`, form, { timeout: 25_000 });
      onCreated(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The consultation could not be scheduled.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="book-consultation-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close consultation form" />
      <form onSubmit={submit} className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-[#f7f9fc] shadow-[0_30px_100px_rgba(15,23,42,0.3)]">
        <header className="flex items-start justify-between border-b border-slate-200/70 bg-white/90 px-6 py-5">
          <div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><CalendarPlus className="h-5 w-5" /></div><h2 id="book-consultation-title" className="text-xl font-semibold tracking-tight text-slate-950">Book consultation</h2><p className="mt-1 text-sm text-slate-500">Schedule a consultation for {lead.firstName || "this lead"}.</p></div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:col-span-2">{error}</div> : null}
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Consultant<select required name="consultantUserId" value={form.consultantUserId} onChange={update} className={fieldClass}><option value="">Select consultant</option>{consultants.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Starts<input required type="datetime-local" name="startAt" value={form.startAt} onChange={update} className={fieldClass} /></label>
          <label className="text-sm font-medium text-slate-700">Ends<input required type="datetime-local" name="endAt" value={form.endAt} onChange={update} className={fieldClass} /></label>
          <label className="text-sm font-medium text-slate-700">Type<select name="appointmentType" value={form.appointmentType} onChange={update} className={fieldClass}><option value="VIDEO">Video</option><option value="PHONE">Phone</option><option value="IN_PERSON">In person</option></select></label>
          <label className="text-sm font-medium text-slate-700">Timezone<input required name="timezone" value={form.timezone} onChange={update} className={fieldClass} /></label>
          <label className="text-sm font-medium text-slate-700">Location<input name="location" value={form.location} onChange={update} className={fieldClass} placeholder="Office or room" /></label>
          <label className="text-sm font-medium text-slate-700">Meeting URL<input type="url" name="meetingUrl" value={form.meetingUrl} onChange={update} className={fieldClass} placeholder="https://…" /></label>
          <label className="text-sm font-medium text-slate-700">Fee (CAD)<input type="number" min="0" step="0.01" name="fee" value={form.fee} onChange={update} className={fieldClass} placeholder="0.00" /></label>
          <label className="text-sm font-medium text-slate-700">Payment<select name="paymentStatus" value={form.paymentStatus} onChange={update} className={fieldClass}><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option><option value="WAIVED">Waived</option><option value="REFUNDED">Refunded</option></select></label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Notes<textarea name="notes" value={form.notes} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} /></label>
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4"><button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving || !consultants.length} className="h-10 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">{saving ? "Scheduling…" : "Schedule consultation"}</button></footer>
      </form>
    </div>
  );
}
