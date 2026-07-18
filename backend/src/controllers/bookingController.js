import { randomUUID } from "node:crypto";
import { sendBookingMessages } from "../services/bookingNotificationService.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  assertSlotAvailable,
  availabilityForRange,
  getOrCreateBookingSettings,
  localDateKey,
  localDateTimeToUtc,
} from "../services/bookingAvailabilityService.js";
import { generatePublicBookingSlug } from "../services/bookingPublicLinkService.js";
import { nextClientNumber } from "../services/clientNumberService.js";
import { lockAgencyContactIntake, normalizeContact } from "../services/contactDuplicateService.js";
import {
  chooseAppointmentAssignee,
  eligibleSchedulingStaff,
  lockSchedulingTransaction,
} from "../services/schedulingAssignmentService.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireAdmin(req) {
  if (req.auth.role !== "admin") {
    throw createHttpError(403, "Only workspace administrators can change scheduling settings.", "FORBIDDEN");
  }
}

function validWorkingHours(value) {
  if (!Array.isArray(value) || value.length > 7) throw createHttpError(400, "Working hours are invalid.", "VALIDATION_ERROR");
  return value.map((rule) => {
    const day = Number(rule.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw createHttpError(400, "Working hours day is invalid.", "VALIDATION_ERROR");
    if (!TIME_PATTERN.test(rule.start) || !TIME_PATTERN.test(rule.end)) throw createHttpError(400, "Working hours must use HH:mm times.", "VALIDATION_ERROR");
    if (rule.start >= rule.end) throw createHttpError(400, "Working hours must end after they start.", "VALIDATION_ERROR");
    return { day, enabled: Boolean(rule.enabled), start: rule.start, end: rule.end };
  });
}

function validDaysOff(value) {
  if (!Array.isArray(value) || value.length > 366) throw createHttpError(400, "Days off are invalid.", "VALIDATION_ERROR");
  const days = value.map((item) => String(item));
  if (days.some((item) => !DATE_PATTERN.test(item))) throw createHttpError(400, "Days off must use YYYY-MM-DD dates.", "VALIDATION_ERROR");
  return [...new Set(days)].sort();
}

function validLocations(value) {
  if (!Array.isArray(value) || value.length > 20) throw createHttpError(400, "Locations are invalid.", "VALIDATION_ERROR");
  return value.map((item, index) => {
    const name = String(item?.name || "").trim().slice(0, 120);
    const address = String(item?.address || "").trim().slice(0, 300);
    let mapsUrl = String(item?.mapsUrl || "").trim().slice(0, 500);
    if (!name || !address) throw createHttpError(400, "Every location needs a name and address.", "VALIDATION_ERROR");
    if (mapsUrl) {
      try {
        const parsed = new URL(mapsUrl);
        const googleHost = parsed.hostname === "goo.gl" || parsed.hostname === "maps.app.goo.gl" || parsed.hostname.endsWith(".google.com") || parsed.hostname === "google.com";
        if (parsed.protocol !== "https:" || !googleHost) throw new Error("invalid map URL");
        mapsUrl = parsed.href;
      } catch {
        throw createHttpError(400, "Use a valid HTTPS Google Maps link.", "VALIDATION_ERROR");
      }
    }
    return { id: String(item?.id || `loc-${index + 1}-${Date.now()}`), name, address, mapsUrl: mapsUrl || null };
  });
}

function boundedInt(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw createHttpError(400, `${field} must be between ${minimum} and ${maximum}.`, "VALIDATION_ERROR");
  }
  return parsed;
}

function validMeetingModes(value, fallback = ["InPerson", "Online"]) {
  if (value === undefined) return fallback;
  const modes = [...new Set((Array.isArray(value) ? value : []).filter((item) => ["InPerson", "Online"].includes(item)))];
  if (!modes.length) throw createHttpError(400, "Each session type needs at least one appointment format.", "VALIDATION_ERROR");
  return modes;
}

