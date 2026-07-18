import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { localDateKey, localDateTimeToUtc } from "./bookingAvailabilityService.js";

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
      schedulingPreference: {
        select: { acceptsAppointments: true, publicBookable: true, maxDailyAppointments: true },
      },
    },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
  return users.filter((user) => preferenceAllows(user, publicOnly)
    && (!restrictedIds.size || restrictedIds.has(user.id)));
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
  timezone = "America/Toronto",
  db = prisma,
}) {
  const staff = await eligibleSchedulingStaff({ agencyId, sessionTypeId, publicOnly, db });
  if (!staff.length) {
    throw createHttpError(409, "No scheduling staff are available for this appointment type.", "NO_BOOKABLE_STAFF");
  }
  if (requestedUserId && !staff.some((user) => user.id === requestedUserId)) {
    throw createHttpError(400, "The selected consultant is not available for this appointment type.", "INVALID_ASSIGNEE");
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const buffer = bufferMinutes * 60_000;
  const dayKey = localDateKey(start, timezone);
  const dayStart = localDateTimeToUtc(dayKey, 0, timezone);
  const dayEnd = localDateTimeToUtc(dayKey, 24 * 60, timezone);
  const ids = staff.map((user) => user.id);
  const [conflicts, dailyCounts, futureCounts] = await Promise.all([
    db.appointment.findMany({
      where: {
        agencyId,
        assignedToId: { in: ids },
        status: "Scheduled",
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        startsAt: { lt: new Date(end.getTime() + buffer) },
        endsAt: { gt: new Date(start.getTime() - buffer) },
      },
      select: { assignedToId: true },
    }),
    db.appointment.groupBy({
      by: ["assignedToId"],
      where: { agencyId, assignedToId: { in: ids }, status: "Scheduled", startsAt: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
    }),
    db.appointment.groupBy({
      by: ["assignedToId"],
      where: { agencyId, assignedToId: { in: ids }, status: "Scheduled", startsAt: { gte: new Date() } },
      _count: { _all: true },
    }),
  ]);
  const blocked = new Set(conflicts.map((item) => item.assignedToId));
  const dayCount = new Map(dailyCounts.map((item) => [item.assignedToId, item._count._all]));
  const workload = new Map(futureCounts.map((item) => [item.assignedToId, item._count._all]));
  const available = staff.filter((user) => {
    if (blocked.has(user.id)) return false;
    const maximum = user.schedulingPreference?.maxDailyAppointments;
    return maximum == null || (dayCount.get(user.id) || 0) < maximum;
  });
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
