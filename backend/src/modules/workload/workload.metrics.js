// Rolling-window periods, matching the existing "days" convention lead
// reports already use (getEmployeeReport's days filter) rather than
// calendar-aligned buckets — simple and consistent, not tied to a
// timezone-correct boundary the way real deadline logic needs to be.
export const WORKLOAD_PERIODS = { day: 1, week: 7, month: 30 };

// How many days out counts as "due soon" rather than merely "not yet
// overdue" — matches the fixed-threshold convention already used elsewhere
// in this codebase (e.g. REVIEW_OVERDUE_DAYS in adminConsultantController.js).
export const DUE_SOON_DAYS = 3;

export function parseWorkloadPeriod(value) {
  return Object.hasOwn(WORKLOAD_PERIODS, value) ? value : "week";
}

export function workloadPeriodBounds(period, now = new Date()) {
  const days = WORKLOAD_PERIODS[parseWorkloadPeriod(period)];
  return { from: new Date(now.getTime() - days * 24 * 60 * 60_000), to: now };
}