export async function getBookingSettings(req, res) {
  const [settings, sessionTypes, staff] = await Promise.all([
    getOrCreateBookingSettings(req.auth.agencyId),
    prisma.bookingSessionType.findMany({ where: { agencyId: req.auth.agencyId }, include: { eligibleStaff: { select: { userId: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.user.findMany({
      where: { agencyId: req.auth.agencyId, status: "active", role: { in: ["admin", "consultant"] } },
      select: { id: true, fullName: true, role: true, schedulingPreference: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  res.json({ data: { settings, sessionTypes, staff } });
}

export async function updateBookingSettings(req, res) {
  requireAdmin(req);
  const body = req.body || {};
  const data = {
    ...(body.timezone !== undefined ? { timezone: (() => {
      const zone = String(body.timezone || "").trim().slice(0, 80);
      try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()); }
      catch { throw createHttpError(400, "Timezone is invalid.", "VALIDATION_ERROR"); }
      return zone;
    })() } : {}),
    ...(body.workingHours !== undefined ? { workingHours: validWorkingHours(body.workingHours) } : {}),
    ...(body.daysOff !== undefined ? { daysOff: validDaysOff(body.daysOff) } : {}),
    ...(body.bufferMinutes !== undefined ? { bufferMinutes: boundedInt(body.bufferMinutes, "Buffer", 0, 240) } : {}),
    ...(body.minNoticeMinutes !== undefined ? { minNoticeMinutes: boundedInt(body.minNoticeMinutes, "Minimum notice", 0, 20160) } : {}),
    ...(body.horizonDays !== undefined ? { horizonDays: boundedInt(body.horizonDays, "Booking horizon", 1, 365) } : {}),
    ...(body.reminderMinutes !== undefined ? { reminderMinutes: boundedInt(body.reminderMinutes, "Reminder lead time", 5, 10080) } : {}),
    ...(typeof body.freeConsultationsEnabled === "boolean" ? { freeConsultationsEnabled: body.freeConsultationsEnabled } : {}),
    ...(body.freeConsultationsPerContact !== undefined ? { freeConsultationsPerContact: boundedInt(body.freeConsultationsPerContact, "Free consultations per contact", 1, 20) } : {}),
    ...(body.cancellationCutoffMinutes !== undefined ? { cancellationCutoffMinutes: boundedInt(body.cancellationCutoffMinutes, "Cancellation cutoff", 0, 10080) } : {}),
    ...(body.rescheduleCutoffMinutes !== undefined ? { rescheduleCutoffMinutes: boundedInt(body.rescheduleCutoffMinutes, "Reschedule cutoff", 0, 10080) } : {}),
    ...(body.locations !== undefined ? { locations: validLocations(body.locations) } : {}),
    ...(typeof body.publicBookingEnabled === "boolean" ? { publicBookingEnabled: body.publicBookingEnabled } : {}),
  };
  const current = await getOrCreateBookingSettings(req.auth.agencyId);
  const finalLocations = data.locations !== undefined ? data.locations : (Array.isArray(current.locations) ? current.locations : []);
  const enablingPublic = data.publicBookingEnabled === true || (data.publicBookingEnabled === undefined && current.publicBookingEnabled);
  if (enablingPublic && finalLocations.length === 0) {
    throw createHttpError(400, "Add at least one office location before the public booking link can be active.", "LOCATION_REQUIRED");
  }
  const settings = data.reminderMinutes === undefined
    ? await prisma.bookingSettings.update({ where: { agencyId: req.auth.agencyId }, data })
    : await prisma.$transaction(async (tx) => {
      const updated = await tx.bookingSettings.update({ where: { agencyId: req.auth.agencyId }, data });
      await tx.$executeRaw`UPDATE appointments SET reminder_due_at = starts_at - make_interval(mins => ${data.reminderMinutes}) WHERE agency_id = ${req.auth.agencyId} AND status = 'Scheduled' AND starts_at > NOW() AND reminder_queued_at IS NULL`;
      return updated;
    });
  res.json({ data: settings });
}

export async function regeneratePublicToken(req, res) {
  requireAdmin(req);
  await getOrCreateBookingSettings(req.auth.agencyId);
  const publicSlug = await generatePublicBookingSlug(req.auth.agencyId, prisma, { forceSuffix: true });
  const settings = await prisma.bookingSettings.update({
    where: { agencyId: req.auth.agencyId },
    data: { publicToken: randomUUID(), publicSlug },
  });
  res.json({ data: settings });
}

export async function createSessionType(req, res) {
  requireAdmin(req);
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 120) throw createHttpError(400, "Session name is required (120 characters max).", "VALIDATION_ERROR");
  const data = await prisma.bookingSessionType.create({
    data: {
      agencyId: req.auth.agencyId,
      name,
      durationMinutes: boundedInt(req.body?.durationMinutes, "Duration", 5, 480),
      description: String(req.body?.description || "").trim().slice(0, 500) || null,
      sortOrder: Number.isInteger(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
      allowedMeetingModes: validMeetingModes(req.body?.allowedMeetingModes),
    },
  });
  res.status(201).json({ data });
}

export async function updateSessionType(req, res) {
  requireAdmin(req);
  const existing = await prisma.bookingSessionType.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Session type not found.", "NOT_FOUND");
  const body = req.body || {};
  const eligibleStaffIds = Array.isArray(body.eligibleStaffIds) ? [...new Set(body.eligibleStaffIds.map(String))] : null;
  if (eligibleStaffIds) {
    const validCount = await prisma.user.count({ where: { id: { in: eligibleStaffIds }, agencyId: req.auth.agencyId, status: "active", role: { in: ["admin", "consultant"] } } });
    if (validCount !== eligibleStaffIds.length) throw createHttpError(400, "Session eligibility contains an invalid team member.", "VALIDATION_ERROR");
  }
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.bookingSessionType.update({
      where: { id: existing.id },
      data: {
      ...(body.name !== undefined ? { name: String(body.name).trim().slice(0, 120) || existing.name } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: boundedInt(body.durationMinutes, "Duration", 5, 480) } : {}),
      ...(body.description !== undefined ? { description: String(body.description || "").trim().slice(0, 500) || null } : {}),
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
      ...(body.allowedMeetingModes !== undefined ? { allowedMeetingModes: validMeetingModes(body.allowedMeetingModes) } : {}),
      ...(Array.isArray(body.allowedLocationIds) ? { allowedLocationIds: body.allowedLocationIds.map(String).slice(0, 20) } : {}),
      },
    });
    if (eligibleStaffIds) {
      await tx.bookingSessionTypeStaff.deleteMany({ where: { sessionTypeId: existing.id } });
      if (eligibleStaffIds.length) await tx.bookingSessionTypeStaff.createMany({ data: eligibleStaffIds.map((userId) => ({ agencyId: req.auth.agencyId, sessionTypeId: existing.id, userId })) });
    }
    return tx.bookingSessionType.findUnique({ where: { id: updated.id }, include: { eligibleStaff: { select: { userId: true } } } });
  });
  res.json({ data });
}

export async function deleteSessionType(req, res) {
  requireAdmin(req);
  const existing = await prisma.bookingSessionType.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId },
    include: { _count: { select: { appointments: true } } },
  });
  if (!existing) throw createHttpError(404, "Session type not found.", "NOT_FOUND");
  if (existing._count.appointments > 0) {
    const data = await prisma.bookingSessionType.update({ where: { id: existing.id }, data: { isActive: false } });
    return res.json({ data, meta: { deactivated: true } });
  }
  await prisma.bookingSessionType.delete({ where: { id: existing.id } });
  res.json({ data: { id: existing.id }, meta: { deleted: true } });
}

export async function getAvailability(req, res) {
  const durationMinutes = boundedInt(req.query.durationMinutes || 30, "Duration", 5, 480);
  const from = String(req.query.from || "");
  const to = String(req.query.to || from);
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw createHttpError(400, "from/to must be YYYY-MM-DD dates.", "VALIDATION_ERROR");
  }
  const assignedToId = req.auth.role === "consultant" ? req.auth.userId : String(req.query.assignedToId || "") || null;
  const staff = assignedToId ? [] : await eligibleSchedulingStaff({ agencyId: req.auth.agencyId, sessionTypeId: String(req.query.sessionTypeId || "") || null });
  const { days, settings } = await availabilityForRange({
    agencyId: req.auth.agencyId,
    assignedToId,
    assignedToIds: assignedToId ? null : staff.map((item) => item.id),
    durationMinutes,
    fromKey: from,
    toKey: to,
  });
  res.json({ data: { days, timezone: settings.timezone } });
}

const calendarInclude = {
  client: { select: { id: true, fullName: true } },
  case: { select: { id: true, caseType: true } },
  assignedTo: { select: { id: true, fullName: true } },
  sessionType: { select: { id: true, name: true, durationMinutes: true } },
};

export async function listCalendarAppointments(req, res) {
  const from = new Date(String(req.query.from || ""));
  const to = new Date(String(req.query.to || ""));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw createHttpError(400, "A valid from/to range is required.", "VALIDATION_ERROR");
  }
  if (to.getTime() - from.getTime() > 93 * 24 * 60 * 60_000) {
    throw createHttpError(400, "Range cannot exceed 93 days.", "VALIDATION_ERROR");
  }
  const data = await prisma.appointment.findMany({
    where: {
      agencyId: req.auth.agencyId,
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    },
    include: calendarInclude,
    orderBy: { startsAt: "asc" },
  });
  res.json({ data });
}

