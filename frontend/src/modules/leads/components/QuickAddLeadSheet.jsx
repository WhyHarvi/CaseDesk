import { ArrowRight, Check, Phone, UserRoundPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import api from "../../../services/api";

function defaultDueDate() {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

const fieldClass = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white/95 px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-300 focus:ring-4 focus:ring-brand-100";
const initialForm = (ownerUserId = "") => ({
  firstName: "", lastName: "", phone: "", email: "", originalSourceId: "",
  immigrationInterest: "", ownerUserId, nextActionType: "CALL", nextActionDescription: "Make the first contact call",
  nextActionAt: defaultDueDate(), priority: "NORMAL", temperature: "COLD", initialMessage: "",
});

export default function QuickAddLeadSheet({ open, sources, staff, onClose, onCreated }) {
  const { appUser } = useAuth();
  const [form, setForm] = useState(initialForm(appUser?.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(initialForm(appUser?.id || staff[0]?.id || ""));
      setError("");
    }
  }, [open, appUser?.id, staff]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const response = await api.post(
        "/leads",
        { ...form, nextActionOwnerId: form.ownerUserId },
        { timeout: 25_000 },
      );
      onCreated(response.data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The lead could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/20 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quick-add-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close quick add" />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-white/80 bg-gradient-to-b from-[#f9fbfd] to-[#eef3f8] shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200/80 bg-white/90 px-6 py-5 backdrop-blur-xl">
          <div>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[0_8px_20px_rgba(73,104,149,0.24)]"><UserRoundPlus className="h-5 w-5" /></div>
            <h2 id="quick-add-title" className="text-xl font-semibold tracking-tight text-slate-950">Quick add lead</h2>
            <p className="mt-1 text-sm text-slate-500">Capture the inquiry and leave one clear next action.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            <section className="rounded-2xl border border-white/90 bg-white/85 p-5 shadow-[0_10px_30px_rgba(28,45,74,0.07)] backdrop-blur-xl">
              <h3 className="text-sm font-semibold text-slate-900">Contact</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">First name<input name="firstName" value={form.firstName} onChange={update} className={fieldClass} placeholder="First name" /></label>
                <label className="text-sm font-medium text-slate-700">Last name<input name="lastName" value={form.lastName} onChange={update} className={fieldClass} placeholder="Last name" /></label>
                <label className="text-sm font-medium text-slate-700"><span>Phone <b className="text-rose-500">*</b></span><div className="relative"><Phone className="absolute left-3.5 top-5.5 h-4 w-4 text-slate-400" /><input required name="phone" value={form.phone} onChange={update} className={`${fieldClass} pl-10`} placeholder="+1 416 555 0123" /></div></label>
                <label className="text-sm font-medium text-slate-700">Email<input type="email" name="email" value={form.email} onChange={update} className={fieldClass} placeholder="name@example.ca" /></label>
              </div>
            </section>

            <section className="rounded-2xl border border-white/90 bg-white/85 p-5 shadow-[0_10px_30px_rgba(28,45,74,0.07)] backdrop-blur-xl">
              <h3 className="text-sm font-semibold text-slate-900">Intake</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700"><span>Source <b className="text-rose-500">*</b></span><select required name="originalSourceId" value={form.originalSourceId} onChange={update} className={fieldClass}><option value="">Select source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                <label className="text-sm font-medium text-slate-700">Immigration interest<input name="immigrationInterest" value={form.immigrationInterest} onChange={update} className={fieldClass} placeholder="Study permit" /></label>
                <label className="text-sm font-medium text-slate-700"><span>Assigned employee <b className="text-rose-500">*</b></span><select required name="ownerUserId" value={form.ownerUserId} onChange={update} className={fieldClass}><option value="">Select employee</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
                <label className="text-sm font-medium text-slate-700">Priority<select name="priority" value={form.priority} onChange={update} className={fieldClass}><option>NORMAL</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></label>
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">Initial message<textarea name="initialMessage" value={form.initialMessage} onChange={update} rows={3} className={`${fieldClass} h-auto py-3`} placeholder="What does the person need help with?" /></label>
              </div>
            </section>

            <section className="rounded-2xl border border-brand-200/70 bg-brand-50/80 p-5 shadow-[0_10px_28px_rgba(73,104,149,0.08)]">
              <div className="flex items-center gap-2 text-sm font-semibold text-brand-900"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><Check className="h-4 w-4" /></span> Next action</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Action<select name="nextActionType" value={form.nextActionType} onChange={update} className={fieldClass}><option value="CALL">Call lead</option><option value="SEND_MESSAGE">Send introduction</option><option value="BOOK_CONSULTATION">Book consultation</option><option value="REVIEW">Review inquiry</option></select></label>
                <label className="text-sm font-medium text-slate-700">Due date and time<input required type="datetime-local" name="nextActionAt" value={form.nextActionAt} onChange={update} className={fieldClass} /></label>
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">Instruction<input required name="nextActionDescription" value={form.nextActionDescription} onChange={update} className={fieldClass} /></label>
              </div>
            </section>
          </div>

          <footer className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
            <button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">Cancel</button>
            <button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(73,104,149,0.22)] transition hover:bg-brand-700 disabled:opacity-50">{saving ? "Saving…" : "Create lead"}<ArrowRight className="h-4 w-4" /></button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
