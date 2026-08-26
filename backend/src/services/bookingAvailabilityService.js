import prisma from "./prisma/client.js";
import { generatePublicBookingSlug } from "./bookingPublicLinkService.js";
import { createHttpError } from "../utils/http.js";
import { meetingModesInSameCapacityGroup } from "./bookingMeetingModeService.js";

export const DEFAULT_WORKING_HOURS = [
  { day: 1, enabled: true, start: "09:00", end: "17:00" },
  { day: 2, enabled: true, start: "09:00", end: "17:00" },
  { day: 3, enabled: true, start: "09:00", end: "17:00" },
  { day: 4, enabled: true, start: "09:00", end: "17:00" },
  { day: 5, enabled: true, start: "09:00", end: "17:00" },
  { day: 6, enabled: false, start: "10:00", end: "14:00" },
  { day: 0, enabled: false, start: "10:00", end: "14:00" },
];

const INTERNAL_ROLES_ALLOWED_TO_BOOK_PAST = new Set(["admin", "frontdesk"]);

export function canBookPastInternalSlot(role) {
  return INTERNAL_ROLES_ALLOWED_TO_BOOK_PAST.has(role);
}

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

function dateKeyDayNumber(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function addDateKeyDays(dateKey, amount) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function localTimeParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { minutes: value("hour") * 60 + value("minute") };
}

export function parseSchedulingBlockDateTime(value, timezone) {
  const text = String(value || "").trim();
  const localMatch = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/.exec(text);
  if (localMatch) {
    return localDateTimeToUtc(localMatch[1], Number(localMatch[2]) * 60 + Number(localMatch[3]), timezone);
  }
  return new Date(text);
}

export function schedulingBlockRecurrenceEnd(dateKey, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return new Date(Number.NaN);
  return localDateTimeToUtc(addDateKeyDays(String(dateKey), 1), 0, timezone);
}

export function schedulingBlockRecurrenceDays(startsAt, recurrenceUntilKey, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(recurrenceUntilKey || ""))) return Number.NaN;
  return dateKeyDayNumber(String(recurrenceUntilKey)) - dateKeyDayNumber(localDateKey(startsAt, timezone));
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

export function expandedSchedulingBlocks(blocks, rangeStart, rangeEnd, timezoneForBlock = "America/Toronto") {
  const expanded = [];
  for (const block of blocks) {
    const blockStart = new Date(block.startsAt);
    const blockEnd = new Date(block.endsAt);
    const stepDays = block.recurrence === "DAILY" ? 1 : block.recurrence === "WEEKLY" ? 7 : null;
    if (!stepDays) {
      if (new Date(block.startsAt) < rangeEnd && new Date(block.endsAt) > rangeStart) expanded.push({ ...block, assignedToId: block.userId });
      continue;
    }
    const timezone = typeof timezoneForBlock === "function" ? timezoneForBlock(block) : timezoneForBlock;
    const anchorDateKey = localDateKey(blockStart, timezone);
    const endDateKey = localDateKey(blockEnd, timezone);
    const startMinutes = localTimeParts(blockStart, timezone).minutes;
    const endMinutes = localTimeParts(blockEnd, timezone).minutes;
    const endDayOffset = Math.max(0, dateKeyDayNumber(endDateKey) - dateKeyDayNumber(anchorDateKey));
    const rangeStartKey = localDateKey(rangeStart, timezone);
    const daysFromAnchor = dateKeyDayNumber(rangeStartKey) - dateKeyDayNumber(anchorDateKey);
    let occurrenceIndex = Math.max(0, Math.floor(daysFromAnchor / stepDays) - 1);
    const finalOccurrenceIndex = occurrenceIndex + 370;
    const recurrenceLimit = block.recurrenceUntil ? new Date(block.recurrenceUntil).getTime() : rangeEnd.getTime();
    for (; occurrenceIndex <= finalOccurrenceIndex; occurrenceIndex += 1) {
      const occurrenceDateKey = addDateKeyDays(anchorDateKey, occurrenceIndex * stepDays);
      const start = localDateTimeToUtc(occurrenceDateKey, startMinutes, timezone);
      if (start.getTime() >= recurrenceLimit || start >= rangeEnd) break;
      const end = localDateTimeToUtc(addDateKeyDays(occurrenceDateKey, endDayOffset), endMinutes, timezone);
      if (end > rangeStart) {
        expanded.push({ userId: block.userId, assignedToId: block.userId, startsAt: start, endsAt: end });
      }
    }
  }
  return expanded;
}