export async function createBookingAppointment(req, res) {
  const body = req.body || {};
  const startsAt = new Date(String(body.startsAt || ""));
  if (Number.isNaN(startsAt.getTime())) throw createHttpError(400, "A valid start time is required.", "VALIDATION_ERROR");

  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  let durationMinutes = Number(body.durationMinutes);
  let sessionType = null;
  if (body.sessionTypeId) {
    sessionType = await prisma.bookingSessionType.findFirst({ where: { id: body.sessionTypeId, agencyId: req.auth.agencyId } });
    if (!sessionType) throw createHttpError(400, "Session type was not found.", "VALIDATION_ERROR");
    durationMinutes = sessionType.durationMinutes;
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
    throw createHttpError(400, "Choose a session type or a duration between 5 and 480 minutes.", "VALIDATION_ERROR");
  }
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const requestedMeetingMode = body.meetingMode === "Online" ? "Online" : "InPerson";
  if (sessionType && !sessionType.allowedMeetingModes.includes(requestedMeetingMode)) throw createHttpError(400, "That appointment format is unavailable for this session type.", "VALIDATION_ERROR");

  let assignedToId = String(body.assignedToId || "") || null;
  if (req.auth.role === "consultant") assignedToId = req.auth.userId;

  let client = null;
  if (body.clientId) {
    client = await prisma.client.findFirst({ where: { id: body.clientId, agencyId: req.auth.agencyId }, select: { id: true, fullName: true, assignedUserId: true } });
    if (!client) throw createHttpError(400, "Client was not found.", "VALIDATION_ERROR");
  }
  const guestName = String(body.guestName || "").trim().slice(0, 160) || null;
  if (!client && !guestName) throw createHttpError(400, "Pick a client or enter the visitor’s name.", "VALIDATION_ERROR");

  const subject = String(body.subject || "").trim().slice(0, 200) || (sessionType ? sessionType.name : "Appointment");
  const dayKey = localDateKey(startsAt, settings.timezone);
  const pool = assignedToId ? null : await eligibleSchedulingStaff({ agencyId: req.auth.agencyId, sessionTypeId: sessionType?.id || null });
  const offeredAvailability = await availabilityForRange({
    agencyId: req.auth.agencyId,
    assignedToId,
    assignedToIds: assignedToId ? null : pool.map((item) => item.id),
    durationMinutes,
    fromKey: dayKey,
    toKey: dayKey,
  });
  if (!(offeredAvailability.days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString())) {
    throw createHttpError(409, "That time is outside bookable hours or no longer available.", "SLOT_TAKEN");
  }

  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.auth.agencyId, startsAt);
    const assignee = await chooseAppointmentAssignee({
      agencyId: req.auth.agencyId,
      sessionTypeId: sessionType?.id || null,
      startsAt,
      endsAt,
      requestedUserId: assignedToId,
      preferredUserId: client?.assignedUserId,
      bufferMinutes: settings.bufferMinutes,
      timezone: settings.timezone,
      db: tx,
    });
    assignedToId = assignee.id;
    const conflict = await assertSlotAvailable(tx, {
      agencyId: req.auth.agencyId,
      assignedToId,
      startsAt,
      endsAt,
      bufferMinutes: settings.bufferMinutes,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    return tx.appointment.create({
      data: {
        agencyId: req.auth.agencyId,
        clientId: client?.id || null,
        caseId: null,
        sessionTypeId: sessionType?.id || null,
        subject,
        location: String(body.location || "").trim().slice(0, 200) || null,
        calendar: "Workspace Calendar",
        startsAt,
        endsAt,
        description: String(body.description || "").trim().slice(0, 2000) || null,
        guestName,
        guestEmail: String(body.guestEmail || "").trim().slice(0, 254) || null,
        guestEmailNormalized: String(body.guestEmail || "").trim().toLowerCase().slice(0, 254) || null,
        guestPhone: String(body.guestPhone || "").trim().slice(0, 40) || null,
        meetingMode: requestedMeetingMode,
        meetingUrl: requestedMeetingMode === "Online" ? `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}` : null,
        assignedToId,
        createdById: req.auth.userId,
        source: body.source === "WalkIn" ? "WalkIn" : "Internal",
        reminderDueAt: new Date(startsAt.getTime() - settings.reminderMinutes * 60_000),
        status: "Scheduled",
      },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
  });

  await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: data, kind: "booked", actorUserId: req.auth.userId }).catch(() => {});

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: client?.id || null,
    caseId: null,
    action: "appointment.booked",
    details: `${subject} booked for ${client?.fullName || guestName} on ${localDateKey(startsAt, settings.timezone)}`,
  });

  res.status(201).json({ data });
}

