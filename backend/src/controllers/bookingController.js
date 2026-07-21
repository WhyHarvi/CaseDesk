import { randomUUID } from "node:crypto";
import { bookingTemplatePreview, sendBookingMessages, sendBookingStaffNotification, sendBookingTemplateTest } from "../services/bookingNotificationService.js";
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
import { appointmentReference, recordAppointmentEvent, recurrenceStarts } from "../services/appointmentOperationsService.js";
import { offerWaitlistOpening, releaseExpiredWaitlistHolds } from "../services/bookingWaitlistService.js";

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

function validFeeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000) {
    throw createHttpError(400, "Consultation fee must be between $0.01 and $10,000.", "VALIDATION_ERROR");
  }
  return parsed;
}

function validMeetingModes(value, fallback = ["InPerson", "Online"]) {
  if (value === undefined) return fallback;
  const modes = [...new Set((Array.isArray(value) ? value : []).filter((item) => ["InPerson", "Online"].includes(item)))];
  if (!modes.length) throw createHttpError(400, "Each session type needs at least one appointment format.", "VALIDATION_ERROR");
  return modes;
}

function validReminderSchedule(value) {
  if (!Array.isArray(value) || !value.length || value.length > 6) throw createHttpError(400, "Choose between one and six reminders.", "VALIDATION_ERROR");
  return [...new Set(value.map((item) => boundedInt(item, "Reminder", 5, 10080)))].sort((a, b) => b - a);
}