function formatMinutes(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function intersectWorkingHours(baseHours, staffHours) {
  if (!Array.isArray(staffHours) || !staffHours.length) return baseHours;
  const normalizedBaseHours = Array.isArray(baseHours) && baseHours.length ? baseHours : DEFAULT_WORKING_HOURS;
  return Array.from({ length: 7 }, (_, day) => {
    const base = normalizedBaseHours.find((rule) => Number(rule.day) === day);
    const staff = staffHours.find((rule) => Number(rule.day) === day);
    if (!base?.enabled || !staff?.enabled) {
      return {
        day,
        enabled: false,
        start: base?.start || staff?.start || "09:00",
        end: base?.end || staff?.end || "17:00",
      };
    }
    const start = Math.max(minutesOf(base.start), minutesOf(staff.start));
    const end = Math.min(minutesOf(base.end), minutesOf(staff.end));
    return {
      day,
      enabled: end > start,
      start: formatMinutes(start),
      end: formatMinutes(end),
    };
  });
}

function effectiveStaffSettings(settings, preference, sessionBufferMinutes, constrainWorkingHours = false) {
  const personalDaysOff = Array.isArray(preference?.daysOff) ? preference.daysOff : [];
  const personalHours = Array.isArray(preference?.workingHours) && preference.workingHours.length
    ? preference.workingHours
    : null;
  return {
    ...settings,
    timezone: preference?.timezone || settings.timezone,
    workingHours: constrainWorkingHours && personalHours
      ? intersectWorkingHours(settings.workingHours, personalHours)
      : personalHours || settings.workingHours,
    daysOff: [...new Set([...(Array.isArray(settings.daysOff) ? settings.daysOff : []), ...personalDaysOff])],
    bufferMinutes: sessionBufferMinutes ?? preference?.bufferMinutes ?? settings.bufferMinutes,
  };
}

/**
 * Compute open slots for one local calendar day.
 *
 * settings: BookingSettings row. durationMinutes: session length.
 * busy: [{ startsAt, endsAt }] existing appointments for the target staff member.
 * Returns [{ startsAt, endsAt }] in UTC, stepped every 30 minutes by default.
 */
export function slotsForDay({ settings, dateKey, durationMinutes, busy, now = new Date(), stepMinutes = 30, ignorePastCutoff = false }) {
  const timezone = settings.timezone || "America/Toronto";
  const workingHours = Array.isArray(settings.workingHours) && settings.workingHours.length ? settings.workingHours : DEFAULT_WORKING_HOURS;
  const daysOff = Array.isArray(settings.daysOff) ? settings.daysOff : [];
  if (daysOff.includes(dateKey)) return [];

  const weekday = localWeekday(dateKey, timezone);
  const dayRule = workingHours.find((rule) => Number(rule.day) === weekday);
  if (!dayRule || !dayRule.enabled) return [];

  const windowStart = localDateTimeToUtc(dateKey, minutesOf(dayRule.start), timezone).getTime();
  const windowEnd = localDateTimeToUtc(dateKey, minutesOf(dayRule.end), timezone).getTime();
  // Frontdesk wants to see (and log) the whole day's grid, including slots
  // earlier today that have already passed — e.g. entering a walk-in after
  // the fact. Everyone else still gets the normal "nothing before now" cutoff.
  const earliest = ignorePastCutoff ? windowStart : now.getTime() + (settings.minNoticeMinutes || 0) * 60_000;
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
export async function availabilityForRange({ agencyId, assignedToId, assignedToIds = null, durationMinutes, fromKey, toKey, now = new Date(), excludeAppointmentId = null, excludeAppointmentIds = null, sessionBufferMinutes = null, excludeHoldToken = null, excludePaymentHoldId = null, minNoticeOverrideMinutes = null, locationId = null, meetingMode = null, ignorePastCutoff = false, ignoreLocationClosure = false }) {
  validateAvailabilityRange(fromKey, toKey);
  const pooled = Array.isArray(assignedToIds);
  const settings = await getOrCreateBookingSettings(agencyId);
  const timezone = settings.timezone || "America/Toronto";
  // minNoticeMinutes is a *public* self-service policy (don't let strangers
  // book with less than N hours' notice online) — staff booking directly
  // from the internal Appointments tab aren't subject to it, so callers
  // there pass minNoticeOverrideMinutes: 0 to still block past slots but
  // allow same-day/right-now bookings.
  // A location with its own hours (e.g. a satellite office open fewer
  // days than HQ) narrows the agency default before staff-level
  // preferences are layered on top in effectiveStaffSettings — same
  // override pattern, one more layer. A day the office's own hours mark
  // closed still has a real person walking in the door sometimes — staff
  // booking that visit passes ignoreLocationClosure so the office's
  // narrower hours are skipped entirely and the agency default schedule
  // (still full-strength, same as any other day) applies instead. This
  // deliberately does NOT touch a specific staff member's own days off,
  // layered on separately in effectiveStaffSettings below — someone who is
  // genuinely away is still unavailable regardless of the office's hours.
  const location = locationId && Array.isArray(settings.locations) ? settings.locations.find((item) => item.id === locationId) : null;
  const baseSettings = {
    ...settings,
    ...(minNoticeOverrideMinutes != null ? { minNoticeMinutes: minNoticeOverrideMinutes } : {}),
    ...(location?.useCustomHours && !ignoreLocationClosure ? {
      workingHours: Array.isArray(location.workingHours) && location.workingHours.length ? location.workingHours : [],
      daysOff: [...new Set([...(Array.isArray(settings.daysOff) ? settings.daysOff : []), ...(Array.isArray(location.daysOff) ? location.daysOff : [])])],
    } : {}),
  };
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
    select: { startsAt: true, endsAt: true, assignedToId: true, meetingMode: true },
  }), staffIds.length ? prisma.schedulingStaffPreference.findMany({
    where: { agencyId, userId: { in: staffIds } },
    select: { userId: true, maxDailyAppointments: true, timezone: true, workingHours: true, daysOff: true, bufferMinutes: true },
  }) : [], staffIds.length ? prisma.schedulingBlock.findMany({
    where: { agencyId, userId: { in: staffIds }, startsAt: { lt: rangeEnd }, OR: [{ recurrence: null }, { recurrenceUntil: null }, { recurrenceUntil: { gt: rangeStart } }] },
    select: { userId: true, startsAt: true, endsAt: true, recurrence: true, recurrenceUntil: true },
  }) : [], staffIds.length && prisma.bookingSlotHold ? prisma.bookingSlotHold.findMany({
    where: { agencyId, assignedToId: { in: staffIds }, claimedAt: null, expiresAt: { gt: now }, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart }, ...(excludeHoldToken ? { claimToken: { not: excludeHoldToken } } : {}) },
    select: { assignedToId: true, startsAt: true, endsAt: true, waitlistEntry: { select: { meetingMode: true } } },
  }) : [], staffIds.length && prisma.bookingPaymentHold ? prisma.bookingPaymentHold.findMany({
    // A confirmation worker atomically moves a paid hold to Confirming
    // before it creates the Appointment. That short-lived state must keep
    // reserving the seat or another request can take a slot that is already
    // paid for.
    where: {
      agencyId,
      assignedToId: { in: staffIds },
      // A walk-in e-transfer hold is linked to an Appointment that already
      // consumes this seat. Only pre-appointment checkout holds belong here.
      appointmentId: null,
      OR: [{ status: "AwaitingPayment", expiresAt: { gt: now } }, { status: "Confirming" }],
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      ...(excludePaymentHoldId ? { id: { not: excludePaymentHoldId } } : {}),
    },
    select: { assignedToId: true, startsAt: true, endsAt: true, meetingMode: true },
  }) : []]);
  const preferenceByStaff = new Map(preferences.map((item) => [item.userId, item]));
  // BookingSlotHold has no meetingMode column of its own — it comes from
  // the waitlist entry it's offering. Flattened here so every busy entry
  // exposes the same shape regardless of source.
  const flattenedHolds = activeHolds.map((hold) => ({ ...hold, meetingMode: hold.waitlistEntry?.meetingMode || null }));
  const busy = [
    ...busyAppointments,
    ...flattenedHolds,
    ...activePaymentHolds,
    ...expandedSchedulingBlocks(
      rawBlocks,
      rangeStart,
      rangeEnd,
      (block) => preferenceByStaff.get(block.userId)?.timezone || timezone,
    ),
  ];
  // Every appointment format consumes the same consultant capacity. Entries
  // with no meeting mode (such as scheduling blocks) also block every format.
  const relevantBusy = meetingMode
    ? busy.filter((item) => !item.meetingMode || meetingModesInSameCapacityGroup(meetingMode).includes(item.meetingMode))
    : busy;
  const staffLimits = new Map(preferences.map((item) => [item.userId, item.maxDailyAppointments]));

  const days = {};
  for (let cursor = rangeStart.getTime(); cursor < rangeEnd.getTime(); cursor += 24 * 60 * 60_000) {
    const dateKey = localDateKey(new Date(cursor + 12 * 60 * 60_000), timezone);
    if (days[dateKey]) continue;
    if (!pooled) {
      const effective = assignedToId
        ? effectiveStaffSettings(baseSettings, preferenceByStaff.get(assignedToId), sessionBufferMinutes, Boolean(location?.useCustomHours))
        : { ...baseSettings, bufferMinutes: sessionBufferMinutes ?? baseSettings.bufferMinutes };
      days[dateKey] = slotsForDay({ settings: effective, dateKey, durationMinutes, busy: relevantBusy, now, ignorePastCutoff });
      continue;
    }
    const staffSlots = assignedToIds.map((staffId) => {
      const dailyMaximum = staffLimits.get(staffId);
      // Active checkout and waitlist holds consume a real consultant seat,
      // including for max-daily limits. Otherwise several simultaneous
      // checkouts can all pass a limit of one and later become appointments.
      const dailyCount = new Set([...busyAppointments, ...activeHolds, ...activePaymentHolds]
        .filter((item) => item.assignedToId === staffId && localDateKey(new Date(item.startsAt), timezone) === dateKey)
        // One waitlist checkout is represented by both its offer hold and
        // payment hold until payment succeeds; it is still only one seat.
        .map((item) => `${new Date(item.startsAt).toISOString()}:${new Date(item.endsAt).toISOString()}`))
        .size;
      if (dailyMaximum != null && dailyCount >= dailyMaximum) return [];
      return slotsForDay({
      settings: effectiveStaffSettings(baseSettings, preferenceByStaff.get(staffId), sessionBufferMinutes, Boolean(location?.useCustomHours)),
      dateKey,
      durationMinutes,
      busy: relevantBusy.filter((item) => item.assignedToId === staffId),
      now,
      ignorePastCutoff,
      });
    });
    days[dateKey] = mergeStaffAvailability(assignedToIds, staffSlots);
  }
  return { settings, days };
}