export async function cancelBookingAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    },
  });
  if (!existing) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (existing.status !== "Scheduled") throw createHttpError(409, "Only a scheduled appointment can be cancelled.", "ALREADY_DONE");
  if (new Date(existing.startsAt) <= new Date()) throw createHttpError(409, "Past appointments should be marked attended or no-show.", "TOO_LATE");
  const data = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: "Cancelled", cancelledAt: new Date(), cancelledById: req.auth.userId, cancellationReason: String(req.body?.reason || "").trim().slice(0, 500) || null },
    include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.cancelled",
    details: `${existing.subject} cancelled`,
  });
  await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: data, kind: "cancelled", actorUserId: req.auth.userId }).catch(() => {});
  res.json({ data });
}

export async function rescheduleBookingAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      status: "Scheduled",
      ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    },
  });
  if (!existing) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (new Date(existing.startsAt) <= new Date()) throw createHttpError(409, "Past appointments cannot be rescheduled.", "TOO_LATE");
  const startsAt = new Date(String(req.body?.startsAt || ""));
  if (Number.isNaN(startsAt.getTime())) throw createHttpError(400, "Pick a new time.", "VALIDATION_ERROR");
  const duration = Math.round((new Date(existing.endsAt) - new Date(existing.startsAt)) / 60_000);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  const requestedMode = req.body?.meetingMode;
  const meetingMode = requestedMode === "Online" || requestedMode === "InPerson" ? requestedMode : existing.meetingMode;
  const locations = Array.isArray(settings.locations) ? settings.locations : [];
  const selectedLocation = meetingMode === "InPerson"
    ? locations.find((item) => item.id === String(req.body?.locationId || "")) || (locations.length === 1 ? locations[0] : null)
    : null;
  if (meetingMode === "InPerson" && locations.length && !selectedLocation) throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
  const dayKey = localDateKey(startsAt, settings.timezone);
  const offeredAvailability = await availabilityForRange({ agencyId: req.auth.agencyId, assignedToId: existing.assignedToId, durationMinutes: duration, fromKey: dayKey, toKey: dayKey, excludeAppointmentId: existing.id });
  if (!(offeredAvailability.days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString())) throw createHttpError(409, "That time is outside bookable hours or no longer available.", "SLOT_TAKEN");

  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.auth.agencyId, startsAt);
    const conflict = await assertSlotAvailable(tx, {
      agencyId: req.auth.agencyId,
      assignedToId: existing.assignedToId,
      startsAt,
      endsAt,
      bufferMinutes: settings.bufferMinutes,
      excludeAppointmentId: existing.id,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    return tx.appointment.update({
      where: { id: existing.id },
      data: {
        startsAt,
        endsAt,
        meetingMode,
        meetingUrl: meetingMode === "Online" ? existing.meetingUrl || `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}` : null,
        location: meetingMode === "InPerson" ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : existing.location : null,
        locationMapsUrl: meetingMode === "InPerson" ? selectedLocation?.mapsUrl || existing.locationMapsUrl : null,
        reminderSentAt: null,
        reminderDueAt: new Date(startsAt.getTime() - settings.reminderMinutes * 60_000),
        reminderQueuedAt: null,
      },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
  });

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.rescheduled",
    details: `${existing.subject} rescheduled`,
  });
  await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: data, kind: "rescheduled", actorUserId: req.auth.userId }).catch(() => {});
  res.json({ data });
}