function optionalTimezone(value) {
  if (value === null || value === "") return null;
  const zone = String(value).trim().slice(0, 80);
  try { new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()); }
  catch { throw createHttpError(400, "Timezone is invalid.", "VALIDATION_ERROR"); }
  return zone;
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
    ...(body.reminderSchedule !== undefined ? { reminderSchedule: validReminderSchedule(body.reminderSchedule) } : {}),
    ...(typeof body.waitlistEnabled === "boolean" ? { waitlistEnabled: body.waitlistEnabled } : {}),
    ...(typeof body.attendanceConfirmationEnabled === "boolean" ? { attendanceConfirmationEnabled: body.attendanceConfirmationEnabled } : {}),
    ...(body.messageTemplates !== undefined && body.messageTemplates && typeof body.messageTemplates === "object" && !Array.isArray(body.messageTemplates) ? { messageTemplates: body.messageTemplates } : {}),
    ...(typeof body.freeConsultationsEnabled === "boolean" ? { freeConsultationsEnabled: body.freeConsultationsEnabled } : {}),
    ...(body.freeConsultationsPerContact !== undefined ? { freeConsultationsPerContact: boundedInt(body.freeConsultationsPerContact, "Free consultations per contact", 1, 20) } : {}),
    ...(body.cancellationCutoffMinutes !== undefined ? { cancellationCutoffMinutes: boundedInt(body.cancellationCutoffMinutes, "Cancellation cutoff", 0, 10080) } : {}),
    ...(body.rescheduleCutoffMinutes !== undefined ? { rescheduleCutoffMinutes: boundedInt(body.rescheduleCutoffMinutes, "Reschedule cutoff", 0, 10080) } : {}),
    ...(body.locations !== undefined ? { locations: validLocations(body.locations) } : {}),
    ...(typeof body.publicBookingEnabled === "boolean" ? { publicBookingEnabled: body.publicBookingEnabled } : {}),
    ...(typeof body.consultFeeEnabled === "boolean" ? { consultFeeEnabled: body.consultFeeEnabled } : {}),
    ...(body.consultFeeAmount !== undefined ? { consultFeeAmount: body.consultFeeAmount === null ? null : validFeeAmount(body.consultFeeAmount) } : {}),
    ...(body.consultFeeHoldMinutes !== undefined ? { consultFeeHoldMinutes: boundedInt(body.consultFeeHoldMinutes, "Payment hold window", 5, 120) } : {}),
  };
  const current = await getOrCreateBookingSettings(req.auth.agencyId);
  const finalLocations = data.locations !== undefined ? data.locations : (Array.isArray(current.locations) ? current.locations : []);
  const enablingPublic = data.publicBookingEnabled === true || (data.publicBookingEnabled === undefined && current.publicBookingEnabled);
  if (enablingPublic && finalLocations.length === 0) {
    throw createHttpError(400, "Add at least one office location before the public booking link can be active.", "LOCATION_REQUIRED");
  }
  const enablingConsultFee = data.consultFeeEnabled === true || (data.consultFeeEnabled === undefined && current.consultFeeEnabled);
  const finalFeeAmount = data.consultFeeAmount !== undefined ? data.consultFeeAmount : current.consultFeeAmount;
  if (enablingConsultFee && !finalFeeAmount) {
    throw createHttpError(400, "Set a consultation fee amount before enabling paid bookings.", "VALIDATION_ERROR");
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
      bufferMinutes: req.body?.bufferMinutes == null || req.body?.bufferMinutes === "" ? null : boundedInt(req.body.bufferMinutes, "Session buffer", 0, 240),
      preparationInstructions: String(req.body?.preparationInstructions || "").trim().slice(0, 2000) || null,
      preparationChecklist: Array.isArray(req.body?.preparationChecklist) ? req.body.preparationChecklist.map((item) => String(item).trim().slice(0, 180)).filter(Boolean).slice(0, 20) : [],
      parkingInstructions: String(req.body?.parkingInstructions || "").trim().slice(0, 1000) || null,
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
      ...(body.bufferMinutes !== undefined ? { bufferMinutes: body.bufferMinutes == null || body.bufferMinutes === "" ? null : boundedInt(body.bufferMinutes, "Session buffer", 0, 240) } : {}),
      ...(body.preparationInstructions !== undefined ? { preparationInstructions: String(body.preparationInstructions || "").trim().slice(0, 2000) || null } : {}),
      ...(body.preparationChecklist !== undefined ? { preparationChecklist: Array.isArray(body.preparationChecklist) ? body.preparationChecklist.map((item) => String(item).trim().slice(0, 180)).filter(Boolean).slice(0, 20) : [] } : {}),
      ...(body.parkingInstructions !== undefined ? { parkingInstructions: String(body.parkingInstructions || "").trim().slice(0, 1000) || null } : {}),
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
    sessionBufferMinutes: req.query.sessionTypeId ? (await prisma.bookingSessionType.findFirst({ where: { id: String(req.query.sessionTypeId), agencyId: req.auth.agencyId }, select: { bufferMinutes: true } }))?.bufferMinutes ?? undefined : undefined,
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
  const startDates = recurrenceStarts(startsAt, body.recurrence);
  if (startDates.length > 1 && !["DAILY", "WEEKLY", "MONTHLY"].includes(String(body.recurrence?.frequency))) {
    throw createHttpError(400, "Choose a valid recurrence.", "VALIDATION_ERROR");
  }
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
  const effectiveBuffer = sessionType?.bufferMinutes ?? settings.bufferMinutes;
  const pool = assignedToId ? null : await eligibleSchedulingStaff({ agencyId: req.auth.agencyId, sessionTypeId: sessionType?.id || null });
  for (const occurrenceStart of startDates) {
    const dayKey = localDateKey(occurrenceStart, settings.timezone);
    const offeredAvailability = await availabilityForRange({
      agencyId: req.auth.agencyId,
      assignedToId,
      assignedToIds: assignedToId ? null : pool.map((item) => item.id),
      durationMinutes,
      sessionBufferMinutes: effectiveBuffer,
      fromKey: dayKey,
      toKey: dayKey,
    });
    if (!(offeredAvailability.days[dayKey] || []).some((slot) => slot.startsAt === occurrenceStart.toISOString())) {
      throw createHttpError(409, `${dayKey} at the selected time is unavailable. No appointments were created.`, "SLOT_TAKEN");
    }
  }

  const seriesKey = startDates.length > 1 ? randomUUID() : null;
  const createdAppointments = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const [index, occurrenceStart] of startDates.entries()) {
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMinutes * 60_000);
      await lockSchedulingTransaction(tx, req.auth.agencyId, occurrenceStart);
      const assignee = await chooseAppointmentAssignee({
        agencyId: req.auth.agencyId,
        sessionTypeId: sessionType?.id || null,
        startsAt: occurrenceStart,
        endsAt: occurrenceEnd,
        requestedUserId: assignedToId,
        preferredUserId: client?.assignedUserId,
        bufferMinutes: settings.bufferMinutes,
        sessionBufferMinutes: sessionType?.bufferMinutes,
        timezone: settings.timezone,
        db: tx,
      });
      const assignmentBuffer = sessionType?.bufferMinutes ?? assignee.schedulingPreference?.bufferMinutes ?? settings.bufferMinutes;
      const conflict = await assertSlotAvailable(tx, {
        agencyId: req.auth.agencyId,
        assignedToId: assignee.id,
        startsAt: occurrenceStart,
        endsAt: occurrenceEnd,
        bufferMinutes: assignmentBuffer,
      });
      if (conflict) throw createHttpError(409, "One of those times was just taken. No appointments were created.", "SLOT_TAKEN");
      const appointment = await tx.appointment.create({
        data: {
        agencyId: req.auth.agencyId,
        clientId: client?.id || null,
        caseId: null,
        sessionTypeId: sessionType?.id || null,
        subject,
        location: String(body.location || "").trim().slice(0, 200) || null,
        calendar: "Workspace Calendar",
        startsAt: occurrenceStart,
        endsAt: occurrenceEnd,
        description: String(body.description || "").trim().slice(0, 2000) || null,
        guestName,
        guestEmail: String(body.guestEmail || "").trim().slice(0, 254) || null,
        guestEmailNormalized: String(body.guestEmail || "").trim().toLowerCase().slice(0, 254) || null,
        guestPhone: String(body.guestPhone || "").trim().slice(0, 40) || null,
        meetingMode: requestedMeetingMode,
        meetingUrl: requestedMeetingMode === "Online" ? `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}` : null,
        assignedToId: assignee.id,
        createdById: req.auth.userId,
        source: body.source === "WalkIn" ? "WalkIn" : "Internal",
        reminderDueAt: new Date(occurrenceStart.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000),
        referenceCode: appointmentReference(),
        seriesKey,
        recurrenceIndex: seriesKey ? index + 1 : null,
        recurrenceCount: seriesKey ? startDates.length : null,
        status: "Scheduled",
      },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
      });
      await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: appointment.id, actorUserId: req.auth.userId, type: "BOOKED", summary: seriesKey ? `Recurring appointment ${index + 1} of ${startDates.length} created` : "Appointment created", metadata: { source: appointment.source } });
      created.push(appointment);
    }
    return created;
  });
  const data = createdAppointments[0];

  await Promise.all(createdAppointments.map((appointment) => sendBookingMessages({ agencyId: req.auth.agencyId, appointment, kind: "booked", actorUserId: req.auth.userId }).catch(() => {})));

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: client?.id || null,
    caseId: null,
    action: "appointment.booked",
    details: `${subject} booked for ${client?.fullName || guestName} on ${localDateKey(startsAt, settings.timezone)}${startDates.length > 1 ? ` (${startDates.length} recurring appointments)` : ""}`,
  });

  res.status(201).json({ data: { ...data, series: seriesKey ? { key: seriesKey, count: createdAppointments.length, appointments: createdAppointments.map((item) => ({ id: item.id, startsAt: item.startsAt, referenceCode: item.referenceCode })) } : null } });
}

