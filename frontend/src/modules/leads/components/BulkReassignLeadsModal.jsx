import { Shuffle, X } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../../../services/api";
import { humanize } from "../leadPresentation";

export default function BulkReassignLeadsModal({ open, leadCount, leadIds, staff, onClose, onDone }) {
  const [selectedStaffIds, setSelectedStaffIds] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedStaffIds(new Set());
      setError("");
    }
  }, [open]);

  if (!open) return null;

  function toggleStaff(id) {
    setSelectedStaffIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllStaff() {
    setSelectedStaffIds((current) => (current.size === staff.length ? new Set() : new Set(staff.map((person) => person.id))));
  }

  async function submit(event) {
    event.preventDefault();
    if (!selectedStaffIds.size) return;
    try {
      setSaving(true);
      setError("");
      const response = await api.post("/leads/reassign-bulk", { leadIds, targetUserIds: [...selectedStaffIds] });
      onDone(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Leads could not be reassigned.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="bulk-reassign-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close reassign form" />
      <form onSubmit={submit} className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/80 bg-[#f7f9fc] shadow-[0_30px_100px_rgba(15,23,42,0.3)]">
        <header className="flex items-start justify-between border-b border-slate-200/70 bg-white/90 px-6 py-5">
          <div>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><Shuffle className="h-5 w-5" /></div>
            <h2 id="bulk-reassign-title" className="text-xl font-semibold tracking-tight text-slate-950">Reassign {leadCount} lead{leadCount === 1 ? "" : "s"}</h2>
            <p className="mt-1 text-sm text-slate-500">Pick who should pick these up — leads go to whoever you choose next has the fewest open leads, so the pile evens out.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Team members</span>
            <button type="button" onClick={toggleSelectAllStaff} className="text-xs font-semibold text-brand-700 hover:underline">{selectedStaffIds.size === staff.length ? "Clear all" : "Select all"}</button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {staff.map((person) => {
              const checked = selectedStaffIds.has(person.id);
              return (
                <li key={person.id}>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition ${checked ? "border-brand-300 bg-brand-50/70" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleStaff(person.id)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200" />
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{person.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{person.fullName}</span>
                      <span className="block text-xs text-slate-400">{humanize(person.role)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <span className="text-xs text-slate-400">{selectedStaffIds.size} selected</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button disabled={saving || !selectedStaffIds.size} className="inline-flex h-10 items-center justify-center rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Reassigning…" : selectedStaffIds.size ? `Reassign to ${selectedStaffIds.size} ${selectedStaffIds.size === 1 ? "person" : "people"}` : "Reassign"}</button>
          </div>
        </footer>
      </form>
    </div>
  );
}
