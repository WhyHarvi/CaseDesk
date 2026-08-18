export const caseOptionItems = [
  "Download application",
  "Applicants",
  "Manage Permissions",
  "E-Sign",
  "Archive",
  "Delete",
  "Close",
];

export function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function getStageStyles(stage) {
  const styles = {
    Lead: "bg-slate-100 text-slate-700",
    Consultation: "bg-sky-100 text-sky-700",
    "Retainer Pending": "bg-amber-100 text-amber-700",
    "Documents Pending": "bg-orange-100 text-orange-700",
    "Reviewing Documents": "bg-violet-100 text-violet-700",
    "Application Preparing": "bg-indigo-100 text-indigo-700",
    Submitted: "bg-emerald-100 text-emerald-700",
    "Decision Received": "bg-green-100 text-green-700",
    Closed: "bg-zinc-100 text-zinc-700",
  };

  return styles[stage] || "bg-slate-100 text-slate-700";
}

export function getPaymentStatusStyles(status) {
  if (status === "Paid") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "Partial") {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-rose-100 text-rose-700";
}

export function getInitials(name) {
  return (name || "Client")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function getWorkflowProgress(steps) {
  const activeSteps = steps.filter((step) => step.isActive !== false);
  const completedSteps = activeSteps.filter((step) => step.status === "Completed");

  return {
    activeSteps,
    completedCount: completedSteps.length,
    totalCount: activeSteps.length,
    percent: activeSteps.length ? Math.round((completedSteps.length / activeSteps.length) * 100) : 0,
  };
}

export function getWorkflowPriorityStyles(priority) {
  const styles = {
    Low: "bg-slate-100 text-slate-500",
    Normal: "bg-slate-100 text-slate-600",
    High: "bg-amber-50 text-amber-700",
    Urgent: "bg-rose-50 text-rose-700",
  };

  return styles[priority] || styles.Normal;
}