export async function cancelBookingAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    },
    include: { sessionType: { select: { bufferMinutes: true, allowedMeetingModes: true } }, assignedTo: { select: { schedulingPreference: { select: { bufferMinutes: true } } } } },
  });
  if (!existing) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (existing.status !== "Scheduled") throw createHttpError(409, "Only a scheduled appointment can be cancelled.", "ALREADY_DONE");
  if (new Date(existing.startsAt) <= new Date()) throw createHttpError(409, "Past appointments should be marked attended or no-show.", "TOO_LATE");
  const cancelSeries = req.body?.scope === "series" && existing.seriesKey;
  if (cancelSeries) {
    const series = await prisma.appointment.findMany({ where: { agencyId: req.auth.agencyId, seriesKey: existing.seriesKey, status: "Scheduled", startsAt: { gte: existing.startsAt }, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) }, include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } }, orderBy: { startsAt: "asc" } });
    const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;
    await prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({ where: { id: { in: series.map((item) => item.id) }, status: "Scheduled" }, data: { status: "Cancelled", cancelledAt: new Date(), cancelledById: req.auth.userId, cancellationReason: reason } });
      if (tx.appointmentEvent && series.length) await tx.appointmentEvent.createMany({ data: series.map((item) => ({ agencyId: req.auth.agencyId, appointmentId: item.id, actorUserId: req.auth.userId, type: "SERIES_CANCELLED", summary: "Appointment cancelled with recurring series", metadata: { seriesKey: existing.seriesKey } })) });
    });
    const cancelled = series.map((item) => ({ ...item, status: "Cancelled", cancelledAt: new Date(), cancellationReason: reason }));
    await Promise.all(cancelled.flatMap((item) => [sendBookingMessages({ agencyId: req.auth.agencyId, appointment: item, kind: "cancelled", actorUserId: req.auth.userId }).catch(() => {}), offerWaitlistOpening(item).catch(() => {})]));
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: existing.clientId, caseId: existing.caseId, action: "appointment.series_cancelled", details: `${series.length} recurring appointments cancelled` });
    return res.json({ data: { ...cancelled.find((item) => item.id === existing.id), seriesAffected: series.length } });
  }
  const data = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: "Cancelled", cancelledAt: new Date(), cancelledById: req.auth.userId, cancellationReason: String(req.body?.reason || "").trim().slice(0, 500) || null },
    include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  await recordAppointmentEvent(prisma, { agencyId: req.auth.agencyId, appointmentId: existing.id, actorUserId: req.auth.userId, type: "CANCELLED", summary: "Appointment cancelled", metadata: { reason: data.cancellationReason } });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.cancelled",
    details: `${existing.subject} cancelled`,
  });
  await sendBookingMessages({ agencyId: req.auth.agencyId, appointment: data, kind: "cancelled", actorUserId: req.auth.userId }).catch(() => {});
  await offerWaitlistOpening(data).catch(() => {});
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
    include: { sessionType: { select: { bufferMinutes: true, allowedMeetingModes: true } }, assignedTo: { select: { schedulingPreference: { select: { bufferMinutes: true } } } } },
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
  if (existing.sessionType?.allowedMeetingModes?.length && !existing.sessionType.allowedMeetingModes.includes(meetingMode)) throw createHttpError(400, "That appointment format is unavailable for this session.", "VALIDATION_ERROR");
  const locations = Array.isArray(settings.locations) ? settings.locations : [];
  const selectedLocation = meetingMode === "InPerson"
    ? locations.find((item) => item.id === String(req.body?.locationId || "")) || (locations.length === 1 ? locations[0] : null)
    : null;
  if (meetingMode === "InPerson" && locations.length && !selectedLocation) throw createHttpError(400, "Choose an office location.", "VALIDATION_ERROR");
  const dayKey = localDateKey(startsAt, settings.timezone);
  const effectiveBuffer = existing.sessionType?.bufferMinutes ?? existing.assignedTo?.schedulingPreference?.bufferMinutes ?? settings.bufferMinutes;
  const rescheduleSeries = req.body?.scope === "series" && existing.seriesKey;
  if (rescheduleSeries) {
    const series = await prisma.appointment.findMany({
      where: { agencyId: req.auth.agencyId, seriesKey: existing.seriesKey, status: "Scheduled", startsAt: { gte: existing.startsAt }, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true, schedulingPreference: { select: { bufferMinutes: true } } } } },
      orderBy: { startsAt: "asc" },
    });
    const seriesIds = series.map((item) => item.id);
    const delta = startsAt.getTime() - new Date(existing.startsAt).getTime();
    const moves = series.map((item) => {
      const nextStart = new Date(new Date(item.startsAt).getTime() + delta);
      const nextEnd = new Date(new Date(item.endsAt).getTime() + delta);
      return { item, startsAt: nextStart, endsAt: nextEnd, buffer: existing.sessionType?.bufferMinutes ?? item.assignedTo?.schedulingPreference?.bufferMinutes ?? settings.bufferMinutes };
    });
    for (const move of moves) {
      const key = localDateKey(move.startsAt, settings.timezone);
      const offered = await availabilityForRange({ agencyId: req.auth.agencyId, assignedToId: move.item.assignedToId, durationMinutes: Math.round((move.endsAt - move.startsAt) / 60_000), sessionBufferMinutes: existing.sessionType?.bufferMinutes, fromKey: key, toKey: key, excludeAppointmentIds: seriesIds });
      if (!(offered.days[key] || []).some((slot) => slot.startsAt === move.startsAt.toISOString())) throw createHttpError(409, `${key} at the recurring time is unavailable. The series was not changed.`, "SLOT_TAKEN");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const move of moves) {
        await lockSchedulingTransaction(tx, req.auth.agencyId, move.startsAt);
        const conflict = await assertSlotAvailable(tx, { agencyId: req.auth.agencyId, assignedToId: move.item.assignedToId, startsAt: move.startsAt, endsAt: move.endsAt, bufferMinutes: move.buffer, excludeAppointmentIds: seriesIds });
        if (conflict) throw createHttpError(409, "A recurring time was just taken. The series was not changed.", "SLOT_TAKEN");
        const result = await tx.appointment.update({ where: { id: move.item.id }, data: { startsAt: move.startsAt, endsAt: move.endsAt, meetingMode, meetingUrl: meetingMode === "Online" ? move.item.meetingUrl || `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}` : null, location: meetingMode === "InPerson" ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : move.item.location : null, locationMapsUrl: meetingMode === "InPerson" ? selectedLocation?.mapsUrl || move.item.locationMapsUrl : null, reminderSentAt: null, reminderDueAt: new Date(move.startsAt.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000), reminderQueuedAt: null }, include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } } });
        await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: move.item.id, actorUserId: req.auth.userId, type: "SERIES_RESCHEDULED", summary: "Appointment moved with recurring series", metadata: { from: move.item.startsAt, to: move.startsAt, seriesKey: existing.seriesKey } });
        results.push(result);
      }
      return results;
    });
    await Promise.all(updated.map((item) => sendBookingMessages({ agencyId: req.auth.agencyId, appointment: item, kind: "rescheduled", actorUserId: req.auth.userId }).catch(() => {})));
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: existing.clientId, caseId: existing.caseId, action: "appointment.series_rescheduled", details: `${updated.length} recurring appointments rescheduled` });
    return res.json({ data: { ...updated.find((item) => item.id === existing.id), seriesAffected: updated.length } });
  }
  const offeredAvailability = await availabilityForRange({ agencyId: req.auth.agencyId, assignedToId: existing.assignedToId, durationMinutes: duration, sessionBufferMinutes: effectiveBuffer, fromKey: dayKey, toKey: dayKey, excludeAppointmentId: existing.id });
  if (!(offeredAvailability.days[dayKey] || []).some((slot) => slot.startsAt === startsAt.toISOString())) throw createHttpError(409, "That time is outside bookable hours or no longer available.", "SLOT_TAKEN");

  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.auth.agencyId, startsAt);
    const conflict = await assertSlotAvailable(tx, {
      agencyId: req.auth.agencyId,
      assignedToId: existing.assignedToId,
      startsAt,
      endsAt,
      bufferMinutes: effectiveBuffer,
      excludeAppointmentId: existing.id,
    });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        startsAt,
        endsAt,
        meetingMode,
        meetingUrl: meetingMode === "Online" ? existing.meetingUrl || `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}` : null,
        location: meetingMode === "InPerson" ? selectedLocation ? `${selectedLocation.name} — ${selectedLocation.address}` : existing.location : null,
        locationMapsUrl: meetingMode === "InPerson" ? selectedLocation?.mapsUrl || existing.locationMapsUrl : null,
        reminderSentAt: null,
        reminderDueAt: new Date(startsAt.getTime() - Math.max(...(Array.isArray(settings.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings.reminderMinutes])) * 60_000),
        reminderQueuedAt: null,
      },
      include: { ...calendarInclude, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: existing.id, actorUserId: req.auth.userId, type: "RESCHEDULED", summary: "Appointment date or format changed", metadata: { from: existing.startsAt, to: startsAt, meetingMode } });
    return updated;
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
      timezone: body.timezone === undefined ? null : optionalTimezone(body.timezone),
      workingHours: body.workingHours === undefined || body.workingHours === null ? undefined : validWorkingHours(body.workingHours),
      daysOff: body.daysOff === undefined ? [] : validDaysOff(body.daysOff),
      bufferMinutes: body.bufferMinutes == null || body.bufferMinutes === "" ? null : boundedInt(body.bufferMinutes, "Personal buffer", 0, 240),
    },
    update: {
      ...(typeof body.acceptsAppointments === "boolean" ? { acceptsAppointments: body.acceptsAppointments } : {}),
      ...(typeof body.publicBookable === "boolean" ? { publicBookable: body.publicBookable } : {}),
      ...(body.maxDailyAppointments !== undefined ? { maxDailyAppointments: body.maxDailyAppointments == null || body.maxDailyAppointments === "" ? null : boundedInt(body.maxDailyAppointments, "Daily appointment limit", 1, 50) } : {}),
      ...(body.timezone !== undefined ? { timezone: optionalTimezone(body.timezone) } : {}),
      ...(body.workingHours !== undefined ? { workingHours: body.workingHours === null ? null : validWorkingHours(body.workingHours) } : {}),
      ...(body.daysOff !== undefined ? { daysOff: validDaysOff(body.daysOff) } : {}),
      ...(body.bufferMinutes !== undefined ? { bufferMinutes: body.bufferMinutes == null || body.bufferMinutes === "" ? null : boundedInt(body.bufferMinutes, "Personal buffer", 0, 240) } : {}),
    },
  });
  res.json({ data });
}

