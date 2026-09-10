const activeStatuses = new Set(["SCHEDULED", "CONFIRMED"]);

const terminalStates = {
  COMPLETED: {
    label: "Completed",
    description: "The consultation outcome has been recorded.",
    badgeClass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  CANCELLED: {
    label: "Cancelled",
    description: "This consultation was cancelled.",
    badgeClass: "bg-rose-50 text-rose-700 ring-rose-200",
  },
  NO_SHOW: {
    label: "No-show",
    description: "The lead did not attend the consultation.",
    badgeClass: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  RESCHEDULED: {
    label: "Rescheduled",
    description: "This time was replaced by a new consultation booking.",
    badgeClass: "bg-violet-50 text-violet-700 ring-violet-200",
  },
};

const toMillis = (value) => {
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

export function consultationDisplayState(consultation, nowValue = new Date()) {
  const status = String(consultation?.status || "").toUpperCase();
  const startAt = toMillis(consultation?.startAt);
  const endAt = toMillis(consultation?.endAt);
  const now = toMillis(nowValue) ?? Date.now();

  // A future appointment has not happened, even if legacy data was
  // mistakenly saved as COMPLETED. Time wins here so the UI never tells a
  // staff member that an upcoming consultation is already finished.
  if (startAt !== null && startAt > now && !["CANCELLED", "RESCHEDULED"].includes(status)) {
    return {
      label: status === "CONFIRMED" ? "Confirmed · upcoming" : "Upcoming",
      description: status === "COMPLETED" || status === "NO_SHOW"
        ? "This consultation has not happened yet; its saved outcome is inconsistent."
        : "This consultation has not happened yet.",
      timingPrefix: "Starts",
      canRecordOutcome: false,
      badgeClass: "bg-blue-50 text-[#002FA7] ring-blue-200",
    };
  }

  if (terminalStates[status]) {
    return {
      ...terminalStates[status],
      timingPrefix: "Scheduled for",
      canRecordOutcome: false,
    };
  }

  if (activeStatuses.has(status) && startAt !== null) {
    if (endAt !== null && endAt > now) {
      return {
        label: "In progress",
        description: "The consultation is currently within its scheduled time.",
        timingPrefix: "Started",
        canRecordOutcome: true,
        badgeClass: "bg-cyan-50 text-cyan-800 ring-cyan-200",
      };
    }
    return {
      label: "Awaiting outcome",
      description: "The scheduled time has passed. Record an outcome to complete it.",
      timingPrefix: "Scheduled for",
      canRecordOutcome: true,
      badgeClass: "bg-amber-50 text-amber-800 ring-amber-200",
    };
  }

  return {
    label: status ? status.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "Status unavailable",
    description: "Review this consultation for its latest status.",
    timingPrefix: "Scheduled for",
    canRecordOutcome: false,
    badgeClass: "bg-slate-100 text-slate-600 ring-slate-200",
  };
}

export function featuredConsultation(consultations = [], nowValue = new Date()) {
  const now = toMillis(nowValue) ?? Date.now();
  const records = consultations.filter((item) => toMillis(item?.startAt) !== null);
  const active = records.filter((item) => activeStatuses.has(String(item.status || "").toUpperCase()));
  const current = active
    .filter((item) => toMillis(item.startAt) <= now && (toMillis(item.endAt) ?? toMillis(item.startAt)) > now)
    .sort((left, right) => toMillis(left.startAt) - toMillis(right.startAt));
  const upcoming = records
    .filter((item) => toMillis(item.startAt) > now && !["CANCELLED", "RESCHEDULED"].includes(String(item.status || "").toUpperCase()))
    .sort((left, right) => toMillis(left.startAt) - toMillis(right.startAt));
  const awaitingOutcome = active
    .filter((item) => (toMillis(item.endAt) ?? toMillis(item.startAt)) <= now)
    .sort((left, right) => toMillis(right.startAt) - toMillis(left.startAt));

  return current[0]
    || upcoming[0]
    || awaitingOutcome[0]
    || [...records].sort((left, right) => toMillis(right.startAt) - toMillis(left.startAt))[0]
    || null;
}
