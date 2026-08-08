import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { assertSlotAvailable, localDateKey, localDateTimeToUtc } from "./bookingAvailabilityService.js";
import { meetingModesInSameCapacityGroup } from "./bookingMeetingModeService.js";

function preferenceAllows(user, publicOnly) {
  const preference = user.schedulingPreference;
  const accepts = preference ? preference.acceptsAppointments : user.role === "consultant";
  const publiclyBookable = preference ? preference.publicBookable : user.role === "consultant";
  return accepts && (!publicOnly || publiclyBookable);
}

export async function eligibleSchedulingStaff({
  agencyId,
  sessionTypeId = null,
  publicOnly = false,
  requestedUserId = null,
  meetingMode = null,
  db = prisma,
}) {
  const sessionEligibility = sessionTypeId
    ? await db.bookingSessionTypeStaff.findMany({
      where: { agencyId, sessionTypeId },
      select: { userId: true },
    })
    : [];
  const restrictedIds = new Set(sessionEligibility.map((item) => item.userId));
  const users = await db.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant"] } } },
      ...(requestedUserId ? { id: requestedUserId } : {}),
    },
    select: {
      id: true,
      fullName: true,
      role: true,
      jobTitle: true,
      consultantProfiles: { where: { agencyId }, select: { specializations: true, masteryLevel: true }, take: 1 },
      schedulingPreference: {
        select: { acceptsAppointments: true, publicBookable: true, maxDailyAppointments: true, bufferMinutes: true },
      },
      zoomHostMapping: {
        select: { zoomUserId: true, zoomEmail: true, displayName: true, licenseType: true, status: true },
      },
    },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
  return users.filter((user) => preferenceAllows(user, publicOnly)
    && (!restrictedIds.size || restrictedIds.has(user.id))
    && (meetingMode !== "Zoom" || user.zoomHostMapping?.status === "active"));
}

