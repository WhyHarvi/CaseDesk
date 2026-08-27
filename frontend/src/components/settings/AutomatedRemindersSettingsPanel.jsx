import {
  BellRing,
  CalendarClock,
  Check,
  ChevronRight,
  FileQuestion,
  FileSignature,
  FileText,
  Loader2,
  Mail,
  MessageSquareText,
  ReceiptText,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import ExpiringDocumentsSettingsPanel from "./ExpiringDocumentsSettingsPanel";

const kindMeta = {
  Invoice: { title: "Invoice Reminders", icon: ReceiptText, tone: "bg-sky-50 text-sky-600" },
  Document: { title: "Document Reminders", icon: FileText, tone: "bg-violet-50 text-violet-600" },
  Agreement: { title: "Agreement Reminders", icon: FileSignature, tone: "bg-amber-50 text-amber-600" },
  Questionnaire: { title: "Questionnaire Reminders", icon: FileQuestion, tone: "bg-emerald-50 text-emerald-600" },
};

const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-slate-400 focus:ring-4 focus:ring-slate-100";

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 disabled:opacity-50 ${checked ? "bg-slate-950" : "bg-slate-200"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-300 ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Overlay({ children, onClose, labelledBy }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/30 p-0 backdrop-blur-md sm:items-center sm:p-6"
      onMouseDown={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 22, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.99 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] border border-white/80 bg-white/95 shadow-[0_32px_100px_rgba(15,23,42,0.24)] backdrop-blur-2xl sm:max-h-[88vh] sm:rounded-[28px]"
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function PreviewOverlay({ policy, preview, onClose }) {
  return (
    <Overlay onClose={onClose} labelledBy="reminder-preview-title">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Client email preview</p>
          <h2 id="reminder-preview-title" className="mt-1 truncate text-xl font-semibold tracking-[-0.02em] text-slate-950">{kindMeta[policy.kind].title}</h2>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-950"><X className="h-4 w-4" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-4 py-5 sm:px-6">
        <article className="mx-auto max-w-xl overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_16px_50px_rgba(15,23,42,0.08)]">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-[11px] font-medium text-slate-400">Subject</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{preview.subject}</p>
          </div>
          <div className="whitespace-pre-wrap px-5 py-6 text-[14px] leading-7 text-slate-700">{preview.message}</div>
        </article>
        {policy.smsEnabled ? (
          <div className="mx-auto mt-4 max-w-xl">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">SMS preview</p>
            <p className="w-fit max-w-[88%] rounded-[20px] rounded-bl-md bg-slate-950 px-4 py-3 text-[13px] leading-5 text-white">{preview.sms}</p>
          </div>
        ) : null}
      </main>
    </Overlay>
  );
}

function EditOverlay({ policy, placeholders, saving, error, onClose, onSave, onPreview }) {
  const [form, setForm] = useState(() => ({ ...policy }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Overlay onClose={onClose} labelledBy="reminder-edit-title">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Automation policy</p>
          <h2 id="reminder-edit-title" className="mt-1 truncate text-xl font-semibold tracking-[-0.02em] text-slate-950">Edit {kindMeta[policy.kind].title}</h2>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-950"><X className="h-4 w-4" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-[12px] font-semibold text-slate-600">Send every
            <div className="relative">
              <input type="number" min="1" max="90" value={form.cadenceDays} onChange={(event) => set("cadenceDays", Number(event.target.value))} className={`${inputClass} pr-14`} />
              <span className="pointer-events-none absolute bottom-2.5 right-3 text-[12px] text-slate-400">days</span>
            </div>
          </label>
          <label className="text-[12px] font-semibold text-slate-600">Maximum reminders
            <input type="number" min="1" max="12" value={form.maxReminders} onChange={(event) => set("maxReminders", Number(event.target.value))} className={inputClass} />
          </label>
          <label className="text-[12px] font-semibold text-slate-600">Default due date
            <div className="relative">
              <input type="number" min="1" max="365" value={form.defaultDueDays} onChange={(event) => set("defaultDueDays", Number(event.target.value))} className={`${inputClass} pr-14`} />
              <span className="pointer-events-none absolute bottom-2.5 right-3 text-[12px] text-slate-400">days</span>
            </div>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-y border-slate-100 py-4">
          <label className="flex items-center gap-2.5 text-[13px] font-medium text-slate-700">
            <input type="checkbox" checked={form.emailEnabled} onChange={(event) => set("emailEnabled", event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-slate-950" />
            <Mail className="h-4 w-4 text-slate-400" /> Email
          </label>
          <label className="flex items-center gap-2.5 text-[13px] font-medium text-slate-700">
            <input type="checkbox" checked={form.smsEnabled} onChange={(event) => set("smsEnabled", event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-slate-950" />
            <MessageSquareText className="h-4 w-4 text-slate-400" /> SMS through Twilio
          </label>
        </div>

        <label className="mt-5 block text-[12px] font-semibold text-slate-600">Email subject
          <input value={form.subjectTemplate} onChange={(event) => set("subjectTemplate", event.target.value)} className={inputClass} />
        </label>
        <label className="mt-4 block text-[12px] font-semibold text-slate-600">Email message
          <textarea rows={8} value={form.messageTemplate} onChange={(event) => set("messageTemplate", event.target.value)} className={`${inputClass} resize-y leading-6`} />
        </label>
        <label className="mt-4 block text-[12px] font-semibold text-slate-600">SMS message
          <textarea rows={3} value={form.smsTemplate} onChange={(event) => set("smsTemplate", event.target.value)} className={`${inputClass} resize-y leading-5`} />
        </label>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {placeholders.map((placeholder) => <code key={placeholder} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-500">{`{{${placeholder}}}`}</code>)}
        </div>
        {error ? <p className="mt-4 rounded-xl bg-rose-50 px-3.5 py-3 text-[13px] text-rose-700">{error}</p> : null}
      </main>
      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={() => onPreview(form)} className="text-[13px] font-semibold text-slate-600 transition hover:text-slate-950">Preview changes</button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-[13px] font-semibold text-slate-500 transition hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={saving} onClick={() => onSave(form)} className="inline-flex min-w-24 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      </footer>
    </Overlay>
  );
}

export default function AutomatedRemindersSettingsPanel() {
  const [view, setView] = useState("outstanding");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState("");
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.getFresh("/settings/automated-reminders")
      .then((response) => { if (active) setData(response.data.data); })
      .catch((reason) => { if (active) setError(reason.response?.data?.message || "Automated reminder settings could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const policies = useMemo(() => {
    const map = new Map((data?.policies || []).map((policy) => [policy.kind, policy]));
    return Object.keys(kindMeta).map((kind) => map.get(kind)).filter(Boolean);
  }, [data]);

  async function updatePolicy(policy, changes, close = false) {
    setBusyKind(policy.kind);
    setError("");
    try {
      const response = await api.patch(`/settings/automated-reminders/${policy.kind}`, changes);
      setData(response.data.data);
      if (close) setEditing(null);
    } catch (reason) {
      setError(reason.response?.data?.message || "This reminder policy could not be saved.");
    } finally {
      setBusyKind("");
    }
  }

  async function showPreview(policy) {
    setBusyKind(policy.kind);
    setError("");
    try {
      const response = await api.post(`/settings/automated-reminders/${policy.kind}/preview`, policy);
      setPreview(response.data.data);
      setPreviewing(policy);
    } catch (reason) {
      setError(reason.response?.data?.message || "The reminder preview could not be prepared.");
    } finally {
      setBusyKind("");
    }
  }

  if (loading) {
    return <div className="flex min-h-52 items-center justify-center gap-2 text-[13px] text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading automated reminders…</div>;
  }

  return (
    <div className="pb-10">
      <header className="flex items-start gap-3 border-b border-slate-100 pb-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white"><BellRing className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="text-[24px] font-semibold tracking-[-0.035em] text-slate-950">Automated Reminders</h2>
          <p className="mt-1 max-w-2xl text-[14px] leading-6 text-slate-500">Set up your reminders once, and let CaseDesk follow up with clients for outstanding items.</p>
        </div>
      </header>

      <div className="mt-5 inline-flex rounded-full bg-slate-100 p-1">
        <button type="button" onClick={() => setView("outstanding")} className={`rounded-full px-4 py-2 text-[12px] font-semibold transition-all ${view === "outstanding" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Outstanding Items</button>
        <button type="button" onClick={() => setView("expiring")} className={`rounded-full px-4 py-2 text-[12px] font-semibold transition-all ${view === "expiring" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>Expiring Documents</button>
      </div>

      {view === "expiring" ? <ExpiringDocumentsSettingsPanel /> : <>
      <div className="mt-5 divide-y divide-slate-100">
        {policies.map((policy) => {
          const meta = kindMeta[policy.kind];
          const Icon = meta.icon;
          const busy = busyKind === policy.kind;
          return (
            <motion.section key={policy.id} layout className="py-5">
              <div className="flex items-start gap-3 sm:gap-4">
                <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${meta.tone}`}><Icon className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-[15px] font-semibold text-slate-950">{meta.title}</h3>
                      <p className="mt-1 text-[13px] leading-5 text-slate-500">Sent every {policy.cadenceDays === 7 ? "week" : `${policy.cadenceDays} days`} for a maximum of {policy.maxReminders} reminders</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => showPreview(policy)} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50">Preview</button>
                      <button type="button" disabled={busy} onClick={() => { setError(""); setEditing(policy); }} className="inline-flex items-center gap-0.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50">Edit <ChevronRight className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 text-[12px] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-slate-500">
                      <CalendarClock className="h-4 w-4 text-slate-400" />
                      <span>If no due date exists, use {policy.defaultDueDays} days from creation or issue.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${policy.enabled ? "text-emerald-600" : "text-slate-400"}`}>{busy ? "Saving…" : policy.enabled ? "Active" : "Paused"}</span>
                      <Toggle checked={policy.enabled} disabled={busy} onChange={(enabled) => updatePolicy(policy, { enabled })} label={`${meta.title} status`} />
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>
          );
        })}
      </div>

      <div className="mt-2 flex items-start gap-2.5 border-t border-slate-100 pt-5 text-[12px] leading-5 text-slate-400">
        <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
        <p>CaseDesk stops automatically when an item is paid, uploaded, signed, submitted, or reaches its reminder limit. Appointment timing remains under Scheduling.</p>
      </div>
      {error && !editing ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</p> : null}

      <AnimatePresence>
        {editing ? (
          <EditOverlay
            key={`edit-${editing.id}`}
            policy={editing}
            placeholders={data?.placeholders || []}
            saving={busyKind === editing.kind}
            error={error}
            onClose={() => { setEditing(null); setError(""); }}
            onSave={(form) => updatePolicy(editing, form, true)}
            onPreview={showPreview}
          />
        ) : null}
        {previewing && preview ? <PreviewOverlay key={`preview-${previewing.kind}`} policy={previewing} preview={preview} onClose={() => { setPreviewing(null); setPreview(null); }} /> : null}
      </AnimatePresence>
      </>}
    </div>
  );
}
