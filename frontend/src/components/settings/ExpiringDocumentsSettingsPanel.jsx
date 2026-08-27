import { Check, ChevronRight, Clock3, FileWarning, Loader2, Mail, MessageSquareText, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100";

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 disabled:opacity-50 ${checked ? "bg-slate-950" : "bg-slate-200"}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-300 ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Overlay({ children, onClose, labelledBy }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose} className="fixed inset-0 z-[10001] flex items-end justify-center bg-slate-950/30 p-0 backdrop-blur-md sm:items-center sm:p-6">
      <motion.div initial={{ opacity: 0, y: 22, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.99 }} transition={{ type: "spring", stiffness: 380, damping: 34 }} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] border border-white/80 bg-white/95 shadow-[0_32px_100px_rgba(15,23,42,0.24)] backdrop-blur-2xl sm:max-h-[88vh] sm:rounded-[28px]">
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function Preview({ policy, preview, onClose }) {
  return (
    <Overlay onClose={onClose} labelledBy="expiry-preview-title">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Expiration notice preview</p><h2 id="expiry-preview-title" className="mt-1 truncate text-xl font-semibold tracking-[-0.02em] text-slate-950">{policy.documentName} Reminder</h2></div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-950"><X className="h-4 w-4" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-4 py-5 sm:px-6">
        <article className="mx-auto max-w-xl overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_16px_50px_rgba(15,23,42,0.08)]">
          <div className="border-b border-slate-100 px-5 py-4"><p className="text-[11px] font-medium text-slate-400">Subject</p><p className="mt-1 text-sm font-semibold text-slate-900">{preview.subject}</p></div>
          <div className="whitespace-pre-wrap px-5 py-6 text-[14px] leading-7 text-slate-700">{preview.message}</div>
        </article>
        {policy.smsEnabled ? <div className="mx-auto mt-4 max-w-xl"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">SMS preview</p><p className="w-fit max-w-[88%] rounded-[20px] rounded-bl-md bg-slate-950 px-4 py-3 text-[13px] leading-5 text-white">{preview.sms}</p></div> : null}
      </main>
    </Overlay>
  );
}

function Editor({ policy, placeholders, saving, error, onClose, onSave, onPreview }) {
  const [form, setForm] = useState(() => ({ ...policy }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Overlay onClose={onClose} labelledBy="expiry-edit-title">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Expiration policy</p><h2 id="expiry-edit-title" className="mt-1 truncate text-xl font-semibold tracking-[-0.02em] text-slate-950">Edit {policy.documentName} Reminder</h2></div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-950"><X className="h-4 w-4" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-[12px] font-semibold text-slate-600">Start before expiration<div className="relative"><input type="number" min="1" max="730" value={form.leadDays} onChange={(event) => set("leadDays", Number(event.target.value))} className={`${inputClass} pr-14`} /><span className="pointer-events-none absolute bottom-2.5 right-3 text-[12px] text-slate-400">days</span></div></label>
          <label className="text-[12px] font-semibold text-slate-600">Repeat every<div className="relative"><input type="number" min="1" max="365" value={form.cadenceDays} onChange={(event) => set("cadenceDays", Number(event.target.value))} className={`${inputClass} pr-14`} /><span className="pointer-events-none absolute bottom-2.5 right-3 text-[12px] text-slate-400">days</span></div></label>
          <label className="text-[12px] font-semibold text-slate-600">Maximum reminders<input type="number" min="1" max="12" value={form.maxReminders} onChange={(event) => set("maxReminders", Number(event.target.value))} className={inputClass} /></label>
        </div>

        <div className="mt-6 space-y-3 border-y border-slate-100 py-4">
          <label className="flex items-center justify-between gap-4 text-[13px] font-medium text-slate-700"><span>Notify the client about expiration</span><Toggle checked={form.notifyClient} onChange={(value) => set("notifyClient", value)} label="Notify client" /></label>
          <div className={`flex flex-wrap gap-x-6 gap-y-3 transition ${form.notifyClient ? "" : "pointer-events-none opacity-40"}`}>
            <label className="flex items-center gap-2.5 text-[13px] font-medium text-slate-700"><input type="checkbox" checked={form.emailEnabled} onChange={(event) => set("emailEnabled", event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-slate-950" /><Mail className="h-4 w-4 text-slate-400" /> Email</label>
            <label className="flex items-center gap-2.5 text-[13px] font-medium text-slate-700"><input type="checkbox" checked={form.smsEnabled} onChange={(event) => set("smsEnabled", event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-slate-950" /><MessageSquareText className="h-4 w-4 text-slate-400" /> SMS through Twilio</label>
          </div>
        </div>

        <label className="mt-5 block text-[12px] font-semibold text-slate-600">Email subject<input value={form.subjectTemplate} onChange={(event) => set("subjectTemplate", event.target.value)} className={inputClass} /></label>
        <label className="mt-4 block text-[12px] font-semibold text-slate-600">Email message<textarea rows={8} value={form.messageTemplate} onChange={(event) => set("messageTemplate", event.target.value)} className={`${inputClass} resize-y leading-6`} /></label>
        <label className="mt-4 block text-[12px] font-semibold text-slate-600">SMS message<textarea rows={3} value={form.smsTemplate} onChange={(event) => set("smsTemplate", event.target.value)} className={`${inputClass} resize-y leading-5`} /></label>
        <div className="mt-4 flex flex-wrap gap-1.5">{placeholders.map((placeholder) => <code key={placeholder} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-500">{`{{${placeholder}}}`}</code>)}</div>
        {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3.5 py-3 text-[13px] text-rose-700">{error}</p> : null}
      </main>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={() => onPreview(form)} className="text-[13px] font-semibold text-slate-600 transition hover:text-slate-950">Preview changes</button>
        <div className="flex items-center gap-2"><button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-[13px] font-semibold text-slate-500 transition hover:bg-slate-100">Cancel</button><button type="button" disabled={saving} onClick={() => onSave(form)} className="inline-flex min-w-24 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save</button></div>
      </footer>
    </Overlay>
  );
}

export default function ExpiringDocumentsSettingsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [editing, setEditing] = useState(null);
  const [previewPolicy, setPreviewPolicy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.getFresh("/settings/expiring-document-reminders")
      .then((response) => { if (active) setData(response.data.data); })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Expiring document settings could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function update(policy, changes, close = false) {
    setBusyKey(policy.documentKey);
    setError("");
    try {
      const response = await api.patch(`/settings/expiring-document-reminders/${policy.documentKey}`, changes);
      setData(response.data.data);
      if (close) setEditing(null);
    } catch (reason) {
      setError(reason.response?.data?.message || "This expiration policy could not be saved.");
    } finally {
      setBusyKey("");
    }
  }

  async function showPreview(policy) {
    setBusyKey(policy.documentKey);
    setError("");
    try {
      const response = await api.post(`/settings/expiring-document-reminders/${policy.documentKey}/preview`, policy);
      setPreview(response.data.data);
      setPreviewPolicy(policy);
    } catch (reason) {
      setError(reason.response?.data?.message || "The expiration preview could not be prepared.");
    } finally {
      setBusyKey("");
    }
  }

  if (loading) return <div className="flex min-h-52 items-center justify-center gap-2 text-[13px] text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading expiring documents…</div>;

  return (
    <div className="pt-6">
      <div className="flex items-start gap-3 border-b border-slate-100 pb-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><FileWarning className="h-[18px] w-[18px]" /></span>
        <div><h3 className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">Expiring Documents</h3><p className="mt-1 max-w-2xl text-[13px] leading-5 text-slate-500">Use personal and case information already stored in CaseDesk to notify teams and clients about upcoming expirations.</p></div>
      </div>

      <div className="divide-y divide-slate-100">
        {(data?.policies || []).map((policy) => {
          const busy = busyKey === policy.documentKey;
          return (
            <motion.section key={policy.id} layout className="py-5">
              <div className="flex items-start gap-3 sm:gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500"><FileWarning className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div><h4 className="text-[15px] font-semibold leading-5 text-slate-950">{policy.documentName} Reminders</h4><p className="mt-1 text-[13px] leading-5 text-slate-500">Sent within {policy.leadDays === 183 ? "6 months" : `${policy.leadDays} days`} of expiration</p></div>
                    <div className="flex items-center gap-2"><button type="button" disabled={busy} onClick={() => showPreview(policy)} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50">Preview</button><button type="button" disabled={busy} onClick={() => { setError(""); setEditing(policy); }} className="inline-flex items-center gap-0.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50">Edit <ChevronRight className="h-3.5 w-3.5" /></button></div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 text-[12px] sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex w-fit items-center gap-2 text-slate-500"><input type="checkbox" checked={policy.notifyClient} disabled={busy} onChange={(event) => update(policy, { notifyClient: event.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-slate-950 disabled:opacity-50" /> Notify client of expiration</label>
                    <div className="flex items-center gap-2"><span className={`font-semibold ${policy.enabled ? "text-emerald-600" : "text-slate-400"}`}>{busy ? "Saving…" : policy.enabled ? "Active" : "Paused"}</span><Toggle checked={policy.enabled} disabled={busy} onChange={(enabled) => update(policy, { enabled })} label={`${policy.documentName} reminder status`} /></div>
                  </div>
                </div>
              </div>
            </motion.section>
          );
        })}
      </div>
      <div className="mt-2 flex items-start gap-2.5 border-t border-slate-100 pt-5 text-[12px] leading-5 text-slate-400"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><p>CaseDesk checks the client’s Identity &amp; Permits profile, primary identification, and case-level Canadian status. Matching records are deduplicated before reminders are scheduled.</p></div>
      {error && !editing ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</p> : null}

      <AnimatePresence>
        {editing ? <Editor key={`expiry-edit-${editing.id}`} policy={editing} placeholders={data?.placeholders || []} saving={busyKey === editing.documentKey} error={error} onClose={() => { setEditing(null); setError(""); }} onSave={(form) => update(editing, form, true)} onPreview={showPreview} /> : null}
        {previewPolicy && preview ? <Preview key={`expiry-preview-${previewPolicy.documentKey}`} policy={previewPolicy} preview={preview} onClose={() => { setPreviewPolicy(null); setPreview(null); }} /> : null}
      </AnimatePresence>
    </div>
  );
}
