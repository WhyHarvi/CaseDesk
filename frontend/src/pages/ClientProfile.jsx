import {
  ArrowUpRight,
  BriefcaseBusiness,
  Mail,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import api from "../services/api";
import PortalAccessCard from "../components/clients/PortalAccessCard";
import QuickBooksSyncCard from "../components/clients/QuickBooksSyncCard";
import CaseEasyReportsCard from "../components/clients/CaseEasyReportsCard";
import StatementOfAccountOverlay from "../components/statements/StatementOfAccountOverlay";
import { useAuth } from "../auth/AuthContext";
import ClientAppointmentsCard from "../components/appointments/ClientAppointmentsCard";
import AppointmentProfileOverlay from "../components/appointments/AppointmentProfileOverlay";
import ClientBillingCard from "../components/clients/ClientBillingCard";
import ClientCommunicationCard from "../components/clients/ClientCommunicationCard";

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
    "Documents Pending": "bg-orange-100 text-orange-700",
    "Reviewing Documents": "bg-violet-100 text-violet-700",
    "Application Preparing": "bg-teal-100 text-teal-700",
    Submitted: "bg-indigo-100 text-indigo-700",
  };

  return styles[status] || "bg-slate-100 text-slate-700";
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
      {message}
    </div>
  );
}

function QuickActionLink({ href, icon: Icon, label, disabled = false }) {
  const sharedClassName =
    "inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition";

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
    <div className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-panel backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {isEditing ? "Edit note" : "Add note"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Keep profile-level notes here. Case notes stay inside each case.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">
            Note
          </span>
          <textarea
            required
            name="content"
            rows="5"
            value={formState.content}
            onChange={onChange}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white"
            placeholder="Relationship note, preference, or important profile detail."
          />
        </label>

        {formError ? (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {formError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-2xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : isEditing ? "Save changes" : "Create note"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function NoteCard({ note, onEdit, onDelete, deletingId }) {
  return (
    <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50/90 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {note.user?.fullName || "Team note"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTime(note.createdAt)}
          </p>
        </div>
        <div className="flex items-start gap-2">
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
        </div>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
        {note.content}
      </p>
    </div>
  );
}

function CaseRow({ item, isPrimary = false }) {
  const assignedLabel = item.assignedUser?.fullName || "Unassigned";
  const updatedLabel = formatDate(item.updatedAt || item.createdAt);

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
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
        <Link
          to={`/cases/${item.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
        >
          Open case
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

export default function ClientProfile() {
  const { id } = useParams();
  const location = useLocation();
  const { role } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [noteFormState, setNoteFormState] = useState(defaultNoteFormState);
  const [noteFormError, setNoteFormError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState("");
  const [statementOpen, setStatementOpen] = useState(false);
  const [selectedNoteAppointmentId, setSelectedNoteAppointmentId] = useState(null);

  const isEditingNote = Boolean(editingNote);
  const client = profile?.client || null;
  const cases =
    profile?.cases || (profile?.activeCase ? [profile.activeCase] : []);
  // Only ever the client's genuinely active case — never falls back to
  // "whatever case happens to be first", which previously showed a closed
  // case as if it were active whenever it was the client's only case.
  const currentCase = profile?.activeCase || null;
  const notes = profile?.notes || [];

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
  const openCases = useMemo(
    () =>
      cases.filter(
        (item) =>
          !TERMINAL_CASE_STATUSES.has(item.status) && item.stage !== "Closed",
      ),
    [cases],
  );

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
    if (!highlightedNoteId || loading) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`client-note-${highlightedNoteId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedNoteId, loading, sortedProfileNotes]);

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

  async function handleNoteSubmit(event) {
    event.preventDefault();

    try {
      setSavingNote(true);
      setNoteFormError("");

      const payload = {
        clientId: id,
        content: noteFormState.content.trim(),
      };

      if (isEditingNote) {
        await api.patch(`/notes/${editingNote.id}`, payload);
      } else {
        await api.post("/notes", payload);
      }

      await loadClient();
      resetNoteForm();
    } catch (requestError) {
      setNoteFormError(
        requestError.response?.data?.message || "Unable to save note.",
      );
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteNote(note) {
    const confirmed = window.confirm("Delete this note?");

    if (!confirmed) {
      return;
    }

    try {
      setDeletingNoteId(note.id);
      await api.delete(`/notes/${note.id}`);
      await loadClient();

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

  if (loading) {
    return (
      <PageContainer
        title="Client profile"
        description="Loading client details..."
      >
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-panel animate-pulse">
            <div className="h-7 w-48 rounded bg-slate-200" />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="h-28 rounded-2xl bg-slate-100" />
              ))}
            </div>
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="h-80 rounded-3xl border border-white/70 bg-white/80 shadow-panel animate-pulse" />
            <div className="h-80 rounded-3xl border border-white/70 bg-white/80 shadow-panel animate-pulse" />
          </div>
        </div>
      </PageContainer>
    );
  }

  if (!client) {
    return (
      <PageContainer
        title="Client profile"
        description="Unable to load this client route."
      >
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-8 text-sm text-slate-500 shadow-panel">
          {error ||
            "Try opening one of the client cards from the clients list."}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Client profile"
      description="Person details, access, and connected cases."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openCreateNoteForm}
            className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            Add note
          </button>
          {currentCase ? (
            <Link
              to={`/cases/${currentCase.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Open active case
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link
              to="/cases"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Go to cases
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      }
    >
      {statementOpen ? (
        <StatementOfAccountOverlay
          clientId={id}
          onClose={() => setStatementOpen(false)}
        />
      ) : null}
      {selectedNoteAppointmentId ? (
        <AppointmentProfileOverlay
          appointmentId={selectedNoteAppointmentId}
          initialTab="notes"
          onClose={() => setSelectedNoteAppointmentId(null)}
          onChanged={loadClient}
        />
      ) : null}

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

      {error ? (
        <div className="mb-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[1.55fr_0.72fr]">
          <article className="rounded-[1.9rem] border border-white/80 bg-white/88 px-5 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0f172a,#475569)] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]">
                    {getInitials(client.fullName)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-xl font-semibold tracking-tight text-slate-950">
                        {client.fullName}
                      </h2>
                      {client.clientNumber ? <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">{client.clientNumber}</span> : null}
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getStatusStyles(client.status)}`}
                      >
                        {client.status || "Client"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {client.phone || "No mobile"}{" "}
                      <span className="mx-1.5 text-slate-300">•</span>
                      {cases.length} {cases.length === 1 ? "case" : "cases"}{" "}
                      <span className="mx-1.5 text-slate-300">•</span>
                      {client.assignedUser?.fullName || "Unassigned"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-sm text-slate-600">
                  <p>
                    <span className="font-medium text-slate-900">Email:</span>{" "}
                    {client.email || "No email on file"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">
                      Active case:
                    </span>{" "}
                    {currentCase ? (
                      <>
                        <Link
                          to={`/cases/${currentCase.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-900 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-900"
                        >
                          {currentCase.caseType || "Open case"}
                        </Link>
                        <span className="text-slate-400">
                          {" "}
                          • {currentCase.stage || currentCase.status || "Open"}
                        </span>
                      </>
                    ) : cases.length ? (
                      "No active case"
                    ) : (
                      "No case yet"
                    )}
                  </p>
                  <p>
                    <span className="font-medium text-slate-900">Joined:</span>{" "}
                    {formatDate(client.createdAt)}
                    {client.dateOfBirth ? (
                      <span className="text-slate-400">
                        {" "}
                        • DOB {formatDate(client.dateOfBirth)}
                      </span>
                    ) : null}
                  </p>
                  {client.address ? (
                    <p>
                      <span className="font-medium text-slate-900">
                        Address:
                      </span>{" "}
                      {client.address}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 lg:max-w-[42%] lg:justify-end">
                <QuickActionLink
                  href={client.email ? `mailto:${client.email}` : "#"}
                  icon={Mail}
                  label="Mail"
                  disabled={!client.email}
                />
                <QuickActionLink
                  href={client.phone ? `tel:${client.phone}` : "#"}
                  icon={Phone}
                  label="Call"
                  disabled={!client.phone}
                />
                <QuickActionLink
                  href={
                    client.phone
                      ? `https://wa.me/${client.phone.replace(/[^\d]/g, "")}`
                      : "#"
                  }
                  icon={Smartphone}
                  label="WhatsApp"
                  disabled={!client.phone}
                />
                <QuickActionLink
                  href="#client-communications"
                  icon={MessageSquareText}
                  label="Client chat"
                />
              </div>
            </div>
          </article>

          <PortalAccessCard
            clientId={client.id}
            clientEmail={client.email}
            clientName={client.fullName}
            openCaseCount={openCases.length}
          />

          {["admin", "consultant"].includes(role) ? (
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
        </section>

        <ClientAppointmentsCard clientId={client.id} />

        <ClientCommunicationCard
          clientId={client.id}
          initialConversationId={new URLSearchParams(location.search).get("conversation")}
        />

        <section className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
          <article className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                  <BriefcaseBusiness className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">
                    Cases
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Each file lives on its own case page.
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {cases.length} total
              </span>
            </div>

            <div className="mt-5 divide-y divide-slate-100">
              {cases.length ? (
                cases.map((item) => (
                  <CaseRow
                    key={item.id}
                    item={item}
                    isPrimary={item.id === currentCase?.id}
                  />
                ))
              ) : (
                <EmptyState message="No cases linked yet. Create the first file from the cases page." />
              )}
            </div>
          </article>

          <div className="space-y-6">
            <article className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-slate-950">
                  Profile details
                </h3>
              </div>

              <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Assigned
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {client.assignedUser?.fullName || "Unassigned"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Joined
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {formatDate(client.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    DOB
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {formatDate(client.dateOfBirth)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Status
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {client.status || "Not set"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Client number</p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">{client.clientNumber || "Not set"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Preferred language</p>
                  <p className="mt-1 text-sm text-slate-700">{client.preferredLanguage || "Not set"}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Identification</p>
                  <p className="mt-1 text-sm text-slate-700">{client.identificationType || "Not set"}{client.identificationNumber ? ` · ${client.identificationNumber}` : ""}</p>
                  {client.identificationCountry || client.identificationExpiryDate ? <p className="mt-1 text-xs text-slate-500">{[client.identificationCountry, client.identificationExpiryDate ? `Expires ${formatDate(client.identificationExpiryDate)}` : null].filter(Boolean).join(" · ")}</p> : null}
                </div>
                {client.address ? (
                  <div className="sm:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Address
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {client.address}
                    </p>
                  </div>
                ) : null}
              </div>
            </article>

            {role === "admin" ? <CaseEasyReportsCard clientId={client.id} /> : null}

            <ClientBillingCard clientId={client.id} onOpenStatement={() => setStatementOpen(true)} />

            <article className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">
                    Client notes
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Profile and appointment notes in one history.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateNoteForm}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {sortedProfileNotes.length ? (
                  sortedProfileNotes.map((note) => (
                    <div
                      id={`client-note-${note.id}`}
                      key={note.id}
                      className={note.id === highlightedNoteId ? "rounded-[1.4rem] ring-4 ring-sky-200/80" : ""}
                    >
                      {note.appointment ? (
                        <button
                          type="button"
                          onClick={() => setSelectedNoteAppointmentId(note.appointment.id)}
                          className="mb-2 inline-flex max-w-full items-center gap-2 rounded-full bg-violet-50 px-3 py-1.5 text-left text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100"
                        >
                          <span className="truncate">{note.appointment.subject}</span>
                          <span className="shrink-0 text-violet-400">{formatDateTime(note.appointment.startsAt)}</span>
                        </button>
                      ) : null}
                      <NoteCard
                        note={note}
                        onEdit={openEditNoteForm}
                        onDelete={handleDeleteNote}
                        deletingId={deletingNoteId}
                      />
                    </div>
                  ))
                ) : (
                  <EmptyState message="No profile notes yet." />
                )}
              </div>
            </article>
          </div>
        </section>
      </div>
    </PageContainer>
  );
}
