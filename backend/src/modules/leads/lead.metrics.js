export const INVALID_CONVERSION_STATUSES = ["DUPLICATE", "ARCHIVED"];
export const DEFAULT_INACTIVE_LEAD_DAYS = 3;

function partsAt(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function zonedMidnight(year, month, day, timezone) {
  const nominal = new Date(Date.UTC(year, month - 1, day));
  const local = partsAt(nominal, timezone);
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - nominal.getTime();
  return new Date(nominal.getTime() - offset);
}

function addCalendarDays({ year, month, day }, amount) {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function reportingBounds(now = new Date(), timezone = "America/Toronto") {
  const local = partsAt(now, timezone);
  const calendar = { year: local.year, month: local.month, day: local.day };
  const tomorrow = addCalendarDays(calendar, 1);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const weekCalendar = addCalendarDays(calendar, mondayOffset);
  return {
    todayStart: zonedMidnight(calendar.year, calendar.month, calendar.day, timezone),
    tomorrowStart: zonedMidnight(tomorrow.year, tomorrow.month, tomorrow.day, timezone),
    weekStart: zonedMidnight(weekCalendar.year, weekCalendar.month, weekCalendar.day, timezone),
  };
}

export function conversionRate(converted, validTotal) {
  return validTotal > 0 ? Math.round((converted / validTotal) * 1000) / 10 : 0;
}

export const FUNNEL_STEPS = [
  "RECEIVED",
  "CONTACTED",
  "CONNECTED",
  "QUALIFIED",
  "CONSULTATION_BOOKED",
  "CONSULTATION_COMPLETED",
  "RETAINER_PENDING",
  "PAYMENT_PENDING",
  "CONVERTED",
];

export function buildFunnel(counts) {
  const received = counts.RECEIVED || 0;
  return FUNNEL_STEPS.map((step, index) => {
    const count = counts[step] || 0;
    const previousCount = index ? counts[FUNNEL_STEPS[index - 1]] || 0 : count;
    return {
      step,
      count,
      shareOfReceived: conversionRate(count, received),
      dropOffFromPrevious: index ? Math.max(previousCount - count, 0) : 0,
    };
  });
}

export function parseReportDays(value) {
  if (value === "all") return null;
  const days = Number(value || 30);
  return [7, 30, 90, 365].includes(days) ? days : 30;
}