export async function chooseAppointmentAssignee({
  agencyId,
  sessionTypeId = null,
  startsAt,
  endsAt,
  requestedUserId = null,
  preferredUserId = null,
  publicOnly = false,
  excludeAppointmentId = null,
  bufferMinutes = 0,
  sessionBufferMinutes = null,
  excludeHoldToken = null,
  meetingMode = null,
  timezone = "America/Toronto",
  db = prisma,
}) {
  const staff = await eligibleSchedulingStaff({ agencyId, sessionTypeId, publicOnly, meetingMode, db });
  if (!staff.length) {
    throw createHttpError(409, "No scheduling staff are available for this appointment type.", "NO_BOOKABLE_STAFF");
  }
  if (requestedUserId && !staff.some((user) => user.id === requestedUserId)) {
    throw createHttpError(400, "The selected consultant is not available for this appointment type.", "INVALID_ASSIGNEE");
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dayKey = localDateKey(start, timezone);
  const dayStart = localDateTimeToUtc(dayKey, 0, timezone);
  const dayEnd = localDateTimeToUtc(dayKey, 24 * 60, timezone);
  const ids = staff.map((user) => user.id);
  const [conflicts, dailyCounts, futureCounts, activeWaitlistHolds, activePaymentHolds] = await Promise.all([
    db.appointment.findMany({
      where: {
        agencyId,
        assignedToId: { in: ids },
        status: "Scheduled",
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        // This is only a coarse overlap prefilter. The exact check below
        // applies the session or consultant-specific buffer for each user.
        // Applying the workspace buffer here incorrectly rejected staff
        // whose session type explicitly overrides that buffer to zero.
        startsAt: { lt: end },
        endsAt: { gt: start },
        // Without this, a coarse hit here excludes a staff member from
        // appointmentAvailable below before the meetingMode-aware
        // assertSlotAvailable check ever runs on them — silently
        // reinstating "every mode blocks every mode" regardless of that
        // later check being correct.
        ...(meetingMode ? { meetingMode: { in: meetingModesInSameCapacityGroup(meetingMode) } } : {}),
      },
      select: { assignedToId: true, startsAt: true, endsAt: true },
    }),
    db.appointment.groupBy({
      by: ["assignedToId"],
      where: { agencyId, assignedToId: { in: ids }, status: "Scheduled", startsAt: { gte: dayStart, lt: dayEnd }, ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}) },
      _count: { _all: true },
    }),
    db.appointment.groupBy({
      by: ["assignedToId"],
      where: { agencyId, assignedToId: { in: ids }, status: "Scheduled", startsAt: { gte: new Date() } },
      _count: { _all: true },
    }),
    typeof db.bookingSlotHold?.findMany === "function" ? db.bookingSlotHold.findMany({
      where: {
        agencyId,
        assignedToId: { in: ids },
        claimedAt: null,
        expiresAt: { gt: new Date() },
        startsAt: { gte: dayStart, lt: dayEnd },
        ...(excludeHoldToken ? { claimToken: { not: excludeHoldToken } } : {}),
      },
      select: { assignedToId: true, startsAt: true, endsAt: true },
    }) : [],
    typeof db.bookingPaymentHold?.findMany === "function" ? db.bookingPaymentHold.findMany({
      where: {
        agencyId,
        assignedToId: { in: ids },
        // Linked walk-in holds already have an Appointment in dailyCounts;
        // counting both would make one consultation consume two seats.
        appointmentId: null,
        OR: [{ status: "AwaitingPayment", expiresAt: { gt: new Date() } }, { status: "Confirming" }],
        startsAt: { gte: dayStart, lt: dayEnd },
      },
      select: { assignedToId: true, startsAt: true, endsAt: true },
    }) : [],
  ]);
  const blocked = new Set(conflicts.map((item) => item.assignedToId));
  const dayCount = new Map(dailyCounts.map((item) => [item.assignedToId, item._count._all]));
  const holdSeatsByStaff = new Map();
  for (const item of [...activeWaitlistHolds, ...activePaymentHolds]) {
    const seats = holdSeatsByStaff.get(item.assignedToId) || new Set();
    seats.add(`${new Date(item.startsAt).toISOString()}:${new Date(item.endsAt).toISOString()}`);
    holdSeatsByStaff.set(item.assignedToId, seats);
  }
  for (const [staffId, seats] of holdSeatsByStaff) {
    dayCount.set(staffId, (dayCount.get(staffId) || 0) + seats.size);
  }
  const workload = new Map(futureCounts.map((item) => [item.assignedToId, item._count._all]));
  const appointmentAvailable = staff.filter((user) => {
    if (blocked.has(user.id)) return false;
    const maximum = user.schedulingPreference?.maxDailyAppointments;
    return maximum == null || (dayCount.get(user.id) || 0) < maximum;
  });
  const available = [];
  for (const user of appointmentAvailable) {
    const effectiveBuffer = sessionBufferMinutes ?? user.schedulingPreference?.bufferMinutes ?? bufferMinutes;
    const conflict = typeof db.appointment?.findFirst === "function"
      ? await assertSlotAvailable(db, { agencyId, assignedToId: user.id, startsAt, endsAt, bufferMinutes: effectiveBuffer, excludeAppointmentId, excludeHoldToken, meetingMode })
      : null;
    if (!conflict) available.push(user);
  }
  if (!available.length) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");

  const preferred = requestedUserId || preferredUserId;
  if (preferred && available.some((user) => user.id === preferred)) {
    return available.find((user) => user.id === preferred);
  }
  return available.sort((a, b) => (workload.get(a.id) || 0) - (workload.get(b.id) || 0)
    || a.fullName.localeCompare(b.fullName))[0];
}

export async function lockSchedulingTransaction(tx, agencyId, _startsAt) {
  // One lightweight advisory lock per firm makes assignment + overlap checks
  // atomic even when two requests begin at different, overlapping times.
  const key = `scheduling:${agencyId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
