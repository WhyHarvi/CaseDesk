import { Landmark, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import api from "../../../services/api";
import { humanize } from "../leadPresentation";

const retainerStatuses = ["NOT_REQUIRED", "NOT_PREPARED", "PREPARED", "SENT", "VIEWED", "SIGNED", "DECLINED", "EXPIRED"];
const paymentStatuses = ["NOT_REQUESTED", "REQUESTED", "PARTIAL", "PAID", "FAILED", "REFUNDED", "WAIVED"];
const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100";

export default function LeadCommercialStatusSheet({ lead, onClose, onUpdated }) {
  const { role, appUser } = useAuth();
  const ownsLead = lead.ownerUserId === appUser?.id;
  const canConfirmSensitive = role === "admin" || ownsLead;
  const [form, setForm] = useState({ retainerStatus: lead.retainerStatus, initialPaymentStatus: lead.initialPaymentStatus, notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const retainerChanged = form.retainerStatus !== lead.retainerStatus;
  const paymentChanged = form.initialPaymentStatus !== lead.initialPaymentStatus;
  const sensitive = (retainerChanged && form.retainerStatus === "SIGNED")
    || (paymentChanged && ["PAID", "WAIVED"].includes(form.initialPaymentStatus));

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const response = await api.patch(`/leads/${lead.id}/commercial-status`, {
        ...(retainerChanged ? { retainerStatus: form.retainerStatus } : {}),
        ...(paymentChanged ? { initialPaymentStatus: form.initialPaymentStatus } : {}),
        notes: form.notes,
      }, { timeout: 25_000 });
      onUpdated(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The statuses could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="commercial-status-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close status form" />
      <form onSubmit={submit} className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/80 bg-[#f7f9fc] shadow-[0_30px_100px_rgba(15,23,42,0.3)]">
        <header className="flex items-start justify-between border-b border-slate-200/70 bg-white/90 px-6 py-5"><div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><Landmark className="h-5 w-5" /></div><h2 id="commercial-status-title" className="text-xl font-semibold tracking-tight text-slate-950">Retainer and payment</h2><p className="mt-1 text-sm text-slate-500">Update the lead’s progress toward conversion.</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button></header>
        <div className="space-y-4 p-6">
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          <label className="block text-sm font-medium text-slate-700">Retainer status<select name="retainerStatus" value={form.retainerStatus} onChange={update} className={fieldClass}>{retainerStatuses.map((status) => <option key={status} value={status}>{humanize(status)}</option>)}</select></label>
          <label className="block text-sm font-medium text-slate-700">Initial-payment status<select name="initialPaymentStatus" value={form.initialPaymentStatus} onChange={update} className={fieldClass}>{paymentStatuses.map((status) => <option key={status} value={status}>{humanize(status)}</option>)}</select></label>
          <label className="block text-sm font-medium text-slate-700">Evidence note{sensitive ? " (required)" : ""}<textarea required={sensitive} name="notes" value={form.notes} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="Signed copy location, invoice number, or reason for the override" /></label>
          {sensitive && !canConfirmSensitive ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Only an admin or this lead's assigned consultant can confirm a signed retainer or received payment.</p> : null}
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4"><button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving || (!retainerChanged && !paymentChanged) || (sensitive && !canConfirmSensitive)} className="h-10 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">{saving ? "Updating…" : "Update status"}</button></footer>
      </form>
    </div>
  );
}