export async function buildSchedulingAnalytics(req, query) {
  const settings = await getOrCreateBookingSettings(req.auth.agencyId);
  const range = query.range == null ? null : String(query.range);
  let dateWhere;
  if (range !== null) {
    if (!["7", "30", "all"].includes(range)) throw createHttpError(400, "Choose a valid analytics range.", "VALIDATION_ERROR");
    dateWhere = range === "all" ? {} : { startsAt: { gte: new Date(Date.now() - Number(range) * 86_400_000) } };
  } else {
    const todayKey = localDateKey(new Date(), settings.timezone);
    const monthKey = `${todayKey.slice(0, 8)}01`;
    const from = query.from ? new Date(String(query.from)) : localDateTimeToUtc(monthKey, 0, settings.timezone);
    const to = query.to ? new Date(String(query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw createHttpError(400, "Choose a valid analytics range up to 366 days.", "VALIDATION_ERROR");
    }
    dateWhere = { startsAt: { gte: from, lte: to } };
  }
  const grouped = await prisma.appointment.groupBy({
    by: ["status"],
    where: { agencyId: req.auth.agencyId, ...dateWhere },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((item) => [item.status, item._count._all]));
  return { booked: Object.values(counts).reduce((sum, value) => sum + value, 0), attended: counts.Completed || 0, cancelled: counts.Cancelled || 0, noShow: counts.NoShow || 0 };
}

export async function getSchedulingAnalytics(req, res) {
  requireAdmin(req);
  res.json({ data: await buildSchedulingAnalytics(req, req.query) });
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
    await recordAppointmentEvent(tx, { agencyId: req.auth.agencyId, appointmentId: appointment.id, actorUserId: req.auth.userId, type: "CLIENT_LINKED", summary: existing ? "Linked to an existing client" : "Visitor converted to a client", metadata: { clientId: created.id } });
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
  await recordAppointmentEvent(prisma, { agencyId: req.auth.agencyId, appointmentId: existing.id, actorUserId: req.auth.userId, type: "STATUS_CHANGED", summary: `Appointment marked ${status}`, metadata: { from: existing.status, to: status } });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: existing.clientId, caseId: existing.caseId, action: "appointment.status_updated", details: `${existing.subject} marked ${status}` });
  if (["Completed", "NoShow"].includes(status)) {
    await sendBookingStaffNotification({ agencyId: req.auth.agencyId, appointment: data, kind: status === "Completed" ? "attended" : "no_show", actorUserId: req.auth.userId }).catch(() => {});
  }
  res.json({ data });
}

