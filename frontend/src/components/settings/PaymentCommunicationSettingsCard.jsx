import { Check, Loader2, Mail, MessageSquareText, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { getPaymentCommunicationSettings, updatePaymentCommunicationSettings } from "../../api/paymentScheduleApi";

const card = "rounded-[1.4rem] border border-white/70 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-slate-300/90"}`}
    >
      <span className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${checked ? "left-[20px]" : "left-[2px]"}`} />
    </button>
  );
}

export default function PaymentCommunicationSettingsCard() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPaymentCommunicationSettings()
      .then((data) => active && setForm(data))
      .catch(() => active && setError("Payment communication settings could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await updatePaymentCommunicationSettings(form);
      setForm(updated);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(reason.response?.data?.message || "These settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className={`${card} flex items-center gap-2 text-sm text-slate-500`}><Loader2 className="h-4 w-4 animate-spin" /> Loading payment communication settings…</div>;
  }
  if (!form) return null;

  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-5">
      <section className={card}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Wallet className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">How to pay</h3>
            <p className="text-xs text-slate-500">Shown to clients in the portal and included in every payment email.</p>
          </div>
        </div>
        <textarea
          rows={3}
          value={form.paymentInstructions}
          onChange={(event) => set("paymentInstructions")(event.target.value)}
          placeholder="E-transfer to payments@youragency.ca. Include your case number in the message."
          className={`${inputClass} resize-none`}
        />
      </section>

      <section className={card}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Mail className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Email notification</h3>
            <p className="text-xs text-slate-500">Sent when a scheduled installment becomes a real invoice.</p>
          </div>
          <div className="ml-auto"><Toggle checked={form.notifyByEmail} onChange={set("notifyByEmail")} label="Notify by email" /></div>
        </div>
        <label className="mt-3 block text-[11px] font-medium text-slate-500">Subject
          <input value={form.emailSubjectTemplate} onChange={(event) => set("emailSubjectTemplate")(event.target.value)} placeholder="New payment due — {{installmentLabel}}" className={inputClass} />
        </label>
        <label className="mt-3 block text-[11px] font-medium text-slate-500">Body
          <textarea rows={6} value={form.emailBodyTemplate} onChange={(event) => set("emailBodyTemplate")(event.target.value)} placeholder="Leave blank to use the default wording" className={`${inputClass} resize-none font-mono text-xs`} />
        </label>
      </section>

      <section className={card}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><MessageSquareText className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">SMS notification</h3>
            <p className="text-xs text-slate-500">Requires Phone & SMS connected in Settings.</p>
          </div>
          <div className="ml-auto"><Toggle checked={form.notifyBySms} onChange={set("notifyBySms")} label="Notify by SMS" /></div>
        </div>
        <label className="mt-3 block text-[11px] font-medium text-slate-500">Message
          <textarea rows={2} value={form.smsTemplate} onChange={(event) => set("smsTemplate")(event.target.value)} placeholder="Leave blank to use the default wording" className={`${inputClass} resize-none font-mono text-xs`} />
        </label>
      </section>

      <section className={card}>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Available placeholders</h3>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {form.placeholders.map((placeholder) => (
            <code key={placeholder} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-mono text-slate-600">{`{{${placeholder}}}`}</code>
          ))}
        </div>
      </section>

      {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4 text-emerald-300" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save payment communication settings"}
      </button>
    </div>
  );
}
