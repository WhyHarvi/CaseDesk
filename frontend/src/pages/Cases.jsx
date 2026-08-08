import {
  BriefcaseBusiness,
  Archive,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Download,
  FilterX,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import CasesCommandBar from "../components/cases/CasesCommandBar";
import api from "../services/api";
import CaseTypeCombobox from "../components/ui/CaseTypeCombobox";

const STAGE_OPTIONS = [
  "Lead",
  "Consultation",
  "Retainer Pending",
  "Documents Pending",
  "Reviewing Documents",
  "Application Preparing",
  "Submitted",
  "Decision Received",
  "Closed",
];
const STATUS_OPTIONS = ["Open", "Active", "On Hold", "Completed", "Closed", "Cancelled", "Inactive"];
const PRIORITY_OPTIONS = ["Low", "Normal", "High", "Urgent"];
const REGISTER_VIEWS = [
  { id: "active", label: "Active Cases", icon: BriefcaseBusiness },
  { id: "closed", label: "Closed", icon: CheckCircle2 },
  { id: "archived", label: "Archived", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash2 },
];

const defaultFormState = {
  clientId: "",
  assignedUserId: "",
  caseType: "",
  stage: "Lead",
  status: "Open",
  priority: "Normal",
  nextAction: "",
  submittedAt: "",
  decisionAt: "",
};

const cardClassName =
  "rounded-3xl border border-slate-200/80 bg-transparent shadow-none";
const pillClassName =
  "inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold leading-none";

function formatDateForInput(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

function formatRelativeDate(value) {
  if (!value) {
    return "Today";
  }

  const date = new Date(value);
  const today = new Date();
  const diffDays = Math.round(
    (today.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / 86400000,
  );

  if (diffDays <= 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getInitials(name) {
  return (name || "Client")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function getDefaultNextAction(stage) {
  const defaults = {
    Lead: "Call client",
    Consultation: "Prepare application",
    "Retainer Pending": "Send payment reminder",
    "Documents Pending": "Review documents",
    "Reviewing Documents": "Review documents",
    "Application Preparing": "Submit application",
    Submitted: "Wait for decision",
    "Decision Received": "Call client",
    Closed: "Wait for decision",
  };

  return defaults[stage] || "Review documents";
}

function getStageStyles(stage) {
  const styles = {
    Lead: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    Consultation: "bg-sky-100 text-sky-700 ring-1 ring-sky-200",
    "Retainer Pending": "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
    "Documents Pending": "bg-orange-100 text-orange-700 ring-1 ring-orange-200",
    "Reviewing Documents":
      "bg-violet-100 text-violet-700 ring-1 ring-violet-200",
    "Application Preparing":
      "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200",
    Submitted: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
    "Decision Received": "bg-green-100 text-green-700 ring-1 ring-green-200",
    Closed: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200",
  };

  return styles[stage] || "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function getPaymentStyles(status, balance) {
  if (status === "Paid" || balance <= 0) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }

  if (status === "Partial") {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  }

  return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
}

function getActionStyles(action, isUrgent) {
  if (isUrgent) {
    return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  }

  if (/payment|collect|call/i.test(action || "")) {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  }

  return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function isActiveCase(item) {
  return item.stage !== "Closed" && item.status !== "Closed";
}

function isReadyForSubmission(item) {
  return (
    item.stage === "Application Preparing" ||
    /submit application/i.test(item.nextAction || "")
  );
}

function isUrgentAction(item) {
  return (
    item.documentSummary.missing > 0 ||
    item.paymentSummary.balance > 0 ||
    /submit|payment reminder/i.test(item.nextAction || "")
  );
}

function buildDocumentSummary(caseId, documents) {
  const caseDocuments = documents.filter((item) => item.case?.id === caseId);
  const total = caseDocuments.length || 0;
  const received = caseDocuments.filter(
    (item) =>
      Boolean(item.storageKey) ||
      [
        "Uploaded",
        "UnderReview",
        "ChangesRequested",
        "Approved",
        "Finalized",
      ].includes(item.status),
  ).length;
  const missing = caseDocuments.filter((item) =>
    ["Requested", "ChangesRequested"].includes(item.status),
  ).length;

  return {
    total,
    received,
    missing,
    label: total ? `${received}/${total} received` : "No checklist yet",
  };
}

function buildPaymentSummary(caseId, payments) {
  const payment = payments.find((item) => item.caseId === caseId);

  if (!payment) {
    return {
      paidAmount: 0,
      totalFee: 0,
      balance: 0,
      status: "Unpaid",
      label: "No payment record",
      balanceLabel: "Not set",
    };
  }

  const paidAmount = Number(payment.paidAmount || 0);
  const totalFee = Number(payment.totalFee || 0);
  const balance = Number(payment.balance ?? Math.max(totalFee - paidAmount, 0));

  return {
    paidAmount,
    totalFee,
    balance,
    status:
      payment.status ||
      (balance <= 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid"),
    label: `${formatCurrency(paidAmount)} / ${formatCurrency(totalFee)}`,
    balanceLabel:
      balance > 0 ? `${formatCurrency(balance)} due` : "Paid in full",
  };
}

function buildCaseViewModel(item, clients, users, documents, payments) {
  const client =
    item.client || clients.find((entry) => entry.id === item.clientId) || null;
  const assignedUser =
    item.assignedUser ||
    users.find((entry) => entry.id === item.assignedUserId) ||
    null;
  const documentSummary = buildDocumentSummary(item.id, documents);
  const paymentSummary = buildPaymentSummary(item.id, payments);
  const nextAction = item.nextAction || "No next action";
  const urgent = isUrgentAction({
    ...item,
    nextAction,
    documentSummary,
    paymentSummary,
  });

  return {
    ...item,
    client,
    assignedUser,
    clientName: client?.fullName || "Unknown client",
    clientInitials: getInitials(client?.fullName),
    fileNumber:
      item.fileNumber ||
      `CD-${
        String(item.id || "")
          .slice(0, 6)
          .toUpperCase() || "NEW"
      }`,
    documentSummary,
    paymentSummary,
    paymentStatus: paymentSummary.status,
    nextAction,
    assignedName: assignedUser?.fullName || "Unassigned",
    assignedTo: assignedUser?.fullName || "Unassigned",
    priority: item.priority || "Normal",
    lastUpdatedLabel: formatRelativeDate(item.updatedAt || item.createdAt),
    urgent,
  };
}

function createOptimisticCase(formState, clients, users) {
  const optimisticId = `optimistic-${Date.now()}`;
  const client = clients.find((item) => item.id === formState.clientId) || null;
  const assignedUser =
    users.find((item) => item.id === formState.assignedUserId) || null;
  const stage = formState.stage || "Lead";

  return {
    id: optimisticId,
    clientId: formState.clientId,
    assignedUserId: formState.assignedUserId || null,
    caseType: formState.caseType,
    stage,
    status: formState.status || "Open",
    priority: formState.priority || "Normal",
    nextAction: formState.nextAction.trim() || getDefaultNextAction(stage),
    submittedAt: formState.submittedAt || null,
    decisionAt: formState.decisionAt || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    client,
    assignedUser,
    isPending: true,
    fileNumber: "Creating…",
  };
}

function replaceOptimisticCase(cases, optimisticId, savedCase) {
  return cases.map((item) => (item.id === optimisticId ? savedCase : item));
}

function rollbackOptimisticCase(cases, optimisticId) {
  return cases.filter((item) => item.id !== optimisticId);
}

function updateCaseOptimistically(cases, caseId, updates) {
  return cases.map((item) =>
    item.id === caseId
      ? {
          ...item,
          ...updates,
          updatedAt: new Date().toISOString(),
          isSavingStage: Boolean(updates.isSavingStage),
        }
      : item,
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
    <div className="pointer-events-none fixed right-4 top-4 z-[70]">
      <div
        className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${styles}`}
      >
        <div className="pt-0.5">
          {toast.type === "error" ? (
            <CircleAlert className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-[220px] text-sm font-medium">{toast.message}</div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-current/70 transition hover:text-current"
          aria-label="Dismiss message"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, helper, accent }) {
  const accentStyles = {
    blue: "bg-sky-100 text-sky-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
  };

  return (
    <article className="flex min-h-[108px] items-center gap-4 rounded-3xl border border-white/70 bg-white/70 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${accentStyles[accent]}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
          {value}
        </p>
        <p className="mt-1 text-xs text-slate-400">{helper}</p>
      </div>
    </article>
  );
}

function KpiSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="min-h-[108px] animate-pulse rounded-3xl border border-white/70 bg-white/70 p-4"
        >
          <div className="h-5 w-24 rounded bg-slate-200" />
          <div className="mt-4 h-8 w-16 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-32 rounded bg-slate-100" />
        </div>
      ))}
    </section>
  );
}

function CreatingBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-300 border-t-sky-600" />
      Creating…
    </span>
  );
}

function CaseStageBadge({ stage }) {
  const label = stage === "Documents Pending" ? "Documents pending" : stage;

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStageStyles(stage)}`}
    >
      {label}
    </span>
  );
}

function CasePaymentBadge({ summary }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-800">{summary.label}</p>
      <span
        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getPaymentStyles(summary.status, summary.balance)}`}
      >
        {summary.balanceLabel}
      </span>
    </div>
  );
}

function CaseDocumentProgress({ summary }) {
  const progress = summary.total
    ? Math.round((summary.received / summary.total) * 100)
    : 0;

  return (
    <div className="min-w-[120px] space-y-2">
      <p className="text-sm font-semibold text-slate-800">{summary.label}</p>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-sky-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">
        {summary.missing ? `${summary.missing} missing` : "Complete"}
      </p>
    </div>
  );
}

function EmptyState({ onCreate, view }) {
  const copy = {
    active: ["No active cases", "Newly created and reopened cases will appear here."],
    closed: ["No closed cases", "Cases appear here after their active work has been completed."],
    archived: ["No archived cases", "Closed cases that you archive will remain available here."],
    trash: ["Trash is empty", "Cases moved to Trash will appear here until they are restored."],
  }[view];
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-sky-700">
        <BriefcaseBusiness className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-slate-950">
        {copy[0]}
      </h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
        {copy[1]}
      </p>
      {view === "active" ? (
        <button
          type="button"
          onClick={onCreate}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(15,23,42,0.22)] transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Case
        </button>
      ) : null}
    </div>
  );
}

function NoResultsState({ onClear }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-600">
        <Search className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-slate-950">
        No matching cases
      </h3>
      <p className="mt-2 text-sm text-slate-500">
        Try changing your search or filters.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600"
      >
        <FilterX className="h-4 w-4" />
        Clear filters
      </button>
    </div>
  );
}

function ErrorState({ onRetry }) {
  return (
    <section className={`${cardClassName} p-8 text-center`}>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-rose-700">
        <CircleAlert className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold text-slate-950">
        Could not load cases
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Please refresh or try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    </section>
  );
}

function CaseActionsMenu({
  item,
  isOpen,
  onToggle,
  onEdit,
  onDelete,
  deletingId,
  registerView,
}) {
  const buttonRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const lifecycleAction = {
    active: { label: "Close case", busy: "Closing…", icon: CheckCircle2, tone: "text-amber-700 hover:bg-amber-50" },
    closed: { label: "Archive case", busy: "Archiving…", icon: Archive, tone: "text-violet-700 hover:bg-violet-50" },
    archived: { label: "Restore from archive", busy: "Restoring…", icon: RefreshCw, tone: "text-emerald-700 hover:bg-emerald-50" },
    trash: { label: "Restore from Trash", busy: "Restoring…", icon: RefreshCw, tone: "text-emerald-700 hover:bg-emerald-50" },
  }[registerView];
  const LifecycleIcon = lifecycleAction.icon;

  useEffect(() => {
    if (!isOpen || !buttonRef.current) {
      return;
    }

    function updateMenuPosition() {
      if (!buttonRef.current) {
        return;
      }

      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 180;
      const menuHeight = 96;
      const viewportPadding = 12;
      const preferredLeft = rect.right - menuWidth;
      const maxLeft = window.innerWidth - menuWidth - viewportPadding;
      const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));
      const shouldOpenUp =
        rect.bottom + 8 + menuHeight > window.innerHeight - viewportPadding;
      const top = shouldOpenUp
        ? Math.max(viewportPadding, rect.top - menuHeight - 8)
        : Math.min(
            rect.bottom + 8,
            window.innerHeight - menuHeight - viewportPadding,
          );

      setMenuPosition({ top, left });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen]);

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onToggle(isOpen ? null : item.id)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
        aria-label={`More actions for ${item.caseType}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {isOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                onClick={() => onToggle(null)}
                className="fixed inset-0 z-[140] cursor-default bg-transparent"
                aria-label="Close actions menu"
              />
              <div
                className="fixed z-[150] min-w-[180px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
                style={{
                  top: `${menuPosition.top}px`,
                  left: `${menuPosition.left}px`,
                }}
              >
                {registerView === "active" || registerView === "closed" ? (
                  <button
                    type="button"
                    onClick={() => {
                      onToggle(null);
                      onEdit(item);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-sky-700"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit case
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    onToggle(null);
                    onDelete(item);
                  }}
                  disabled={deletingId === item.id}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${lifecycleAction.tone}`}
                >
                  <LifecycleIcon className="h-4 w-4" />
                  {deletingId === item.id ? lifecycleAction.busy : lifecycleAction.label}
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

function CaseMobileCard({
  item,
  onEdit,
  onDelete,
  onStageChange,
  onToggleMenu,
  isMenuOpen,
  deletingId,
  registerView,
}) {
  return (
    <article className={`rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_14px_35px_rgba(15,23,42,0.06)] ${item.isPending ? "pointer-events-none animate-pulse opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
            {item.clientInitials}
          </div>
          <div>
            <Link
              to={`/app/cases/${item.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-950 transition hover:text-sky-700"
            >
              {item.caseType}
            </Link>
            <Link
              to={`/app/cases/${item.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block text-sm text-slate-500 transition hover:text-sky-700"
            >
              {item.clientName}
            </Link>
            <p className="text-xs text-slate-400">{item.fileNumber}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <CaseStageBadge stage={item.stage} />
          {item.isPending ? <CreatingBadge /> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-500">Next action</span>
          {item.urgent ? (
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
              Needs attention
            </span>
          ) : null}
        </div>
        <p className="text-sm font-semibold text-slate-900">
          {item.nextAction}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              Assigned staff
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {item.assignedName}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              Updated
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {item.lastUpdatedLabel}
            </p>
          </div>
        </div>
        <CaseDocumentProgress summary={item.documentSummary} />
        <CasePaymentBadge summary={item.paymentSummary} />
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Stage
          </span>
          <select
            value={item.stage}
            onChange={(event) => onStageChange(item, event.target.value)}
            disabled={registerView !== "active"}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 disabled:bg-slate-100 disabled:text-slate-500"
          >
            {STAGE_OPTIONS.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <CaseActionsMenu
            item={item}
            isOpen={isMenuOpen}
            onToggle={onToggleMenu}
            onEdit={onEdit}
            onDelete={onDelete}
            deletingId={deletingId}
            registerView={registerView}
          />
        </div>
      </div>
    </article>
  );
}

function DrawerShell({
  title,
  subtitle,
  eyebrow,
  onClose,
  children,
  footer,
  closing,
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm transition-all duration-300 ${closing ? "opacity-0" : "opacity-100"}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        aria-label="Close drawer"
      />
      <aside
        className={`relative flex h-full w-full max-w-[560px] flex-col overflow-hidden border-l border-white/70 bg-gradient-to-br from-white via-slate-50 to-sky-50 shadow-[0_32px_120px_rgba(15,23,42,0.28)] backdrop-blur-2xl transition-all duration-300 ease-out ${closing ? "translate-x-full" : "translate-x-0"}`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.08),transparent_32%)]" />
        <div className="relative border-b border-slate-200/70 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex rounded-full border border-sky-200/70 bg-sky-50/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                {eyebrow}
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
                {title}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white/80 text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          {children}
        </div>
        {footer ? (
          <div className="relative border-t border-slate-200/80 bg-white/85 px-6 py-4 backdrop-blur-xl sm:px-8">
            {footer}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function CaseFormDrawer({
  formState,
  onChange,
  onSubmit,
  onCancel,
  saving,
  formError,
  clients,
  users,
  caseTypeOptions,
  isEditing,
  closing,
}) {
  const submitLabel = saving
    ? "Saving..."
    : isEditing
      ? "Save Changes"
      : "Create Case";

  return (
    <DrawerShell
      title={isEditing ? "Edit case" : "New Case"}
      subtitle="Keep the file moving with a clear owner, stage, and next action."
      eyebrow="Case workflow"
      onClose={onCancel}
      closing={closing}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="case-form"
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(15,23,42,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </div>
      }
    >
      <form id="case-form" className="space-y-5" onSubmit={onSubmit}>
        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Client &amp; Case
          </h3>
          <div className="mt-4 grid gap-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Client
              </span>
              <select
                required
                name="clientId"
                value={formState.clientId}
                onChange={onChange}
                className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              >
                <option value="">Select client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.fullName}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Case type
                </span>
                <CaseTypeCombobox
                  required
                  name="caseType"
                  value={formState.caseType}
                  onChange={onChange}
                  options={caseTypeOptions}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Status
                </span>
                <select
                  required
                  name="status"
                  value={formState.status}
                  onChange={onChange}
                  className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                >
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Assignment
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Stage
              </span>
              <select
                name="stage"
                value={formState.stage}
                onChange={onChange}
                className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              >
                {STAGE_OPTIONS.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Priority</span>
              <select name="priority" value={formState.priority} onChange={onChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100">
                {PRIORITY_OPTIONS.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Assigned staff
              </span>
              <select
                name="assignedUserId"
                value={formState.assignedUserId}
                onChange={onChange}
                className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Timeline
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Submitted date
              </span>
              <input
                type="date"
                name="submittedAt"
                value={formState.submittedAt}
                onChange={onChange}
                className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Decision date
              </span>
              <input
                type="date"
                name="decisionAt"
                value={formState.decisionAt}
                onChange={onChange}
                className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              />
            </label>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Next Action
          </h3>
          <div className="mt-4 grid gap-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Next action
              </span>
              <textarea
                name="nextAction"
                rows="4"
                value={formState.nextAction}
                onChange={onChange}
                placeholder="Review documents"
                className="w-full resize-none rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
              />
            </label>
          </div>
        </section>

        {formError ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {formError}
          </div>
        ) : null}
      </form>
    </DrawerShell>
  );
}

function CaseQuickViewDrawer({ item, onClose, onEdit, closing }) {
  if (!item) {
    return null;
  }

  return (
    <DrawerShell
      title={item.clientName}
      subtitle="Review the case status, next action, documents, and payment progress."
      eyebrow="Case quick view"
      onClose={onClose}
      closing={closing}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white"
          >
            <Pencil className="h-4 w-4" />
            Edit Case
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-500">
                {item.fileNumber}
              </p>
              <h3 className="mt-1 text-xl font-semibold text-slate-950">
                {item.caseType}
              </h3>
            </div>
            <CaseStageBadge stage={item.stage} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Assigned staff
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {item.assignedName}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Last updated
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {item.lastUpdatedLabel}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Next action
          </h3>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getActionStyles(item.nextAction, item.urgent)}`}
            >
              {item.nextAction}
            </span>
            {item.urgent ? (
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                Needs attention
              </span>
            ) : null}
            {item.isPending ? <CreatingBadge /> : null}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Documents
          </h3>
          <div className="mt-4">
            <CaseDocumentProgress summary={item.documentSummary} />
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Payment
          </h3>
          <div className="mt-4">
            <CasePaymentBadge summary={item.paymentSummary} />
          </div>
        </section>
      </div>
    </DrawerShell>
  );
}

export default function Cases() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cases, setCases] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [caseTypeOptions, setCaseTypeOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  const [viewingCase, setViewingCase] = useState(null);
  const [formState, setFormState] = useState(defaultFormState);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState(() => {
    const stageFromUrl = searchParams.get("stage");
    return {
      caseType: "all",
      stage: stageFromUrl && STAGE_OPTIONS.includes(stageFromUrl) ? stageFromUrl : "all",
      status: "all",
      staff: "all",
      priority: "all",
    };
  });
  const [refreshing, setRefreshing] = useState(false);
  const [registerView, setRegisterView] = useState("active");
  const [activeActionMenuId, setActiveActionMenuId] = useState(null);
  const loadRequestRef = useRef(0);
  const handledCreateRequestRef = useRef("");
  const afterCreateActionRef = useRef("");
  const bookAppointmentAfterPaymentRef = useRef(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );

  const isEditing = Boolean(editingCase);

  useEffect(() => {
    loadWorkspaceData({ view: registerView });
  }, [registerView]);

  useEffect(() => {
    api.get("/cases/case-types").then((response) => setCaseTypeOptions(response.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get("action") !== "create") return undefined;
    const createClientId = searchParams.get("clientId") || "";
    if (!createClientId || handledCreateRequestRef.current === createClientId)
      return undefined;

    let active = true;

    const openForClient = (clientRecord) => {
      if (!active) return;
      handledCreateRequestRef.current = createClientId;
      afterCreateActionRef.current = searchParams.get("after") || "";
      bookAppointmentAfterPaymentRef.current = searchParams.get("bookAppointment") === "true";
      if (clientRecord?.id) {
        setClients((current) =>
          current.some((item) => item.id === clientRecord.id)
            ? current
            : [clientRecord, ...current],
        );
      }
      openCreateFormForClient(createClientId);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("action");
      nextParams.delete("clientId");
      nextParams.delete("after");
      nextParams.delete("bookAppointment");
      setSearchParams(nextParams, { replace: true });
    };

    const existingClient = clients.find((item) => item.id === createClientId);
    if (existingClient) {
      openForClient(existingClient);
      return () => {
        active = false;
      };
    }

    api
      .get(`/clients/${createClientId}`)
      .then((response) => openForClient(response.data.data?.client))
      .catch((requestError) => {
        if (!active) return;
        setToast({
          type: "error",
          message:
            requestError.response?.data?.message ||
            "This client could not be selected for a new case.",
        });
      });

    return () => {
      active = false;
    };
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    function updateLayoutMode() {
      const nextIsDesktop = window.innerWidth >= 1024;
      setIsDesktopLayout(nextIsDesktop);
      setActiveActionMenuId(null);
    }

    updateLayoutMode();
    window.addEventListener("resize", updateLayoutMode);

    return () => {
      window.removeEventListener("resize", updateLayoutMode);
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!showForm && !viewingCase) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeDrawers();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm, viewingCase]);

  async function loadWorkspaceData({ quiet = false, view = registerView } = {}) {
    const requestId = ++loadRequestRef.current;
    try {
      if (quiet) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const requests = quiet
        ? [
            api.getFresh("/cases", { params: { view } }),
            api.getFresh("/clients"),
            api.getFresh("/leads/staff"),
            api.getFresh("/client-documents"),
            api.getFresh("/cases/payment-summaries"),
          ]
        : [
            api.get("/cases", { params: { view } }),
            api.get("/clients"),
            api.get("/leads/staff"),
            api.get("/client-documents"),
            api.get("/cases/payment-summaries"),
          ];
      const results = await Promise.allSettled(requests);

      const [
        casesResult,
        clientsResult,
        usersResult,
        documentsResult,
        paymentsResult,
      ] = results;

      if (requestId !== loadRequestRef.current) return;

      if (casesResult.status !== "fulfilled") {
        throw casesResult.reason;
      }

      setCases(casesResult.value.data.data || []);
      setClients(
        clientsResult.status === "fulfilled"
          ? clientsResult.value.data.data || []
          : [],
      );
      setUsers(
        usersResult.status === "fulfilled"
          ? usersResult.value.data.data || []
          : [],
      );
      setDocuments(
        documentsResult.status === "fulfilled"
          ? documentsResult.value.data.data || []
          : [],
      );
      setPayments(
        paymentsResult.status === "fulfilled"
          ? paymentsResult.value.data.data || []
          : [],
      );
      setError("");
    } catch (requestError) {
      if (requestId !== loadRequestRef.current) return;
      setError(requestError.response?.data?.message || "Unable to load cases.");
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  const enrichedCases = useMemo(
    () =>
      [...cases]
        .map((item) =>
          buildCaseViewModel(item, clients, users, documents, payments),
        )
        .sort((a, b) => a.clientName.localeCompare(b.clientName)),
    [cases, clients, users, documents, payments],
  );

  const filteredCases = useMemo(() => {
    return enrichedCases.filter((caseItem) => {
      const query = searchQuery.trim().toLowerCase();

      const matchesSearch =
        !query ||
        [
          caseItem.clientName,
          caseItem.fileNumber,
          caseItem.caseType,
          caseItem.stage,
          caseItem.status,
          caseItem.assignedTo,
          caseItem.nextAction,
          caseItem.paymentStatus,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));

      const matchesCaseType =
        filters.caseType === "all" || caseItem.caseType === filters.caseType;
      const matchesStage =
        filters.stage === "all" || caseItem.stage === filters.stage;
      const matchesStatus =
        filters.status === "all" || caseItem.status === filters.status;
      const matchesStaff =
        filters.staff === "all" || caseItem.assignedTo === filters.staff;
      const matchesPriority =
        filters.priority === "all" || caseItem.priority === filters.priority;

      return (
        matchesSearch &&
        matchesCaseType &&
        matchesStage &&
        matchesStatus &&
        matchesStaff &&
        matchesPriority
      );
    });
  }, [enrichedCases, filters, searchQuery]);

  const summary = useMemo(() => {
    const totalCases = enrichedCases.length;
    const activeCases = enrichedCases.filter(isActiveCase).length;
    const readyForSubmission =
      enrichedCases.filter(isReadyForSubmission).length;
    const overdueFollowUps = enrichedCases.filter((item) => item.urgent).length;

    return { totalCases, activeCases, readyForSubmission, overdueFollowUps };
  }, [enrichedCases]);

  function resetFormState() {
    setFormState(defaultFormState);
    setFormError("");
    setEditingCase(null);
  }

  function openCreateForm() {
    afterCreateActionRef.current = "";
    bookAppointmentAfterPaymentRef.current = false;
    setActiveActionMenuId(null);
    setViewingCase(null);
    setEditingCase(null);
    setFormState(defaultFormState);
    setFormError("");
    setDrawerClosing(false);
    setShowForm(true);
  }

  function openCreateFormForClient(clientId) {
    setActiveActionMenuId(null);
    setViewingCase(null);
    setEditingCase(null);
    setFormState({ ...defaultFormState, clientId });
    setFormError("");
    setDrawerClosing(false);
    setShowForm(true);
  }

  function openEditForm(item) {
    afterCreateActionRef.current = "";
    bookAppointmentAfterPaymentRef.current = false;
    setActiveActionMenuId(null);
    setViewingCase(null);
    setEditingCase(item);
    setFormState({
      clientId: item.client?.id || item.clientId || "",
      assignedUserId: item.assignedUser?.id || item.assignedUserId || "",
      caseType: item.caseType || "",
      stage: item.stage || "Lead",
      status: item.status || "Open",
      priority: item.priority || "Normal",
      nextAction: item.nextAction || "",
      submittedAt: formatDateForInput(item.submittedAt),
      decisionAt: formatDateForInput(item.decisionAt),
    });
    setFormError("");
    setDrawerClosing(false);
    setShowForm(true);
  }

  function openQuickView(item) {
    afterCreateActionRef.current = "";
    bookAppointmentAfterPaymentRef.current = false;
    setActiveActionMenuId(null);
    setShowForm(false);
    setEditingCase(null);
    setDrawerClosing(false);
    setViewingCase(item);
  }

  function closeDrawers() {
    setActiveActionMenuId(null);
    setDrawerClosing(true);
    window.setTimeout(() => {
      setShowForm(false);
      setViewingCase(null);
      setDrawerClosing(false);
      resetFormState();
    }, 220);
  }

  function cancelDrawers() {
    afterCreateActionRef.current = "";
    bookAppointmentAfterPaymentRef.current = false;
    closeDrawers();
  }

  function handleInputChange(event) {
    const { name, value } = event.target;

    setFormState((current) => {
      const nextState = { ...current, [name]: value };

      if (name === "stage" && !current.nextAction) {
        nextState.nextAction = getDefaultNextAction(value);
      }

      return nextState;
    });
  }

  function clearFilters() {
    setSearchQuery("");
    setFilters({
      caseType: "all",
      stage: "all",
      status: "all",
      staff: "all",
      priority: "all",
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setFormError("");

      const payload = {
        ...formState,
        assignedUserId: formState.assignedUserId || "",
        nextAction:
          (formState.nextAction || "").trim() ||
          getDefaultNextAction(formState.stage),
      };

      if (!payload.assignedUserId) {
        delete payload.assignedUserId;
      }

      if (!payload.submittedAt) {
        delete payload.submittedAt;
      }

      if (!payload.decisionAt) {
        delete payload.decisionAt;
      }

      if (isEditing) {
        const response = await api.patch(`/cases/${editingCase.id}`, payload);
        const savedCase = response.data.data || response.data;
        setCases((current) =>
          current.map((item) =>
            item.id === editingCase.id ? { ...item, ...savedCase } : item,
          ),
        );
        setToast({ type: "success", message: "Case updated successfully" });
        closeDrawers();
        return;
      }

      const optimisticCase = createOptimisticCase(formState, clients, users);
      setCases((current) => [optimisticCase, ...current]);
      closeDrawers();

      try {
        const response = await api.post("/cases", payload);
        const savedCase = response.data.data || response.data;

        if (savedCase?.id) {
          setCases((current) =>
            replaceOptimisticCase(current, optimisticCase.id, savedCase),
          );

          if (afterCreateActionRef.current === "professional-payment") {
            afterCreateActionRef.current = "";
            navigate(`/app/clients/${encodeURIComponent(payload.clientId)}`, {
              state: {
                openBillingEntry: true,
                billingEntry: {
                  mode: "new",
                  paymentType: "fees",
                  caseId: savedCase.id,
                  afterSave: bookAppointmentAfterPaymentRef.current ? "appointment" : "",
                },
              },
            });
            bookAppointmentAfterPaymentRef.current = false;
            return;
          }
        } else {
          setCases((current) =>
            rollbackOptimisticCase(current, optimisticCase.id),
          );
          await loadWorkspaceData({ quiet: true });
        }

        setToast({ type: "success", message: "Case created successfully" });
      } catch (requestError) {
        setCases((current) =>
          rollbackOptimisticCase(current, optimisticCase.id),
        );
        setToast({
          type: "error",
          message: "Could not create case. Please try again.",
        });
        setFormState(formState);
        setFormError(
          requestError.response?.data?.message || "Unable to save case.",
        );
        setShowForm(true);
      }
    } catch (requestError) {
      setFormError(
        requestError.response?.data?.message || "Unable to save case.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStageChange(item, nextStage) {
    if (item.stage === nextStage || item.isPending) {
      return;
    }

    const previousStage = item.stage;
    const nextAction = getDefaultNextAction(nextStage);

    setCases((current) =>
      updateCaseOptimistically(current, item.id, {
        stage: nextStage,
        nextAction,
        isSavingStage: true,
      }),
    );

    try {
      await api.patch(`/cases/${item.id}`, { stage: nextStage, nextAction });
      setCases((current) =>
        updateCaseOptimistically(current, item.id, { isSavingStage: false }),
      );
    } catch (requestError) {
      setCases((current) =>
        updateCaseOptimistically(current, item.id, {
          stage: previousStage,
          nextAction: item.nextAction,
          isSavingStage: false,
        }),
      );
      setToast({
        type: "error",
        message: "Could not update case stage. Changes were rolled back.",
      });
    }
  }

  async function handleDelete(item) {
    const confirmation = registerView === "active"
      ? `Close the ${item.caseType} case for ${item.clientName}? Open tasks, follow-ups, and appointments will be cancelled and the history will be preserved.`
      : registerView === "closed"
        ? `Archive the ${item.caseType} case for ${item.clientName}? Its complete history will be retained.`
        : null;
    const confirmed = confirmation ? window.confirm(confirmation) : true;

    if (!confirmed) {
      return;
    }

    try {
      setActiveActionMenuId(null);
      setDeletingId(item.id);
      const endpoint = {
        active: "close",
        closed: "archive",
        archived: "unarchive",
        trash: "restore",
      }[registerView];
      await api.patch(`/cases/${item.id}/${endpoint}`);
      setCases((current) => current.filter((entry) => entry.id !== item.id));
      const successMessage = {
        active: "Case moved to Closed.",
        closed: "Case archived.",
        archived: "Case restored to Closed.",
        trash: "Case restored.",
      }[registerView];
      setToast({ type: "success", message: successMessage });
      if (editingCase?.id === item.id || viewingCase?.id === item.id) {
        closeDrawers();
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to update this case.",
      );
    } finally {
      setDeletingId("");
    }
  }

  if (error && !loading && !cases.length) {
    return (
      <>
        <Toast toast={toast} onDismiss={() => setToast(null)} />
        <ErrorState onRetry={() => loadWorkspaceData()} />
      </>
    );
  }

  return (
    <>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <section className="min-h-screen px-1 py-1">
        <div className="mx-auto w-full max-w-[1560px] space-y-6">
          <section className="rounded-3xl border border-white/70 bg-white/75 px-6 py-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
                  Case Management
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                  Cases
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Track active immigration files, stages, next actions, and
                  assigned staff.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white/75 px-4 text-sm font-medium text-slate-400"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => loadWorkspaceData({ quiet: true })}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white/85 text-slate-600 transition hover:bg-white"
                  aria-label="Refresh cases"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-950 bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  New Case
                </button>
              </div>
            </div>
          </section>

          {loading && registerView === "active" ? (
            <KpiSkeleton />
          ) : registerView === "active" ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={BriefcaseBusiness}
                label="Total Cases"
                value={summary.totalCases}
                helper="Files in the active register"
                accent="blue"
              />
              <StatCard
                icon={Users}
                label="Active Cases"
                value={summary.activeCases}
                helper="Files currently moving forward"
                accent="emerald"
              />
              <StatCard
                icon={Sparkles}
                label="Ready for Submission"
                value={summary.readyForSubmission}
                helper="Applications close to filing"
                accent="amber"
              />
              <StatCard
                icon={CalendarClock}
                label="Overdue Follow-ups"
                value={summary.overdueFollowUps}
                helper="Cases needing attention today"
                accent="rose"
              />
            </section>
          ) : null}

          <div className="space-y-2">
            <section>
              <CasesCommandBar
                cases={enrichedCases}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filters={filters}
                setFilters={setFilters}
                onNewCase={openCreateForm}
                onSelectCase={(caseItem) => {
                  openQuickView(caseItem);
                }}
              />
            </section>

            <section
              className={`${cardClassName} relative z-10 overflow-hidden`}
            >
              <div className="border-b border-slate-200/60 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-semibold text-slate-900">
                        Case register
                      </h2>
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                        {REGISTER_VIEWS.find((item) => item.id === registerView)?.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Showing {filteredCases.length} of {enrichedCases.length}{" "}
                      {enrichedCases.length === 1 ? "case" : "cases"} in this register
                    </p>
                    <div className="scrollbar-hidden -mx-1 mt-4 overflow-x-auto px-1 pb-1">
                      <div className="flex min-w-max gap-2" role="tablist" aria-label="Case register views">
                        {REGISTER_VIEWS.map(({ id, label, icon: Icon }) => {
                          const selected = registerView === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => {
                                setActiveActionMenuId(null);
                                setSearchQuery("");
                                setFilters({ caseType: "all", stage: "all", status: "all", staff: "all", priority: "all" });
                                setRegisterView(id);
                              }}
                              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
                                selected
                                  ? "border-slate-950 bg-slate-950 text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950"
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {error ? (
                <div className="mx-5 mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:mx-6">
                  {error}
                </div>
              ) : null}

              {loading ? (
                <div className="space-y-3 p-5 sm:p-6">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-20 animate-pulse rounded-[1.5rem] border border-slate-200/60 bg-white/70"
                    />
                  ))}
                </div>
              ) : !enrichedCases.length ? (
                <EmptyState onCreate={openCreateForm} view={registerView} />
              ) : !filteredCases.length ? (
                <NoResultsState onClear={clearFilters} />
              ) : (
                <>
                  {isDesktopLayout ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="sticky top-0 border-b border-slate-200/55 bg-white/82 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          <tr>
                            <th className="px-6 py-4">Client</th>
                            <th className="px-4 py-4">Case Type</th>
                            <th className="px-4 py-4">Stage</th>
                            <th className="px-4 py-4">Next Action</th>
                            <th className="px-4 py-4">Assigned To</th>
                            <th className="px-4 py-4">Documents</th>
                            <th className="px-4 py-4">Payment</th>
                            <th className="px-4 py-4">Last Updated</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCases.map((item) => (
                            <tr
                              key={item.id}
                              className={`border-b border-slate-100 transition hover:bg-sky-50/50 ${item.isPending ? "pointer-events-none animate-pulse opacity-60" : ""}`}
                            >
                              <td className="px-6 py-5">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                                    {item.clientInitials}
                                  </div>
                                  <div>
                                    <Link
                                      to={`/app/cases/${item.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-semibold text-slate-900 transition hover:text-sky-700"
                                    >
                                      {item.clientName}
                                    </Link>
                                    <p className="text-xs text-slate-400">
                                      {item.fileNumber}
                                    </p>
                                    {item.isPending ? (
                                      <span className="mt-2 inline-block"><CreatingBadge /></span>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-5">
                                <Link
                                  to={`/app/cases/${item.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold text-slate-900 transition hover:text-sky-700"
                                >
                                  {item.caseType}
                                </Link>
                              </td>
                              <td className="px-4 py-5">
                                <div className="space-y-2">
                                  <select
                                    value={item.stage}
                                    disabled={registerView !== "active"}
                                    onChange={(event) =>
                                      handleStageChange(
                                        item,
                                        event.target.value,
                                      )
                                    }
                                    className="h-10 w-[190px] rounded-xl border border-slate-200 bg-white/80 px-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 disabled:bg-slate-100 disabled:text-slate-500"
                                  >
                                    {STAGE_OPTIONS.map((stage) => (
                                      <option key={stage} value={stage}>
                                        {stage}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="flex items-center gap-2">
                                    <CaseStageBadge stage={item.stage} />
                                    {item.isSavingStage ? (
                                      <span className="text-xs font-medium text-slate-400">
                                        Saving...
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-5">
                                <div className="max-w-[220px]">
                                  <div className="flex items-start gap-2">
                                    <span
                                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.urgent ? "bg-rose-500" : "bg-sky-500"}`}
                                    />
                                    <div>
                                      <p className="text-sm font-semibold leading-5 text-slate-900">
                                        {item.nextAction}
                                      </p>
                                      {item.urgent ? (
                                        <span className="mt-2 inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
                                          Needs attention
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-5">
                                <div className="flex items-center gap-2">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                                    {getInitials(item.assignedName)}
                                  </div>
                                  <span className="font-medium text-slate-700">
                                    {item.assignedName}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-5">
                                <CaseDocumentProgress
                                  summary={item.documentSummary}
                                />
                              </td>
                              <td className="px-4 py-5">
                                <CasePaymentBadge
                                  summary={item.paymentSummary}
                                />
                              </td>
                              <td className="px-4 py-5">
                                <p className="font-medium text-slate-700">
                                  {item.lastUpdatedLabel}
                                </p>
                              </td>
                              <td className="px-6 py-5">
                                <div className="flex items-center justify-end">
                                  <CaseActionsMenu
                                    item={item}
                                    isOpen={activeActionMenuId === item.id}
                                    onToggle={setActiveActionMenuId}
                                    onEdit={openEditForm}
                                    onDelete={handleDelete}
                                    deletingId={deletingId}
                                    registerView={registerView}
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid gap-4 p-5 sm:p-6">
                      {filteredCases.map((item) => (
                        <CaseMobileCard
                          key={item.id}
                          item={item}
                          onEdit={openEditForm}
                          onDelete={handleDelete}
                          onStageChange={handleStageChange}
                          onToggleMenu={setActiveActionMenuId}
                          isMenuOpen={activeActionMenuId === item.id}
                          deletingId={deletingId}
                          registerView={registerView}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </section>

      {showForm ? (
        <CaseFormDrawer
          formState={formState}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          onCancel={cancelDrawers}
          saving={saving}
          formError={formError}
          clients={clients}
          users={users}
          caseTypeOptions={caseTypeOptions}
          isEditing={isEditing}
          closing={drawerClosing}
        />
      ) : null}

      {viewingCase ? (
        <CaseQuickViewDrawer
          item={viewingCase}
          onClose={closeDrawers}
          onEdit={openEditForm}
          closing={drawerClosing}
        />
      ) : null}
    </>
  );
}
