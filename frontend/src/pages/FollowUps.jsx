import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  FileWarning,
  FilterX,
  Funnel,
  Mail,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";
import AppointmentProfileOverlay from "../components/appointments/AppointmentProfileOverlay";

const defaultFormState = {
  clientId: "",
  caseId: "",
  assignedUserId: "",
  followUpType: "General follow-up",
  title: "",
  description: "",
  dueDate: "",
  dueTime: "",
  priority: "Medium",
  status: "Pending",
  completedAt: "",
};

const chipOptions = ["All", "Today", "Overdue", "Pending", "Completed", "Cancelled", "Missing Docs", "Payment", "Documents"];
const filterPriorityOptions = ["All Priorities", "High", "Medium", "Low"];
const priorityLevels = ["High", "Medium", "Low"];
const dateRangeOptions = ["Any time", "Today", "This week", "This month"];
const followUpTypes = ["General follow-up", "Client call", "Document request", "Payment reminder", "Case review"];
const statusOptions = ["Pending", "Completed", "Overdue", "Cancelled"];
const sortOptions = ["Due date", "Priority", "Client"];

const cardClassName =
  "rounded-[22px] border border-white/80 bg-white/90 shadow-[0_18px_45px_rgba(15,23,42,0.07)] backdrop-blur-xl";
