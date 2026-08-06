import { Bell, CalendarClock, FileText, Plus, Search, Send, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fadingHighlightClass, useFadingHighlight } from "../../hooks/useFadingHighlight";
import { formatDate } from "./caseProfileUtils";

const templates = [
  { name: "Document expiry", subject: "Your document is expiring soon", message: "Hello, this is a reminder that your document expiry date is approaching. Please send an updated copy when available." },
  { name: "Missing documents", subject: "Documents needed for your application", message: "Hello, please provide the outstanding documents for your application at your earliest convenience." },
  { name: "Appointment reminder", subject: "Upcoming appointment reminder", message: "Hello, this is a reminder about your upcoming appointment. Please let us know if you need to reschedule." },
];
const blankForm = {
  expiresAt: "",
  reminderAt: "",
  dueDate: "",
  notificationChannels: ["in_app", "email"],
  notifyClient: true,
  subject: "",
  message: "",
  overrideReason: "",
};

function reminderView(reminder, now = new Date()) {
  const due = reminder?.dueDate ? new Date(reminder.dueDate) : null;
  return due && due < now ? "past" : "upcoming";
}

function channelLabel(channels) {
  const labels = { in_app: "Portal", email: "Email", sms: "SMS" };
  return (channels || []).map((item) => labels[item] || item).join(" + ") || "Staff only";
}

function ReminderOverlay({ saving, error, archived, onClose, onSave }) {
  const [form, setForm] = useState(blankForm);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const visibleTemplates = templates.filter((item) => `${item.name} ${item.subject}`.toLowerCase().includes(templateSearch.toLowerCase()));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleChannel = (channel) => setForm((current) => ({
    ...current,
    notificationChannels: current.notificationChannels.includes(channel)
      ? current.notificationChannels.filter((item) => item !== channel)
      : [...current.notificationChannels, channel],
  }));
  const inputClass = "mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100";
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-slate-950/24 p-3 backdrop-blur-md">
      <motion.form initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} onSubmit={async (event) => { event.preventDefault(); await onSave(form); }} className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.26)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Case workflow</p><h2 className="mt-1 text-xl font-semibold text-slate-950">Add reminder</h2></div><button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200"><X className="h-4 w-4" /></button></header>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          {archived ? <label className="mb-4 block rounded-2xl border border-amber-200 bg-amber-50 p-4"><span className="text-sm font-semibold text-amber-900">Archived-case override reason <b className="text-rose-500">*</b></span><textarea required rows={2} value={form.overrideReason} onChange={(event) => update("overrideReason", event.target.value)} className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none" placeholder="Explain why this archived case needs a reminder." /></label> : null}
          <div className="grid gap-4 sm:grid-cols-3"><label><span className="text-sm font-semibold text-slate-800">Due <b className="text-rose-500">*</b></span><input required type="datetime-local" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} className={inputClass} /></label><label><span className="text-sm font-semibold text-slate-800">Send reminder</span><input type="datetime-local" value={form.reminderAt} onChange={(event) => update("reminderAt", event.target.value)} className={inputClass} /></label><label><span className="text-sm font-semibold text-slate-800">Expires</span><input type="datetime-local" value={form.expiresAt} onChange={(event) => update("expiresAt", event.target.value)} className={inputClass} /></label></div>
          <label className="mt-4 block"><span className="text-sm font-semibold text-slate-800">Subject <b className="text-rose-500">*</b></span><input required value={form.subject} onChange={(event) => update("subject", event.target.value)} className={inputClass} placeholder="Reminder subject" /></label>
          <div className="mt-4"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-800">Message</span><button type="button" onClick={() => setTemplatesOpen((open) => !open)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"><FileText className="h-3.5 w-3.5" />Insert template</button></div><AnimatePresence initial={false}>{templatesOpen ? <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden"><div className="mt-3 rounded-2xl bg-slate-50 p-3"><label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Search templates" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none" /></label><div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{visibleTemplates.map((template) => <button key={template.name} type="button" onClick={() => { setForm((current) => ({ ...current, subject: template.subject, message: template.message })); setTemplatesOpen(false); }} className="w-full rounded-xl bg-white px-3 py-2 text-left text-sm hover:bg-slate-100"><b>{template.name}</b><span className="mt-0.5 block truncate text-xs text-slate-500">{template.subject}</span></button>)}</div></div></motion.div> : null}</AnimatePresence><textarea required rows={6} value={form.message} onChange={(event) => update("message", event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Write your reminder message" /></div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"><label className="flex items-center gap-3 text-sm font-semibold text-slate-800"><input type="checkbox" checked={form.notifyClient} onChange={(event) => update("notifyClient", event.target.checked)} className="h-4 w-4 rounded border-slate-300" />Notify the client</label><div className="mt-3 flex flex-wrap gap-5">{[["in_app", "Portal"], ["email", "Email"], ["sms", "SMS"]].map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.notificationChannels.includes(value)} onChange={() => toggleChannel(value)} className="h-4 w-4 rounded border-slate-300" />{label}</label>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">Email and SMS honor the client&apos;s recorded communication consent.</p></div>
        </main>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" onClick={onClose} className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Send className="h-4 w-4" />{saving ? "Saving" : "Create reminder"}</button></footer>
      </motion.form>
    </div>,
    document.body,
  );
}

