import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere } from "../middleware/authorization.js";
import { assertSlotAvailable, getOrCreateBookingSettings } from "../services/bookingAvailabilityService.js";
import { chooseAppointmentAssignee, lockSchedulingTransaction } from "../services/schedulingAssignmentService.js";
import { sendBookingMessages } from "../services/bookingNotificationService.js";
import { logger } from "../services/logger.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";

const statuses = new Set(["Scheduled", "Completed", "Cancelled", "NoShow"]);
const include = {
  client: { select: { id: true, fullName: true, email: true, phone: true, assignedUserId: true } },
  assignedTo: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true } },
};

function clean(value, max, fallback = "") {
  return String(value ?? fallback).trim().slice(0, max);
}

function dateValue(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${field} is required and must be valid`);
  }
  return date;
}

async function scopedCase(req, caseId) {
  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId: req.user.agencyId, ...caseAccessWhere(req) },
    select: { id: true, clientId: true },
  });
  if (!caseItem) throw createHttpError(404, "Case not found");
  return caseItem;
}

async function validateAssignee(req, assignedToId) {
  if (!assignedToId) return null;
  const user = await prisma.user.findFirst({
    where: {
      id: assignedToId,
      agencyId: req.user.agencyId,
      status: "active",
      memberships: {
        some: {
          agencyId: req.user.agencyId,
          isActive: true,
          role: { in: ["admin", "consultant"] },
        },
      },
    },
    select: { id: true },
  });
  if (!user) throw createHttpError(400, "Assigned team member was not found");
  return user.id;
}

function validateRange(startsAt, endsAt) {
  if (endsAt <= startsAt) {
    throw createHttpError(400, "End time must be later than start time");
  }
}

export async function listCaseAppointments(req, res) {
  const caseItem = await scopedCase(req, req.params.caseId);
  const data = await prisma.appointment.findMany({
    where: { agencyId: req.user.agencyId, caseId: caseItem.id },
    include,
    orderBy: { startsAt: "asc" },
  });
  res.json({ data });
}

export async function createAppointment(req, res) {
  const caseItem = await scopedCase(req, clean(req.body.caseId, 80));
  const subject = clean(req.body.subject, 180);
  if (!subject) throw createHttpError(400, "Subject is required");
  const startsAt = dateValue(req.body.startsAt, "Start time");
  const endsAt = dateValue(req.body.endsAt, "End time");
  validateRange(startsAt, endsAt);
  const requestedAssigneeId = await validateAssignee(req, req.body.assignedToId);
  const [settings, client] = await Promise.all([
    getOrCreateBookingSettings(req.user.agencyId),
    prisma.client.findUnique({ where: { id: caseItem.clientId }, select: { assignedUserId: true } }),
  ]);
  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.user.agencyId, startsAt);
    const assignee = await chooseAppointmentAssignee({ agencyId: req.user.agencyId, startsAt, endsAt, requestedUserId: requestedAssigneeId, preferredUserId: client?.assignedUserId, bufferMinutes: settings.bufferMinutes, timezone: settings.timezone, db: tx });
    const conflict = await assertSlotAvailable(tx, { agencyId: req.user.agencyId, assignedToId: assignee.id, startsAt, endsAt, bufferMinutes: settings.bufferMinutes });
    if (conflict) throw createHttpError(409, "That time was just taken.", "SLOT_TAKEN");
    return tx.appointment.create({ data: {
      agencyId: req.user.agencyId,
      clientId: caseItem.clientId,
      caseId: caseItem.id,
      subject,
      location: clean(req.body.location, 300) || null,
      calendar: clean(req.body.calendar, 80, "Case Calendar") || "Case Calendar",
      startsAt,
      endsAt,
      description: clean(req.body.description, 5000) || null,
      assignedToId: assignee.id,
      createdById: req.user.id,
      source: "Case",
      reminderDueAt: new Date(startsAt.getTime() - settings.reminderMinutes * 60_000),
      status: statuses.has(req.body.status) ? req.body.status : "Scheduled",
    }, include });
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: caseItem.clientId,
    caseId: caseItem.id,
    action: "appointment.created",
    details: `${data.subject} scheduled for ${data.startsAt.toISOString()}`,
  });
  invalidateDashboardCache(req.user.agencyId);
  await sendBookingMessages({ agencyId: req.user.agencyId, appointment: data, kind: "booked", actorUserId: req.user.id }).catch((error) => {
    logger.warn("appointment_controller.booked_message_failed", { agencyId: req.user.agencyId, appointmentId: data.id, reason: error.message });
  });
  res.status(201).json({ data });
}

export async function updateAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      case: caseAccessWhere(req),
    },
  });
  if (!existing) throw createHttpError(404, "Appointment not found");
  const startsAt = req.body.startsAt === undefined ? existing.startsAt : dateValue(req.body.startsAt, "Start time");
  const endsAt = req.body.endsAt === undefined ? existing.endsAt : dateValue(req.body.endsAt, "End time");
  validateRange(startsAt, endsAt);
  const subject = req.body.subject === undefined ? existing.subject : clean(req.body.subject, 180);
  if (!subject) throw createHttpError(400, "Subject is required");
  const assignedToId = req.body.assignedToId === undefined ? existing.assignedToId : await validateAssignee(req, req.body.assignedToId);
  const status = req.body.status === undefined ? existing.status : req.body.status;
  if (!statuses.has(status)) throw createHttpError(400, "Invalid appointment status");
  const settings = await getOrCreateBookingSettings(req.user.agencyId);
  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.user.agencyId, startsAt);
    if (status === "Scheduled") {
      const conflict = await assertSlotAvailable(tx, { agencyId: req.user.agencyId, assignedToId, startsAt, endsAt, bufferMinutes: settings.bufferMinutes, excludeAppointmentId: existing.id });
      if (conflict) throw createHttpError(409, "That time was just taken.", "SLOT_TAKEN");
    }
    return tx.appointment.update({ where: { id: existing.id }, data: {
      subject,
      startsAt,
      endsAt,
      assignedToId,
      status,
      reminderDueAt: new Date(startsAt.getTime() - settings.reminderMinutes * 60_000),
      ...((startsAt.getTime() !== new Date(existing.startsAt).getTime()) ? { reminderSentAt: null, reminderQueuedAt: null } : {}),
      ...(status === "Cancelled" ? { cancelledAt: new Date(), cancelledById: req.user.id } : {}),
      ...(req.body.location !== undefined ? { location: clean(req.body.location, 300) || null } : {}),
      ...(req.body.calendar !== undefined ? { calendar: clean(req.body.calendar, 80, "Case Calendar") || "Case Calendar" } : {}),
      ...(req.body.description !== undefined ? { description: clean(req.body.description, 5000) || null } : {}),
    }, include });
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.updated",
    details: `${data.subject} appointment updated`,
  });
  invalidateDashboardCache(req.user.agencyId);
  const notifyFailed = (kind) => (error) => {
    logger.warn("appointment_controller.status_message_failed", { agencyId: req.user.agencyId, appointmentId: data.id, kind, reason: error.message });
  };
  if (status === "Cancelled" && existing.status !== "Cancelled") await sendBookingMessages({ agencyId: req.user.agencyId, appointment: data, kind: "cancelled", actorUserId: req.user.id }).catch(notifyFailed("cancelled"));
  else if (startsAt.getTime() !== new Date(existing.startsAt).getTime()) await sendBookingMessages({ agencyId: req.user.agencyId, appointment: data, kind: "rescheduled", actorUserId: req.user.id }).catch(notifyFailed("rescheduled"));
  res.json({ data });
}

export async function deleteAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      case: caseAccessWhere(req),
    },
  });
  if (!existing) throw createHttpError(404, "Appointment not found");
  const data = await prisma.appointment.update({ where: { id: existing.id }, data: { status: "Cancelled", cancelledAt: new Date(), cancelledById: req.user.id, cancellationReason: "Cancelled from case" }, include });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.cancelled",
    details: `${existing.subject} appointment cancelled`,
  });
  invalidateDashboardCache(req.user.agencyId);
  await sendBookingMessages({ agencyId: req.user.agencyId, appointment: data, kind: "cancelled", actorUserId: req.user.id }).catch((error) => {
    logger.warn("appointment_controller.cancelled_message_failed", { agencyId: req.user.agencyId, appointmentId: data.id, reason: error.message });
  });
  res.status(204).send();
}
