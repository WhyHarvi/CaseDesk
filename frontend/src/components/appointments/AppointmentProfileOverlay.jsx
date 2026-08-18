import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  Link2,
  Loader2,
  Mail,
  MapPin,
  MessageSquareText,
  NotebookPen,
  Phone,
  Plus,
  Pencil,
  Save,
  Trash2,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  convertAppointmentToClient,
  createAppointmentFollowUp,
  createAppointmentNote,
  archiveAppointmentNote,
  getAppointmentRegistryDetail,
  updateAppointmentProfileContext,
  updateAppointmentNote,
  updateBookingAppointmentStatus,
} from "../../api/bookingApi";
import NoteDeleteOverlay from "../case-profile/notes/NoteDeleteOverlay";
import { hasCapability } from "../../auth/portalAccess";
import CompleteConsultationSheet from "../../modules/leads/components/CompleteConsultationSheet";
import useDebouncedAutosave from "../../hooks/useDebouncedAutosave";

const tabs = [
  ["details", "Details", FileText],
  ["notes", "Notes", NotebookPen],
  ["history", "History", History],
  ["messages", "Messages", MessageSquareText],
];

const statusTone = {
  Scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
  NoShow: "bg-amber-50 text-amber-700 ring-amber-200",
};

function dateTime(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function dateInput(value = new Date(Date.now() + 24 * 60 * 60_000)) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function personFor(appointment) {
  if (appointment?.client) return appointment.client;
  if (appointment?.lead) return {
    fullName: [appointment.lead.firstName, appointment.lead.lastName].filter(Boolean).join(" "),
    email: appointment.lead.email,
    phone: appointment.lead.phone,
  };
  return { fullName: appointment?.guestName, email: appointment?.guestEmail, phone: appointment?.guestPhone };
}

function Empty({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-5 py-8 text-center text-sm text-slate-400">{children}</div>;
}

export default function AppointmentProfileOverlay({ appointmentId, initialTab = "details", onClose, onChanged, onEditScheduling }) {
  const { role, appUser, membership } = useAuth();
  const canAccessInternalNotes = hasCapability(role, membership?.permissions, "internalNotes");
  const canWrite = ["admin", "consultant", "frontdesk"].includes(role);
  const [appointment, setAppointment] = useState(null);
  const [tab, setTab] = useState("details");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingContext, setEditingContext] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [note, setNote] = useState("");
  const [autosavedNote, setAutosavedNote] = useState(null);
  const [showNoteComposer, setShowNoteComposer] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [deleteNoteTarget, setDeleteNoteTarget] = useState(null);
  const [deleteNoteError, setDeleteNoteError] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUp, setFollowUp] = useState({ title: "", description: "", dueDate: dateInput() });
  const [completingConsultation, setCompletingConsultation] = useState(false);

  const load = useCallback(async () => {
    if (!appointmentId) {
      setAppointment(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await getAppointmentRegistryDetail(appointmentId);
      setAppointment(data);
      setPurpose(data.purpose || data.description || "");
      setInternalNotes(data.internalNotes || "");
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Appointment details could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (appointmentId) {
      setTab(!canAccessInternalNotes && initialTab === "notes" ? "details" : initialTab);
      setEditingContext(false);
      setShowNoteComposer(false);
      setNote("");
      setAutosavedNote(null);
    }
  }, [appointmentId, canAccessInternalNotes, initialTab]);
  useEffect(() => {
    const close = (event) => event.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, saving]);

  const person = useMemo(() => personFor(appointment), [appointment]);
  const clientNotes = appointment?.clientNotes ?? appointment?.notes ?? [];
  const visibleTabs = canAccessInternalNotes ? tabs : tabs.filter(([id]) => id !== "notes");
  const hasStarted = appointment ? new Date(appointment.startsAt) <= new Date() : false;
  const calendarUrl = appointment ? `/app/calendar?appointment=${appointment.id}&date=${new Date(appointment.startsAt).toISOString().slice(0, 10)}` : "/app/calendar";

  function updateLocalNotes(updater) {
    setAppointment((current) => {
      if (!current) return current;
      const next = { ...current };
      if (Array.isArray(current.clientNotes)) next.clientNotes = updater(current.clientNotes);
      if (Array.isArray(current.notes)) next.notes = updater(current.notes);
      return next;
    });
  }

  async function saveContext() {
    try {
      setSaving(true);
      const patch = await updateAppointmentProfileContext(appointment.id, { purpose, internalNotes });
      setAppointment((current) => ({ ...current, ...patch, description: patch.purpose }));
      setEditingContext(false);
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Appointment context could not be saved.");
    } finally { setSaving(false); }
  }

  function cancelContextEdit() {
    setPurpose(appointment?.purpose || appointment?.description || "");
    setInternalNotes(appointment?.internalNotes || "");
    setEditingContext(false);
  }

  async function addNote(event, { keepOpen = false } = {}) {
    event?.preventDefault();
    if (saving || !note.trim()) return;
    try {
      setSaving(true);
      const saved = autosavedNote
        ? await updateAppointmentNote(autosavedNote.id, note.trim())
        : await createAppointmentNote(appointment.id, note.trim());
      const localNote = { ...autosavedNote, ...saved, appointment: { id: appointment.id, subject: appointment.subject, startsAt: appointment.startsAt } };
      updateLocalNotes((items) => [localNote, ...items.filter((item) => item.id !== localNote.id)]);
      if (keepOpen) {
        setAutosavedNote(localNote);
      } else {
        setNote("");
        setAutosavedNote(null);
        setShowNoteComposer(false);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The note could not be saved.");
    } finally { setSaving(false); }
  }

  async function saveNoteEdit(event) {
    event?.preventDefault();
    const content = editingNoteContent.trim();
    if (saving || !editingNote || !content) return;
    try {
      setSaving(true);
      const updated = await updateAppointmentNote(editingNote.id, content);
      const localNote = { ...editingNote, ...updated };
      updateLocalNotes((items) => items.map((item) => item.id === localNote.id ? { ...item, ...localNote } : item));
      if (event) {
        setEditingNote(null);
        setEditingNoteContent("");
      } else {
        setEditingNote(localNote);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The note could not be updated.");
    } finally { setSaving(false); }
  }

  useDebouncedAutosave({
    value: note,
    savedValue: autosavedNote?.content || "",
    enabled: showNoteComposer && !saving,
    onSave: () => addNote(null, { keepOpen: true }),
  });

  useDebouncedAutosave({
    value: editingNoteContent,
    savedValue: editingNote?.content || "",
    enabled: Boolean(editingNote) && !saving,
    onSave: saveNoteEdit,
  });

  async function archiveNote() {
    if (!deleteNoteTarget) return;
    try {
      setSaving(true);
      setDeleteNoteError("");
      await archiveAppointmentNote(deleteNoteTarget.id);
      if (editingNote?.id === deleteNoteTarget.id) {
        setEditingNote(null);
        setEditingNoteContent("");
      }
      setDeleteNoteTarget(null);
      updateLocalNotes((items) => items.filter((item) => item.id !== deleteNoteTarget.id));
    } catch (requestError) {
      setDeleteNoteError(requestError.response?.data?.message || "The note could not be archived.");
    } finally { setSaving(false); }
  }

  async function addFollowUp(event) {
    event.preventDefault();
    try {
      setSaving(true);
      const created = await createAppointmentFollowUp(appointment.id, { ...followUp, dueDate: followUp.dueDate ? new Date(followUp.dueDate).toISOString() : null });
      setAppointment((current) => ({ ...current, followUps: [created, ...(current.followUps || [])] }));
      setFollowUp({ title: "", description: "", dueDate: dateInput() });
      setShowFollowUp(false);
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The follow-up could not be created.");
    } finally { setSaving(false); }
  }

  async function setStatus(status) {
    try {
      setSaving(true);
      const updated = await updateBookingAppointmentStatus(appointment.id, status);
      setAppointment((current) => ({ ...current, ...updated }));
      await load();
      onChanged?.(updated);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The appointment status could not be updated.");
    } finally { setSaving(false); }
  }

  async function convertGuest() {
    try {
      setSaving(true);
      await convertAppointmentToClient(appointment.id);
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The visitor could not be saved as a client.");
    } finally { setSaving(false); }
  }

  if (!appointmentId) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[650] flex justify-end bg-slate-950/25 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Appointment profile">
        <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close appointment profile" />
        <motion.aside initial={{ opacity: 0, x: 36 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ type: "spring", stiffness: 380, damping: 36 }} className="relative flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-white/80 bg-[#f5f7fa] shadow-[-30px_0_100px_rgba(15,23,42,0.25)]">
          <header className="border-b border-slate-200/70 bg-white/90 px-6 pt-5 backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">Appointment profile</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">{appointment?.subject || "Loading appointment…"}</h2>
                  {appointment?.status ? <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusTone[appointment.status] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{appointment.status === "NoShow" ? "No-show" : appointment.status}</span> : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {appointment?.client?.id ? (
                    <Link
                      to={`/app/clients/${appointment.client.id}`}
                      className="font-medium text-slate-700 transition hover:text-sky-700 hover:underline hover:decoration-sky-300 hover:underline-offset-4"
                    >
                      {person?.fullName || "Appointment visitor"}
                    </Link>
                  ) : (
                    person?.fullName || "Appointment visitor"
                  )}
                  {appointment?.referenceCode ? ` · ${appointment.referenceCode}` : ""}
                </p>
                {!loading && canWrite && appointment && !appointment.client ? (
                  <button type="button" disabled={saving} onClick={convertGuest} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />}
                    {saving ? "Saving…" : "Save as client"}
                  </button>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {onEditScheduling && appointment ? <button type="button" onClick={() => onEditScheduling(appointment)} className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700">Edit schedule</button> : null}
                <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-label="Close"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <nav className="mt-4 flex gap-1 overflow-x-auto scrollbar-hidden">
              {visibleTabs.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`relative inline-flex h-11 shrink-0 items-center gap-2 px-4 text-sm font-medium ${tab === id ? "text-sky-700" : "text-slate-500"}`}><Icon className="h-4 w-4" />{label}{id === "notes" && clientNotes.length ? <span className="rounded-full bg-slate-100 px-1.5 text-[10px]">{clientNotes.length}</span> : null}{tab === id ? <motion.span layoutId="appointment-profile-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-sky-600" /> : null}</button>)}
            </nav>
          </header>

          <main className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {error ? <p className="mb-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
            {loading ? <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading appointment profile…</div> : null}
            {!loading && appointment && tab === "details" ? <div className="space-y-4">
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.4rem] border border-white bg-white p-4 shadow-sm"><p className="flex items-center gap-2 text-xs font-semibold text-slate-400"><CalendarDays className="h-4 w-4" />When</p><p className="mt-2 text-sm font-semibold text-slate-900">{dateTime(appointment.startsAt)}</p><p className="mt-1 text-xs text-slate-400">Ends {dateTime(appointment.endsAt)}</p></div>
                <div className="rounded-[1.4rem] border border-white bg-white p-4 shadow-sm"><p className="flex items-center gap-2 text-xs font-semibold text-slate-400"><UserRound className="h-4 w-4" />Consultant</p><p className="mt-2 text-sm font-semibold text-slate-900">{appointment.assignedTo?.fullName || "Unassigned"}</p><p className="mt-1 text-xs text-slate-400">{appointment.meetingMode || "In person"}</p></div>
              </section>
              <section className="rounded-[1.5rem] border border-white bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Connected records</h3>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div><p className="text-xs text-slate-400">Contact</p>{appointment.client?.id ? <Link to={`/app/clients/${appointment.client.id}`} className="mt-1 inline-flex font-semibold text-slate-800 transition hover:text-sky-700 hover:underline hover:decoration-sky-300 hover:underline-offset-4">{person?.fullName || "Visitor"}</Link> : <p className="mt-1 font-semibold text-slate-800">{person?.fullName || "Visitor"}</p>}{person?.email ? <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Mail className="h-3.5 w-3.5" />{person.email}</p> : null}{person?.phone ? <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Phone className="h-3.5 w-3.5" />{person.phone}</p> : null}</div>
                  <div><p className="text-xs text-slate-400">Matter</p>{appointment.case ? <Link to={`/app/cases/${appointment.case.id}`} target="_blank" className="mt-1 inline-flex items-center gap-1.5 font-semibold text-sky-700"><Link2 className="h-3.5 w-3.5" />{appointment.case.caseType}</Link> : appointment.lead ? <p className="mt-1 font-semibold text-slate-800">{appointment.lead.leadNumber}</p> : <p className="mt-1 text-slate-500">Not linked to a case</p>}</div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2"><Link to={calendarUrl} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700"><CalendarDays className="h-3.5 w-3.5" />Open in calendar</Link>{appointment.meetingUrl ? <a href={appointment.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white"><Video className="h-3.5 w-3.5" />Join meeting</a> : null}{appointment.location ? <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-xs text-slate-600"><MapPin className="h-3.5 w-3.5" />{appointment.location}</span> : null}</div>
              </section>
              {canWrite && appointment.status === "Scheduled" && hasStarted ? <section className="rounded-[1.5rem] border border-white bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Attendance</p><div className="mt-3 grid grid-cols-2 gap-2">{role !== "frontdesk" ? <button type="button" disabled={saving} onClick={() => appointment.lead?.id && appointment.leadConsultation?.id ? setCompletingConsultation(true) : setStatus("Completed")} className="rounded-full bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700">Mark attended</button> : null}<button type="button" disabled={saving} onClick={() => setStatus("NoShow")} className={`rounded-full bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-700 ${role === "frontdesk" ? "col-span-2" : ""}`}>Mark no-show</button></div></section> : null}
              {canWrite && appointment.status === "Completed" && role === "admin" ? <button type="button" disabled={saving} onClick={() => setStatus("Scheduled")} className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600">Unmark attended</button> : null}
            </div> : null}

            {!loading && appointment && tab === "notes" ? <div className="space-y-5">
              <section className="rounded-[1.5rem] border border-sky-100 bg-sky-50/55 p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-600">Client query</p><p className="mt-1 text-xs text-slate-500">Keep the client’s original concern visible while documenting the consultation.</p></div>{canWrite ? editingContext ? <div className="flex items-center gap-2"><button type="button" onClick={cancelContextEdit} disabled={saving} className="rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 disabled:opacity-50">Cancel</button><button type="button" onClick={saveContext} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save context"}</button></div> : <button type="button" onClick={() => setEditingContext(true)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200"><NotebookPen className="h-3.5 w-3.5" />Edit context</button> : null}</div>
                <div className="mt-4 space-y-4">
                  <label className="block">{editingContext ? <textarea rows={4} value={purpose} onChange={(event) => setPurpose(event.target.value)} className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-400" /> : <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{purpose || "No client query was recorded."}</p>}</label>
                  {canWrite ? <label className="block border-t border-sky-100 pt-4"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-600">Private staff context</span>{editingContext ? <textarea rows={4} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-400" /> : <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{internalNotes || "No private context recorded."}</p>}</label> : null}
                </div>
              </section>
              {canWrite ? <section className="rounded-[1.5rem] border border-white bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Internal note</h3><p className="mt-1 text-xs text-slate-400">Discussion, outcome, or context for the next contact.</p></div>{!showNoteComposer ? <button type="button" onClick={() => setShowNoteComposer(true)} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Note</button> : null}</div>
                {showNoteComposer ? <form onSubmit={addNote} className="mt-4"><textarea autoFocus rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Write an internal note…" className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400" /><div className="mt-3 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => { setNote(""); setAutosavedNote(null); setShowNoteComposer(false); }} className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600">Cancel</button><button type="submit" disabled={saving || !note.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save note"}</button></div></form> : null}
              </section> : null}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{appointment.client ? `All client notes for ${appointment.client.fullName}` : "Appointment notes"}</h3>
                    <p className="mt-1 text-xs text-slate-400">Profile notes and notes from every appointment, in one history.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{clientNotes.length}</span>
                </div>
                <div className="space-y-2">
                  {clientNotes.length ? clientNotes.map((item) => (
                    <article key={item.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${item.appointmentId === appointment.id || item.appointment?.id === appointment.id ? "border-violet-200 ring-2 ring-violet-100" : "border-white"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="text-xs font-semibold text-slate-700">{item.user?.fullName || "Team member"}</p>
                          {item.appointment ? <span className="truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{item.appointment.id === appointment.id ? "Current appointment" : item.appointment.subject}</span> : <span className="truncate rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-600">Client profile</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <time className="text-[11px] text-slate-400">{dateTime(item.updatedAt || item.createdAt)}</time>
                          {role === "admin" || item.user?.id === appUser?.id ? <>
                            <button type="button" onClick={() => { setEditingNote(item); setEditingNoteContent(item.content || ""); }} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800" aria-label="Edit note"><Pencil className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => { setDeleteNoteError(""); setDeleteNoteTarget(item); }} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-amber-50 hover:text-amber-700" aria-label="Archive note"><Trash2 className="h-3.5 w-3.5" /></button>
                          </> : null}
                        </div>
                      </div>
                      {item.appointment && item.appointment.id !== appointment.id ? <p className="mt-2 text-[11px] font-medium text-violet-600">{dateTime(item.appointment.startsAt)}</p> : null}
                      {editingNote?.id === item.id ? <form onSubmit={saveNoteEdit} className="mt-3"><textarea rows={4} value={editingNoteContent} onChange={(event) => setEditingNoteContent(event.target.value)} className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 outline-none focus:border-sky-400" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => { setEditingNote(null); setEditingNoteContent(""); }} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">Cancel</button><button type="submit" disabled={saving || !editingNoteContent.trim()} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Save changes</button></div></form> : <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.content}</p>}
                    </article>
                  )) : <Empty>No client notes yet.</Empty>}
                </div>
              </section>
              <section className="rounded-[1.5rem] border border-white bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Follow-ups</h3><p className="mt-1 text-xs text-slate-400">Next actions connected to this appointment.</p></div>{canWrite ? <button type="button" onClick={() => setShowFollowUp((current) => !current)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white" aria-label="Add follow-up"><Plus className="h-4 w-4" /></button> : null}</div>{showFollowUp ? <form onSubmit={addFollowUp} className="mt-4 space-y-3 rounded-2xl bg-slate-50 p-4"><input required value={followUp.title} onChange={(event) => setFollowUp((current) => ({ ...current, title: event.target.value }))} placeholder="Follow-up title" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm outline-none" /><textarea rows={3} value={followUp.description} onChange={(event) => setFollowUp((current) => ({ ...current, description: event.target.value }))} placeholder="What needs to happen next?" className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none" /><input type="datetime-local" required value={followUp.dueDate} onChange={(event) => setFollowUp((current) => ({ ...current, dueDate: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm outline-none" /><button type="submit" disabled={saving} className="w-full rounded-full bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white">Create follow-up</button></form> : null}<div className="mt-4 space-y-2">{appointment.followUps?.length ? appointment.followUps.map((item) => <div key={item.id} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 px-4 py-3"><div><p className="text-sm font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-400">{item.assignedUser?.fullName || "Unassigned"}{item.description ? ` · ${item.description}` : ""}</p></div><div className="text-right"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{item.status}</span><p className="mt-1 text-[10px] text-slate-400">{dateTime(item.dueDate)}</p></div></div>) : <Empty>No follow-ups connected yet.</Empty>}</div></section>
            </div> : null}

            {!loading && appointment && tab === "history" ? <div className="space-y-3">{appointment.events?.length ? appointment.events.map((event, index) => <div key={event.id} className="flex gap-3"><div className="flex flex-col items-center"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm"><Clock3 className="h-3.5 w-3.5" /></span>{index < appointment.events.length - 1 ? <span className="h-full w-px bg-slate-200" /> : null}</div><div className="mb-2 flex-1 rounded-2xl border border-white bg-white p-4 shadow-sm"><p className="text-sm font-semibold text-slate-800">{event.summary}</p><p className="mt-1 text-xs text-slate-400">{dateTime(event.createdAt)}{event.actor?.fullName ? ` · ${event.actor.fullName}` : ""}</p></div></div>) : <Empty>No appointment history has been recorded.</Empty>}</div> : null}

            {!loading && appointment && tab === "messages" ? <div className="space-y-3">{appointment.messageDeliveries?.length ? appointment.messageDeliveries.map((delivery) => <div key={delivery.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white bg-white p-4 shadow-sm"><div><p className="text-sm font-semibold capitalize text-slate-800">{delivery.kind} · {delivery.channel}</p><p className="mt-1 text-xs text-slate-400">{dateTime(delivery.sentAt || delivery.failedAt || delivery.createdAt)}</p>{delivery.lastError ? <p className="mt-2 text-xs text-rose-600">{delivery.lastError}</p> : null}</div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${String(delivery.status).toLowerCase() === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{delivery.status}</span></div>) : <Empty>No appointment messages have been sent.</Empty>}</div> : null}
          </main>
        </motion.aside>
        <NoteDeleteOverlay note={deleteNoteTarget} busy={saving} error={deleteNoteError} onClose={() => !saving && setDeleteNoteTarget(null)} onConfirm={archiveNote} />
      </div>
      {completingConsultation && appointment?.lead && appointment?.leadConsultation ? <CompleteConsultationSheet lead={appointment.lead} consultation={appointment.leadConsultation} onClose={() => setCompletingConsultation(false)} onSaved={async () => { setCompletingConsultation(false); await load(); onChanged?.(); }} /> : null}
    </AnimatePresence>,
    document.body,
  );
}
