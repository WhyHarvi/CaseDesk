import {
  ArrowUpRight,
  BriefcaseBusiness,
  Calendar,
  Check,
  ChevronDown,
  FileText,
  History,
  IdCard,
  Languages,
  Loader2,
  Mail,
  MapPin,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  Smartphone,
  StickyNote,
  Trash2,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import { useSoftphone } from "../components/calls/SoftphoneProvider";
import PortalAccessCard from "../components/clients/PortalAccessCard";
import QuickBooksSyncCard from "../components/clients/QuickBooksSyncCard";
import CaseEasyReportsCard from "../components/clients/CaseEasyReportsCard";
import CaseEasyOriginBadge from "../components/clients/CaseEasyOriginBadge";
import StaffAvatar from "../components/staff/StaffAvatar";
import StatementOfAccountOverlay from "../components/statements/StatementOfAccountOverlay";
import { useAuth } from "../auth/AuthContext";
import ClientAppointmentsCard from "../components/appointments/ClientAppointmentsCard";
import AppointmentProfileOverlay from "../components/appointments/AppointmentProfileOverlay";
import ClientBillingCard from "../components/clients/ClientBillingCard";
import ClientCommunicationCard from "../components/clients/ClientCommunicationCard";
import ClientEditDrawer from "../components/clients/ClientEditDrawer";
import NoteDeleteOverlay from "../components/case-profile/notes/NoteDeleteOverlay";
import { canAccessPage, hasCapability } from "../auth/portalAccess";
import { fadingHighlightClass, useFadingHighlight } from "../hooks/useFadingHighlight";
import useDebouncedAutosave from "../hooks/useDebouncedAutosave";
import {
  CaseFormDrawer,
  defaultCaseFormState,
  getDefaultNextAction,
  newCaseOperationKey,
} from "./Cases";
import { caseStagesForType } from "../constants/caseStages";
import { isStudyPermitCaseType, studyIntakeApiValue } from "../utils/studyIntake";

const glass = "rounded-[1.9rem] border border-slate-200/90 bg-white shadow-[0_14px_38px_rgba(15,23,42,0.07)]";
const spring = { type: "spring", stiffness: 320, damping: 30 };
function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

const defaultNoteFormState = {
  content: "",
};

// Mirrors caseController.js's TERMINAL_CASE_STATUSES — any status here
// means the case is done, not just "not literally Closed".
const TERMINAL_CASE_STATUSES = new Set(["Completed", "Closed", "Cancelled", "Inactive"]);

function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInitials(name) {
  return (name || "Client")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function getStatusStyles(status) {
  const styles = {
    Lead: "bg-slate-100 text-slate-700",
    Active: "bg-emerald-100 text-emerald-700",
    Inactive: "bg-slate-100 text-slate-700",
    Closed: "bg-slate-200 text-slate-700",
    Consultation: "bg-blue-100 text-blue-700",
    "Retainer Pending": "bg-amber-100 text-amber-700",
    "Offer Letter Application Submitted": "bg-cyan-100 text-cyan-700",
    "Offer Letter Received": "bg-teal-100 text-teal-700",
    "Documents Pending": "bg-orange-100 text-orange-700",
    "Reviewing Documents": "bg-violet-100 text-violet-700",
    "Application Preparing": "bg-teal-100 text-teal-700",
    "Application Under Review": "bg-blue-100 text-blue-700",
    Submitted: "bg-indigo-100 text-indigo-700",
  };

  return styles[status] || "bg-slate-100 text-slate-700";
}

function clientActivityTitle(activity) {
  const actor = activity.user?.fullName || "CaseDesk";
  const labels = {
    "client.created": "created client",
    "client.updated": "updated client",
    "client.assigned": "changed client assignment",
    "client.closed": "closed client",
    "client.archived": "archived client",
    "client.restored": "restored client",
    "appointment.booked": "booked appointment",
    "appointment.client_linked": "linked appointment to client",
    "appointment.status_updated": "updated appointment status",
    "appointment.session_type_corrected": "corrected appointment type",
  };
  const fallback = String(activity.action || "updated client")
    .replace(/^client\./, "")
    .replace(/[._]+/g, " ");
  return `${actor} ${labels[activity.action] || fallback}`;
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
      {message}
    </div>
  );
}

const QUICK_ACTION_TONES = {
  email: "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100 hover:text-sky-900",
  phone: "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100 hover:text-violet-900",
  whatsapp: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-900",
  chat: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 hover:text-amber-900",
};

function QuickActionLink({ href, onClick, icon: Icon, label, disabled = false, tone = "email" }) {
  const sharedClassName =
    `inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition ${QUICK_ACTION_TONES[tone] || QUICK_ACTION_TONES.email}`;

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className={`${sharedClassName} cursor-not-allowed opacity-50`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${sharedClassName} hover:border-slate-300 hover:text-slate-950`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }

  return (
    <a
      href={href}
      className={`${sharedClassName} hover:border-slate-300 hover:text-slate-950`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

function NoteForm({
  formState,
  onChange,
  onSubmit,
  onCancel,
  saving,
  formError,
  isEditing,
}) {
  return (
    <motion.section
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="mt-4 overflow-hidden border-y border-violet-100 bg-violet-50/45 py-4"
      aria-labelledby="client-note-title"
    >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-500">Profile note</p>
            <h2 id="client-note-title" className="mt-0.5 text-base font-semibold text-slate-950">
              {isEditing ? "Edit note" : "Add note"}
            </h2>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Note
            </span>
            <textarea
              autoFocus
              required
              name="content"
              rows="4"
              value={formState.content}
              onChange={onChange}
              className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-100"
              placeholder="Relationship note, preference, or important profile detail."
            />
          </label>

          {formError ? (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {formError}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)] transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? "Saving…" : isEditing ? "Save changes" : "Create note"}
            </button>
          </div>
        </form>
    </motion.section>
  );
}

function NoteCard({ note, canManage, onEdit, onDelete, deletingId }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {note.user?.fullName || "Team note"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTime(note.createdAt)}
          </p>
        </div>
        {canManage ? <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onEdit(note)}
            className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:border-brand-200 hover:text-brand-700"
            aria-label="Edit note"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(note)}
            disabled={deletingId === note.id}
            className="rounded-2xl border border-rose-200 bg-white p-2.5 text-rose-500 transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Delete note"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div> : null}
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
        {note.content}
      </p>
    </div>
  );
}

function CaseRow({ item, isPrimary = false, canOpenCase = false }) {
  const assignedLabel = item.assignedUser?.fullName || "Unassigned";
  const updatedLabel = formatDate(item.updatedAt || item.createdAt);
  const isImported = Boolean(item.caseEasyImportCases?.length);
  const Wrapper = canOpenCase ? Link : "div";
  const wrapperProps = canOpenCase
    ? { to: `/app/cases/${item.id}`, target: "_blank", rel: "noopener noreferrer" }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cx(
        "flex flex-col gap-3 rounded-2xl border px-4 py-3.5 transition md:flex-row md:items-center md:justify-between",
        isPrimary ? "border-sky-200 border-l-[3px] border-l-sky-500 bg-sky-50/70" : "border-slate-200 bg-slate-50/45",
        canOpenCase
          ? isPrimary
            ? "hover:border-sky-300 hover:bg-sky-50/80"
            : "hover:border-slate-300 hover:bg-slate-100/70"
          : "",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-950">
            {item.caseType || "Untitled case"}
          </p>
          {isPrimary ? (
            <span className="inline-flex rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold text-white">
              Current
            </span>
          ) : null}
          {isImported ? (
            <span
              title="Migrated from Case Easy as historical reference — closed by default, not part of active work"
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
            >
              Imported
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-xs text-slate-500">
          {assignedLabel} <span className="mx-1.5 text-slate-300">•</span>
          Updated {updatedLabel}
        </p>

        {item.nextAction ? (
          <p className="mt-2 text-sm text-slate-600">Next: {item.nextAction}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getStatusStyles(item.stage || item.status)}`}
        >
          {item.stage || item.status || "Open"}
        </span>
        {canOpenCase ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500">
            Open case
            <ArrowUpRight className="h-4 w-4" />
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}

function DetailRow({ icon: Icon, label, value, hint }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

export default function ClientProfile() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { role, appUser, membership } = useAuth();
  const { status: softphoneStatus, dial } = useSoftphone();
  const [callError, setCallError] = useState("");
  const canAccessInternalNotes = hasCapability(role, membership?.permissions, "internalNotes");
  const canAccessFinancialData = hasCapability(role, membership?.permissions, "financialData");
  const canManageClientPortal = hasCapability(role, membership?.permissions, "manageClientPortal");
  const canOpenCases = canAccessPage(role, membership?.permissions, "cases");
  const initialBillingEntry = location.state?.openBillingEntry ? location.state.billingEntry : null;
  const canReassignClient = ["admin", "frontdesk"].includes(role);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [noteFormState, setNoteFormState] = useState(defaultNoteFormState);
  const [noteFormError, setNoteFormError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState("");
  const [deleteNoteTarget, setDeleteNoteTarget] = useState(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [workflowAppointmentId, setWorkflowAppointmentId] = useState(null);
  const [assignmentUsers, setAssignmentUsers] = useState([]);
  const [assignmentUserId, setAssignmentUserId] = useState("");
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState(null);
  const initialChatConversationId = new URLSearchParams(location.search).get("conversation");
  const [chatOpen, setChatOpen] = useState(Boolean(initialChatConversationId));
  const [caseCreateOpen, setCaseCreateOpen] = useState(false);
  const [caseCreateClosing, setCaseCreateClosing] = useState(false);
  const [caseCreateSaving, setCaseCreateSaving] = useState(false);
  const [caseCreateError, setCaseCreateError] = useState("");
  const [caseCreateKey, setCaseCreateKey] = useState(newCaseOperationKey);
  const [caseCreateForm, setCaseCreateForm] = useState(defaultCaseFormState);
  const [caseTypeOptions, setCaseTypeOptions] = useState([]);
  const [caseTypeAliases, setCaseTypeAliases] = useState({});
  const [caseTeamOptions, setCaseTeamOptions] = useState({
    rcicUsers: [],
    caseWorkerUsers: [],
    ready: false,
    missing: [],
  });

  useEffect(() => {
    if (initialChatConversationId) setChatOpen(true);
  }, [initialChatConversationId]);

  async function startClientCall() {
    if (!client?.phone) return;
    try {
      setCallError("");
      await dial(client.phone, { clientId: client.id, clientName: client.fullName });
    } catch (reason) {
      setCallError(reason?.message || "The call could not be placed.");
    }
  }

  const isEditingNote = Boolean(editingNote);
  const client = profile?.client || null;
  const cases =
    profile?.cases || (profile?.activeCase ? [profile.activeCase] : []);
  // Only ever the client's genuinely active case — never falls back to
  // "whatever case happens to be first", which previously showed a closed
  // case as if it were active whenever it was the client's only case.
  const currentCase = profile?.activeCase || null;
  const notes = profile?.notes || [];
  const clientActivities = profile?.activityLogs || [];

  const profileNotes = useMemo(
    () => notes.filter((note) => !note.caseId || note.appointmentId),
    [notes],
  );
  const sortedProfileNotes = useMemo(
    () =>
      [...profileNotes].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [profileNotes],
  );
  const highlightedNoteId = useMemo(
    () => new URLSearchParams(location.search).get("note") || "",
    [location.search],
  );
  // Lets a link from elsewhere (e.g. a lead's "Path to conversion" panel)
  // jump straight to the Billing card and briefly highlight it, instead of
  // dropping someone on the client profile and leaving them to scroll and
  // find it themselves.
  const focusSection = useMemo(
    () => new URLSearchParams(location.search).get("focus") || "",
    [location.search],
  );
  const openCases = useMemo(
    () =>
      cases.filter(
        (item) =>
          !TERMINAL_CASE_STATUSES.has(item.status) && item.stage !== "Closed",
      ),
    [cases],
  );
  const assignmentOptions = useMemo(() => {
    const consultants = assignmentUsers.filter((user) =>
      ["admin", "consultant"].includes(user.role),
    );
    if (
      client?.assignedUser?.id &&
      !consultants.some((user) => user.id === client.assignedUser.id)
    ) {
      return [...consultants, client.assignedUser];
    }
    return consultants;
  }, [assignmentUsers, client?.assignedUser]);

  async function loadClient() {
    try {
      setLoading(true);
      const response = await api.get(`/clients/${id}`);
      setProfile(response.data.data);
      setError("");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to load this client profile.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClient();
  }, [id]);

  useEffect(() => {
    if (!client?.id || !canOpenCases || cases.length) return;

    Promise.all([
      api.get("/cases/case-types"),
      api.get("/cases/collaboration-options"),
    ])
      .then(([caseTypesResponse, collaborationResponse]) => {
        setCaseTypeOptions(caseTypesResponse.data.data || []);
        setCaseTypeAliases(caseTypesResponse.data.aliases || {});
        const options = collaborationResponse.data.data || {
          rcicUsers: [], caseWorkerUsers: [], ready: false, missing: ["RCIC", "Case Worker"],
        };
        setCaseTeamOptions(options);
        setCaseCreateForm((current) => {
          const rcicUserId = current.rcicUserId || (options.rcicUsers?.length === 1 ? options.rcicUsers[0].id : "");
          const caseWorkerUserId = current.caseWorkerUserId || (options.caseWorkerUsers?.length === 1 ? options.caseWorkerUsers[0].id : "");
          return {
            ...current,
            clientId: client.id,
            rcicUserId,
            assignedUserId: current.assignedUserId || rcicUserId,
            caseWorkerUserId,
          };
        });
      })
      .catch(() => {
        setCaseTeamOptions({
          rcicUsers: [], caseWorkerUsers: [], ready: false, missing: ["RCIC", "Case Worker"],
        });
      });
  }, [client?.id, canOpenCases, cases.length]);

  useEffect(() => {
    let active = true;
    async function resolveWorkflowAppointment() {
      try {
        const upcoming = await api.get(`/clients/${id}/appointments?scope=upcoming&page=1&limit=1`);
        let appointment = upcoming.data.data?.[0] || null;
        if (!appointment) {
          const recent = await api.get(`/clients/${id}/appointments?scope=all&page=1&limit=1`);
          appointment = recent.data.data?.[0] || null;
        }
        if (active) setWorkflowAppointmentId(appointment?.id || null);
      } catch {
        if (active) setWorkflowAppointmentId(null);
      }
    }
    resolveWorkflowAppointment();
    return () => { active = false; };
  }, [id]);

  function openAppointment(appointmentId, action = null, initialTab = "details") {
    if (!appointmentId) return;
    setSelectedAppointment({ id: appointmentId, action, initialTab });
  }

  useEffect(() => {
    setAssignmentUserId(client?.assignedUser?.id || "");
  }, [client?.assignedUser?.id]);

  useEffect(() => {
    if (!canReassignClient) return undefined;
    let active = true;
    setAssignmentLoading(true);
    api.get("/leads/staff")
      .then((response) => {
        if (active) setAssignmentUsers(response.data.data || []);
      })
      .catch(() => {
        if (active) setAssignmentFeedback({ tone: "error", message: "Consultants could not be loaded." });
      })
      .finally(() => {
        if (active) setAssignmentLoading(false);
      });
    return () => { active = false; };
  }, [canReassignClient]);

  const activeHighlightedNoteId = useFadingHighlight(highlightedNoteId, {
    domIdPrefix: "client-note-",
    ready: !loading,
    deps: [sortedProfileNotes],
  });
  const activeFocusSection = useFadingHighlight(focusSection, {
    domIdPrefix: "client-section-",
    ready: !loading,
  });

  function resetNoteForm() {
    setNoteFormState(defaultNoteFormState);
    setEditingNote(null);
    setNoteFormError("");
    setShowNoteForm(false);
  }

  function openCreateNoteForm() {
    setEditingNote(null);
    setNoteFormState(defaultNoteFormState);
    setNoteFormError("");
    setShowNoteForm(true);
  }

  function openEditNoteForm(note) {
    setEditingNote(note);
    setNoteFormState({
      content: note.content || "",
    });
    setNoteFormError("");
    setShowNoteForm(true);
  }

  function handleNoteChange(event) {
    const { name, value } = event.target;
    setNoteFormState((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function updateSavedNote(savedNote) {
    setProfile((current) => {
      const currentNotes = current?.notes || [];
      const exists = currentNotes.some((note) => note.id === savedNote.id);
      return {
        ...current,
        notes: exists
          ? currentNotes.map((note) => note.id === savedNote.id ? savedNote : note)
          : [savedNote, ...currentNotes],
      };
    });
  }

  async function handleNoteSubmit(event, { keepOpen = false } = {}) {
    event?.preventDefault();

    if (savingNote || !noteFormState.content.trim()) return;

    try {
      setSavingNote(true);
      setNoteFormError("");

      const payload = {
        clientId: id,
        content: noteFormState.content.trim(),
      };

      const response = isEditingNote
        ? await api.patch(`/notes/${editingNote.id}`, payload)
        : await api.post("/notes", payload);
      const savedNote = response.data.data;
      updateSavedNote(savedNote);

      if (keepOpen) {
        setEditingNote(savedNote);
      } else {
        resetNoteForm();
      }
    } catch (requestError) {
      setNoteFormError(
        requestError.response?.data?.message || "Unable to save note.",
      );
    } finally {
      setSavingNote(false);
    }
  }

  useDebouncedAutosave({
    value: noteFormState.content,
    savedValue: editingNote?.content || "",
    enabled: showNoteForm && !savingNote,
    onSave: () => handleNoteSubmit(null, { keepOpen: true }),
  });

  async function handleDeleteNote(note) {
    try {
      setDeletingNoteId(note.id);
      await api.delete(`/notes/${note.id}`);
      setProfile((current) => ({
        ...current,
        notes: (current?.notes || []).filter((item) => item.id !== note.id),
      }));
      setDeleteNoteTarget(null);

      if (editingNote?.id === note.id) {
        resetNoteForm();
      }
    } catch (requestError) {
      setNoteFormError(
        requestError.response?.data?.message || "Unable to delete note.",
      );
    } finally {
      setDeletingNoteId("");
    }
  }

  async function handleAssignmentChange(event) {
    const nextAssignedUserId = event.target.value;
    const previousAssignedUserId = client.assignedUser?.id || "";
    if (nextAssignedUserId === previousAssignedUserId) return;

    try {
      setAssignmentUserId(nextAssignedUserId);
      setAssignmentSaving(true);
      setAssignmentFeedback(null);
      const response = await api.patch(`/clients/${client.id}`, {
        assignedUserId: nextAssignedUserId,
      });
      setProfile((current) => ({
        ...current,
        client: { ...current.client, ...response.data.data },
      }));
      setAssignmentFeedback({ tone: "success", message: "Assignment updated." });
    } catch (requestError) {
      setAssignmentUserId(previousAssignedUserId);
      setAssignmentFeedback({
        tone: "error",
        message: requestError.response?.data?.message || "Assignment could not be updated.",
      });
    } finally {
      setAssignmentSaving(false);
    }
  }

  function openCaseCreate() {
    const rcicUserId = caseTeamOptions.rcicUsers?.length === 1
      ? caseTeamOptions.rcicUsers[0].id
      : "";
    const caseWorkerUserId = caseTeamOptions.caseWorkerUsers?.length === 1
      ? caseTeamOptions.caseWorkerUsers[0].id
      : "";

    setCaseCreateForm({
      ...defaultCaseFormState,
      clientId: client.id,
      rcicUserId,
      assignedUserId: rcicUserId,
      caseWorkerUserId,
    });
    setCaseCreateKey(newCaseOperationKey());
    setCaseCreateError("");
    setCaseCreateClosing(false);
    setCaseCreateOpen(true);
  }

  function closeCaseCreate() {
    if (caseCreateSaving) return;
    setCaseCreateClosing(true);
    window.setTimeout(() => {
      setCaseCreateOpen(false);
      setCaseCreateClosing(false);
      setCaseCreateError("");
    }, 220);
  }

  function handleCaseCreateChange(event) {
    const { name, value } = event.target;
    setCaseCreateForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "caseType" && !isStudyPermitCaseType(value)) {
        next.studyIntakeMonth = "";
        if (!caseStagesForType(value).includes(current.stage)) {
          next.stage = "Retainer Pending";
          next.nextAction = getDefaultNextAction("Retainer Pending");
        }
      }
      if (name === "stage" && !current.nextAction) {
        next.nextAction = getDefaultNextAction(value);
      }
      if (name === "rcicUserId") next.assignedUserId = value;
      return next;
    });
  }

  async function handleCaseCreateSubmit(event) {
    event.preventDefault();
    try {
      setCaseCreateSaving(true);
      setCaseCreateError("");
      const payload = {
        ...caseCreateForm,
        idempotencyKey: caseCreateKey,
        studyIntakeMonth: isStudyPermitCaseType(caseCreateForm.caseType)
          ? studyIntakeApiValue(caseCreateForm.studyIntakeMonth)
          : null,
        nextAction: caseCreateForm.nextAction.trim() || getDefaultNextAction(caseCreateForm.stage),
      };
      if (!payload.rcicUserId || !payload.caseWorkerUserId) {
        throw new Error("Choose both an RCIC and a Case Worker before creating the case.");
      }
      delete payload.assignedUserId;
      if (!payload.submittedAt) delete payload.submittedAt;
      if (!payload.decisionAt) delete payload.decisionAt;

      const response = await api.post("/cases", payload);
      const savedCase = response.data.data || response.data;
      setCaseCreateOpen(false);
      navigate(`/app/cases/${savedCase.id}`);
    } catch (requestError) {
      setCaseCreateError(
        requestError.response?.data?.message || requestError.message || "Unable to create case.",
      );
    } finally {
      setCaseCreateSaving(false);
    }
  }

  const shellBg = "min-h-full min-w-0 px-3 py-4 sm:px-5 lg:px-6";

  if (loading) {
    return (
      <main className={shellBg}>
        <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
          <div className={cx(glass, "h-40 animate-pulse p-6")} />
          <div className="grid gap-5 xl:grid-cols-[1.62fr_0.85fr]">
            <div className="space-y-5">
              <div className={cx(glass, "h-48 animate-pulse")} />
              <div className={cx(glass, "h-64 animate-pulse")} />
            </div>
            <div className="space-y-5">
              <div className={cx(glass, "h-72 animate-pulse")} />
              <div className={cx(glass, "h-40 animate-pulse")} />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!client) {
    return (
      <main className={shellBg}>
        <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
          <div className={cx(glass, "p-8 text-sm text-slate-500")}>
            {error || "Try opening one of the client cards from the clients list."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={shellBg}>
      <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-5">
        {statementOpen ? (
          <StatementOfAccountOverlay
            clientId={id}
            onClose={() => setStatementOpen(false)}
          />
        ) : null}
        {editingClient ? (
          <ClientEditDrawer
            client={client}
            onClose={() => setEditingClient(false)}
            onSaved={async () => {
              setEditingClient(false);
              await loadClient();
            }}
          />
        ) : null}
        {caseCreateOpen ? (
          <CaseFormDrawer
            formState={caseCreateForm}
            onChange={handleCaseCreateChange}
            onSubmit={handleCaseCreateSubmit}
            onCancel={closeCaseCreate}
            saving={caseCreateSaving}
            formError={caseCreateError}
            clients={[client]}
            users={[]}
            caseTypeOptions={caseTypeOptions}
            caseTypeAliases={caseTypeAliases}
            isEditing={false}
            fixedClient={client}
            newCaseTeamOptions={caseTeamOptions}
            closing={caseCreateClosing}
          />
        ) : null}
        <ClientCommunicationCard
          clientId={client.id}
          clientName={client.fullName}
          cases={cases}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          initialConversationId={initialChatConversationId}
          canManagePortal={canManageClientPortal}
          onManagePortalAccess={() => {
            window.setTimeout(() => {
              document.getElementById("client-portal-access")?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }, 80);
          }}
        />
        {selectedAppointment ? (
          <AppointmentProfileOverlay
            appointmentId={selectedAppointment.id}
            initialTab={selectedAppointment.initialTab}
            initialAction={selectedAppointment.action}
            onClose={() => setSelectedAppointment(null)}
            onChanged={loadClient}
          />
        ) : null}
        <NoteDeleteOverlay
          note={deleteNoteTarget}
          busy={Boolean(deletingNoteId)}
          error={noteFormError}
          onClose={() => { if (!deletingNoteId) { setDeleteNoteTarget(null); setNoteFormError(""); } }}
          onConfirm={() => handleDeleteNote(deleteNoteTarget)}
        />
        {error ? (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        {callError ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{callError}</span>
            <button type="button" onClick={() => setCallError("")} className="text-xs font-semibold underline">Dismiss</button>
          </div>
        ) : null}

        {/* Identity header — who this is, what they're actively working on,
            and the fastest way to reach them, all in one glance. Everything
            reference-only (DOB, marital status, ID, address) lives in the
            sidebar instead, so this card stays scannable. */}
        <motion.header initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cx(glass, "p-5 sm:p-7")}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#475569)] text-base font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]">
                {getInitials(client.fullName)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {client.fullName}
                  </h1>
                  {client.clientNumber ? <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">{client.clientNumber}</span> : null}
                  <span className={cx("inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold", getStatusStyles(client.status))}>
                    {client.status || "Client"}
                  </span>
                  {client.caseEasyImportContacts?.length ? <CaseEasyOriginBadge /> : null}
                </div>
                <p className="mt-1.5 text-sm text-slate-500">
                  {cases.length} {cases.length === 1 ? "case" : "cases"}
                  <span className="mx-1.5 text-slate-300">·</span>
                  {client.assignedUser?.fullName || "Unassigned"}
                  {currentCase ? (
                    <>
                      <span className="mx-1.5 text-slate-300">·</span>
                      {canOpenCases ? (
                        <Link
                          to={`/app/cases/${currentCase.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-900"
                        >
                          {currentCase.caseType || "Open case"}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-700">{currentCase.caseType || "Case on file"}</span>
                      )}
                      <span className="text-slate-400"> · {currentCase.stage || currentCase.status || "Open"}</span>
                    </>
                  ) : (
                    <>
                      <span className="mx-1.5 text-slate-300">·</span>
                      {cases.length ? "No active case" : "No case yet"}
                    </>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <QuickActionLink
                    href={client.email ? `mailto:${client.email}` : "#"}
                    icon={Mail}
                    label={client.email || "No email on file"}
                    disabled={!client.email}
                    tone="email"
                  />
                  <QuickActionLink
                    href={client.phone ? `tel:${client.phone}` : "#"}
                    icon={Phone}
                    label={client.phone || "No mobile on file"}
                    disabled={!client.phone}
                    tone="phone"
                    onClick={softphoneStatus === "ready" && client.phone ? startClientCall : undefined}
                  />
                  <QuickActionLink
                    href={client.phone ? `https://wa.me/${client.phone.replace(/[^\d]/g, "")}` : "#"}
                    icon={Smartphone}
                    label="WhatsApp"
                    disabled={!client.phone}
                    tone="whatsapp"
                  />
                  <QuickActionLink onClick={() => setChatOpen(true)} icon={MessageSquareText} label="Portal chat" tone="chat" />
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 lg:shrink-0">
              <div className="flex flex-wrap items-center justify-end gap-2">
              {canAccessInternalNotes ? (
                <button
                  type="button"
                  onClick={openCreateNoteForm}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  Add note
                </button>
              ) : null}
              {["admin", "consultant", "frontdesk"].includes(role) ? (
                <button
                  type="button"
                  onClick={() => setEditingClient(true)}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                >
                  <Pencil className="h-4 w-4" />
                  Edit profile
                </button>
              ) : null}
              {currentCase && canOpenCases ? (
                <Link
                  to={`/app/cases/${currentCase.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                >
                  Open active case
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              ) : !cases.length && canOpenCases ? (
                <button
                  type="button"
                  onClick={openCaseCreate}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                >
                  <Plus className="h-4 w-4" />
                  Create case
                </button>
              ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={!workflowAppointmentId}
                  onClick={() => openAppointment(workflowAppointmentId, "pre-consultation")}
                  title={workflowAppointmentId ? "Open the pre-consultation questionnaire" : "No appointment is available"}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 text-sm font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <FileText className="h-4 w-4" />
                  Pre-consultation form
                </button>
                {canAccessInternalNotes ? (
                  <button
                    type="button"
                    disabled={!workflowAppointmentId}
                    onClick={() => openAppointment(workflowAppointmentId, "advice-handoff", "notes")}
                    title={workflowAppointmentId ? "Open advice and handoff" : "No appointment is available"}
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <StickyNote className="h-4 w-4" />
                    Advice &amp; handoff
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </motion.header>

        {/* Main = what staff actively work with (appointments, cases, money,
            notes). Sidebar = identity/reference facts and integrations,
            consulted far less often — this is what actually uses the wide
            screens most desks run on instead of one long single-width
            scroll of same-weight cards. */}
        <div className="grid gap-5 xl:grid-cols-[1.62fr_0.85fr] xl:items-start">
          <div className="min-w-0 space-y-5">
            <ClientAppointmentsCard clientId={client.id} onOpenAppointment={openAppointment} />

            <motion.article initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.03 }} className={cx(glass, "p-6")}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
                    <BriefcaseBusiness className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Cases</h2>
                    <p className="mt-0.5 text-sm text-slate-500">Each file lives on its own case page.</p>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{cases.length} total</span>
              </div>

              <div className="mt-4 space-y-2">
                {cases.length ? (
                  cases.map((item) => (
                    <CaseRow
                      key={item.id}
                      item={item}
                      isPrimary={item.id === currentCase?.id}
                      canOpenCase={canOpenCases}
                    />
                  ))
                ) : (
                  <EmptyState message="No cases linked yet. Create the first file from the cases page." />
                )}
              </div>
            </motion.article>

            {canAccessFinancialData ? (
              <ClientBillingCard
                id="client-section-billing"
                highlightClassName={fadingHighlightClass(activeFocusSection === "billing")}
                clientId={client.id}
                clientName={client.fullName}
                initialEntry={initialBillingEntry}
                onEntrySaved={(_result, preset) => {
                  if (preset?.afterSave !== "appointment") return;
                  navigate(`/app/calendar?bookForClient=${encodeURIComponent(client.id)}`, {
                    state: { frontDeskIntake: { action: "appointment" } },
                  });
                }}
                onOpenStatement={() => setStatementOpen(true)}
              />
            ) : null}

            {canAccessInternalNotes ? (
              <motion.article initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.06 }} className={cx(glass, "p-6")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                      <StickyNote className="h-4.5 w-4.5" />
                    </span>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">Client notes</h2>
                      <p className="mt-0.5 text-sm text-slate-500">Profile and appointment notes in one history.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateNoteForm}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>

                {showNoteForm ? (
                  <NoteForm
                    formState={noteFormState}
                    onChange={handleNoteChange}
                    onSubmit={handleNoteSubmit}
                    onCancel={resetNoteForm}
                    saving={savingNote}
                    formError={noteFormError}
                    isEditing={isEditingNote}
                  />
                ) : null}

                <div className="mt-4 space-y-3">
                  {sortedProfileNotes.length ? (
                    sortedProfileNotes.map((note) => (
                      <div
                        id={`client-note-${note.id}`}
                        key={note.id}
                        className={`rounded-[1.4rem] ${fadingHighlightClass(note.id === activeHighlightedNoteId)}`}
                      >
                        {note.appointment ? (
                          <button
                            type="button"
                            onClick={() => openAppointment(note.appointment.id, null, "notes")}
                            className="mb-2 inline-flex max-w-full items-center gap-2 rounded-full bg-violet-50 px-3 py-1.5 text-left text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100"
                          >
                            <span className="truncate">{note.appointment.subject}</span>
                            <span className="shrink-0 text-violet-400">{formatDateTime(note.appointment.startsAt)}</span>
                          </button>
                        ) : null}
                        <NoteCard
                          note={note}
                          canManage={role === "admin" || note.user?.id === appUser?.id}
                          onEdit={openEditNoteForm}
                          onDelete={(item) => { setNoteFormError(""); setDeleteNoteTarget(item); }}
                          deletingId={deletingNoteId}
                        />
                      </div>
                    ))
                  ) : (
                    <EmptyState message="No profile notes yet." />
                  )}
                </div>
              </motion.article>
            ) : null}
          </div>

          <div className="min-w-0 space-y-5">
            <motion.article initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.03 }} className={cx(glass, "p-6")}>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                  <IdCard className="h-4.5 w-4.5" />
                </span>
                <h2 className="text-lg font-semibold text-slate-950">Profile details</h2>
              </div>

              <div className="mt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Assigned consultant</p>
                {canReassignClient ? (
                  <div className="mt-1.5 flex items-center gap-2.5">
                    {client.assignedUser ? <StaffAvatar user={client.assignedUser} alt={`${client.assignedUser.fullName} profile`} className="h-9 w-9 shrink-0" /> : null}
                    <div className="min-w-0 flex-1">
                    <div className="relative">
                      <UserRoundCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <select
                        aria-label="Assigned consultant"
                        value={assignmentUserId}
                        onChange={handleAssignmentChange}
                        disabled={assignmentLoading || assignmentSaving}
                        className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white py-0 pl-9 pr-9 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:cursor-wait disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        <option value="">Unassigned</option>
                        {assignmentOptions.map((user) => (
                          <option key={user.id} value={user.id}>{user.fullName}</option>
                        ))}
                      </select>
                      {assignmentLoading || assignmentSaving ? (
                        <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-sky-600" />
                      ) : (
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      )}
                    </div>
                    {assignmentFeedback ? (
                      <p className={cx("mt-1.5 flex items-center gap-1 text-[11px] font-medium", assignmentFeedback.tone === "success" ? "text-emerald-600" : "text-rose-600")}>
                        {assignmentFeedback.tone === "success" ? <Check className="h-3 w-3" /> : null}
                        {assignmentFeedback.message}
                      </p>
                    ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2.5">
                    {client.assignedUser ? <StaffAvatar user={client.assignedUser} alt={`${client.assignedUser.fullName} profile`} className="h-9 w-9 shrink-0" /> : null}
                    <p className="text-sm font-medium text-slate-800">{client.assignedUser?.fullName || "Unassigned"}</p>
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2">
                <DetailRow icon={Calendar} label="Joined" value={formatDate(client.createdAt)} />
                <DetailRow icon={Calendar} label="Date of birth" value={formatDate(client.dateOfBirth)} />
                <DetailRow icon={UserRoundCheck} label="Marital status" value={client.maritalStatus || "Not set"} />
                <DetailRow icon={Languages} label="Preferred language" value={client.preferredLanguage || "Not set"} />
              </div>

              <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                <DetailRow
                  icon={IdCard}
                  label="Identification"
                  value={`${client.identificationType || "Not set"}${client.identificationNumber ? ` · ${client.identificationNumber}` : ""}`}
                  hint={[client.identificationCountry, client.identificationExpiryDate ? `Expires ${formatDate(client.identificationExpiryDate)}` : null].filter(Boolean).join(" · ") || null}
                />
                {client.address ? <DetailRow icon={MapPin} label="Address" value={client.address} /> : null}
              </div>
            </motion.article>

            {canManageClientPortal ? (
              <PortalAccessCard
                clientId={client.id}
                clientEmail={client.email}
                clientName={client.fullName}
                openCaseCount={openCases.length}
              />
            ) : null}

            {["admin", "consultant"].includes(role) && canAccessFinancialData ? (
              <QuickBooksSyncCard
                clientId={client.id}
                qbCustomerId={client.qbCustomerId}
                qbSyncStatus={client.qbSyncStatus}
                qbSyncError={client.qbSyncError}
                qbSyncedAt={client.qbSyncedAt}
                onSynced={(patch) =>
                  setProfile((current) => ({
                    ...current,
                    client: { ...current.client, ...patch },
                  }))
                }
              />
            ) : null}

            <motion.article
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.08 }}
              className={cx(glass, "flex min-h-[320px] flex-col p-6")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                    <History className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Client activity</h2>
                    <p className="mt-0.5 text-sm text-slate-500">Who changed what on this client.</p>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{clientActivities.length}</span>
              </div>

              <div className="mt-5 min-h-0 flex-1 space-y-0 overflow-y-auto pr-1">
                {clientActivities.length ? clientActivities.map((activity, index) => (
                  <div key={activity.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-50" />
                      {index < clientActivities.length - 1 ? <span className="my-1 w-px flex-1 bg-slate-200" /> : null}
                    </div>
                    <div className="min-w-0 pb-5">
                      <p className="text-sm font-semibold text-slate-900">{clientActivityTitle(activity)}</p>
                      {activity.details ? <p className="mt-1 text-xs leading-5 text-slate-500">{activity.details}</p> : null}
                      <p className="mt-1.5 text-[11px] font-medium text-slate-500">{formatDateTime(activity.createdAt)}</p>
                    </div>
                  </div>
                )) : <EmptyState message="No client activity recorded yet." />}
              </div>
            </motion.article>

            <CaseEasyReportsCard clientId={client.id} />
          </div>
        </div>
      </div>
    </main>
  );
}
