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