export async function updateSchedulingStaff(req, res) {
  requireAdmin(req);
  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, agencyId: req.auth.agencyId, status: "active", role: { in: ["admin", "consultant"] } },
    select: { id: true },
  });
  if (!user) throw createHttpError(404, "Scheduling team member not found.", "NOT_FOUND");
  const body = req.body || {};
  const data = await prisma.schedulingStaffPreference.upsert({
    where: { userId: user.id },
    create: {
      agencyId: req.auth.agencyId,
      userId: user.id,
      acceptsAppointments: Boolean(body.acceptsAppointments),
      publicBookable: Boolean(body.publicBookable),
      maxDailyAppointments: body.maxDailyAppointments == null || body.maxDailyAppointments === "" ? null : boundedInt(body.maxDailyAppointments, "Daily appointment limit", 1, 50),
    },
    update: {
      ...(typeof body.acceptsAppointments === "boolean" ? { acceptsAppointments: body.acceptsAppointments } : {}),
      ...(typeof body.publicBookable === "boolean" ? { publicBookable: body.publicBookable } : {}),
      ...(body.maxDailyAppointments !== undefined ? { maxDailyAppointments: body.maxDailyAppointments == null || body.maxDailyAppointments === "" ? null : boundedInt(body.maxDailyAppointments, "Daily appointment limit", 1, 50) } : {}),
    },
  });
  res.json({ data });
}

