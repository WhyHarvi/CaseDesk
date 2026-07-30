import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere } from "../middleware/authorization.js";
import { assertSlotAvailable, getOrCreateBookingSettings } from "../services/bookingAvailabilityService.js";
import { chooseAppointmentAssignee, lockSchedulingTransaction } from "../services/schedulingAssignmentService.js";
import {
  processBookingMessageDeliveries,
  sendBookingMessages,
  sendBookingStaffNotification,
} from "../services/bookingNotificationService.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";
import { enqueueAppointmentMeetingJob } from "../services/appointmentMeetingService.js";
import { syncLeadConsultationFromAppointment } from "../services/leadConsultationAppointmentService.js";
import { offerWaitlistOpening } from "../services/bookingWaitlistService.js";
import { assertZoomOperational } from "../services/zoomService.js";
import {
  MEETING_MODES,
  appointmentMeetingFields,
  assertMeetingModeConfigured,
  normalizeMeetingMode,
} from "../services/bookingMeetingModeService.js";

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
    prisma.client.findUnique({ where: { id: caseItem.clientId }, select: { assignedUserId: true, phone: true } }),
  ]);
  const meetingMode = normalizeMeetingMode(req.body.meetingMode);
  assertMeetingModeConfigured({ settings, mode: meetingMode, guestPhone: client?.phone });
  if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(req.user.agencyId);
  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.user.agencyId, startsAt);
    if (meetingMode === MEETING_MODES.ZOOM) await assertZoomOperational(req.user.agencyId, tx);
    const assignee = await chooseAppointmentAssignee({ agencyId: req.user.agencyId, startsAt, endsAt, requestedUserId: requestedAssigneeId, preferredUserId: client?.assignedUserId, bufferMinutes: settings.bufferMinutes, timezone: settings.timezone, meetingMode, db: tx });
    const conflict = await assertSlotAvailable(tx, { agencyId: req.user.agencyId, assignedToId: assignee.id, startsAt, endsAt, bufferMinutes: settings.bufferMinutes });
    if (conflict) throw createHttpError(409, "That time was just taken.", "SLOT_TAKEN");
    const created = await tx.appointment.create({ data: {
      agencyId: req.user.agencyId,
      clientId: caseItem.clientId,
      caseId: caseItem.id,
      subject,
      ...appointmentMeetingFields({ mode: meetingMode, settings }),
      location: meetingMode === MEETING_MODES.IN_PERSON ? clean(req.body.location, 300) || null : null,
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
    if (meetingMode === MEETING_MODES.ZOOM && created.status === "Scheduled") {
      await enqueueAppointmentMeetingJob(tx, {
        appointment: created,
        action: "SYNC",
        notifyKind: "booked",
        actorUserId: req.user.id,
        dedupeSuffix: "case-appointment-created",
      });
    } else if (created.status === "Scheduled") {
      await sendBookingMessages({ agencyId: req.user.agencyId, appointment: created, kind: "booked", actorUserId: req.user.id, db: tx });
    }
    return created;
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
  if (data.status === "Scheduled" && data.meetingMode !== MEETING_MODES.ZOOM) void processBookingMessageDeliveries();
  res.status(201).json({ data });
}

export async function updateAppointment(req, res) {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      case: caseAccessWhere(req),
    },
    include: { client: { select: { phone: true } } },
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
  const timeChanged = startsAt.getTime() !== new Date(existing.startsAt).getTime()
    || endsAt.getTime() !== new Date(existing.endsAt).getTime();
  const assigneeChanged = assignedToId !== existing.assignedToId;
  const meetingMode = req.body.meetingMode === undefined
    ? normalizeMeetingMode(existing.meetingMode)
    : normalizeMeetingMode(req.body.meetingMode, existing.meetingMode);
  const modeChanged = meetingMode !== existing.meetingMode;
  const meetingChanged = timeChanged || assigneeChanged || modeChanged;
  if (modeChanged) {
    assertMeetingModeConfigured({ settings, mode: meetingMode, guestPhone: existing.client?.phone });
  }
  if (meetingMode === MEETING_MODES.ZOOM && status === "Scheduled" && meetingChanged) {
    await assertZoomOperational(req.user.agencyId);
    const mapping = assignedToId ? await prisma.zoomHostMapping.findFirst({
      where: { agencyId: req.user.agencyId, userId: assignedToId, status: "active" },
      select: { id: true },
    }) : null;
    if (!mapping) throw createHttpError(409, "Zoom is not configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
  }
  const data = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, req.user.agencyId, startsAt);
    if (status === "Scheduled") {
      const conflict = await assertSlotAvailable(tx, { agencyId: req.user.agencyId, assignedToId, startsAt, endsAt, bufferMinutes: settings.bufferMinutes, excludeAppointmentId: existing.id });
      if (conflict) throw createHttpError(409, "That time was just taken.", "SLOT_TAKEN");
    }
    if (meetingMode === MEETING_MODES.ZOOM && status === "Scheduled" && meetingChanged) {
      await assertZoomOperational(req.user.agencyId, tx);
      const mapping = assignedToId ? await tx.zoomHostMapping.findFirst({
        where: { agencyId: req.user.agencyId, userId: assignedToId, status: "active" },
        select: { id: true },
      }) : null;
      if (!mapping) throw createHttpError(409, "Zoom is no longer configured for this consultant.", "ZOOM_HOST_NOT_MAPPED");
    }
    const meetingFields = modeChanged || (meetingMode === MEETING_MODES.ZOOM && meetingChanged)
      ? appointmentMeetingFields({ mode: meetingMode, settings, existing })
      : {};
    const updated = await tx.appointment.update({ where: { id: existing.id }, data: {
      subject,
      startsAt,
      endsAt,
      assignedToId,
      status,
      ...meetingFields,
      reminderDueAt: new Date(startsAt.getTime() - settings.reminderMinutes * 60_000),
      ...((startsAt.getTime() !== new Date(existing.startsAt).getTime()) ? { reminderSentAt: null, reminderQueuedAt: null } : {}),
      ...(status === "Cancelled" ? { cancelledAt: new Date(), cancelledById: req.user.id } : {}),
      ...(req.body.location !== undefined || modeChanged ? {
        location: meetingMode === MEETING_MODES.IN_PERSON
          ? clean(req.body.location === undefined ? existing.location : req.body.location, 300) || null
          : null,
      } : {}),
      ...(req.body.calendar !== undefined ? { calendar: clean(req.body.calendar, 80, "Case Calendar") || "Case Calendar" } : {}),
      ...(req.body.description !== undefined ? { description: clean(req.body.description, 5000) || null } : {}),
    }, include });
    await syncLeadConsultationFromAppointment(tx, updated, {
      consultationStatus: status === "Completed" ? "COMPLETED"
        : status === "Cancelled" ? "CANCELLED"
          : status === "NoShow" ? "NO_SHOW"
            : timeChanged ? "RESCHEDULED"
              : null,
    });
    if (meetingMode === MEETING_MODES.ZOOM && status === "Scheduled" && meetingChanged) {
      await enqueueAppointmentMeetingJob(tx, {
        appointment: updated,
        action: "SYNC",
        notifyKind: timeChanged ? "rescheduled" : modeChanged ? "format_updated" : "meeting_updated",
        actorUserId: req.user.id,
        dedupeSuffix: "case-appointment-updated",
      });
    }
    if (existing.meetingProvider === "Zoom" && existing.meetingProviderId && modeChanged && meetingMode !== MEETING_MODES.ZOOM) {
      await enqueueAppointmentMeetingJob(tx, {
        appointment: updated,
        action: "DELETE",
        providerMeetingId: existing.meetingProviderId,
        dedupeSuffix: "case-appointment-format-changed",
      });
    }
    if (existing.meetingProvider === "Zoom" && existing.meetingProviderId && status === "Cancelled" && existing.status !== "Cancelled") {
      await enqueueAppointmentMeetingJob(tx, {
        appointment: updated,
        action: "DELETE",
        providerMeetingId: existing.meetingProviderId,
        dedupeSuffix: "case-appointment-cancelled",
      });
    }
    if (status === "Cancelled" && existing.status !== "Cancelled") {
      await sendBookingMessages({ agencyId: req.user.agencyId, appointment: updated, kind: "cancelled", actorUserId: req.user.id, db: tx });
    } else if (status === "NoShow" && existing.status !== "NoShow") {
      await sendBookingStaffNotification({ agencyId: req.user.agencyId, appointment: updated, kind: "no_show", actorUserId: req.user.id, db: tx });
    } else if (status === "Completed" && existing.status !== "Completed") {
      await sendBookingStaffNotification({ agencyId: req.user.agencyId, appointment: updated, kind: "attended", actorUserId: req.user.id, db: tx });
    } else if (updated.meetingMode !== MEETING_MODES.ZOOM && timeChanged) {
      await sendBookingMessages({ agencyId: req.user.agencyId, appointment: updated, kind: "rescheduled", actorUserId: req.user.id, db: tx });
    } else if (updated.meetingMode !== MEETING_MODES.ZOOM && modeChanged) {
      await sendBookingMessages({ agencyId: req.user.agencyId, appointment: updated, kind: "format_updated", actorUserId: req.user.id, db: tx });
    } else if (updated.meetingMode !== MEETING_MODES.ZOOM && assigneeChanged) {
      await sendBookingMessages({ agencyId: req.user.agencyId, appointment: updated, kind: "assignment_updated", actorUserId: req.user.id, db: tx });
    }
    return updated;
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
  void processBookingMessageDeliveries();
  if (status === "Cancelled" && existing.status !== "Cancelled") await offerWaitlistOpening(data).catch(() => {});
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
  const data = await prisma.$transaction(async (tx) => {
    const cancelled = await tx.appointment.update({ where: { id: existing.id }, data: { status: "Cancelled", cancelledAt: new Date(), cancelledById: req.user.id, cancellationReason: "Cancelled from case" }, include });
    await syncLeadConsultationFromAppointment(tx, cancelled, { consultationStatus: "CANCELLED" });
    if (existing.meetingProvider === "Zoom" && existing.meetingProviderId) {
      await enqueueAppointmentMeetingJob(tx, {
        appointment: cancelled,
        action: "DELETE",
        providerMeetingId: existing.meetingProviderId,
        dedupeSuffix: "case-appointment-deleted",
      });
    }
    await sendBookingMessages({ agencyId: req.user.agencyId, appointment: cancelled, kind: "cancelled", actorUserId: req.user.id, db: tx });
    return cancelled;
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.cancelled",
    details: `${existing.subject} appointment cancelled`,
  });
  invalidateDashboardCache(req.user.agencyId);
  void processBookingMessageDeliveries();
  await offerWaitlistOpening(data).catch(() => {});
  res.status(204).send();
}
