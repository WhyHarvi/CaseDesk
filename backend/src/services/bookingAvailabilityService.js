import prisma from "./prisma/client.js";

export const DEFAULT_WORKING_HOURS = [
  { day: 1, enabled: true, start: "09:00", end: "17:00" },
  { day: 2, enabled: true, start: "09:00", end: "17:00" },
  { day: 3, enabled: true, start: "09:00", end: "17:00" },
  { day: 4, enabled: true, start: "09:00", end: "17:00" },
  { day: 5, enabled: true, start: "09:00", end: "17:00" },
  { day: 6, enabled: false, start: "10:00", end: "14:00" },
  { day: 0, enabled: false, start: "10:00", end: "14:00" },
];

export async function getOrCreateBookingSettings(agencyId) {
  const existing = await prisma.bookingSettings.findUnique({ where: { agencyId } });
  if (existing) return existing;
  return prisma.bookingSettings.create({
    data: { agencyId, workingHours: DEFAULT_WORKING_HOURS },
  });
}

function minutesOf(value) {
  const [hours, minutes] = String(value || "0:0").split(":").map(Number);
  return hours * 60 + minutes;
}

// What is the UTC offset (ms) of `timezone` at this instant?
function timezoneOffsetMs(date, timezone) {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const parts = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === "24" ? 0 : parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

// Convert a local wall-clock time on a given local date to a UTC Date.
function localDateTimeToUtc(dateKey, minutes, timezone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60));
  // Two-pass correction handles DST edges well enough for scheduling.
  const offset = timezoneOffsetMs(guess, timezone);
  const corrected = new Date(guess.getTime() - offset);
  return new Date(guess.getTime() - timezoneOffsetMs(corrected, timezone));
}

export function localDateKey(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function localWeekday(dateKey, timezone) {
  const noonUtc = localDateTimeToUtc(dateKey, 12 * 60, timezone);
  const name = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short" }).format(noonUtc);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Compute open slots for one local calendar day.
 *
 * settings: BookingSettings row. durationMinutes: session length.
 * busy: [{ startsAt, endsAt }] existing appointments for the target staff member.
 * Returns [{ startsAt, endsAt }] in UTC, stepped every 15 minutes.
 */
export function slotsForDay({ settings, dateKey, durationMinutes, busy, now = new Date(), stepMinutes = 15 }) {
  const timezone = settings.timezone || "America/Toronto";
  const workingHours = Array.isArray(settings.workingHours) && settings.workingHours.length ? settings.workingHours : DEFAULT_WORKING_HOURS;
  const daysOff = Array.isArray(settings.daysOff) ? settings.daysOff : [];
  if (daysOff.includes(dateKey)) return [];

  const weekday = localWeekday(dateKey, timezone);
  const dayRule = workingHours.find((rule) => Number(rule.day) === weekday);
  if (!dayRule || !dayRule.enabled) return [];

  const windowStart = localDateTimeToUtc(dateKey, minutesOf(dayRule.start), timezone).getTime();
  const windowEnd = localDateTimeToUtc(dateKey, minutesOf(dayRule.end), timezone).getTime();
  const earliest = now.getTime() + (settings.minNoticeMinutes || 0) * 60_000;
  const latest = now.getTime() + (settings.horizonDays || 30) * 24 * 60 * 60_000;
  const buffer = (settings.bufferMinutes || 0) * 60_000;
  const duration = durationMinutes * 60_000;

  const blocked = busy.map((item) => ({
    start: new Date(item.startsAt).getTime() - buffer,
    end: new Date(item.endsAt).getTime() + buffer,
  }));

  const slots = [];
  for (let start = windowStart; start + duration <= windowEnd; start += stepMinutes * 60_000) {
    const end = start + duration;
    if (start < earliest || start > latest) continue;
    if (blocked.some((block) => overlaps(start, end, block.start, block.end))) continue;
    slots.push({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
  }
  return slots;
}

/**
 * Availability for a staff member over a local date range (inclusive keys).
 */
export async function availabilityForRange({ agencyId, assignedToId, durationMinutes, fromKey, toKey, now = new Date() }) {
  const settings = await getOrCreateBookingSettings(agencyId);
  const timezone = settings.timezone || "America/Toronto";
  const rangeStart = localDateTimeToUtc(fromKey, 0, timezone);
  const rangeEnd = localDateTimeToUtc(toKey, 24 * 60, timezone);
  const busy = await prisma.appointment.findMany({
    where: {
      agencyId,
      status: "Scheduled",
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      ...(assignedToId ? { assignedToId } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });

  const days = {};
  for (let cursor = rangeStart.getTime(); cursor < rangeEnd.getTime(); cursor += 24 * 60 * 60_000) {
    const dateKey = localDateKey(new Date(cursor + 12 * 60 * 60_000), timezone);
    if (days[dateKey]) continue;
    days[dateKey] = slotsForDay({ settings, dateKey, durationMinutes, busy, now });
  }
  return { settings, days };
}

/**
 * Validate that a concrete start/end is still open (used at create time inside a transaction).
 */
export async function assertSlotAvailable(tx, { agencyId, assignedToId, startsAt, endsAt, bufferMinutes = 0, excludeAppointmentId = null }) {
  const buffer = bufferMinutes * 60_000;
  const conflict = await tx.appointment.findFirst({
    where: {
      agencyId,
      status: "Scheduled",
      ...(assignedToId ? { assignedToId } : {}),
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) },
      endsAt: { gt: new Date(new Date(startsAt).getTime() - buffer) },
    },
    select: { id: true, startsAt: true },
  });
  return conflict;
}