const fieldClassName =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100";

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const parsed = parseDate(value);

  if (!parsed) {
    return "No due date";
  }

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatTime(value) {
  const parsed = parseDate(value);

  if (!parsed) {
    return "No time";
  }

  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatDateForInput(value) {
  const parsed = parseDate(value);

  if (!parsed) {
    return "";
  }

  const localDate = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function formatTimeForInput(value) {
  const parsed = parseDate(value);

  if (!parsed) {
    return "";
  }

  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getInitials(name) {
  return (name || "Client")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function getRelativeDueLabel(value) {
  const dueDate = parseDate(value);

  if (!dueDate) {
    return "No due date";
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const diffDays = Math.round((dueStart.getTime() - todayStart.getTime()) / 86400000);

  if (diffDays < 0) {
    return `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} overdue`;
  }

  if (diffDays === 0) {
    return "Follow up today";
  }

  if (diffDays === 1) {
    return "Due tomorrow";
  }

  return `Due in ${diffDays} days`;
}

function getStatusTone(status, dueDate) {
  if (status === "Cancelled") {
    return "cancelled";
  }
  if (status === "Completed") {
    return "completed";
  }

  const due = parseDate(dueDate);

  if (!due) {
    return status === "Overdue" ? "overdue" : "pending";
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((dueStart.getTime() - todayStart.getTime()) / 86400000);

  if (diffDays < 0 || status === "Overdue") {
    return "overdue";
  }

  if (diffDays === 0) {
    return "today";
  }

  return "pending";
}

function getStatusLabel(item) {
  if (item.tone === "today") {
    return "Due Today";
  }

  if (item.tone === "overdue") {
    return "Overdue";
  }

  return item.status || "Pending";
}

function getStatusStyles(tone) {
  const styles = {
    pending: {
      badge: "border-amber-200 bg-amber-50 text-amber-700",
      dot: "bg-amber-400",
      railText: "text-amber-300",
    },
    overdue: {
      badge: "border-rose-200 bg-rose-50 text-rose-700",
      dot: "bg-rose-500",
      railText: "text-rose-300",
    },
    completed: {
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
      dot: "bg-emerald-500",
      railText: "text-emerald-300",
    },
    cancelled: {
      badge: "border-slate-200 bg-slate-100 text-slate-600",
      dot: "bg-slate-400",
      railText: "text-slate-300",
    },
    today: {
      badge: "border-sky-200 bg-sky-50 text-sky-700",
      dot: "bg-sky-500",
      railText: "text-sky-300",
    },
  };

  return styles[tone] || styles.pending;
}

function getAccentBarClass(tone) {
  const styles = {
    pending: "bg-amber-400",
    overdue: "bg-rose-500",
    completed: "bg-emerald-500",
    cancelled: "bg-slate-400",
    today: "bg-sky-500",
  };

  return styles[tone] || styles.pending;
}

function inferPriority(item, tone) {
  const text = `${item.title || ""} ${item.description || ""}`;

  if (tone === "overdue" || /urgent|missing|passport|certificate/i.test(text)) {
    return "High";
  }

  if (tone === "today" || /payment|document|review|submit/i.test(text)) {
    return "Medium";
  }

  return "Low";
}

function getPriorityStyles(priority) {
  const styles = {
    High: "bg-rose-50 text-rose-700",
    Medium: "bg-amber-50 text-amber-700",
    Low: "bg-slate-100 text-slate-600",
  };

  return styles[priority] || styles.Medium;
}

function getAvatarClass(name) {
  const palettes = [
    "bg-rose-50 text-rose-600",
    "bg-sky-50 text-sky-700",
    "bg-amber-50 text-amber-700",
    "bg-emerald-50 text-emerald-700",
    "bg-violet-50 text-violet-700",
  ];
  const seed = Array.from(name || "Client").reduce((total, character) => total + character.charCodeAt(0), 0);
  return palettes[seed % palettes.length];
}

function getCategory(text) {
  if (/payment|balance|fee/i.test(text)) {
    return "Payment";
  }

  if (/document|passport|certificate|missing|upload/i.test(text)) {
    return "Documents";
  }

  if (/call|phone|consult/i.test(text)) {
    return "Call";
  }

  return "General";
}

function getCategoryForType(followUpType, text) {
  if (followUpType === "Payment reminder") return "Payment";
  if (followUpType === "Document request") return "Documents";
  if (followUpType === "Client call") return "Call";
  if (followUpType === "Case review") return "Review";
  return getCategory(text);
}

function buildFollowUpViewModel(item, cases) {
  const tone = getStatusTone(item.status, item.dueDate);
  const linkedCase = item.case || cases.find((entry) => entry.id === item.caseId || entry.id === item.case?.id) || null;
  const text = `${item.title || ""} ${item.description || ""}`;
  const inferredCategory = getCategory(text);
  const followUpType = item.followUpType || (
    inferredCategory === "Payment"
      ? "Payment reminder"
      : inferredCategory === "Documents"
        ? "Document request"
        : inferredCategory === "Call"
          ? "Client call"
          : "General follow-up"
  );
  const category = getCategoryForType(followUpType, text);
  const priority = item.priority || inferPriority(item, tone);
  const missingDocs = /missing|passport|certificate|document/i.test(text) ? 1 : 0;

  return {
    ...item,
    caseType: linkedCase?.caseType || item.case?.caseType || "General Matter",
    caseStage: linkedCase?.stage || item.case?.stage || "Workflow",
    clientName: item.client?.fullName || linkedCase?.client?.fullName || "Unknown client",
    assignedName: item.assignedUser?.fullName || "Unassigned",
    clientPhone: item.client?.phone || "No phone on file",
    clientEmail: item.client?.email || "No email on file",
    initials: getInitials(item.client?.fullName || linkedCase?.client?.fullName),
    tone,
    priority,
    category,
    missingDocs,
    followUpType,
    dueLabel: getRelativeDueLabel(item.dueDate),
  };
}

async function loadAllFollowUps(fresh = false) {
  const get = fresh ? api.getFresh : api.get;
  const firstResponse = await get("/follow-ups", { params: { page: 1, limit: 100 } });
  const firstPage = firstResponse.data.data || [];
  const total = Number(firstResponse.data.meta?.total) || firstPage.length;
  const pageCount = Math.ceil(total / 100);
  if (pageCount <= 1) return firstPage;
  const remainingResponses = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      get("/follow-ups", { params: { page: index + 2, limit: 100 } })
    )
  );
  return [
    ...firstPage,
    ...remainingResponses.flatMap((response) => response.data.data || []),
  ];
}

function RequiredMark() {
  return <span className="text-rose-500">*</span>;
}

function FieldLabel({ children, required = false }) {
  return (
    <span className="mb-2 block text-sm font-medium text-slate-700">
      {children} {required ? <RequiredMark /> : null}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, helper, accent }) {
  const accents = {
    blue: {
      icon: "bg-sky-50 text-sky-700 ring-sky-100",
      value: "text-sky-700",
    },
    rose: {
      icon: "bg-rose-50 text-rose-600 ring-rose-100",
      value: "text-rose-600",
    },
    amber: {
      icon: "bg-amber-50 text-amber-600 ring-amber-100",
      value: "text-amber-600",
    },
    emerald: {
      icon: "bg-emerald-50 text-emerald-600 ring-emerald-100",
      value: "text-emerald-600",
    },
    violet: {
      icon: "bg-violet-50 text-violet-600 ring-violet-100",
      value: "text-violet-600",
    },
  };
  const tone = accents[accent] || accents.blue;

  return (
    <article className="flex min-h-[112px] items-center gap-4 rounded-[20px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_38px_rgba(15,23,42,0.07)] backdrop-blur-xl">
      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ${tone.icon}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
        <p className={`mt-1 text-3xl font-semibold leading-none ${tone.value}`}>{value}</p>
        <p className="mt-2 truncate text-xs text-slate-500">{helper}</p>
      </div>
    </article>
  );
}

function Toast({ toast, onDismiss }) {
  if (!toast) {
    return null;
  }

  const styles =
    toast.type === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[80]">
      <div className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl ${styles}`}>
        <div className="pt-0.5">{toast.type === "error" ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</div>
        <div className="min-w-[220px] text-sm font-medium">{toast.message}</div>
        <button type="button" onClick={onDismiss} className="text-current/70 transition hover:text-current" aria-label="Dismiss message">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DrawerShell({ title, onClose, children, footer, closing }) {
  return (
    <div className={`fixed inset-0 z-50 flex justify-end bg-slate-950/10 backdrop-blur-[1px] transition-opacity duration-300 ${closing ? "opacity-0" : "opacity-100"}`}>
      <button type="button" onClick={onClose} className="absolute inset-0 cursor-default" aria-label="Close drawer" />
      <aside
        className={`relative flex h-full w-full max-w-[430px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.2)] transition-transform duration-300 ease-out ${closing ? "translate-x-full" : "translate-x-0"}`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        {footer ? <div className="border-t border-slate-100 bg-white px-6 py-5">{footer}</div> : null}
      </aside>
    </div>
  );
}

function FollowUpDrawer({
  formState,
  onChange,
  onSubmit,
  onCancel,
  saving,
  formError,
  clients,
  cases,
  users,
  isEditing,
  closing,
}) {
  const availableCases = formState.clientId
    ? cases.filter((item) => item.client?.id === formState.clientId)
    : [];

  return (
    <DrawerShell
      title={isEditing ? "Edit Follow-up" : "Add Follow-up"}
      onClose={onCancel}
      closing={closing}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="follow-up-form"
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.24)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Save Follow-up"}
          </button>
        </div>
      }
    >
      <form id="follow-up-form" className="space-y-5" onSubmit={onSubmit}>
        <label className="block">
          <FieldLabel required>Client</FieldLabel>
          <select required name="clientId" value={formState.clientId} onChange={onChange} className={fieldClassName}>
            <option value="">Select client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.fullName}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel>Case</FieldLabel>
          <select name="caseId" value={formState.caseId} onChange={onChange} disabled={!formState.clientId} className={`${fieldClassName} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}>
            <option value="">{formState.clientId ? "No case / select case" : "Select a client first"}</option>
            {availableCases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.caseType + (item.archivedAt ? " • Archived" : "") + (["Completed", "Closed", "Cancelled", "Inactive"].includes(item.status) ? ` • ${item.status}` : "")}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel required>Follow-up type</FieldLabel>
          <select name="followUpType" value={formState.followUpType} onChange={onChange} className={fieldClassName}>
            {followUpTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel required>Title</FieldLabel>
          <input
            required
            name="title"
            value={formState.title}
            onChange={onChange}
            placeholder="Enter follow-up title"
            className={fieldClassName}
          />
        </label>

        <label className="block">
          <FieldLabel>Notes</FieldLabel>
          <textarea
            name="description"
            rows="5"
            value={formState.description}
            onChange={onChange}
            placeholder="Add notes or next action..."
            className={textareaClassName}
          />
        </label>

        <label className="block">
          <FieldLabel>Assigned staff</FieldLabel>
          <select name="assignedUserId" value={formState.assignedUserId} onChange={onChange} className={fieldClassName}>
            <option value="">Select staff</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <FieldLabel>Due date</FieldLabel>
            <input type="date" name="dueDate" value={formState.dueDate} onChange={onChange} className={fieldClassName} />
          </label>

          <label className="block">
            <FieldLabel>Due time</FieldLabel>
            <input type="time" name="dueTime" value={formState.dueTime} onChange={onChange} disabled={!formState.dueDate} className={`${fieldClassName} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <FieldLabel required>Priority</FieldLabel>
            <select name="priority" value={formState.priority} onChange={onChange} className={fieldClassName}>
              {priorityLevels.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <FieldLabel required>Status</FieldLabel>
            <select name="status" value={formState.status} onChange={onChange} className={fieldClassName}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        {formState.status === "Completed" ? (
          <label className="block">
            <FieldLabel>Completed date</FieldLabel>
            <input type="date" name="completedAt" value={formState.completedAt} onChange={onChange} className={fieldClassName} />
          </label>
        ) : null}

        {formError ? <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{formError}</div> : null}
      </form>
    </DrawerShell>
  );
}

function FollowUpCard({ item, highlighted, onEdit, onDelete, onCopyMessage, onMarkDone, onOpenAppointment, deletingId }) {
  const statusStyles = getStatusStyles(item.tone);

  return (
    <article
      id={`followup-row-${item.id}`}
      className={`group relative overflow-hidden rounded-[18px] border border-slate-200/70 bg-white/95 shadow-[0_10px_28px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_42px_rgba(15,23,42,0.09)] ${highlighted ? "ring-4 ring-sky-200/80" : ""}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${getAccentBarClass(item.tone)}`} />

      <div className="grid gap-4 px-4 py-3.5 xl:grid-cols-[270px_minmax(260px,1fr)_150px_182px] xl:items-center">
        <div className="flex min-w-0 gap-3 pl-2 xl:border-r xl:border-slate-100 xl:pr-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${getAvatarClass(item.clientName)}`}>
            {item.initials}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-slate-950">{item.clientName}</p>
              <span className="shrink-0 rounded-md bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700">{item.caseType}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {item.clientPhone}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <Mail className="h-3 w-3" />
                <span className="max-w-[140px] truncate">{item.clientEmail}</span>
              </span>
            </div>
            <p className="mt-2 truncate text-[11px] text-slate-500">Assigned to: <span className="font-semibold text-slate-700">{item.assignedName}</span></p>
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">
            {item.description || "Follow up with the client and record the next action."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">{item.caseStage}</span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">{item.followUpType}</span>
            {item.missingDocs ? (
              <span className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-600">1 missing</span>
            ) : null}
            {item.appointment ? (
              <button
                type="button"
                onClick={() => onOpenAppointment(item.appointment.id)}
                className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100"
              >
                <CalendarClock className="h-3 w-3" />
                From appointment · {formatDate(item.appointment.startsAt)}
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-bold uppercase ${statusStyles.badge}`}>
            {getStatusLabel(item)}
          </span>
          <div className="space-y-1 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
              {formatDate(item.dueDate)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5 text-slate-400" />
              {formatTime(item.dueDate)}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${getPriorityStyles(item.priority)}`}>
              <span className={`h-2 w-2 rounded-full ${statusStyles.dot}`} />
              {item.priority}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            onClick={() => onMarkDone(item)}
            disabled={["Completed", "Cancelled"].includes(item.status)}
            className="inline-flex h-9 min-w-[118px] items-center justify-center rounded-lg border border-slate-800 bg-white px-3 text-xs font-semibold text-slate-950 transition hover:bg-slate-950 hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-white"
          >
            Mark Done
          </button>
          <button
            type="button"
            onClick={() => onCopyMessage(item)}
            className="inline-flex h-9 min-w-[118px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Message
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-sky-200 hover:text-sky-700"
              aria-label={`Edit ${item.title}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item)}
              disabled={deletingId === item.id}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`Cancel ${item.title}`}
            >
              <Ban className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function TodayWorkRail({ items, overdueCount, missingDocItem, onCreate, onShowOverdue, onCopyMissing, onSelect }) {
  return (
    <aside className="xl:sticky xl:top-5">
      <section className="overflow-hidden rounded-[22px] bg-slate-950 p-5 text-white shadow-[0_28px_70px_rgba(15,23,42,0.28)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/20">
            <CalendarClock className="h-6 w-6" />
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-xl font-semibold tracking-tight">Today&apos;s Work</h2>
          <p className="mt-2 text-sm leading-5 text-slate-400">Highest priority actions for your team.</p>
        </div>

        <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
          {items.length ? (
            items.map((item) => {
              const statusStyles = getStatusStyles(item.tone);

              return (
                <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="w-full py-4 text-left transition hover:bg-white/[0.04]">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${getAvatarClass(item.clientName)}`}>
                      {item.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-white">{item.clientName}</p>
                        <span className="shrink-0 text-[11px] text-slate-500">{formatTime(item.dueDate)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-400">{item.title}</p>
                      <p className={`mt-1 flex items-center gap-1.5 text-[11px] font-semibold ${statusStyles.railText}`}>
                        <span className={`h-2 w-2 rounded-full ${statusStyles.dot}`} />
                        {item.dueLabel}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-6 text-sm text-slate-400">No priority follow-ups for the current filter.</div>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-white">Quick actions</h3>
          <div className="mt-3 space-y-3">
            <button
              type="button"
              onClick={onCreate}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              <Plus className="h-4 w-4" />
              Add follow-up
            </button>
            <button
              type="button"
              onClick={onShowOverdue}
              className="flex h-11 w-full items-center justify-between rounded-xl bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4" />
                View overdue
              </span>
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white">{overdueCount}</span>
            </button>
            <button
              type="button"
              onClick={onCopyMissing}
              disabled={!missingDocItem}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileWarning className="h-4 w-4 shrink-0" />
              Copy missing-doc template
            </button>
          </div>
        </div>
      </section>
    </aside>
  );
}

export default function FollowUps() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight") || "";
  const [followUps, setFollowUps] = useState([]);
  const [clients, setClients] = useState([]);
  const [cases, setCases] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState(null);
  const [formState, setFormState] = useState(defaultFormState);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeChip, setActiveChip] = useState("All");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [caseTypeFilter, setCaseTypeFilter] = useState("All Case Types");
  const [staffFilter, setStaffFilter] = useState("All Staff");
  const [priorityFilter, setPriorityFilter] = useState("All Priorities");
  const [dateRangeFilter, setDateRangeFilter] = useState("Any time");
  const [sortBy, setSortBy] = useState("Due date");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);

  const isEditing = Boolean(editingFollowUp);

  useEffect(() => {
    loadWorkspaceData();
  }, []);

  useEffect(() => {
    if (!highlightId || loading) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`followup-row-${highlightId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightId, loading, followUps]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!showForm) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeDrawer();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm]);

  async function loadWorkspaceData({ quiet = false } = {}) {
    try {
      if (quiet) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const get = quiet ? api.getFresh : api.get;
      const [allFollowUps, optionsResponse] = await Promise.all([
        loadAllFollowUps(quiet),
        get("/follow-ups/options"),
      ]);
      const options = optionsResponse.data.data || {};

      setFollowUps(allFollowUps);
      setClients(options.clients || []);
      setCases(options.cases || []);
      setUsers(options.users || []);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load follow-ups.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const enrichedFollowUps = useMemo(
    () => followUps.map((item) => buildFollowUpViewModel(item, cases)),
    [followUps, cases]
  );

  const caseTypeOptions = useMemo(
    () => ["All Case Types", ...Array.from(new Set(enrichedFollowUps.map((item) => item.caseType)))],
    [enrichedFollowUps]
  );

  const staffOptions = useMemo(
    () => ["All Staff", ...Array.from(new Set(enrichedFollowUps.map((item) => item.assignedName)))],
    [enrichedFollowUps]
  );

  const filteredFollowUps = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const priorityRank = { High: 0, Medium: 1, Low: 2 };

    return [...enrichedFollowUps]
      .filter((item) => {
        const matchesQuery =
          !normalizedQuery ||
          [
            item.clientName,
            item.caseType,
            item.caseStage,
            item.clientPhone,
            item.clientEmail,
            item.assignedName,
            item.followUpType,
            item.category,
            item.title,
            item.description,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedQuery));

        const matchesChip = (() => {
          switch (activeChip) {
            case "Today":
              return item.tone === "today";
            case "Overdue":
              return item.tone === "overdue";
            case "Pending":
              return item.status === "Pending";
            case "Completed":
              return item.status === "Completed";
            case "Cancelled":
              return item.status === "Cancelled";
            case "Missing Docs":
              return item.missingDocs > 0;
            case "Payment":
              return item.category === "Payment";
            case "Documents":
              return item.category === "Documents";
            default:
              return true;
          }
        })();

        const matchesCaseType = caseTypeFilter === "All Case Types" || item.caseType === caseTypeFilter;
        const matchesStaff = staffFilter === "All Staff" || item.assignedName === staffFilter;
        const matchesPriority = priorityFilter === "All Priorities" || item.priority === priorityFilter;
        const matchesDateRange = (() => {
          if (dateRangeFilter === "Any time" || !item.dueDate) {
            return true;
          }

          const due = parseDate(item.dueDate);

          if (!due) {
            return true;
          }

          const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
          const diff = Math.round((dueStart.getTime() - startOfToday.getTime()) / 86400000);

          if (dateRangeFilter === "Today") {
            return diff === 0;
          }

          if (dateRangeFilter === "This week") {
            return diff >= 0 && diff <= 7;
          }

          if (dateRangeFilter === "This month") {
            return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
          }

          return true;
        })();

        return matchesQuery && matchesChip && matchesCaseType && matchesStaff && matchesPriority && matchesDateRange;
      })
      .sort((a, b) => {
        if (sortBy === "Client") {
          return a.clientName.localeCompare(b.clientName);
        }

        if (sortBy === "Priority") {
          return (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
        }

        const first = a.dueDate ? parseDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        const second = b.dueDate ? parseDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        return first - second;
      });
  }, [activeChip, caseTypeFilter, dateRangeFilter, enrichedFollowUps, priorityFilter, searchQuery, sortBy, staffFilter]);

  const summary = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const dueToday = enrichedFollowUps.filter((item) => item.tone === "today").length;
    const overdue = enrichedFollowUps.filter((item) => item.tone === "overdue").length;
    const pending = enrichedFollowUps.filter((item) => item.status === "Pending").length;
    const completedThisWeek = enrichedFollowUps.filter((item) => {
      if (item.status !== "Completed") {
        return false;
      }

      const completedAt = parseDate(item.completedAt || item.updatedAt);
      return completedAt && completedAt >= startOfWeek && completedAt < endOfWeek;
    }).length;
    const missingDocs = enrichedFollowUps.filter((item) => item.missingDocs > 0).length;

    return { dueToday, overdue, pending, completedThisWeek, missingDocs };
  }, [enrichedFollowUps]);

  const todayPanel = useMemo(() => {
    const priorityRank = { High: 0, Medium: 1, Low: 2 };
    const priorities = [...filteredFollowUps]
      .filter((item) => !["Completed", "Cancelled"].includes(item.status))
      .sort((a, b) => {
        const priorityDiff = (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);

        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        const first = a.dueDate ? parseDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        const second = b.dueDate ? parseDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        return first - second;
      })
      .slice(0, 5);
    const missingDocItem = filteredFollowUps.find((item) => item.missingDocs > 0) || null;

    return { priorities, missingDocItem };
  }, [filteredFollowUps]);

  function resetForm() {
    setFormState(defaultFormState);
    setEditingFollowUp(null);
    setFormError("");
    setShowForm(false);
  }

  function openCreateForm() {
    setEditingFollowUp(null);
    setFormState(defaultFormState);
    setFormError("");
    setDrawerClosing(false);
    setShowForm(true);
  }

  function openEditForm(item) {
    setEditingFollowUp(item);
    setFormState({
      clientId: item.client?.id || item.case?.client?.id || "",
      caseId: item.case?.id || "",
      assignedUserId: item.assignedUser?.id || "",
      followUpType: item.followUpType || "General follow-up",
      title: item.title || "",
      description: item.description || "",
      dueDate: formatDateForInput(item.dueDate),
      dueTime: formatTimeForInput(item.dueDate),
      priority: item.priority || "Medium",
      status: item.status || "Pending",
      completedAt: formatDateForInput(item.completedAt),
    });
    setFormError("");
    setDrawerClosing(false);
    setShowForm(true);
  }

  function closeDrawer() {
    setDrawerClosing(true);
    window.setTimeout(() => {
      resetForm();
      setDrawerClosing(false);
    }, 240);
  }

  function handleInputChange(event) {
    const { name, value } = event.target;
    setFormState((current) => {
      if (name === "clientId") {
        const selectedCase = cases.find((item) => item.id === current.caseId);
        return {
          ...current,
          clientId: value,
          caseId: selectedCase?.client?.id === value ? current.caseId : "",
        };
      }
      if (name === "caseId") {
        const selectedCase = cases.find((item) => item.id === value);
        return {
          ...current,
          caseId: value,
          clientId: selectedCase?.client?.id || current.clientId,
        };
      }
      if (name === "dueDate" && !value) {
        return { ...current, dueDate: "", dueTime: "" };
      }
      if (name === "status") {
        const terminal = ["Completed", "Cancelled"].includes(value);
        return {
          ...current,
          status: value,
          completedAt: terminal
            ? current.completedAt || formatDateForInput(new Date())
            : "",
        };
      }
      return { ...current, [name]: value };
    });
  }

  function clearFilters() {
    setActiveChip("All");
    setSearchQuery("");
    setCaseTypeFilter("All Case Types");
    setStaffFilter("All Staff");
    setPriorityFilter("All Priorities");
    setDateRangeFilter("Any time");
  }

  function buildDueDatePayload() {
    if (!formState.dueDate) {
      return null;
    }
    const parsed = new Date(`${formState.dueDate}T${formState.dueTime || "12:00"}:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function buildCompletedAtPayload() {
    if (!formState.completedAt) return null;
    const parsed = new Date(`${formState.completedAt}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setFormError("");

      const payload = {
        clientId: formState.clientId,
        caseId: formState.caseId || null,
        assignedUserId: formState.assignedUserId || null,
        followUpType: formState.followUpType,
        title: formState.title.trim(),
        description: formState.description.trim() || null,
        dueDate: buildDueDatePayload(),
        priority: formState.priority,
        status: formState.status,
        completedAt: buildCompletedAtPayload(),
      };

      if (isEditing) {
        await api.patch(`/follow-ups/${editingFollowUp.id}`, payload);
      } else {
        await api.post("/follow-ups", payload);
      }

      await loadWorkspaceData({ quiet: true });
      closeDrawer();
      setToast({ type: "success", message: `Follow-up ${isEditing ? "updated" : "created"} successfully` });
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || "Unable to save follow-up.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    const confirmed = window.confirm(`Cancel the follow-up "${item.title}"? It will remain in case history.`);

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(item.id);
      const response = await api.patch(`/follow-ups/${item.id}/cancel`);
      const cancelled = response.data.data;
      setFollowUps((current) => current.map((entry) => entry.id === item.id ? cancelled : entry));
      setToast({ type: "success", message: "Follow-up cancelled" });

      if (editingFollowUp?.id === item.id) {
        closeDrawer();
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to cancel follow-up.");
    } finally {
      setDeletingId("");
    }
  }

  async function handleMarkDone(item) {
    try {
      const response = await api.patch(`/follow-ups/${item.id}`, {
        status: "Completed",
        completedAt: new Date().toISOString(),
      });
      const completed = response.data.data;
      setFollowUps((current) => current.map((entry) => entry.id === item.id ? completed : entry));
      setToast({ type: "success", message: "Follow-up marked complete" });
    } catch (requestError) {
      setToast({ type: "error", message: requestError.response?.data?.message || "Unable to update follow-up." });
    }
  }

  async function handleCopyMessage(item) {
    const message = `Hello ${item.clientName}, this is a reminder from CaseDesk regarding "${item.title}". ${item.description || "Please contact us with your latest update."}`;

    try {
      await navigator.clipboard.writeText(message);
      setToast({ type: "success", message: "Follow-up message copied" });
    } catch (copyError) {
      setToast({ type: "error", message: "Unable to copy message." });
    }
  }

  function handleExportCsv() {
    const headers = ["Client", "Case type", "Title", "Status", "Priority", "Due date", "Assigned staff"];
    const rows = filteredFollowUps.map((item) => [
      item.clientName,
      item.caseType,
      item.title,
      getStatusLabel(item),
      item.priority,
      `${formatDate(item.dueDate)} ${formatTime(item.dueDate)}`,
      item.assignedName,
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) => {
            const stringValue = String(value ?? "");
            return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "follow-ups.csv";
    link.click();
    URL.revokeObjectURL(url);
    setToast({ type: "success", message: "Follow-ups exported" });
  }

  return (
    <>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <section className="relative min-h-[calc(100vh-32px)] max-w-full overflow-hidden px-4 py-5 sm:px-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.13),transparent_28%),radial-gradient(circle_at_90%_8%,rgba(15,23,42,0.08),transparent_24%),linear-gradient(180deg,rgba(248,251,255,0.96),rgba(238,244,251,0.92))]" />

        <div className="relative mx-auto max-w-[1720px] space-y-4">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase text-sky-700">Workflow</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Follow-ups</h1>
              <p className="mt-2 text-sm text-slate-600">Track today&apos;s client follow-ups, overdue tasks, and next actions.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openCreateForm}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(15,23,42,0.24)] transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                New Follow-up
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-white"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => loadWorkspaceData({ quiet: true })}
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white/90 text-slate-700 shadow-sm transition hover:bg-white"
                aria-label="Refresh follow-ups"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </header>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard icon={CalendarClock} label="Due Today" value={summary.dueToday} helper={`${summary.dueToday} tasks due today`} accent="blue" />
            <StatCard icon={AlertCircle} label="Overdue" value={summary.overdue} helper={`${summary.overdue} tasks overdue`} accent="rose" />
            <StatCard icon={ClipboardCheck} label="Pending" value={summary.pending} helper={`${summary.pending} tasks pending`} accent="amber" />
            <StatCard icon={CheckCircle2} label="Completed This Week" value={summary.completedThisWeek} helper={`${summary.completedThisWeek} tasks completed`} accent="emerald" />
            <StatCard icon={FileWarning} label="Missing Docs" value={summary.missingDocs} helper={`${summary.missingDocs} clients missing docs`} accent="violet" />
          </section>

          <section className={`${cardClassName} p-3.5`}>
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
              <div className="relative min-w-0 flex-1 2xl:max-w-[430px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search client, case type, phone, assigned staff..."
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white/95 pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {chipOptions.map((chip) => {
                  const active = activeChip === chip;

                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setActiveChip(chip)}
                      className={[
                        "h-9 rounded-full px-4 text-sm font-semibold transition",
                        active
                          ? "bg-slate-950 text-white shadow-[0_10px_20px_rgba(15,23,42,0.16)]"
                          : "border border-slate-200 bg-white/80 text-slate-700 hover:bg-white",
                      ].join(" ")}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((current) => !current)}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Funnel className="h-4 w-4" />
                Advanced filters
                <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${showAdvancedFilters ? "rotate-180" : ""}`} />
              </button>
              {(searchQuery || activeChip !== "All" || caseTypeFilter !== "All Case Types" || staffFilter !== "All Staff" || priorityFilter !== "All Priorities" || dateRangeFilter !== "Any time") ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                >
                  <FilterX className="h-4 w-4" />
                  Clear filters
                </button>
              ) : null}
            </div>

            <div className={`grid overflow-hidden transition-all duration-300 ease-out ${showAdvancedFilters ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="min-h-0">
                <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 md:grid-cols-2 xl:grid-cols-4">
                  <select value={caseTypeFilter} onChange={(event) => setCaseTypeFilter(event.target.value)} className={fieldClassName}>
                    {caseTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>

                  <select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} className={fieldClassName}>
                    {staffOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>

                  <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className={fieldClassName}>
                    {filterPriorityOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>

                  <select value={dateRangeFilter} onChange={(event) => setDateRangeFilter(event.target.value)} className={fieldClassName}>
                    {dateRangeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700">{error}</div> : null}

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <main className="min-w-0">
              <div className="mb-3 flex flex-col gap-3 px-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-950">Follow-up Queue</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{filteredFollowUps.length} tasks</span>
                </div>
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                  className="h-10 rounded-xl border border-slate-200 bg-white/90 px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                >
                  {sortOptions.map((option) => (
                    <option key={option} value={option}>
                      Sort by {option.toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2.5">
                {loading ? (
                  Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="h-[116px] animate-pulse rounded-[18px] border border-white/80 bg-white/75 shadow-sm" />
                  ))
                ) : filteredFollowUps.length ? (
                  filteredFollowUps.map((item) => (
                    <FollowUpCard
                      key={item.id}
                      item={item}
                      highlighted={item.id === highlightId}
                      onEdit={openEditForm}
                      onDelete={handleDelete}
                      onCopyMessage={handleCopyMessage}
                      onMarkDone={handleMarkDone}
                      onOpenAppointment={setSelectedAppointmentId}
                      deletingId={deletingId}
                    />
                  ))
                ) : (
                  <div className={`${cardClassName} p-8 text-center text-sm text-slate-500`}>
                    No follow-ups match your current search or filters.
                  </div>
                )}
              </div>

              {!loading && filteredFollowUps.length ? (
                <div className="mt-3 text-sm text-slate-500">
                  <span>Showing all {filteredFollowUps.length} matching task{filteredFollowUps.length === 1 ? "" : "s"}</span>
                </div>
              ) : null}
            </main>

            <TodayWorkRail
              items={todayPanel.priorities}
              overdueCount={summary.overdue}
              missingDocItem={todayPanel.missingDocItem}
              onCreate={openCreateForm}
              onShowOverdue={() => setActiveChip("Overdue")}
              onCopyMissing={() => todayPanel.missingDocItem && handleCopyMessage(todayPanel.missingDocItem)}
              onSelect={(id) => document.getElementById(`followup-row-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
            />
          </section>
        </div>
      </section>

      {showForm ? (
        <FollowUpDrawer
          formState={formState}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          onCancel={closeDrawer}
          saving={saving}
          formError={formError}
          clients={clients}
          cases={cases}
          users={users}
          isEditing={isEditing}
          closing={drawerClosing}
        />
      ) : null}
      {selectedAppointmentId ? (
        <AppointmentProfileOverlay
          appointmentId={selectedAppointmentId}
          onClose={() => setSelectedAppointmentId(null)}
          onChanged={() => loadWorkspaceData({ quiet: true })}
        />
      ) : null}
    </>
  );
}