export default function RemindersWorkspace({ reminders, saving, error, highlightId, archived = false, onCreate }) {
  const [view, setView] = useState("upcoming");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const openReminders = useMemo(() => reminders.filter((item) => !["Completed", "Cancelled"].includes(item.status)), [reminders]);
  const highlighted = useMemo(() => openReminders.find((item) => item.id === highlightId) || null, [highlightId, openReminders]);
  useEffect(() => { if (highlighted) setView(reminderView(highlighted)); }, [highlighted]);
  const filtered = useMemo(() => openReminders.filter((item) => reminderView(item) === view).sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0)), [openReminders, view]);
  const activeHighlightId = useFadingHighlight(highlightId, { domIdPrefix: "case-followup-", ready: filtered.some((item) => item.id === highlightId), deps: [view, filtered.length] });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="inline-flex w-fit rounded-full bg-slate-100 p-1"><button type="button" onClick={() => setView("upcoming")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "upcoming" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Upcoming</button><button type="button" onClick={() => setView("past")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "past" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Past due</button></div><button type="button" onClick={() => setOverlayOpen(true)} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Add reminder</button></div>
      <section className="overflow-hidden rounded-[1.5rem] border border-slate-100 bg-white"><div className="border-b border-slate-100 px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{view === "upcoming" ? "Upcoming reminders" : "Past-due reminders"}</p><h3 className="mt-1 text-base font-semibold text-slate-950">{filtered.length} reminders</h3></div>{filtered.length ? <div className="divide-y divide-slate-100">{filtered.map((item) => <div key={item.id} id={`case-followup-${item.id}`} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${fadingHighlightClass(item.id === activeHighlightId)}`}><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-950">{item.title}</p><p className="mt-1 truncate text-xs text-slate-500">{item.description || "No message"}</p><p className="mt-2 text-[11px] text-slate-400">{item.notifyClient ? `Client: ${channelLabel(item.notificationChannels)}` : "Staff reminder only"}{item.expiresAt ? ` · Expires ${formatDate(item.expiresAt)}` : ""}</p></div><span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${view === "past" ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}><CalendarClock className="h-3.5 w-3.5" />{formatDate(item.dueDate)}</span></div>)}</div> : <div className="px-5 py-10 text-center"><Bell className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-800">No {view === "upcoming" ? "upcoming" : "past-due"} reminders</p></div>}</section>
      {overlayOpen ? <ReminderOverlay saving={saving} error={error} archived={archived} onClose={() => setOverlayOpen(false)} onSave={async (form) => { await onCreate(form); setOverlayOpen(false); }} /> : null}
    </div>
  );
}