export async function buildAppointmentRegistry(req, query) {
  const attendance = String(query.attendance || "all");
  const range = String(query.range || "30");
  if (!["all", "attended", "not_attended", "no_show", "cancelled", "upcoming"].includes(attendance)) {
    throw createHttpError(400, "Choose a valid attendance filter.", "VALIDATION_ERROR");
  }
  if (!["7", "30", "all"].includes(range)) throw createHttpError(400, "Choose a valid date range.", "VALIDATION_ERROR");
  const page = boundedInt(query.page || 1, "Page", 1, 100000);
  const limit = boundedInt(query.limit || 25, "Page size", 1, 100);
  const now = new Date();
  const from = range === "all" ? null : new Date(now.getTime() - Number(range) * 86_400_000);
  const search = String(query.search || "").trim().slice(0, 120);
  const statusWhere = attendance === "attended" ? { status: "Completed" }
    : attendance === "no_show" ? { status: "NoShow" }
      : attendance === "cancelled" ? { status: "Cancelled" }
        : attendance === "upcoming" ? { status: "Scheduled", startsAt: { gte: now } }
          : attendance === "not_attended" ? { OR: [{ status: "NoShow" }, { status: "Scheduled", endsAt: { lt: now } }] }
            : {};
  const where = {
    agencyId: req.auth.agencyId,
    ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}),
    ...(query.assignedToId && req.auth.role !== "consultant" ? { assignedToId: String(query.assignedToId) } : {}),
    AND: [
      statusWhere,
      ...(from && attendance !== "upcoming" ? [{ startsAt: { gte: from } }] : []),
      ...(search ? [{ OR: [
      { guestName: { contains: search, mode: "insensitive" } },
      { guestEmail: { contains: search, mode: "insensitive" } },
      { referenceCode: { contains: search, mode: "insensitive" } },
      { subject: { contains: search, mode: "insensitive" } },
      { client: { is: { fullName: { contains: search, mode: "insensitive" } } } },
      ] }] : []),
    ],
  };
  const [data, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        client: { select: { id: true, fullName: true, email: true, phone: true } },
        assignedTo: { select: { id: true, fullName: true } },
        sessionType: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: attendance === "upcoming" ? "asc" : "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.appointment.count({ where }),
  ]);
  return { data, meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function listAppointmentRegistry(req, res) {
  res.json(await buildAppointmentRegistry(req, req.query));
}

export async function getAppointmentRegistryDetail(req, res) {
  const data = await prisma.appointment.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...(req.auth.role === "consultant" ? { assignedToId: req.auth.userId } : {}) },
    include: {
      client: { select: { id: true, fullName: true, email: true, phone: true } },
      assignedTo: { select: { id: true, fullName: true } },
      sessionType: true,
      events: { orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { id: true, fullName: true } } } },
      messageDeliveries: { select: { id: true, channel: true, kind: true, status: true, sentAt: true, failedAt: true }, orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!data) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  res.json({ data });
}

