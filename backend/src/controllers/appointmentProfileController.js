import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { notifyUsers } from "../services/notificationService.js";
import { recordAppointmentEvent } from "../services/appointmentOperationsService.js";
import { requireAppointmentProfile } from "../services/appointmentProfileService.js";

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

export async function getAppointmentProfile(req, res) {
  res.json({ data: await requireAppointmentProfile(req, req.params.id) });
}

export async function updateAppointmentProfileContext(req, res) {
  const existing = await requireAppointmentProfile(req, req.params.id);
  const purpose = Object.hasOwn(req.body || {}, "purpose") ? clean(req.body.purpose, 5000) || null : existing.purpose;
  const internalNotes = Object.hasOwn(req.body || {}, "internalNotes") ? clean(req.body.internalNotes, 10000) || null : existing.internalNotes;
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        purpose,
        // Keep legacy consumers working while purpose replaces description.
        description: purpose,
        internalNotes,
      },
    });
    await recordAppointmentEvent(tx, {
      agencyId: existing.agencyId,
      appointmentId: existing.id,
      actorUserId: req.auth.userId,
      type: "CONTEXT_UPDATED",
      summary: "Appointment context updated",
    });
    return updated;
  });
  res.json({ data: { purpose: data.purpose || data.description || null, internalNotes: data.internalNotes } });
}

export async function createAppointmentNote(req, res) {
  const appointment = await requireAppointmentProfile(req, req.params.id);
  const content = clean(req.body?.content, 10000);
  if (!content) throw createHttpError(400, "Enter a note before saving.", "VALIDATION_ERROR");
  const data = await prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        agencyId: appointment.agencyId,
        appointmentId: appointment.id,
        clientId: appointment.clientId,
        caseId: appointment.caseId,
        userId: req.auth.userId,
        content,
        clientVisible: false,
      },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
    await recordAppointmentEvent(tx, {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      actorUserId: req.auth.userId,
      type: "NOTE_ADDED",
      summary: "Internal appointment note added",
      metadata: { noteId: note.id },
    });
    return note;
  });
  res.status(201).json({ data });
}

export async function createAppointmentFollowUp(req, res) {
  const appointment = await requireAppointmentProfile(req, req.params.id);
  const title = clean(req.body?.title, 180);
  if (!title) throw createHttpError(400, "Follow-up title is required.", "VALIDATION_ERROR");
  const dueDate = req.body?.dueDate ? new Date(req.body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) throw createHttpError(400, "Choose a valid follow-up date.", "VALIDATION_ERROR");
  const assignedUserId = String(req.body?.assignedUserId || appointment.assignedToId || req.auth.userId);
  const assignee = await prisma.user.findFirst({
    where: { id: assignedUserId, agencyId: appointment.agencyId, status: "active" },
    select: { id: true },
  });
  if (!assignee) throw createHttpError(400, "Assigned team member was not found.", "VALIDATION_ERROR");
  const data = await prisma.$transaction(async (tx) => {
    const followUp = await tx.followUp.create({
      data: {
        agencyId: appointment.agencyId,
        appointmentId: appointment.id,
        clientId: appointment.clientId,
        caseId: appointment.caseId,
        assignedUserId,
        title,
        description: clean(req.body?.description, 2000) || null,
        dueDate,
        reminderAt: dueDate,
        notificationChannels: ["in_app"],
        status: "Pending",
      },
      include: { assignedUser: { select: { id: true, fullName: true, email: true } } },
    });
    await recordAppointmentEvent(tx, {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      actorUserId: req.auth.userId,
      type: "FOLLOW_UP_CREATED",
      summary: "Follow-up created from appointment",
      metadata: { followUpId: followUp.id, dueDate },
    });
    return followUp;
  });
  await notifyUsers({
    agencyId: appointment.agencyId,
    recipientIds: [assignedUserId],
    actorUserId: req.auth.userId,
    type: "follow_up.assigned",
    category: "work",
    title: `Follow-up assigned: ${data.title}`,
    body: dueDate ? `Due ${dueDate.toISOString()}` : data.description,
    severity: "info",
    entityType: "follow_up",
    entityId: data.id,
    actionUrl: appointment.caseId ? `/app/cases/${appointment.caseId}` : "/app/follow-ups",
    dedupeKey: `follow-up:${data.id}:assigned:${assignedUserId}`,
  });
  res.status(201).json({ data });
}
