import { randomUUID } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  assertSlotAvailable,
  availabilityForRange,
  getOrCreateBookingSettings,
  localDateKey,
} from "../services/bookingAvailabilityService.js";

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

function boundedInt(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw createHttpError(400, `${field} must be between ${minimum} and ${maximum}.`, "VALIDATION_ERROR");
  }
  return parsed;
}

export async function getBookingSettings(req, res) {
  const [settings, sessionTypes] = await Promise.all([
    getOrCreateBookingSettings(req.auth.agencyId),
    prisma.bookingSessionType.findMany({ where: { agencyId: req.auth.agencyId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  res.json({ data: { settings, sessionTypes } });
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
    ...(typeof body.publicBookingEnabled === "boolean" ? { publicBookingEnabled: body.publicBookingEnabled } : {}),
  };
  await getOrCreateBookingSettings(req.auth.agencyId);
  const settings = await prisma.bookingSettings.update({ where: { agencyId: req.auth.agencyId }, data });
  res.json({ data: settings });
}

export async function regeneratePublicToken(req, res) {
  requireAdmin(req);
  await getOrCreateBookingSettings(req.auth.agencyId);
  const settings = await prisma.bookingSettings.update({
    where: { agencyId: req.auth.agencyId },
    data: { publicToken: randomUUID() },
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
    },
  });
  res.status(201).json({ data });
}

export async function updateSessionType(req, res) {
  requireAdmin(req);
  const existing = await prisma.bookingSessionType.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Session type not found.", "NOT_FOUND");
  const body = req.body || {};
  const data = await prisma.bookingSessionType.update({
    where: { id: existing.id },
    data: {
      ...(body.name !== undefined ? { name: String(body.name).trim().slice(0, 120) || existing.name } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: boundedInt(body.durationMinutes, "Duration", 5, 480) } : {}),
      ...(body.description !== undefined ? { description: String(body.description || "").trim().slice(0, 500) || null } : {}),
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) || 0 } : {}),
    },
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
  const { days, settings } = await availabilityForRange({
    agencyId: req.auth.agencyId,
    assignedToId,
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

  let assignedToId = String(body.assignedToId || "") || null;
  if (req.auth.role === "consultant") assignedToId = req.auth.userId;
  if (assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assignedToId, agencyId: req.auth.agencyId, status: "active", memberships: { some: { agencyId: req.auth.agencyId, isActive: true, role: { in: ["admin", "consultant"] } } } },
      select: { id: true },
    });
    if (!assignee) throw createHttpError(400, "Assignee must be an active admin or consultant.", "VALIDATION_ERROR");
  }

  let client = null;
  if (body.clientId) {
    client = await prisma.client.findFirst({ where: { id: body.clientId, agencyId: req.auth.agencyId }, select: { id: true, fullName: true } });
    if (!client) throw createHttpError(400, "Client was not found.", "VALIDATION_ERROR");
  }
  const guestName = String(body.guestName || "").trim().slice(0, 160) || null;
  if (!client && !guestName) throw createHttpError(400, "Pick a client or enter the visitor’s name.", "VALIDATION_ERROR");

  const subject = String(body.subject || "").trim().slice(0, 200) || (sessionType ? sessionType.name : "Appointment");

  const data = await prisma.$transaction(async (tx) => {
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
        guestPhone: String(body.guestPhone || "").trim().slice(0, 40) || null,
        assignedToId,
        createdById: req.auth.userId,
        status: "Scheduled",
      },
      include: calendarInclude,
    });
  });

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
  const data = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: "Cancelled" },
    include: calendarInclude,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.cancelled",
    details: `${existing.subject} cancelled`,
  });
  res.json({ data });
}
