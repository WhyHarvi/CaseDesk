import {
  BriefcaseBusiness,
  Archive,
  CalendarDays,
  CalendarClock,
  ChevronDown,
  Download,
  FileWarning,
  FilterX,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { canAccessPage, getPortalAccess, hasCapability } from "../auth/portalAccess";
import api from "../services/api";
import CaseEasyOriginBadge from "../components/clients/CaseEasyOriginBadge";
import { clientNameParts, composePersonFullName } from "../utils/personName";

export const newClientOperationKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export const defaultClientFormState = {
  givenNames: "",
  familyName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  address: "",
  preferredLanguage: "",
  identificationType: "",
  identificationNumber: "",
  identificationCountry: "",
  identificationExpiryDate: "",
  status: "Lead",
  assignedUserId: "",
};

const defaultFrontDeskIntakeState = {
  action: "client-only",
  bookAppointmentAfterPayment: true,
};

const cardClassName =
  "rounded-3xl border border-white/70 bg-white/75 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl";
const pillClassName = "inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold leading-none";

// Keeps the Add/Edit Client drawer open (and whatever was typed) across a
// browser reload — sessionStorage rather than localStorage, so a stale draft
// from a previous work session never resurfaces in a new tab days later.
const CLIENT_DRAFT_STORAGE_KEY = "casedesk:client-drawer-draft";

export function dateOfBirthError(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return "Use YYYY-MM-DD, for example 1990-05-23.";
  const [year, month, day] = input.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return "Enter a real calendar date.";
  const today = new Date();
  if (parsed.getTime() > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) return "Date of birth cannot be in the future.";
  if (year < 1900) return "Enter a date of birth from 1900 onward.";
  return "";
}

function readClientDraft() {
  try {
    const raw = window.sessionStorage.getItem(CLIENT_DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeClientDraft(draft) {
  try {
    window.sessionStorage.setItem(CLIENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private browsing, quota) — the drawer still works,
    // it just won't survive a reload.
  }
}

function clearClientDraft() {
  try {
    window.sessionStorage.removeItem(CLIENT_DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

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
  const diffDays = Math.round((today.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / 86400000);

  if (diffDays <= 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "1 day ago";
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

function normalizeStatus(status) {
  if (!status) {
    return "Lead";
  }

  if (status === "Inactive") {
    return "Waiting";
  }

  return status;
}

function getStageStyles(stage) {
  const styles = {
    Lead: "bg-slate-100 text-slate-600",
    Consultation: "bg-blue-100 text-blue-700",
    "Retainer Pending": "bg-amber-100 text-amber-700",
    "Offer Letter Application Submitted": "bg-cyan-100 text-cyan-700",
    "Offer Letter Received": "bg-teal-100 text-teal-700",
    "Documents Pending": "bg-orange-100 text-orange-700",
    "Reviewing Documents": "bg-violet-100 text-violet-700",
    "Application Preparing": "bg-teal-100 text-teal-700",
    Submitted: "bg-indigo-100 text-indigo-700",
    "Decision Received": "bg-emerald-100 text-emerald-700",
    Closed: "bg-slate-200 text-slate-600",
    Active: "bg-sky-100 text-sky-700",
    Waiting: "bg-amber-100 text-amber-700",
  };

  return styles[stage] || "bg-slate-100 text-slate-600";
}

function getPaymentStyles(payment) {
  if (payment === "Paid") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (payment === "Partial") {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-rose-100 text-rose-700";
}

function getActionStyles(action) {
  if (/(payment|collect|call)/i.test(action)) {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  }

  if (/submit/i.test(action)) {
    return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  }

  return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
}

function matchesView(client, view) {
  switch (view) {
    case "Active":
      return client.normalizedStatus === "Active";
    case "Pending Documents":
      return client.missingDocs > 0;
    case "Payment Due":
      return client.paymentBalance > 0;
    case "Follow-ups Due":
      return client.followUpsDue > 0;
    case "Closed":
      return client.normalizedStatus === "Closed" || client.stage === "Closed";
    default:
      return true;
  }
}

function buildClientViewModel(client) {
  const currentCase = client.cases?.[0] || null;
  const caseType = currentCase?.caseType || "No case";
  const stage = currentCase?.stage || client.status || "Lead";
  const nextAction = currentCase?.nextAction || "No next action";
  const missingDocs = (currentCase?.clientDocuments || []).filter((document) => ["Requested", "ChangesRequested"].includes(document.status)).length;
  const legacyPaymentTotals = (currentCase?.payments || []).reduce((summary, paymentItem) => ({
    balance: summary.balance + Number(paymentItem.balance || 0),
    paid: summary.paid + Number(paymentItem.paidAmount || 0),
  }), { balance: 0, paid: 0 });
  const paymentTotals = client.billingSummary || legacyPaymentTotals;
  const hasBilling = client.billingSummary ? Number(client.billingSummary.totalCharges) > 0 : Boolean(currentCase?.payments?.length);
  const payment = hasBilling ? (Number(paymentTotals.balance) > 0 ? `${new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(paymentTotals.balance)} due` : Number(paymentTotals.totalRefunds || 0) > 0 && Number(paymentTotals.netCollected || 0) <= 0 ? "Refunded" : "Paid") : "No payment record";
  const now = Date.now();
  const followUpsDue = (currentCase?.followUps || []).filter((followUp) => !["Completed", "Cancelled"].includes(followUp.status) && followUp.dueDate && new Date(followUp.dueDate).getTime() <= now).length;
  const updatedAt = currentCase?.updatedAt || client.updatedAt || client.createdAt;

  return {
    ...client,
    caseType,
    stage,
    missingDocs,
    payment,
    paymentBalance: paymentTotals.balance,
    followUpsDue,
    nextAction,
    hasCase: Boolean(currentCase),
    normalizedStatus: normalizeStatus(client.status),
    assignedName: client.assignedUser?.fullName || "Unassigned",
    fileNumber: client.clientNumber || `CL-${String(client.id || "").slice(0, 8).toUpperCase()}`,
    lastUpdatedLabel: formatRelativeDate(updatedAt),
    initials: getInitials(client.fullName),
  };
}

export function ClientDrawer({
  formState,
  onChange,
  onSubmit,
  onCancel,
  saving,
  formError,
  users,
  isEditing,
  closing,
  showFrontDeskActions,
  frontDeskIntake,
  onFrontDeskIntakeChange,
  canRecordProfessionalFee,
  nameNeedsReview,
  contactMatches,
  caseEasyMatches = [],
  checkingContact,
  onOpenExistingClient,
  onBookExistingClient,
  onImportCaseEasyContact,
  importingCaseEasyId = "",
  dobError,
  onDobBlur,
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm transition-all duration-300 ease-out ${
        closing ? "opacity-0" : "opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
        aria-label="Close drawer"
      />

      <aside
        className={`relative flex h-full w-full max-w-[720px] flex-col overflow-hidden border-l border-white/70 bg-gradient-to-br from-white via-slate-50 to-sky-50 shadow-[0_32px_120px_rgba(15,23,42,0.28)] backdrop-blur-2xl transition-all duration-300 ease-out ${
          closing ? "translate-x-full scale-[0.98]" : "translate-x-0 scale-100"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.08),transparent_32%)]" />

        <div className="relative border-b border-slate-200/70 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-5">
            <div>
              <div className="inline-flex items-center rounded-full border border-sky-200/70 bg-sky-50/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                Client intake
              </div>

              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
                {isEditing ? "Edit client profile" : "Add new client"}
              </h2>

              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                {showFrontDeskActions
                  ? "Create the profile, then continue into appointment booking, consultation payment, or categorized professional billing."
                  : "Save the core client details first. Case, documents, payments, and follow-ups can be handled from the client profile."}
              </p>
            </div>

            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white/80 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <form className="relative flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6 sm:px-8">
            <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    Client details
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Basic identity and contact information.
                  </p>
                </div>

                <div className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 sm:block">
                  At least one name required
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Given name(s)
                  </span>
                  <input
                    name="givenNames"
                    value={formState.givenNames}
                    onChange={onChange}
                    className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                    placeholder="As shown on passport"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Family name
                  </span>
                  <input
                    name="familyName"
                    value={formState.familyName}
                    onChange={onChange}
                    className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                    placeholder="Leave blank only if none"
                  />
                </label>

                <div className={`md:col-span-2 rounded-2xl px-4 py-3 text-xs leading-5 ${nameNeedsReview ? "border border-amber-200 bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-500"}`}>
                  {nameNeedsReview ? "These name parts were suggested from the old Full name. Verify them against the passport before saving. " : "Enter names exactly as shown on the passport. At least one name is required. "}
                  <span className="font-semibold">CRM display name: {composePersonFullName(formState.givenNames, formState.familyName) || "—"}</span>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Email
                  </span>
                  <input
                    type="email"
                    name="email"
                    value={formState.email}
                    onChange={onChange}
                    className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                    placeholder="client@example.com"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Phone
                  </span>
                  <input
                    name="phone"
                    value={formState.phone}
                    onChange={onChange}
                    className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                    placeholder="+1 416 555 0100"
                  />
                </label>

                {!isEditing && (checkingContact || contactMatches.length) ? (
                  <div className="md:col-span-2 rounded-2xl border border-sky-200 bg-sky-50 p-4" role="status" aria-live="polite">
                    {checkingContact ? (
                      <p className="flex items-center gap-2 text-xs font-semibold text-sky-800"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for an existing client…</p>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-sky-900">This person is already in CaseDesk</p>
                        <p className="mt-1 text-xs leading-5 text-sky-700">Use the existing profile instead of creating a duplicate.</p>
                        <div className="mt-3 space-y-2">
                          {contactMatches.map((client) => (
                            <div key={client.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 shadow-sm">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{client.fullName}</p>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">{[client.clientNumber, client.email, client.phone].filter(Boolean).join(" · ")}</p>
                                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-sky-600">Matched {client.matchedBy.join(" and ")}{client.archivedAt ? " · Archived profile" : ""}</p>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <button type="button" onClick={() => onOpenExistingClient(client)} className="h-9 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">Go to profile</button>
                                {client.canBookAppointment ? <button type="button" onClick={() => onBookExistingClient(client)} className="h-9 rounded-full bg-slate-950 px-3.5 text-xs font-semibold text-white transition hover:bg-slate-800">Book appointment</button> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {!isEditing && !checkingContact && caseEasyMatches.length ? (
                  <div className="md:col-span-2 rounded-2xl border border-violet-200 bg-violet-50 p-4" role="status" aria-live="polite">
                    <p className="text-sm font-semibold text-violet-900">Found in imported Case Easy data</p>
                    <p className="mt-1 text-xs leading-5 text-violet-700">Not yet a CaseDesk client. Import their record instead of starting from scratch.</p>
                    <div className="mt-3 space-y-2">
                      {caseEasyMatches.map((contact) => (
                        <div key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 shadow-sm">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{contact.fullName}</p>
                            <p className="mt-0.5 truncate text-[11px] text-slate-500">{[contact.clientIdentifier, contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600">Case Easy{contact.recordType ? ` · ${contact.recordType}` : ""}</p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button type="button" disabled={importingCaseEasyId === contact.id} onClick={() => onImportCaseEasyContact(contact, false)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
                              {importingCaseEasyId === contact.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              Import
                            </button>
                            <button type="button" disabled={importingCaseEasyId === contact.id} onClick={() => onImportCaseEasyContact(contact, true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-3.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                              {importingCaseEasyId === contact.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              Import &amp; book
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Date of birth
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="bday"
                    name="dateOfBirth"
                    value={formState.dateOfBirth}
                    onChange={onChange}
                    onBlur={onDobBlur}
                    maxLength={10}
                    placeholder="YYYY-MM-DD"
                    aria-invalid={Boolean(dobError)}
                    aria-describedby={dobError ? "client-dob-error" : undefined}
                    className={`h-12 w-full rounded-2xl border bg-white/90 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 ${dobError ? "border-rose-400 ring-4 ring-rose-100 focus:border-rose-500" : "border-slate-200/90 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"}`}
                  />
                  {dobError ? <span id="client-dob-error" className="mt-1.5 block text-xs font-medium text-rose-600">{dobError}</span> : null}
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Status
                  </span>
                  <select
                    name="status"
                    value={formState.status}
                    onChange={onChange}
                    className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                  >
                    {["Lead", "Active", "Inactive", "Closed"].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Preferred language</span>
                  <input name="preferredLanguage" value={formState.preferredLanguage} onChange={onChange} maxLength={100} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="English, French..." />
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Address
                  </span>
                  <textarea
                    name="address"
                    rows="3"
                    value={formState.address}
                    onChange={onChange}
                    className="w-full resize-none rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                    placeholder="Toronto, ON"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-slate-950">Identification</h3>
                <p className="mt-1 text-sm text-slate-500">Record the primary identity document used for the file.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Document type</span><input name="identificationType" value={formState.identificationType} onChange={onChange} maxLength={100} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" placeholder="Passport" /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Document number</span><input name="identificationNumber" value={formState.identificationNumber} onChange={onChange} maxLength={150} autoComplete="off" className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Issuing country</span><input name="identificationCountry" value={formState.identificationCountry} onChange={onChange} maxLength={100} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">Expiry date</span><input type="date" name="identificationExpiryDate" value={formState.identificationExpiryDate} onChange={onChange} className="h-12 w-full rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-slate-950">
                  File ownership
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Assign the client to a staff member for follow-ups and daily work.
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Assigned consultant
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
            </section>

            {showFrontDeskActions ? (
              <section className="rounded-[1.75rem] border border-sky-100 bg-gradient-to-br from-white to-sky-50/80 p-5 shadow-[0_18px_50px_rgba(14,165,233,0.1)]">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Front-desk intake
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-slate-950">What should happen after the client is saved?</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">Choose the next step now. The next screen will open with the new client already selected.</p>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    { value: "client-only", label: "Save only", helper: "Create the profile" },
                    { value: "appointment", label: "Book appointment", helper: "Charge the fee or skip" },
                    ...(canRecordProfessionalFee
                      ? [{ value: "professional-payment", label: "Professional fee", helper: "Create case, charge and payment" }]
                      : []),
                  ].map(({ value, label, helper }) => {
                    const active = frontDeskIntake.action === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onFrontDeskIntakeChange({ action: value })}
                        className={`rounded-2xl border px-3.5 py-3 text-left transition ${active ? "border-sky-400 bg-sky-600 text-white shadow-[0_12px_28px_rgba(2,132,199,0.2)]" : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"}`}
                      >
                        <span className="block text-xs font-semibold">{label}</span>
                        <span className={`mt-1 block text-[11px] leading-4 ${active ? "text-sky-100" : "text-slate-400"}`}>{helper}</span>
                      </button>
                    );
                  })}
                </div>

                {frontDeskIntake.action === "professional-payment" ? (
                  <div className="mt-4 rounded-2xl border border-violet-100 bg-white/90 p-4">
                    <div className="flex items-center gap-2">
                      <BriefcaseBusiness className="h-4 w-4 text-violet-600" />
                      <p className="text-xs font-semibold text-slate-800">Professional charge and payment</p>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">After the client is saved, create their case. CaseDesk will then open the billing form with <strong>Professional fees</strong> selected so you can enter the total charge, amount received, and payment reference.</p>
                    <p className="mt-2 text-[11px] leading-5 text-slate-500">This keeps professional services separate from the consultation item and creates the correct QuickBooks invoice trail.</p>
                    <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50/70 px-3.5 py-3 text-xs leading-5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={frontDeskIntake.bookAppointmentAfterPayment}
                        onChange={(event) => onFrontDeskIntakeChange({ bookAppointmentAfterPayment: event.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-300"
                      />
                      <span><strong className="block font-semibold text-slate-900">Also book a consultation</strong>Open appointment booking with this client selected after the professional payment is recorded.</span>
                    </label>
                  </div>
                ) : null}

                {!canRecordProfessionalFee ? (
                  <p className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-[11px] leading-5 text-amber-800">Professional fee intake becomes available when this front-desk role has Cases, Financial data, and all-record client/case access in Portal Access.</p>
                ) : null}
              </section>
            ) : null}

            {formError ? (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {formError}
              </div>
            ) : null}
          </div>

          <div className="relative border-t border-slate-200/80 bg-white/85 px-6 py-4 shadow-[0_-18px_45px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:px-8">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving || (!isEditing && (checkingContact || contactMatches.length > 0))}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(15,23,42,0.24)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : isEditing
                    ? "Save changes"
                    : showFrontDeskActions && frontDeskIntake.action !== "client-only"
                      ? "Create client & continue"
                      : "Create client"}
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, helper, accent, onClick, active }) {
  const accentStyles = {
    blue: "bg-sky-100 text-sky-700",
    teal: "bg-teal-100 text-teal-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
  };

  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex max-h-[92px] min-h-[92px] w-full items-center gap-4 rounded-2xl border p-4 text-left shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl transition ${
        active ? "border-sky-300 bg-white ring-2 ring-sky-100" : "border-white/70 bg-white/70"
      } ${onClick ? "hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_16px_36px_rgba(15,23,42,0.1)]" : ""}`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${accentStyles[accent]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-slate-950">{value}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-600">{label}</p>
        <p className="mt-1 text-xs text-slate-400">{helper}</p>
      </div>
    </Tag>
  );
}

function ClientActionsMenu({ client, isOpen, onToggle, onEdit, onDelete, deletingId, canManage }) {
  const buttonRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuWidth = 180;
  const menuHeight = 104;
  const viewportPadding = 12;

  useEffect(() => {
    if (!isOpen || !buttonRef.current) {
      return;
    }

    function updateMenuPosition() {
      if (!buttonRef.current) {
        return;
      }

      const rect = buttonRef.current.getBoundingClientRect();
      const preferredLeft = rect.right - menuWidth;
      const maxLeft = window.innerWidth - menuWidth - viewportPadding;
      const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));
      const shouldOpenUp = rect.bottom + 8 + menuHeight > window.innerHeight - viewportPadding;
      const top = shouldOpenUp
        ? Math.max(viewportPadding, rect.top - menuHeight - 8)
        : Math.min(rect.bottom + 8, window.innerHeight - menuHeight - viewportPadding);

      setMenuPosition({
        top,
        left,
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen]);

  // Edit and Archive are the only two actions this menu offers — with
  // neither available (frontdesk has view-only access to clients), there's
  // nothing left worth opening a menu for.
  if (!canManage) return null;

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onToggle(isOpen ? null : client.id)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
        aria-label={`More actions for ${client.fullName}`}
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
            <button
              type="button"
              onClick={() => {
                onToggle(null);
                onEdit(client);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-sky-700"
            >
              <Pencil className="h-4 w-4" />
              Edit client
            </button>
            <button
              type="button"
              onClick={() => {
                onToggle(null);
                onDelete(client);
              }}
              disabled={deletingId === client.id}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Archive className="h-4 w-4" />
              {deletingId === client.id ? "Archiving..." : "Archive client"}
            </button>
          </div>
          </>,
          document.body
        )
        : null}
    </div>
  );
}

function ClientsMobileCard({ client, onEdit, onDelete, onToggleMenu, isMenuOpen, deletingId, canManage }) {
  return (
    <div className={`${cardClassName} space-y-4 p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
            {client.initials}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Link to={`/clients/${client.id}`} className="font-semibold text-slate-900 transition hover:text-sky-700">
                {client.fullName}
              </Link>
              {client.caseEasyImportContacts?.length ? <CaseEasyOriginBadge /> : null}
            </div>
            <p className="text-sm text-slate-500">{client.email || client.phone || "No contact on file"}</p>
            <p className="text-xs text-slate-400">{client.fileNumber}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-slate-400">Case type</p>
          <p className="mt-1 font-medium text-slate-700">{client.caseType}</p>
        </div>
        <div>
          <p className="text-slate-400">Assigned</p>
          <p className="mt-1 font-medium text-slate-700">{client.assignedName}</p>
        </div>
        <div>
          <p className="text-slate-400">Payment</p>
          <p className="mt-1 font-medium text-slate-700">{client.payment}</p>
        </div>
        <div>
          <p className="text-slate-400">Updated</p>
          <p className="mt-1 font-medium text-slate-700">{client.lastUpdatedLabel}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`${pillClassName} ${getStageStyles(client.stage)}`}>{client.stage}</span>
        <span className={`${pillClassName} ${getActionStyles(client.nextAction)}`}>
          {client.nextAction}
        </span>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200/80 pt-4">
        <p className={`text-sm font-medium ${client.missingDocs ? "text-amber-700" : "text-emerald-700"}`}>
          {client.missingDocs ? `${client.missingDocs} missing docs` : "Documents complete"}
        </p>
        <ClientActionsMenu
          client={client}
          isOpen={isMenuOpen}
          onToggle={onToggleMenu}
          onEdit={onEdit}
          onDelete={onDelete}
          deletingId={deletingId}
          canManage={canManage}
        />
      </div>
    </div>
  );
}

export default function Clients() {
  const { role, membership } = useAuth();
  const canManageClients = ["admin", "consultant", "frontdesk"].includes(role);
  const navigate = useNavigate();
  const canReassignClients = ["admin", "frontdesk"].includes(role);
  const portalAccess = getPortalAccess(role, membership?.permissions);
  const canRecordProfessionalFee =
    canAccessPage(role, membership?.permissions, "cases") &&
    hasCapability(role, membership?.permissions, "financialData") &&
    portalAccess.data.clients === "all" &&
    portalAccess.data.cases === "all";
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(() => Boolean(readClientDraft()));
  const [editingClient, setEditingClient] = useState(() => readClientDraft()?.editingClient || null);
  const [formState, setFormState] = useState(() => ({ ...defaultClientFormState, ...(readClientDraft()?.formState || {}) }));
  const [frontDeskIntake, setFrontDeskIntake] = useState(() => readClientDraft()?.frontDeskIntake || defaultFrontDeskIntakeState);
  const [clientCreateIdempotencyKey, setClientCreateIdempotencyKey] = useState(() => readClientDraft()?.clientCreateIdempotencyKey || newClientOperationKey());
  const [formError, setFormError] = useState("");
  const [dobError, setDobError] = useState("");
  const [contactMatches, setContactMatches] = useState([]);
  const [caseEasyMatches, setCaseEasyMatches] = useState([]);
  const [importingCaseEasyId, setImportingCaseEasyId] = useState("");
  const [checkingContact, setCheckingContact] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assigningClientIds, setAssigningClientIds] = useState([]);
  const [deletingId, setDeletingId] = useState("");
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [caseTypeFilter, setCaseTypeFilter] = useState("All Case Types");
  const [staffFilter, setStaffFilter] = useState("All Staff");
  const [activeView, setActiveView] = useState("All Clients");
  const [directoryOrder, setDirectoryOrder] = useState("alphabetical");
  const [activeTabStyle, setActiveTabStyle] = useState(null);
  const [activeActionMenuId, setActiveActionMenuId] = useState(null);
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  );
  const tabsContainerRef = useRef(null);
  const tabRefs = useRef({});

  const isEditing = Boolean(editingClient);

  async function loadClients() {
    try {
      setLoading(true);
      const response = await api.get("/clients?limit=100");
      setClients(response.data.data || []);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load clients.");
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const response = await api.get("/leads/staff");
      setUsers(response.data.data || []);
    } catch (requestError) {
      setUsers([]);
    }
  }

  useEffect(() => {
    loadClients();
    loadUsers();
  }, []);

  useEffect(() => {
    if (!showForm) {
      clearClientDraft();
      return;
    }
    writeClientDraft({ editingClient, formState, frontDeskIntake, clientCreateIdempotencyKey });
  }, [showForm, editingClient, formState, frontDeskIntake, clientCreateIdempotencyKey]);

  useEffect(() => {
    if (!showForm || isEditing) {
      setContactMatches([]);
      setCaseEasyMatches([]);
      setCheckingContact(false);
      return undefined;
    }
    const email = formState.email.trim();
    const phone = formState.phone.trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const validPhone = phone.replace(/\D/g, "").length >= 7;
    if (!validEmail && !validPhone) {
      setContactMatches([]);
      setCaseEasyMatches([]);
      setCheckingContact(false);
      return undefined;
    }

    let active = true;
    setContactMatches([]);
    setCaseEasyMatches([]);
    setCheckingContact(true);
    const timer = window.setTimeout(() => {
      api.get("/clients/contact-matches", {
        params: {
          ...(validEmail ? { email } : {}),
          ...(validPhone ? { phone } : {}),
        },
      })
        .then((response) => {
          if (!active) return;
          setContactMatches(response.data.data?.clients || []);
          setCaseEasyMatches(response.data.data?.caseEasyContacts || []);
        })
        .catch(() => { if (active) { setContactMatches([]); setCaseEasyMatches([]); } })
        .finally(() => { if (active) setCheckingContact(false); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [formState.email, formState.phone, isEditing, showForm]);

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

  const enrichedClients = useMemo(
    () => [...clients].sort((a, b) => a.fullName.localeCompare(b.fullName)).map(buildClientViewModel),
    [clients]
  );

  const filteredClients = useMemo(() => {
    const matchingClients = enrichedClients.filter((client) => {
      const searchHaystack = [
        client.fullName,
        client.email,
        client.emailNormalized,
        client.phone,
        client.phoneNormalized,
        client.fileNumber,
        client.caseType,
        client.nextAction,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const normalizedQuery = searchQuery.toLowerCase();
      const searchDigits = searchQuery.replace(/\D/g, "");
      const matchesSearch = !searchQuery || searchHaystack.includes(normalizedQuery) || (searchDigits.length >= 7 && String(client.phoneNormalized || "").includes(searchDigits));
      const matchesStatus = statusFilter === "All Statuses" || client.normalizedStatus === statusFilter;
      const matchesCaseType = caseTypeFilter === "All Case Types" || client.caseType === caseTypeFilter;
      const matchesStaff = staffFilter === "All Staff" || client.assignedName === staffFilter;
      const matchesActiveView = matchesView(client, activeView);

      return matchesSearch && matchesStatus && matchesCaseType && matchesStaff && matchesActiveView;
    });

    if (directoryOrder === "recentlyAdded") {
      return [...matchingClients].sort(
        (left, right) =>
          new Date(right.createdAt || 0).getTime() -
          new Date(left.createdAt || 0).getTime(),
      );
    }

    return matchingClients;
  }, [activeView, caseTypeFilter, directoryOrder, enrichedClients, searchQuery, staffFilter, statusFilter]);

  const summary = useMemo(() => {
    const activeCases = enrichedClients.filter((client) => client.normalizedStatus === "Active").length;
    const documentsPending = enrichedClients.filter((client) => client.missingDocs > 0).length;
    const followUpsDue = enrichedClients.reduce((total, client) => total + client.followUpsDue, 0);

    return {
      totalClients: enrichedClients.length,
      activeCases,
      documentsPending,
      followUpsDue,
    };
  }, [enrichedClients]);

  const hasActiveFilters =
    Boolean(searchQuery) ||
    statusFilter !== "All Statuses" ||
    caseTypeFilter !== "All Case Types" ||
    staffFilter !== "All Staff";

  const caseTypeOptions = useMemo(
    () => ["All Case Types", ...new Set(enrichedClients.map((client) => client.caseType).filter((value) => value && value !== "No case"))],
    [enrichedClients]
  );

  const statusOptions = ["All Statuses", "Lead", "Active", "Waiting", "Closed"];
  const staffOptions = useMemo(
    () => ["All Staff", ...new Set(users.map((user) => user.fullName).filter(Boolean))],
    [users]
  );
  const viewTabs = useMemo(
    () =>
      ["All Clients", "Active", "Pending Documents", "Payment Due", "Follow-ups Due", "Closed"].map((label) => ({
        label,
        count: enrichedClients.filter((client) => matchesView(client, label)).length,
      })),
    [enrichedClients]
  );

  useLayoutEffect(() => {
    function updateActiveTabStyle() {
      const activeTab = tabRefs.current[activeView];

      if (!activeTab) {
        return;
      }

      setActiveTabStyle({
        width: activeTab.offsetWidth,
        height: activeTab.offsetHeight,
        left: activeTab.offsetLeft,
        top: activeTab.offsetTop,
      });
    }

    updateActiveTabStyle();
    window.addEventListener("resize", updateActiveTabStyle);

    return () => {
      window.removeEventListener("resize", updateActiveTabStyle);
    };
  }, [activeView, viewTabs]);

  function resetForm() {
    setActiveActionMenuId(null);
    setDrawerClosing(true);

    window.setTimeout(() => {
      setFormState(defaultClientFormState);
      setFrontDeskIntake(defaultFrontDeskIntakeState);
      setEditingClient(null);
      setFormError("");
      setDobError("");
      setShowForm(false);
      setDrawerClosing(false);
    }, 260);
  }

  function openCreateForm() {
    setActiveActionMenuId(null);
    setEditingClient(null);
    setFormState(defaultClientFormState);
    setClientCreateIdempotencyKey(newClientOperationKey());
    setFrontDeskIntake(defaultFrontDeskIntakeState);
    setFormError("");
    setDobError("");
    setShowForm(true);
  }

  function openEditForm(client) {
    setActiveActionMenuId(null);
    setEditingClient(client);
    setFrontDeskIntake(defaultFrontDeskIntakeState);
    const names = clientNameParts(client);
    setFormState({
      givenNames: names.givenNames,
      familyName: names.familyName,
      email: client.email || "",
      phone: client.phone || "",
      dateOfBirth: formatDateForInput(client.dateOfBirth),
      address: client.address || "",
      preferredLanguage: client.preferredLanguage || "",
      identificationType: client.identificationType || "",
      identificationNumber: client.identificationNumber || "",
      identificationCountry: client.identificationCountry || "",
      identificationExpiryDate: formatDateForInput(client.identificationExpiryDate),
      status: client.status || "Lead",
      assignedUserId: client.assignedUser?.id || "",
    });
    setFormError("");
    setDobError("");
    setShowForm(true);
  }

  function leaveClientIntake(path) {
    clearClientDraft();
    setShowForm(false);
    setEditingClient(null);
    setContactMatches([]);
    setCaseEasyMatches([]);
    navigate(path);
  }

  // Reuses the same bulk-convert endpoint the Case Easy Import page itself
  // uses for a batch of contacts, just with a single id — it already
  // creates the Client (and any of its not-yet-converted linked cases)
  // with sensible defaults, no separate conversion logic needed here.
  async function importCaseEasyContact(contact, book) {
    setImportingCaseEasyId(contact.id);
    setFormError("");
    try {
      const { data } = await api.post("/case-easy-import/contacts/bulk-convert", { contactIds: [contact.id] });
      const result = data?.data?.results?.[0];
      if (result?.status !== "converted" || !result.clientId) {
        throw new Error(result?.message || "This contact could not be imported.");
      }
      leaveClientIntake(book ? `/app/calendar?bookForClient=${encodeURIComponent(result.clientId)}` : `/app/clients/${result.clientId}`);
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || requestError.message || "This contact could not be imported.");
    } finally {
      setImportingCaseEasyId("");
    }
  }

  function handleInputChange(event) {
    const { name, value } = event.target;
    if (name === "dateOfBirth" && dobError) setDobError(dateOfBirthError(value));
    setFormState((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    try {
      setSaving(true);
      setFormError("");

      if (!formState.givenNames.trim() && !formState.familyName.trim()) {
        setFormError("Enter at least a given name or family name.");
        return;
      }

      const nextDobError = dateOfBirthError(formState.dateOfBirth);
      if (nextDobError) {
        setDobError(nextDobError);
        setFormError("Correct the highlighted date of birth before saving.");
        return;
      }

      const payload = {
        ...formState,
        givenNames: formState.givenNames.trim(),
        familyName: formState.familyName.trim(),
        email: formState.email.trim(),
        phone: formState.phone.trim(),
        address: formState.address.trim(),
        assignedUserId: formState.assignedUserId || "",
        ...(!isEditing ? { idempotencyKey: clientCreateIdempotencyKey } : {}),
      };
      delete payload.fullName;

      if (!payload.email) {
        delete payload.email;
      }

      if (!payload.phone) {
        delete payload.phone;
      }

      if (!payload.address) {
        delete payload.address;
      }

      ["dateOfBirth", "identificationExpiryDate"].forEach((field) => {
        if (!payload[field]) delete payload[field];
      });

      if (isEditing) {
        await api.patch(`/clients/${editingClient.id}`, payload);
      } else {
        const response = await api.post("/clients", payload);
        const createdClient = response.data.data;
        if (role === "frontdesk" && frontDeskIntake.action === "professional-payment") {
          setShowForm(false);
          clearClientDraft();
          navigate(`/app/cases?action=create&clientId=${encodeURIComponent(createdClient.id)}&after=professional-payment&bookAppointment=${frontDeskIntake.bookAppointmentAfterPayment ? "true" : "false"}`);
          return;
        }
        if (role === "frontdesk" && frontDeskIntake.action !== "client-only") {
          setShowForm(false);
          clearClientDraft();
          navigate(`/app/calendar?bookForClient=${encodeURIComponent(createdClient.id)}`, {
            state: {
              frontDeskIntake: {
                action: frontDeskIntake.action,
              },
            },
          });
          return;
        }
      }

      await loadClients();
      resetForm();
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || "Unable to save client.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDirectoryAssignment(client, assignedUserId) {
    const previousAssignedUser = client.assignedUser || null;
    const nextAssignedUser =
      users.find((user) => user.id === assignedUserId) || null;

    setAssigningClientIds((current) => [...new Set([...current, client.id])]);
    setError("");
    setClients((current) =>
      current.map((item) =>
        item.id === client.id
          ? { ...item, assignedUser: nextAssignedUser }
          : item,
      ),
    );

    try {
      const response = await api.patch(`/clients/${client.id}`, {
        assignedUserId,
      });
      setClients((current) =>
        current.map((item) =>
          item.id === client.id
            ? { ...item, ...response.data.data }
            : item,
        ),
      );
    } catch (requestError) {
      setClients((current) =>
        current.map((item) =>
          item.id === client.id
            ? { ...item, assignedUser: previousAssignedUser }
            : item,
        ),
      );
      setError(
        requestError.response?.data?.message ||
          "Unable to update the client assignment.",
      );
    } finally {
      setAssigningClientIds((current) =>
        current.filter((clientId) => clientId !== client.id),
      );
    }
  }

  async function handleDelete(client) {
    let impact;
    try {
      const response = await api.get(`/clients/${client.id}/archive-impact`);
      impact = response.data.data.impact;
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to check the client history before archiving.");
      return;
    }
    const otherHistory = impact.notes + impact.followUps + impact.activity;
    const history = [
      `${impact.cases} case${impact.cases === 1 ? "" : "s"}`,
      `${impact.documents} document${impact.documents === 1 ? "" : "s"}`,
      `${impact.payments} payment${impact.payments === 1 ? "" : "s"}`,
      `${otherHistory} other history item${otherHistory === 1 ? "" : "s"}`,
    ].join(", ");
    const confirmed = window.confirm(`Archive ${client.fullName} (${client.fileNumber})?\n\nThis profile has ${history}. Nothing will be permanently deleted. Archived clients are removed from the daily directory.`);

    if (!confirmed) {
      return;
    }

    try {
      setActiveActionMenuId(null);
      setDeletingId(client.id);
      await api.patch(`/clients/${client.id}/archive`);
      setClients((current) => current.filter((entry) => entry.id !== client.id));

      if (editingClient?.id === client.id) {
        resetForm();
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to archive client.");
    } finally {
      setDeletingId("");
    }
  }

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("All Statuses");
    setCaseTypeFilter("All Case Types");
    setStaffFilter("All Staff");
  }

  function toggleRecentlyAdded() {
    if (directoryOrder === "recentlyAdded") {
      setDirectoryOrder("alphabetical");
      return;
    }

    clearFilters();
    setActiveView("All Clients");
    setActiveActionMenuId(null);
    setDirectoryOrder("recentlyAdded");
  }

  return (
    <section className="space-y-6">
      <div className="space-y-5">
        <section className="rounded-3xl border border-white/70 bg-white/75 px-6 py-5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-slate-950">Clients</h2>
              <p className="mt-1 text-sm text-slate-500">Know exactly which client needs what today.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 text-sm font-medium text-slate-600 transition hover:bg-white"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={openCreateForm}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-950 bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Add Client
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Users}
            label="Total Clients"
            value={summary.totalClients}
            helper="All profiles in the workspace"
            accent="blue"
            active={activeView === "All Clients"}
            onClick={() => setActiveView("All Clients")}
          />
          <StatCard
            icon={BriefcaseBusiness}
            label="Active Cases"
            value={summary.activeCases}
            helper="Files currently moving forward"
            accent="teal"
            active={activeView === "Active"}
            onClick={() => setActiveView("Active")}
          />
          <StatCard
            icon={FileWarning}
            label="Documents Pending"
            value={summary.documentsPending}
            helper="Clients needing document follow-up"
            accent="amber"
            active={activeView === "Pending Documents"}
            onClick={() => setActiveView("Pending Documents")}
          />
          <StatCard
            icon={CalendarClock}
            label="Follow-ups Due"
            value={summary.followUpsDue}
            helper="Tasks that need attention today"
            accent="rose"
            active={activeView === "Follow-ups Due"}
            onClick={() => setActiveView("Follow-ups Due")}
          />
        </section>

        <section className="relative isolate z-0 overflow-hidden rounded-3xl border border-white/80 bg-white/62 p-2.5 shadow-[0_20px_55px_rgba(15,23,42,0.12)] ring-1 ring-white/45 backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/28 via-transparent to-sky-100/18" />
          <div ref={tabsContainerRef} className="relative z-10 flex flex-wrap gap-2">
            {activeTabStyle ? (
              <div
                className="pointer-events-none absolute rounded-2xl border border-sky-200/90 bg-sky-200 shadow-[0_14px_32px_rgba(56,189,248,0.28)] transition-all duration-500 ease-out"
                style={{
                  width: `${activeTabStyle.width}px`,
                  height: `${activeTabStyle.height}px`,
                  transform: `translate(${activeTabStyle.left}px, ${activeTabStyle.top}px)`,
                }}
              />
            ) : null}
            {viewTabs.map((tab) => {
              const active = activeView === tab.label;

              return (
                <button
                  key={tab.label}
                  ref={(element) => {
                    tabRefs.current[tab.label] = element;
                  }}
                  type="button"
                  onClick={() => setActiveView(tab.label)}
                  className={`relative z-10 inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition duration-300 ${
                    active
                      ? "border border-transparent bg-transparent text-slate-950"
                      : "border border-transparent bg-white/18 text-slate-600 hover:bg-white/82 hover:shadow-sm"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      active ? "bg-white/60 text-slate-900 ring-1 ring-white/60" : "bg-slate-100/90 text-slate-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="relative z-10 rounded-3xl border border-white/70 bg-white/70 p-4 shadow-[0_12px_35px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search clients by name, phone, email, or file number..."
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white/90 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-12 min-w-[170px] rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <select
                value={caseTypeFilter}
                onChange={(event) => setCaseTypeFilter(event.target.value)}
                className="h-12 min-w-[170px] rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"
              >
                {caseTypeOptions.map((caseType) => (
                  <option key={caseType} value={caseType}>
                    {caseType}
                  </option>
                ))}
              </select>

              <select
                value={staffFilter}
                onChange={(event) => setStaffFilter(event.target.value)}
                className="h-12 min-w-[170px] rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 sm:col-span-2 xl:col-span-1"
              >
                {staffOptions.map((staff) => (
                  <option key={staff} value={staff}>
                    {staff}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {hasActiveFilters ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 text-sm font-medium text-slate-500 transition hover:text-sky-700"
              >
                <FilterX className="h-4 w-4" />
                Clear
              </button>
            </div>
          ) : null}
        </section>

        <section className={`${cardClassName} relative z-10 overflow-visible`}>
          <div className="border-b border-slate-200/60 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Client directory</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Showing {filteredClients.length} of {enrichedClients.length}{" "}
                  {enrichedClients.length === 1 ? "client" : "clients"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                  {directoryOrder === "recentlyAdded" ? "Newest clients first" : "Focused daily ops"}
                </div>
                <button
                  type="button"
                  onClick={toggleRecentlyAdded}
                  aria-pressed={directoryOrder === "recentlyAdded"}
                  className={`inline-flex h-9 items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition ${
                    directoryOrder === "recentlyAdded"
                      ? "border-slate-950 bg-slate-950 text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Recently added
                </button>
              </div>
            </div>
          </div>

          {error ? <div className="mx-5 mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:mx-6">{error}</div> : null}

          {loading ? (
            <div className="space-y-3 p-5 sm:p-6">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-[1.5rem] border border-slate-200/60 bg-white/70"
                />
              ))}
            </div>
          ) : filteredClients.length ? (
            <>
              {isDesktopLayout ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200/55 bg-white/82 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    <tr>
                      <th className="px-6 py-4">Client</th>
                      <th className="px-4 py-4">Case Type</th>
                      <th className="px-4 py-4">Stage</th>
                      <th className="px-4 py-4">Missing Docs</th>
                      <th className="px-4 py-4">Payment</th>
                      <th className="px-4 py-4">Next Action</th>
                      <th className="px-4 py-4">Assigned To</th>
                      <th className="px-4 py-4">Updated</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((client) => (
                      <tr key={client.id} className="border-b border-slate-100 transition hover:bg-sky-50/50">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                              {client.initials}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Link
                                  to={`/clients/${client.id}`}
                                  className="font-semibold text-slate-900 transition hover:text-sky-700"
                                >
                                  {client.fullName}
                                </Link>
                                {client.caseEasyImportContacts?.length ? <CaseEasyOriginBadge /> : null}
                              </div>
                              <p className="text-slate-500">{client.email || client.phone || "No contact on file"}</p>
                              <p className="text-xs text-slate-400">{client.fileNumber}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <span className={`${pillClassName} bg-slate-100 text-slate-700`}>
                            {client.caseType}
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className={`${pillClassName} ${getStageStyles(client.stage)}`}>
                            {client.stage}
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span
                            className={`${pillClassName} ${
                              client.missingDocs
                                ? "bg-amber-50 text-amber-700"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {client.missingDocs ? `${client.missingDocs} missing` : "Complete"}
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className={`${pillClassName} ${getPaymentStyles(client.payment)}`}>
                            {client.payment}
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className={`${pillClassName} ${getActionStyles(client.nextAction)}`}>
                            {client.nextAction}
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          {canReassignClients ? (
                            <div className="relative inline-flex max-w-[190px] items-center rounded-full border border-slate-200/90 bg-white shadow-sm transition hover:border-sky-200 hover:shadow-md focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100">
                              <span className="pointer-events-none ml-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-sky-700 text-[10px] font-bold text-white shadow-sm">
                                {getInitials(client.assignedName)}
                              </span>
                              <select
                                aria-label={`Assign ${client.fullName} to a consultant`}
                                value={client.assignedUser?.id || ""}
                                onChange={(event) =>
                                  handleDirectoryAssignment(client, event.target.value)
                                }
                                disabled={assigningClientIds.includes(client.id)}
                                className="h-9 min-w-0 max-w-[150px] appearance-none rounded-full bg-transparent py-0 pl-2 pr-8 text-xs font-semibold text-slate-700 outline-none disabled:cursor-wait disabled:text-slate-400"
                              >
                                <option value="">Unassigned</option>
                                {client.assignedUser?.id &&
                                !users.some(
                                  (user) => user.id === client.assignedUser.id,
                                ) ? (
                                  <option value={client.assignedUser.id}>
                                    {client.assignedUser.fullName}
                                  </option>
                                ) : null}
                                {users
                                  .filter(
                                    (user) =>
                                      ["admin", "consultant"].includes(user.role) ||
                                      user.id === client.assignedUser?.id,
                                  )
                                  .map((user) => (
                                    <option key={user.id} value={user.id}>
                                      {user.fullName}
                                    </option>
                                  ))}
                              </select>
                              {assigningClientIds.includes(client.id) ? (
                                <Loader2 className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 animate-spin text-sky-600" />
                              ) : (
                                <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
                              )}
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-1.5 py-1 pr-3 shadow-sm">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                                {getInitials(client.assignedName)}
                              </div>
                              <span className="max-w-[130px] truncate text-xs font-semibold text-slate-700">
                                {client.assignedName}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-5 font-medium text-slate-600">{client.lastUpdatedLabel}</td>
                        <td className="px-6 py-5">
                          <div className="flex items-center justify-end">
                            <ClientActionsMenu
                              client={client}
                              isOpen={activeActionMenuId === client.id}
                              onToggle={setActiveActionMenuId}
                              onEdit={openEditForm}
                              onDelete={handleDelete}
                              deletingId={deletingId}
                              canManage={canManageClients}
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
                {filteredClients.map((client) => (
                  <ClientsMobileCard
                    key={client.id}
                    client={client}
                    onEdit={openEditForm}
                    onDelete={handleDelete}
                    onToggleMenu={setActiveActionMenuId}
                    isMenuOpen={activeActionMenuId === client.id}
                    deletingId={deletingId}
                    canManage={canManageClients}
                  />
                ))}
              </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <Users className="h-7 w-7" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-900">No clients found</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Add your first client or adjust your filters to see results.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-slate-900 via-sky-900 to-sky-700 px-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(2,132,199,0.22)]"
                >
                  <Plus className="h-4 w-4" />
                  Add Client
                </button>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600"
                >
                  <FilterX className="h-4 w-4" />
                  Clear Filters
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {showForm ? (
        <ClientDrawer
          formState={formState}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          onCancel={resetForm}
          saving={saving}
          formError={formError}
          users={users}
          isEditing={isEditing}
          closing={drawerClosing}
          showFrontDeskActions={role === "frontdesk" && !isEditing}
          frontDeskIntake={frontDeskIntake}
          onFrontDeskIntakeChange={(patch) => setFrontDeskIntake((current) => ({ ...current, ...patch }))}
          canRecordProfessionalFee={canRecordProfessionalFee}
          nameNeedsReview={Boolean(isEditing && clientNameParts(editingClient).needsReview)}
          contactMatches={contactMatches}
          caseEasyMatches={caseEasyMatches}
          checkingContact={checkingContact}
          onOpenExistingClient={(client) => leaveClientIntake(`/app/clients/${client.id}`)}
          onBookExistingClient={(client) => leaveClientIntake(`/app/calendar?bookForClient=${encodeURIComponent(client.id)}`)}
          onImportCaseEasyContact={importCaseEasyContact}
          importingCaseEasyId={importingCaseEasyId}
          dobError={dobError}
          onDobBlur={() => setDobError(dateOfBirthError(formState.dateOfBirth))}
        />
      ) : null}
    </section>
  );
}