export async function listSchedulingBlocks(req, res) {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(from.getTime() + 180 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw createHttpError(400, "Choose a valid block range up to one year.", "VALIDATION_ERROR");
  }
  const data = await prisma.schedulingBlock.findMany({
    where: {
      agencyId: req.auth.agencyId,
      ...(req.auth.role === "consultant" ? { userId: req.auth.userId } : req.query.userId ? { userId: String(req.query.userId) } : {}),
      startsAt: { lt: to },
      OR: [{ endsAt: { gt: from } }, { recurrence: { in: ["DAILY", "WEEKLY"] }, recurrenceUntil: { gte: from } }],
    },
    include: { user: { select: { id: true, fullName: true } } },
    orderBy: { startsAt: "asc" },
  });
  res.json({ data });
}

export async function createSchedulingBlock(req, res) {
  const startsAt = new Date(String(req.body?.startsAt || ""));
  const endsAt = new Date(String(req.body?.endsAt || ""));
  const recurrence = String(req.body?.recurrence || "NONE");
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw createHttpError(400, "Choose a valid start and end.", "VALIDATION_ERROR");
  if (!["NONE", "DAILY", "WEEKLY"].includes(recurrence)) throw createHttpError(400, "Choose a valid recurrence.", "VALIDATION_ERROR");
  let userId = req.auth.role === "consultant" ? req.auth.userId : String(req.body?.userId || req.auth.userId);
  const user = await prisma.user.findFirst({ where: { id: userId, agencyId: req.auth.agencyId, status: "active" }, select: { id: true } });
  if (!user) throw createHttpError(400, "Team member not found.", "VALIDATION_ERROR");
  const recurrenceUntil = recurrence === "NONE" ? null : new Date(String(req.body?.recurrenceUntil || ""));
  if (recurrence !== "NONE" && (Number.isNaN(recurrenceUntil.getTime()) || recurrenceUntil < startsAt || recurrenceUntil.getTime() - startsAt.getTime() > 366 * 86_400_000)) {
    throw createHttpError(400, "Recurring blocks need an end date within one year.", "VALIDATION_ERROR");
  }
  const data = await prisma.schedulingBlock.create({ data: {
    agencyId: req.auth.agencyId,
    userId,
    startsAt,
    endsAt,
    title: String(req.body?.title || "Unavailable").trim().slice(0, 120) || "Unavailable",
    recurrence,
    recurrenceUntil,
  }, include: { user: { select: { id: true, fullName: true } } } });
  res.status(201).json({ data });
}

