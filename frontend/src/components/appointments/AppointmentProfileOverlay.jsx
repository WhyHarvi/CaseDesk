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
  ShieldAlert,
  Sparkles,
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
  confirmAppointmentAdvice,
  checkInAppointmentClient,
  convertAppointmentToClient,
  createAppointmentFollowUp,
  createAppointmentNote,
  archiveAppointmentNote,
  getAppointmentRegistryDetail,
  saveAppointmentAdviceDraft,
  shortenAppointmentSubject,
  updateAppointmentProfileContext,
  updateAppointmentNote,
  updateBookingAppointmentStatus,
} from "../../api/bookingApi";
import api from "../../services/api";
import { getStaffPreConsultationSummary } from "../../api/preConsultationApi";
import NoteDeleteOverlay from "../case-profile/notes/NoteDeleteOverlay";
import PreConsultationSummaryCard, { dateOnly, flagLabel } from "./PreConsultationSummaryCard";
import MultiCaseTypeCombobox from "../ui/MultiCaseTypeCombobox";
import { hasCapability } from "../../auth/portalAccess";
import CompleteConsultationSheet, { getDraftConsultationId } from "../../modules/leads/components/CompleteConsultationSheet";
import useDebouncedAutosave from "../../hooks/useDebouncedAutosave";
import { fadingHighlightClass, useFadingHighlight } from "../../hooks/useFadingHighlight";

const tabs = [
  ["details", "Details", FileText],
  ["notes", "Notes", NotebookPen],
  ["history", "History", History],
  ["messages", "Messages", MessageSquareText],
];

const APPOINTMENT_SUBJECT_MAX_WORDS = 10;
const subjectWordCount = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

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

function consultationSummarySections(value) {
  const sections = {};
  const remaining = [];
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\*\*/g, "").replace(/^[-*#\s]+/, "").trim();
    if (!line || /^(Flags|Relevant answers):/i.test(line)) continue;
    const match = line.match(/^(Important for the consultation|Immigration context|Consultation focus):\s*(.*)$/i);
    if (!match) {
      if (!/questionnaire identifies no urgent immigration concern/i.test(line)) remaining.push(line);
      continue;
    }
    const key = match[1].toLowerCase().startsWith("important")
      ? "important"
      : match[1].toLowerCase().startsWith("immigration") ? "context" : "focus";
    sections[key] = match[2].trim();
  }
  if (!sections.important && remaining.length) sections.important = remaining.join(" ");
  return sections;
}

