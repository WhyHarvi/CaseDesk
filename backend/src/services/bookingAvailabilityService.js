import prisma from "./prisma/client.js";
import { generatePublicBookingSlug } from "./bookingPublicLinkService.js";
import { createHttpError } from "../utils/http.js";

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
  const publicSlug = await generatePublicBookingSlug(agencyId);
  const [settings] = await Promise.all([
    prisma.bookingSettings.create({ data: { agencyId, publicSlug, workingHours: DEFAULT_WORKING_HOURS } }),
    // Never leave a fresh workspace with nothing bookable
    prisma.bookingSessionType.count({ where: { agencyId } }).then((count) =>
      count === 0
        ? prisma.bookingSessionType.create({ data: { agencyId, name: "Initial Consultation", durationMinutes: 30 } })
        : null,
    ),
  ]);
  return settings;
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
export function localDateTimeToUtc(dateKey, minutes, timezone) {
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

export function validateAvailabilityRange(fromKey, toKey, maximumDays = 62) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
    throw createHttpError(400, "Availability dates must use YYYY-MM-DD.", "VALIDATION_ERROR");
  }
  const from = new Date(`${fromKey}T00:00:00.000Z`);
  const to = new Date(`${toKey}T00:00:00.000Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0 || days > maximumDays) {
    throw createHttpError(400, `Availability range must be between 0 and ${maximumDays} days.`, "VALIDATION_ERROR");
  }
}

function localWeekday(dateKey, timezone) {
  const noonUtc = localDateTimeToUtc(dateKey, 12 * 60, timezone);
  const name = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short" }).format(noonUtc);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function mergeStaffAvailability(assignedToIds, staffSlots) {
  const combined = new Map();
  staffSlots.forEach((slots, index) => slots.forEach((slot) => {
    const current = combined.get(slot.startsAt) || { ...slot, capacity: 0, staffIds: [] };
    current.capacity += 1;
    current.staffIds.push(assignedToIds[index]);
    combined.set(slot.startsAt, current);
  }));
  return [...combined.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function expandedSchedulingBlocks(blocks, rangeStart, rangeEnd) {
  const expanded = [];
  for (const block of blocks) {
    const duration = new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime();
    const step = block.recurrence === "DAILY" ? 86_400_000 : block.recurrence === "WEEKLY" ? 7 * 86_400_000 : null;
    if (!step) {
      if (new Date(block.startsAt) < rangeEnd && new Date(block.endsAt) > rangeStart) expanded.push({ ...block, assignedToId: block.userId });
      continue;
    }
    const limit = block.recurrenceUntil ? Math.min(new Date(block.recurrenceUntil).getTime(), rangeEnd.getTime()) : rangeEnd.getTime();
    let start = new Date(block.startsAt).getTime();
    if (start + duration <= rangeStart.getTime()) start += Math.max(0, Math.floor((rangeStart.getTime() - start - duration) / step)) * step;
    for (; start < limit; start += step) {
      const end = start + duration;
      if (end > rangeStart.getTime()) expanded.push({ userId: block.userId, assignedToId: block.userId, startsAt: new Date(start), endsAt: new Date(end) });
    }
  }
  return expanded;
}

function effectiveStaffSettings(settings, preference, sessionBufferMinutes) {
  const personalDaysOff = Array.isArray(preference?.daysOff) ? preference.daysOff : [];
  return {
    ...settings,
    timezone: preference?.timezone || settings.timezone,
    workingHours: Array.isArray(preference?.workingHours) && preference.workingHours.length ? preference.workingHours : settings.workingHours,
    daysOff: [...new Set([...(Array.isArray(settings.daysOff) ? settings.daysOff : []), ...personalDaysOff])],
    bufferMinutes: sessionBufferMinutes ?? preference?.bufferMinutes ?? settings.bufferMinutes,
  };
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
export async function availabilityForRange({ agencyId, assignedToId, assignedToIds = null, durationMinutes, fromKey, toKey, now = new Date(), excludeAppointmentId = null, excludeAppointmentIds = null, sessionBufferMinutes = null, excludeHoldToken = null, excludePaymentHoldId = null, minNoticeOverrideMinutes = null }) {
  validateAvailabilityRange(fromKey, toKey);
  const pooled = Array.isArray(assignedToIds);
  const settings = await getOrCreateBookingSettings(agencyId);
  const timezone = settings.timezone || "America/Toronto";
  // minNoticeMinutes is a *public* self-service policy (don't let strangers
  // book with less than N hours' notice online) — staff booking directly
  // from the internal Appointments tab aren't subject to it, so callers
  // there pass minNoticeOverrideMinutes: 0 to still block past slots but
  // allow same-day/right-now bookings.
  const baseSettings = minNoticeOverrideMinutes != null ? { ...settings, minNoticeMinutes: minNoticeOverrideMinutes } : settings;
  const rangeStart = localDateTimeToUtc(fromKey, 0, timezone);
  const rangeEnd = localDateTimeToUtc(toKey, 24 * 60, timezone);
  const staffIds = assignedToId ? [assignedToId] : pooled ? assignedToIds : [];
  const [busyAppointments, preferences, rawBlocks, activeHolds, activePaymentHolds] = await Promise.all([prisma.appointment.findMany({
    where: {
      agencyId,
      status: "Scheduled",
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      ...(assignedToId ? { assignedToId } : pooled ? { assignedToId: { in: assignedToIds } } : {}),
      ...(excludeAppointmentIds?.length ? { id: { notIn: excludeAppointmentIds } } : excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { startsAt: true, endsAt: true, assignedToId: true },
  }), staffIds.length ? prisma.schedulingStaffPreference.findMany({
    where: { agencyId, userId: { in: staffIds } },
    select: { userId: true, maxDailyAppointments: true, timezone: true, workingHours: true, daysOff: true, bufferMinutes: true },
  }) : [], staffIds.length ? prisma.schedulingBlock.findMany({
    where: { agencyId, userId: { in: staffIds }, startsAt: { lt: rangeEnd }, OR: [{ recurrence: null }, { recurrenceUntil: null }, { recurrenceUntil: { gt: rangeStart } }] },
    select: { userId: true, startsAt: true, endsAt: true, recurrence: true, recurrenceUntil: true },
  }) : [], staffIds.length && prisma.bookingSlotHold ? prisma.bookingSlotHold.findMany({
    where: { agencyId, assignedToId: { in: staffIds }, claimedAt: null, expiresAt: { gt: now }, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart }, ...(excludeHoldToken ? { claimToken: { not: excludeHoldToken } } : {}) },
    select: { assignedToId: true, startsAt: true, endsAt: true },
  }) : [], staffIds.length && prisma.bookingPaymentHold ? prisma.bookingPaymentHold.findMany({
    where: { agencyId, assignedToId: { in: staffIds }, status: "AwaitingPayment", expiresAt: { gt: now }, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart }, ...(excludePaymentHoldId ? { id: { not: excludePaymentHoldId } } : {}) },
    select: { assignedToId: true, startsAt: true, endsAt: true },
  }) : []]);
  const busy = [...busyAppointments, ...activeHolds, ...activePaymentHolds, ...expandedSchedulingBlocks(rawBlocks, rangeStart, rangeEnd)];
  const preferenceByStaff = new Map(preferences.map((item) => [item.userId, item]));
  const staffLimits = new Map(preferences.map((item) => [item.userId, item.maxDailyAppointments]));

  const days = {};
  for (let cursor = rangeStart.getTime(); cursor < rangeEnd.getTime(); cursor += 24 * 60 * 60_000) {
    const dateKey = localDateKey(new Date(cursor + 12 * 60 * 60_000), timezone);
    if (days[dateKey]) continue;
    if (!pooled) {
      const effective = assignedToId ? effectiveStaffSettings(baseSettings, preferenceByStaff.get(assignedToId), sessionBufferMinutes) : { ...baseSettings, bufferMinutes: sessionBufferMinutes ?? baseSettings.bufferMinutes };
      days[dateKey] = slotsForDay({ settings: effective, dateKey, durationMinutes, busy, now });
      continue;
    }
    const staffSlots = assignedToIds.map((staffId) => {
      const dailyMaximum = staffLimits.get(staffId);
      const dailyCount = busyAppointments.filter((item) => item.assignedToId === staffId && localDateKey(new Date(item.startsAt), timezone) === dateKey).length;
      if (dailyMaximum != null && dailyCount >= dailyMaximum) return [];
      return slotsForDay({
      settings: effectiveStaffSettings(baseSettings, preferenceByStaff.get(staffId), sessionBufferMinutes),
      dateKey,
      durationMinutes,
      busy: busy.filter((item) => item.assignedToId === staffId),
      now,
      });
    });
    days[dateKey] = mergeStaffAvailability(assignedToIds, staffSlots);
  }
  return { settings, days };
}

/**
 * Validate that a concrete start/end is still open (used at create time inside a transaction).
 */
export async function assertSlotAvailable(tx, { agencyId, assignedToId, startsAt, endsAt, bufferMinutes = 0, excludeAppointmentId = null, excludeAppointmentIds = null, excludeHoldToken = null, excludePaymentHoldId = null }) {
  const buffer = bufferMinutes * 60_000;
  const conflict = await tx.appointment.findFirst({
    where: {
      agencyId,
      status: "Scheduled",
      ...(assignedToId ? { assignedToId } : {}),
      ...(excludeAppointmentIds?.length ? { id: { notIn: excludeAppointmentIds } } : excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) },
      endsAt: { gt: new Date(new Date(startsAt).getTime() - buffer) },
    },
    select: { id: true, startsAt: true },
  });
  if (conflict || !assignedToId) return conflict;
  if (tx.bookingSlotHold) {
    const hold = await tx.bookingSlotHold.findFirst({ where: { agencyId, assignedToId, claimedAt: null, expiresAt: { gt: new Date() }, startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) }, endsAt: { gt: new Date(new Date(startsAt).getTime() - buffer) }, ...(excludeHoldToken ? { claimToken: { not: excludeHoldToken } } : {}) }, select: { id: true, startsAt: true } });
    if (hold) return hold;
  }
  if (tx.bookingPaymentHold) {
    const paymentHold = await tx.bookingPaymentHold.findFirst({ where: { agencyId, assignedToId, status: "AwaitingPayment", expiresAt: { gt: new Date() }, startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) }, endsAt: { gt: new Date(new Date(startsAt).getTime() - buffer) }, ...(excludePaymentHoldId ? { id: { not: excludePaymentHoldId } } : {}) }, select: { id: true, startsAt: true } });
    if (paymentHold) return paymentHold;
  }
  if (!tx.schedulingBlock) return null;
  const blockRows = await tx.schedulingBlock.findMany({
    where: {
      agencyId,
      userId: assignedToId,
      startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) },
      OR: [{ recurrence: null }, { recurrenceUntil: null }, { recurrenceUntil: { gt: new Date(new Date(startsAt).getTime() - buffer) } }],
    },
    select: { id: true, userId: true, startsAt: true, endsAt: true, recurrence: true, recurrenceUntil: true },
  });
  const expanded = expandedSchedulingBlocks(blockRows, new Date(new Date(startsAt).getTime() - buffer), new Date(new Date(endsAt).getTime() + buffer));
  return expanded.find((block) => overlaps(new Date(startsAt).getTime(), new Date(endsAt).getTime(), new Date(block.startsAt).getTime() - buffer, new Date(block.endsAt).getTime() + buffer)) || null;
}
