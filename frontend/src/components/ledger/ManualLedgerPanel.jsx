import { Landmark, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../services/api";

const money = (value) => Number(value || 0).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

const statusTone = {
  Paid: "bg-emerald-50 text-emerald-700",
  "Partially Paid": "bg-amber-50 text-amber-700",
  Unpaid: "bg-slate-100 text-slate-600",
};

function AddEntryForm({ onCancel, onSave }) {
  const [form, setForm] = useState({ label: "", amountOwed: "", amountPaid: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({ label: form.label, amountOwed: Number(form.amountOwed) || 0, amountPaid: Number(form.amountPaid) || 0, note: form.note || null });
    } catch (reason) {
      setError(reason.response?.data?.message || "The entry could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">
          Label
          <input required value={form.label} onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))} placeholder="e.g. Registration Fee" className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Amount owed
          <input required type="number" min="0" step="0.01" value={form.amountOwed} onChange={(e) => setForm((c) => ({ ...c, amountOwed: e.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Amount paid so far
          <input type="number" min="0" step="0.01" value={form.amountPaid} onChange={(e) => setForm((c) => ({ ...c, amountPaid: e.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
        </label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2">
          Note (optional)
          <input value={form.note} onChange={(e) => setForm((c) => ({ ...c, note: e.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
        </label>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 rounded-full px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        <button disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-3.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? "Saving…" : "Add entry"}
        </button>
      </div>
    </form>
  );
}

// Manual, QuickBooks-independent record of what's owed/paid — used on both
// leads (before conversion) and cases (after). One entry = one line item
// (e.g. "Registration Fee"), not a full invoice.
export default function ManualLedgerPanel({ leadId, caseId }) {
  const basePath = leadId ? `/leads/${leadId}/ledger` : `/cases/${caseId}/ledger`;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  function load() {
    setLoading(true);
    api.get(basePath)
      .then((response) => { setEntries(response.data.data); setError(""); })
      .catch((reason) => setError(reason.response?.data?.message || "Payment records could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [basePath]);

  async function addEntry(payload) {
    const { data } = await api.post(basePath, payload);
    setEntries((current) => [...current, data.data]);
    setAdding(false);
  }

  async function markPaidInFull(entry) {
    const { data } = await api.patch(`${basePath}/${entry.id}`, { amountPaid: Number(entry.amountOwed) });
    setEntries((current) => current.map((item) => (item.id === entry.id ? data.data : item)));
  }

  async function removeEntry(entry) {
    if (!window.confirm(`Remove "${entry.label}"?`)) return;
    await api.delete(`${basePath}/${entry.id}`);
    setEntries((current) => current.filter((item) => item.id !== entry.id));
  }

  const totalOwed = entries.reduce((sum, item) => sum + Number(item.amountOwed || 0), 0);
  const totalPaid = entries.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);

  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Landmark className="h-4 w-4 text-slate-400" />Payments</h3>
          <p className="mt-1 text-xs text-slate-500">Tracked here directly — separate from QuickBooks.</p>
        </div>
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-3.5 text-xs font-semibold text-white hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" />Add entry
          </button>
        ) : null}
      </div>

      {entries.length ? (
        <div className="mb-3 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-[11px] text-slate-400">Total owed</p><p className="mt-1 text-sm font-semibold text-slate-800">{money(totalOwed)}</p></div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-[11px] text-slate-400">Total paid</p><p className="mt-1 text-sm font-semibold text-emerald-700">{money(totalPaid)}</p></div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-[11px] text-slate-400">Balance</p><p className="mt-1 text-sm font-semibold text-rose-600">{money(totalOwed - totalPaid)}</p></div>
        </div>
      ) : null}

      {adding ? <div className="mb-3"><AddEntryForm onCancel={() => setAdding(false)} onSave={addEntry} /></div> : null}

      {error ? <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">{error}</div> : null}

      {loading ? (
        <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
      ) : entries.length ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
          {entries.map((entry, index) => {
            const balance = Number(entry.amountOwed) - Number(entry.amountPaid);
            return (
              <div key={entry.id} className={`flex items-start justify-between gap-4 px-5 py-4 ${index ? "border-t border-slate-100" : ""}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{entry.label}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone[entry.status] || statusTone.Unpaid}`}>{entry.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{money(entry.amountPaid)} paid of {money(entry.amountOwed)}{balance > 0 ? ` · ${money(balance)} owing` : ""}</p>
                  {entry.note ? <p className="mt-1 text-xs text-slate-400">{entry.note}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {balance > 0 ? <button type="button" onClick={() => markPaidInFull(entry)} className="h-8 rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">Mark paid</button> : null}
                  <button type="button" onClick={() => removeEntry(entry)} aria-label={`Remove ${entry.label}`} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      ) : !adding ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/45 px-4 py-6 text-center text-sm text-slate-500">No payment records yet.</div>
      ) : null}
    </section>
  );
}