export async function deleteSchedulingBlock(req, res) {
  const existing = await prisma.schedulingBlock.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId, ...(req.auth.role === "consultant" ? { userId: req.auth.userId } : {}) } });
  if (!existing) throw createHttpError(404, "Availability block not found.", "NOT_FOUND");
  await prisma.schedulingBlock.delete({ where: { id: existing.id } });
  res.json({ data: { id: existing.id } });
}

export async function buildBookingWaitlist(req, statusValue) {
  await releaseExpiredWaitlistHolds(req.auth.agencyId);
  const status = String(statusValue || "Waiting");
  if (!["Waiting", "Offered", "Booked", "Closed", "all"].includes(status)) throw createHttpError(400, "Choose a valid waitlist status.", "VALIDATION_ERROR");
  const data = await prisma.bookingWaitlistEntry.findMany({ where: { agencyId: req.auth.agencyId, ...(status === "all" ? {} : { status }) }, orderBy: { createdAt: "asc" }, take: 250 });
  const typeIds = [...new Set(data.map((item) => item.sessionTypeId))];
  const types = await prisma.bookingSessionType.findMany({ where: { id: { in: typeIds }, agencyId: req.auth.agencyId }, select: { id: true, name: true } });
  const typeMap = new Map(types.map((item) => [item.id, item]));
  return data.map((item) => ({ ...item, sessionType: typeMap.get(item.sessionTypeId) || null }));
}

