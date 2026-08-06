import { ClipboardCheck, X } from "lucide-react";
import { useState } from "react";
import api from "../../../services/api";
import { humanize } from "../leadPresentation";

const outcomes = ["READY_TO_PROCEED", "AGREEMENT_REQUIRED", "PAYMENT_REQUIRED", "FOLLOW_UP_REQUIRED", "NOT_ELIGIBLE", "NOT_INTERESTED", "FUTURE_OPPORTUNITY", "LOST"];
const statuses = ["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"];
const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

export default function CompleteConsultationSheet({ lead, consultation, onClose, onSaved }) {
  const [form, setForm] = useState({ status: "COMPLETED", outcome: consultation?.outcome || "", notes: consultation?.notes || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (form.status === "COMPLETED" && !form.outcome) return;
    try {
      setSaving(true);
      setError("");
      const response = await api.patch(`/leads/${lead.id}/consultations/${consultation.id}`, {
        status: form.status,
        outcome: form.status === "COMPLETED" ? form.outcome : undefined,
        notes: form.notes || undefined,
      });
      onSaved(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The consultation could not be completed.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[720] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="complete-consultation-title">
    <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close consultation outcome" />
    <form onSubmit={submit} className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/80 bg-[#f7f9fc] shadow-[0_30px_100px_rgba(15,23,42,0.3)]">
      <header className="flex items-start justify-between border-b border-slate-200/70 bg-white/90 px-6 py-5"><div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><ClipboardCheck className="h-5 w-5" /></div><h2 id="complete-consultation-title" className="text-xl font-semibold tracking-tight text-slate-950">Complete consultation</h2><p className="mt-1 text-sm text-slate-500">Record the result for {lead.firstName || "this lead"} and create the correct next action.</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"><X className="h-4 w-4" /></button></header>
      <div className="space-y-4 p-6">
        {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        <label className="block text-sm font-medium text-slate-700">Result<select name="status" value={form.status} onChange={update} className={fieldClass}>{statuses.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        {form.status === "COMPLETED" ? <label className="block text-sm font-medium text-slate-700">Outcome<select required name="outcome" value={form.outcome} onChange={update} className={fieldClass}><option value="">Choose an outcome</option>{outcomes.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label> : null}
        <label className="block text-sm font-medium text-slate-700">Consultation notes<textarea name="notes" value={form.notes} onChange={update} rows={4} className={`${fieldClass} h-auto py-3`} placeholder="Key advice, decision, and next steps" /></label>
      </div>
      <footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4"><button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving || (form.status === "COMPLETED" && !form.outcome)} className="h-10 rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">{saving ? "Saving…" : "Save outcome"}</button></footer>
    </form>
  </div>;
}