export async function getSchedulingAnalytics(req, res) {
  requireAdmin(req);
  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  const todayKey = localDateKey(new Date(), settings.timezone);
  const monthKey = `${todayKey.slice(0, 8)}01`;
  const from = req.query.from ? new Date(String(req.query.from)) : localDateTimeToUtc(monthKey, 0, settings.timezone);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from || to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw createHttpError(400, "Choose a valid analytics range up to 366 days.", "VALIDATION_ERROR");
  }
  const grouped = await prisma.appointment.groupBy({
    by: ["status"],
    where: { agencyId: req.auth.agencyId, startsAt: { gte: from, lte: to } },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((item) => [item.status, item._count._all]));
  res.json({ data: { booked: Object.values(counts).reduce((sum, value) => sum + value, 0), attended: counts.Completed || 0, cancelled: counts.Cancelled || 0, noShow: counts.NoShow || 0 } });
}

export async function convertAppointmentToClient(req, res) {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) } });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (appointment.clientId) return res.json({ data: { clientId: appointment.clientId, existing: true } });
  if (!appointment.guestName) throw createHttpError(400, "This appointment has no visitor name.", "VALIDATION_ERROR");
  const client = await prisma.$transaction(async (tx) => {
    await lockAgencyContactIntake(tx, req.auth.agencyId);
    const contact = normalizeContact({ phone: appointment.guestPhone, email: appointment.guestEmail });
    const contactOr = [contact.emailNormalized ? { emailNormalized: contact.emailNormalized } : null, contact.phoneNormalized ? { phoneNormalized: contact.phoneNormalized } : null].filter(Boolean);
    const existing = contactOr.length ? await tx.client.findFirst({ where: { agencyId: req.auth.agencyId, OR: contactOr } }) : null;
    const created = existing || await tx.client.create({ data: {
      agencyId: req.auth.agencyId,
      clientNumber: await nextClientNumber(tx, req.auth.agencyId),
      fullName: appointment.guestName,
      ...contact,
      status: "Active",
      assignedUserId: appointment.assignedToId,
    } });
    await tx.appointment.update({ where: { id: appointment.id }, data: { clientId: created.id } });
    return created;
  });
  res.status(201).json({ data: { clientId: client.id, existing: false } });
}

export async function updateBookingAppointmentStatus(req, res) {
  const status = String(req.body?.status || "");
  if (!["Scheduled", "Completed", "Cancelled", "NoShow"].includes(status)) throw createHttpError(400, "Choose a valid appointment status.", "VALIDATION_ERROR");
  const existing = await prisma.appointment.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) },
  });
  if (!existing) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (["Completed", "NoShow"].includes(status) && new Date(existing.startsAt) > new Date()) {
    throw createHttpError(409, "An appointment cannot be marked attended or no-show before it starts.", "TOO_EARLY");
  }
  const data = await prisma.appointment.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === "Cancelled" ? { cancelledAt: new Date(), cancelledById: req.auth.userId, cancellationReason: String(req.body?.reason || "").trim().slice(0, 500) || null } : {}),
    },
    include: calendarInclude,
  });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: existing.clientId, caseId: existing.caseId, action: "appointment.status_updated", details: `${existing.subject} marked ${status}` });
  res.json({ data });
}
