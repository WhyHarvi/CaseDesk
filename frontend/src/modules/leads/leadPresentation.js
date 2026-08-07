export const LEAD_STATUSES = ["OPEN", "CONVERTED", "LOST", "NURTURE", "DUPLICATE", "DO_NOT_CONTACT", "ARCHIVED"];
export const LEAD_STAGES = ["NEW", "ASSIGNED", "CONTACTING", "CONNECTED", "QUALIFIED", "CONSULTATION_BOOKED", "CONSULTATION_COMPLETED", "RETAINER_PENDING", "PAYMENT_PENDING", "READY_TO_CONVERT"];
export const LEAD_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

export function humanize(value) {
  if (!value) return "—";
  return String(value).toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function leadName(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unnamed lead";
}

export function initials(lead) {
  return [lead.firstName, lead.lastName].filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "LD";
}

export function formatDueDate(value) {
  if (!value) return { label: "No date", overdue: false };
  const date = new Date(value);
  const overdue = date.getTime() < Date.now();
  return {
    label: new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date),
    overdue,
  };
}

export const statusTone = {
  OPEN: "bg-brand-50 text-brand-700 ring-brand-200",
  CONVERTED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  LOST: "bg-rose-50 text-rose-700 ring-rose-100",
  NURTURE: "bg-amber-50 text-amber-700 ring-amber-100",
  DUPLICATE: "bg-violet-50 text-violet-700 ring-violet-100",
  DO_NOT_CONTACT: "bg-slate-100 text-slate-600 ring-slate-200",
  ARCHIVED: "bg-slate-100 text-slate-500 ring-slate-200",
};

// Mirrors the exact readiness check convertLead() uses server-side
// (backend/src/modules/leads/lead.service.js) so the UI never shows a
// "Convert to client" button the backend would reject.
export const RETAINER_READY_VALUES = ["SIGNED", "NOT_REQUIRED"];
export const PAYMENT_READY_VALUES = ["PAID", "WAIVED"];

export function isLeadReadyToConvert(lead) {
  return lead.stage === "READY_TO_CONVERT"
    && RETAINER_READY_VALUES.includes(lead.retainerStatus)
    && PAYMENT_READY_VALUES.includes(lead.initialPaymentStatus);
}

export const retainerStatusTone = {
  NOT_REQUIRED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  NOT_PREPARED: "bg-amber-50 text-amber-700 ring-amber-100",
  PREPARED: "bg-amber-50 text-amber-700 ring-amber-100",
  SENT: "bg-sky-50 text-sky-700 ring-sky-100",
  VIEWED: "bg-sky-50 text-sky-700 ring-sky-100",
  SIGNED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  DECLINED: "bg-rose-50 text-rose-700 ring-rose-100",
  EXPIRED: "bg-rose-50 text-rose-700 ring-rose-100",
};

export const paymentStatusTone = {
  NOT_REQUESTED: "bg-amber-50 text-amber-700 ring-amber-100",
  REQUESTED: "bg-sky-50 text-sky-700 ring-sky-100",
  PARTIAL: "bg-sky-50 text-sky-700 ring-sky-100",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  FAILED: "bg-rose-50 text-rose-700 ring-rose-100",
  REFUNDED: "bg-rose-50 text-rose-700 ring-rose-100",
  WAIVED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};