/**
 * Validate that a concrete start/end is still open (used at create time inside a transaction).
 */
export async function assertSlotAvailable(tx, { agencyId, assignedToId, startsAt, endsAt, bufferMinutes = 0, excludeAppointmentId = null, excludeAppointmentIds = null, excludeHoldToken = null, excludePaymentHoldId = null, meetingMode = null }) {
  const buffer = bufferMinutes * 60_000;
  // Every appointment format consumes the same consultant capacity.
  // meetingMode remains optional for generic callers and scheduling blocks.
  const sameGroup = meetingMode ? { meetingMode: { in: meetingModesInSameCapacityGroup(meetingMode) } } : {};
  const conflict = await tx.appointment.findFirst({
    where: {
      agencyId,
      status: "Scheduled",
      ...(assignedToId ? { assignedToId } : {}),
      ...(excludeAppointmentIds?.length ? { id: { notIn: excludeAppointmentIds } } : excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) },
      endsAt: { gt: new Date(new Date(startsAt).getTime() - buffer) },
      ...sameGroup,
    },
    select: { id: true, startsAt: true },
  });
  if (conflict || !assignedToId) return conflict;
  if (tx.bookingSlotHold) {
    const hold = await tx.bookingSlotHold.findFirst({ where: { agencyId, assignedToId, claimedAt: null, expiresAt: { gt: new Date() }, startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) }, endsAt: { gt: new Date(new Date(startsAt).getTime() - buffer) }, ...(excludeHoldToken ? { claimToken: { not: excludeHoldToken } } : {}), ...(meetingMode ? { waitlistEntry: { meetingMode: { in: meetingModesInSameCapacityGroup(meetingMode) } } } : {}) }, select: { id: true, startsAt: true } });
    if (hold) return hold;
  }
  if (tx.bookingPaymentHold) {
    const paymentHold = await tx.bookingPaymentHold.findFirst({ where: { agencyId, assignedToId, appointmentId: null, OR: [{ status: "AwaitingPayment", expiresAt: { gt: new Date() } }, { status: "Confirming" }], startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) }, endsAt: { gt: new Date(new Date(startsAt).getTime() - buffer) }, ...(excludePaymentHoldId ? { id: { not: excludePaymentHoldId } } : {}), ...sameGroup }, select: { id: true, startsAt: true } });
    if (paymentHold) return paymentHold;
  }
  if (!tx.schedulingBlock) return null;
  const [blockRows, settings, preference] = await Promise.all([
    tx.schedulingBlock.findMany({
      where: {
        agencyId,
        userId: assignedToId,
        startsAt: { lt: new Date(new Date(endsAt).getTime() + buffer) },
        OR: [{ recurrence: null }, { recurrenceUntil: null }, { recurrenceUntil: { gt: new Date(new Date(startsAt).getTime() - buffer) } }],
      },
      select: { id: true, userId: true, startsAt: true, endsAt: true, recurrence: true, recurrenceUntil: true },
    }),
    tx.bookingSettings?.findUnique
      ? tx.bookingSettings.findUnique({ where: { agencyId }, select: { timezone: true } })
      : Promise.resolve(null),
    tx.schedulingStaffPreference?.findUnique
      ? tx.schedulingStaffPreference.findUnique({ where: { userId: assignedToId }, select: { timezone: true } })
      : Promise.resolve(null),
  ]);
  const blockTimezone = preference?.timezone || settings?.timezone || "America/Toronto";
  const expanded = expandedSchedulingBlocks(
    blockRows,
    new Date(new Date(startsAt).getTime() - buffer),
    new Date(new Date(endsAt).getTime() + buffer),
    blockTimezone,
  );
  return expanded.find((block) => overlaps(new Date(startsAt).getTime(), new Date(endsAt).getTime(), new Date(block.startsAt).getTime() - buffer, new Date(block.endsAt).getTime() + buffer)) || null;
}