// Highlighted text for a flag's own computed date/days — built directly
// from that plain date math (see the flag-recompute above), never from
// Nova's prose, so the exact fact staff need to trust is never at the
// mercy of how the model happened to phrase it this time.
function highlightedFactClause(flag) {
  const days = Number(flag.days);
  const hasDays = Number.isFinite(days);
  switch (flag.type) {
    case "STATUS_EXPIRY":
      return hasDays && days < 0
        ? `status expired ${dateOnly(flag.date)} (${Math.abs(days)} days ago)`
        : `status expires ${dateOnly(flag.date)}${hasDays ? ` (in ${days} day${days === 1 ? "" : "s"})` : ""}`;
    case "NO_CURRENT_STATUS":
      return "client currently has no immigration status";
    case "PREVIOUS_REFUSAL":
      return "a previous application refusal is on record";
    case "ACTIVE_IMMIGRATION_ISSUE":
      return "an active immigration issue was reported";
    case "UPCOMING_DEADLINE":
      return `upcoming deadline ${flag.date ? dateOnly(flag.date) : ""}${hasDays ? ` (${days} day${days === 1 ? "" : "s"})` : ""}`.trim();
    default:
      return flagLabel[flag.type] || flag.type;
  }
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

export default function AppointmentProfileOverlay({ appointmentId, initialTab = "details", initialAction = null, onClose, onChanged, onEditScheduling }) {
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
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [shorteningSubject, setShorteningSubject] = useState(false);
  const [subjectSuggestion, setSubjectSuggestion] = useState(null);
  const [note, setNote] = useState("");
  const [autosavedNote, setAutosavedNote] = useState(null);
  const [showNoteComposer, setShowNoteComposer] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [deleteNoteTarget, setDeleteNoteTarget] = useState(null);
  const [deleteNoteError, setDeleteNoteError] = useState("");
  const [novaSummary, setNovaSummary] = useState(null);
  const [novaSummaryLoading, setNovaSummaryLoading] = useState(false);
  const [novaSummaryError, setNovaSummaryError] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUp, setFollowUp] = useState({ title: "", description: "", dueDate: dateInput() });
  const [showAdviceComposer, setShowAdviceComposer] = useState(false);
  const [adviceCategories, setAdviceCategories] = useState([]);
  const [adviceText, setAdviceText] = useState("");
  const [adviceAssignedUserId, setAdviceAssignedUserId] = useState("");
  const [adviceAdditionalAssignedUserIds, setAdviceAdditionalAssignedUserIds] = useState([]);
  const [adviceFollowUpDate, setAdviceFollowUpDate] = useState("");
  const [savedAdvice, setSavedAdvice] = useState(null);
  const [adviceSaving, setAdviceSaving] = useState(false);
  const [adviceError, setAdviceError] = useState("");
  const [adviceStaff, setAdviceStaff] = useState([]);
  const [adviceCaseTypeOptions, setAdviceCaseTypeOptions] = useState([]);
  const [adviceCaseTypeAliases, setAdviceCaseTypeAliases] = useState({});
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
      setSubjectDraft(data.subject || "");
      setSavedAdvice(data.advice || null);
      setAdviceCategories(data.advice?.categories || []);
      setAdviceText(data.advice?.adviceText || "");
      setAdviceAssignedUserId(data.advice?.assignedUserId || "");
      setAdviceAdditionalAssignedUserIds(data.advice?.additionalAssignedUserIds || []);
      setAdviceFollowUpDate(data.advice?.followUpDate ? data.advice.followUpDate.slice(0, 10) : "");
      setNovaSummary(data.preConsultationIntake?.novaSummary || null);
      setNovaSummaryError("");
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
      const requestedTab = initialAction === "advice-handoff" ? "notes" : initialAction === "pre-consultation" ? "details" : initialTab;
      setTab(!canAccessInternalNotes && requestedTab === "notes" ? "details" : requestedTab);
      setEditingContext(false);
      setEditingSubject(false);
      setSubjectSuggestion(null);
      setShowNoteComposer(false);
      setNote("");
      setAutosavedNote(null);
      setShowAdviceComposer(false);
      setAdviceError("");
    }
  }, [appointmentId, canAccessInternalNotes, initialAction, initialTab]);
  useEffect(() => {
    if (completingConsultation || !appointment?.leadConsultation) return;
    if (getDraftConsultationId() === appointment.leadConsultation.id) setCompletingConsultation(true);
  }, [appointment, completingConsultation]);
  useEffect(() => {
    const close = (event) => event.key === "Escape" && !saving && !completingConsultation && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, saving, completingConsultation]);

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
      if (patch.attendanceAutoMarkFailed) {
        setError("The note was saved, but attendance could not be updated. Mark the appointment attended manually.");
      }
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

  function updateSubjectDraft(value) {
    setSubjectSuggestion(null);
    setSubjectDraft(value);
  }

  async function shortenSubjectDraft() {
    try {
      setShorteningSubject(true);
      const suggestion = await shortenAppointmentSubject(subjectDraft);
      setSubjectSuggestion(suggestion);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Nova could not shorten this subject right now.");
    } finally {
      setShorteningSubject(false);
    }
  }

  function acceptSubjectSuggestion() {
    if (!subjectSuggestion) return;
    setSubjectDraft(subjectSuggestion);
    setSubjectSuggestion(null);
  }

  async function saveSubject() {
    const trimmed = subjectDraft.trim();
    if (!trimmed) { setError("Add a subject for this appointment."); return; }
    const words = subjectWordCount(trimmed);
    if (words > APPOINTMENT_SUBJECT_MAX_WORDS) {
      setError(`Keep the subject to ${APPOINTMENT_SUBJECT_MAX_WORDS} words or fewer (currently ${words}).`);
      return;
    }
    try {
      setSaving(true);
      const patch = await updateAppointmentProfileContext(appointment.id, { subject: trimmed });
      setAppointment((current) => ({ ...current, ...patch }));
      setEditingSubject(false);
      setSubjectSuggestion(null);
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Appointment subject could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function cancelSubjectEdit() {
    setSubjectDraft(appointment?.subject || "");
    setSubjectSuggestion(null);
    setEditingSubject(false);
  }

  async function addNote(event, { keepOpen = false } = {}) {
    event?.preventDefault();
    if (saving || !note.trim()) return;
    try {
      setSaving(true);
      const created = autosavedNote
        ? null
        : await createAppointmentNote(appointment.id, note.trim());
      const saved = autosavedNote
        ? await updateAppointmentNote(autosavedNote.id, note.trim())
        : created.note;
      const localNote = { ...autosavedNote, ...saved, appointment: { id: appointment.id, subject: appointment.subject, startsAt: appointment.startsAt } };
      updateLocalNotes((items) => [localNote, ...items.filter((item) => item.id !== localNote.id)]);
      if (created?.meta?.attendanceAutoMarked) {
        setAppointment((current) => current ? { ...current, status: "Completed" } : current);
      } else if (created?.meta?.attendanceAutoMarkFailed) {
        setError("The note was saved, but attendance could not be updated. Mark the appointment attended manually.");
      }
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

  function openAdviceComposer() {
    setShowAdviceComposer(true);
    setAdviceError("");
    if (!adviceStaff.length) {
      api.get("/leads/staff", { cache: false }).then((response) => setAdviceStaff(response.data.data || [])).catch(() => {});
    }
    if (!adviceCaseTypeOptions.length) {
      // The agency's real, live case-type catalog — the same list case
      // creation itself uses — not a hand-picked subset. Real advice covers
      // whatever the practice actually handles (every sponsorship variant,
      // every provincial stream, citizenship, refugee/H&C matters, and so
      // on), and reusing this list is what keeps "client agreed — start the
      // case" a one-click handoff instead of a re-typing exercise.
      api.get("/cases/case-types", { cache: false }).then((response) => {
        setAdviceCaseTypeOptions(response.data.data || []);
        setAdviceCaseTypeAliases(response.data.aliases || {});
      }).catch(() => {});
    }
  }

  // Nova only ever restates the flags/answers the backend already computed
  // deterministically (see summarizePreConsultationIntake) — this call never
  // blocks the flags themselves from showing, since those render immediately
  // from appointment.preConsultationIntake below, independent of this.
  async function generateNovaSummary(regenerate = false) {
    setNovaSummaryLoading(true);
    setNovaSummaryError("");
    try {
      const data = await getStaffPreConsultationSummary(appointmentId, { regenerate });
      setNovaSummary(data);
      if (data.summaryError) setNovaSummaryError(data.summaryError);
    } catch (requestError) {
      setNovaSummaryError(requestError.response?.data?.message || "The AI summary could not be generated.");
    } finally {
      setNovaSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && appointment && initialAction === "advice-handoff" && canAccessInternalNotes) openAdviceComposer();
    // Opening is intentionally tied to the requested deep action, not to
    // changes made while the consultant is working inside the composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, loading, initialAction, canAccessInternalNotes]);

  const actionReady = !loading && Boolean(appointment) && (
    (initialAction === "pre-consultation" && tab === "details")
    || (initialAction === "advice-handoff" && tab === "notes" && showAdviceComposer)
  );
  const activeAction = useFadingHighlight(initialAction, {
    domIdPrefix: "appointment-action-",
    ready: actionReady,
    deps: [tab, showAdviceComposer],
  });

  useEffect(() => {
    if (!activeAction) return;
    document.getElementById(`appointment-action-${activeAction}`)?.focus({ preventScroll: true });
  }, [activeAction]);

  const adviceDraftKey = JSON.stringify({ adviceCategories, adviceText, adviceAssignedUserId, adviceAdditionalAssignedUserIds, adviceFollowUpDate });
  const savedAdviceKey = savedAdvice ? JSON.stringify({ adviceCategories: savedAdvice.categories, adviceText: savedAdvice.adviceText, adviceAssignedUserId: savedAdvice.assignedUserId, adviceAdditionalAssignedUserIds: savedAdvice.additionalAssignedUserIds || [], adviceFollowUpDate: savedAdvice.followUpDate ? savedAdvice.followUpDate.slice(0, 10) : "" }) : "";

  async function saveAdviceDraft() {
    if (!appointment) return;
    try {
      const saved = await saveAppointmentAdviceDraft(appointment.id, {
        categories: adviceCategories,
        adviceText,
        assignedUserId: adviceAssignedUserId || undefined,
        additionalAssignedUserIds: adviceAdditionalAssignedUserIds,
        followUpDate: adviceFollowUpDate || undefined,
      });
      setSavedAdvice(saved);
    } catch {
      // Autosave failures stay silent — the consultant's own typing is
      // never touched, and "Save and assign" surfaces a real error if the
      // final submit fails too.
    }
  }

  useDebouncedAutosave({
    value: adviceDraftKey,
    savedValue: savedAdviceKey,
    enabled: showAdviceComposer && !adviceSaving,
    onSave: saveAdviceDraft,
  });

  async function confirmAdvice(event) {
    event?.preventDefault();
    if (adviceSaving) return;
    if (!adviceText.trim()) { setAdviceError("Enter the advice given to the client."); return; }
    if (!adviceCategories.length) { setAdviceError("Choose at least one category."); return; }
    if (!adviceAssignedUserId) { setAdviceError("Select who should contact the client."); return; }
    if (!adviceFollowUpDate) { setAdviceError("Choose a follow-up date."); return; }
    try {
      setAdviceSaving(true);
      setAdviceError("");
      const saved = await confirmAppointmentAdvice(appointment.id, {
        categories: adviceCategories,
        adviceText: adviceText.trim(),
        assignedUserId: adviceAssignedUserId,
        additionalAssignedUserIds: adviceAdditionalAssignedUserIds,
        followUpDate: adviceFollowUpDate,
      });
      setSavedAdvice(saved.advice);
      if (saved.meta?.attendanceAutoMarked) {
        setAppointment((current) => current ? { ...current, status: "Completed" } : current);
      }
      if (saved.meta?.attendanceAutoMarkError) setError(saved.meta.attendanceAutoMarkError);
      setShowAdviceComposer(false);
      onChanged?.();
    } catch (requestError) {
      // Deliberately does not clear/reset any field the consultant already
      // entered — only the error message is shown, right below the button.
      setAdviceError(requestError.response?.data?.message || "The advice could not be saved.");
    } finally {
      setAdviceSaving(false);
    }
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

  async function checkInClient() {
    try {
      setSaving(true);
      setError("");
      await checkInAppointmentClient(appointment.id);
      setAppointment((current) => ({ ...current, status: "Completed" }));
      await load();
      onChanged?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The client could not be checked in.");
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
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">Appointment profile</p>
                {editingSubject ? (
                  <div className="mt-1">
                    <input
                      autoFocus
                      value={subjectDraft}
                      onChange={(event) => updateSubjectDraft(event.target.value)}
                      className="w-full rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-base font-semibold text-slate-950 outline-none focus:border-sky-400"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-normal">
                      <span className={subjectWordCount(subjectDraft) > APPOINTMENT_SUBJECT_MAX_WORDS ? "font-semibold text-rose-600" : "text-slate-400"}>
                        {subjectWordCount(subjectDraft)}/{APPOINTMENT_SUBJECT_MAX_WORDS} words
                      </span>
                      {subjectWordCount(subjectDraft) > APPOINTMENT_SUBJECT_MAX_WORDS ? (
                        <button type="button" onClick={shortenSubjectDraft} disabled={shorteningSubject} className="inline-flex items-center gap-1 font-semibold text-sky-700 disabled:opacity-50">
                          {shorteningSubject ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          {shorteningSubject ? "Asking Nova…" : "Shorten with Nova"}
                        </button>
                      ) : null}
                    </div>
                    {subjectSuggestion ? (
                      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
                        <span className="min-w-0 flex-1">
                          Nova suggests: <span className="font-semibold">“{subjectSuggestion}”</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <button type="button" onClick={acceptSubjectSuggestion} className="font-semibold text-sky-700">Use this</button>
                          <button type="button" onClick={() => setSubjectSuggestion(null)} className="text-slate-400">Dismiss</button>
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">{appointment?.subject || "Loading appointment…"}</h2>
                    {appointment?.status ? <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusTone[appointment.status] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{appointment.status === "NoShow" ? "No-show" : appointment.status}</span> : null}
                    {canWrite && appointment ? (
                      <button type="button" onClick={() => setEditingSubject(true)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800" aria-label="Edit subject">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                )}
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
                {editingSubject ? (
                  <>
                    <button type="button" onClick={cancelSubjectEdit} disabled={saving} className="rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 disabled:opacity-50">Cancel</button>
                    <button type="button" onClick={saveSubject} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save subject"}</button>
                  </>
                ) : onEditScheduling && appointment ? (
                  <button type="button" onClick={() => onEditScheduling(appointment)} className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700">Edit schedule</button>
                ) : null}
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
              <div id="appointment-action-pre-consultation" tabIndex={-1} className={`rounded-[1.5rem] outline-none ${fadingHighlightClass(activeAction === "pre-consultation")}`}>
                <PreConsultationSummaryCard intake={appointment.preConsultationIntake} />
              </div>
              {canWrite && appointment.status === "Scheduled" && hasStarted ? <section className="rounded-[1.5rem] border border-white bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Attendance</p><div className="mt-3 grid grid-cols-2 gap-2">{role !== "frontdesk" ? <button type="button" disabled={saving} onClick={() => appointment.lead?.id && appointment.leadConsultation?.id ? setCompletingConsultation(true) : setStatus("Completed")} className="rounded-full bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700">Mark attended</button> : appointment.meetingMode === "InPerson" ? <button type="button" disabled={saving} onClick={checkInClient} className="rounded-full bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700">Check in client</button> : null}<button type="button" disabled={saving} onClick={() => setStatus("NoShow")} className={`rounded-full bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-700 ${role === "frontdesk" && appointment.meetingMode !== "InPerson" ? "col-span-2" : ""}`}>Mark no-show</button></div></section> : null}
              {canWrite && appointment.status === "Completed" && role === "admin" ? <button type="button" disabled={saving} onClick={() => setStatus("Scheduled")} className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600">Unmark attended</button> : null}
            </div> : null}

            {!loading && appointment && tab === "notes" ? <div className="space-y-5">
              {appointment.preConsultationIntake?.answers ? (() => {
                // Recomputed live, right here, from each flag's own static
                // date — never trust the days value stored at submission
                // time, which only reflects "how many days" as of whenever
                // the client filled the form out, not as of today. This is
                // plain date math, not Nova — the one thing here that must
                // never be wrong stays independent of the AI call below.
                const liveFlags = (appointment.preConsultationIntake.flags || []).map((flag) => ({
                  ...flag,
                  days: flag.date ? Math.ceil((new Date(`${flag.date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000) : flag.days,
                }));
                const urgent = liveFlags.some((flag) => flag.severity === "urgent");
                const summarySections = consultationSummarySections(novaSummary?.summary);
                // One flowing note, not a chip row plus a separate labeled-card
                // restatement of the same facts: flag-derived clauses (exact
                // date/days math, never Nova's prose) are highlighted inline as
                // the lead sentence, and Nova's context/focus — genuinely new
                // information, not a repeat of the flags — reads on as the rest
                // of the paragraph.
                const factClauses = liveFlags.map((flag) => ({ text: highlightedFactClause(flag), severity: flag.severity }));
                const novaProse = [
                  summarySections.context,
                  summarySections.focus ? `Consultation focus: ${summarySections.focus.charAt(0).toLowerCase()}${summarySections.focus.slice(1)}.` : null,
                ].filter(Boolean).join(" ");
                return (
                  <section className={`rounded-[1.5rem] border bg-white p-5 shadow-sm ${urgent ? "border-rose-200 ring-2 ring-rose-50" : "border-white"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2"><ShieldAlert className={`h-4 w-4 ${urgent ? "text-rose-600" : "text-violet-600"}`} /><h3 className="text-sm font-semibold text-slate-900">Pre-consultation summary</h3></div>
                        <p className="mt-1 text-xs text-slate-400">Private to staff — what the client told us before the appointment, so nothing urgent gets missed.</p>
                      </div>
                      <button type="button" onClick={() => generateNovaSummary(Boolean(novaSummary?.summary))} disabled={novaSummaryLoading} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                        {novaSummaryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {novaSummaryLoading ? "Asking Nova…" : novaSummary?.summary ? "Regenerate" : "Add Nova's read"}
                      </button>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      {factClauses.length ? factClauses.map((clause, index) => (
                        <span key={index}>
                          {index > 0 ? (index === factClauses.length - 1 ? " and " : ", ") : ""}
                          <mark className={`rounded px-1 font-medium ${clause.severity === "urgent" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{clause.text}</mark>
                        </span>
                      )) : "No urgent flags from the questionnaire."}
                      {factClauses.length ? ". " : " "}
                      {novaProse}
                    </p>

                    {novaSummary?.summary ? (
                      <p className="mt-2 text-[10px] text-slate-400">
                        Nova's read saved{novaSummary.generatedAt ? ` ${dateTime(novaSummary.generatedAt)}` : ""} · Verify against the questionnaire.
                      </p>
                    ) : null}
                    {novaSummaryError ? <p className="mt-2 text-xs text-amber-700">{novaSummaryError}</p> : null}
                  </section>
                );
              })() : null}
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
              {canWrite ? <section id="appointment-action-advice-handoff" tabIndex={-1} className={`rounded-[1.5rem] border border-white bg-white p-5 shadow-sm outline-none ${fadingHighlightClass(activeAction === "advice-handoff")}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Advice & handoff</h3>
                    <p className="mt-1 text-xs text-slate-400">What to advise, who follows up, and by when.</p>
                  </div>
                  {!showAdviceComposer ? <button type="button" onClick={openAdviceComposer} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />{savedAdvice ? "Edit" : "Advice"}</button> : null}
                </div>
                {showAdviceComposer ? (
                  <form onSubmit={confirmAdvice} className="mt-4 space-y-4">
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600">Consultant's advice</span>
                      <textarea
                        autoFocus
                        rows={3}
                        value={adviceText}
                        onChange={(event) => setAdviceText(event.target.value)}
                        placeholder='Example: "Client should apply for PSW. Call the client, confirm they want to proceed, and collect the required documents."'
                        className="mt-1.5 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-sky-400"
                      />
                    </label>
                    <div>
                      <span className="text-xs font-semibold text-slate-600">Category</span>
                      <div className="mt-1.5">
                        <MultiCaseTypeCombobox
                          value={adviceCategories}
                          onChange={setAdviceCategories}
                          options={adviceCaseTypeOptions}
                          aliases={adviceCaseTypeAliases}
                          placeholder="Search or add a category…"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Assign to</span>
                        <select
                          value={adviceAssignedUserId}
                          onChange={(event) => {
                            const nextPrimary = event.target.value;
                            setAdviceAssignedUserId(nextPrimary);
                            setAdviceAdditionalAssignedUserIds((current) => current.filter((id) => id !== nextPrimary));
                          }}
                          className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400"
                        >
                          <option value="">Select team member</option>
                          {adviceStaff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Follow-up date</span>
                        <input type="date" value={adviceFollowUpDate} onChange={(event) => setAdviceFollowUpDate(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400" />
                      </label>
                    </div>
                    {adviceStaff.length > 1 ? (
                      <div>
                        <span className="text-xs font-semibold text-slate-600">Also assign (optional)</span>
                        <p className="mt-0.5 text-[11px] text-slate-400">Other consultants who should see this handoff. The follow-up task still goes to the primary assignee above.</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {adviceStaff.filter((person) => person.id !== adviceAssignedUserId).map((person) => {
                            const checked = adviceAdditionalAssignedUserIds.includes(person.id);
                            return (
                              <button
                                type="button"
                                key={person.id}
                                onClick={() => setAdviceAdditionalAssignedUserIds((current) => checked ? current.filter((id) => id !== person.id) : current.length >= 5 ? current : [...current, person.id])}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition ${checked ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}
                              >
                                {person.fullName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {adviceError ? <p className="text-xs font-medium text-rose-700">{adviceError}</p> : null}
                    <div className="flex justify-end gap-2">
                      <button type="button" disabled={adviceSaving} onClick={() => setShowAdviceComposer(false)} className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600">Close</button>
                      <button type="submit" disabled={adviceSaving} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">
                        <Save className="h-3.5 w-3.5" />{adviceSaving ? "Saving…" : "Save and assign"}
                      </button>
                    </div>
                  </form>
                ) : savedAdvice ? (
                  <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex flex-wrap gap-1.5">
                      {savedAdvice.categories.map((category) => <span key={category} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">{category}</span>)}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{savedAdvice.adviceText}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Assigned to {[savedAdvice.assignedUser?.fullName, ...(savedAdvice.additionalAssignedUsers || []).map((user) => user.fullName)].filter(Boolean).join(", ") || "—"}
                      <span className="mx-1.5">·</span>
                      Follow up by {savedAdvice.followUpDate ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(savedAdvice.followUpDate)) : "—"}
                      {!savedAdvice.leadId ? <><span className="mx-1.5">·</span>No lead linked — saved to this appointment only</> : null}
                    </p>
                  </div>
                ) : null}
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