export async function listBookingWaitlist(req, res) {
  requireAdmin(req);
  res.json({ data: await buildBookingWaitlist(req, req.query.status) });
}

export async function updateBookingWaitlistEntry(req, res) {
  requireAdmin(req);
  const status = String(req.body?.status || "");
  if (!["Waiting", "Offered", "Booked", "Closed"].includes(status)) throw createHttpError(400, "Choose a valid waitlist status.", "VALIDATION_ERROR");
  const existing = await prisma.bookingWaitlistEntry.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Waitlist entry not found.", "NOT_FOUND");
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.bookingWaitlistEntry.update({ where: { id: existing.id }, data: { status } });
    if (status === "Closed") await tx.bookingSlotHold.deleteMany({ where: { waitlistEntryId: existing.id, claimedAt: null } });
    return updated;
  });
  res.json({ data });
}

export async function previewBookingEmailTemplate(req, res) {
  requireAdmin(req);
  const kind = String(req.body?.kind || "booked");
  if (!["booked", "reminder", "rescheduled", "cancelled"].includes(kind)) throw createHttpError(400, "Choose a valid email type.", "VALIDATION_ERROR");
  const messageTemplates = req.body?.messageTemplates && typeof req.body.messageTemplates === "object" ? req.body.messageTemplates : null;
  const data = await bookingTemplatePreview({ agencyId: req.auth.agencyId, kind, messageTemplates });
  res.json({ data });
}

export async function testBookingEmailTemplate(req, res) {
  requireAdmin(req);
  const kind = String(req.body?.kind || "booked");
  if (!["booked", "reminder", "rescheduled", "cancelled"].includes(kind)) throw createHttpError(400, "Choose a valid email type.", "VALIDATION_ERROR");
  const messageTemplates = req.body?.messageTemplates && typeof req.body.messageTemplates === "object" ? req.body.messageTemplates : null;
  const data = await sendBookingTemplateTest({ agencyId: req.auth.agencyId, userId: req.auth.userId, kind, messageTemplates });
  res.json({ data });
}
