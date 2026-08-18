import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { caseNotificationActionUrl, notifyUsers } from "../services/notificationService.js";
import { recordAppointmentEvent } from "../services/appointmentOperationsService.js";
import { requireAppointmentProfile } from "../services/appointmentProfileService.js";
import { APPOINTMENT_SUBJECT_MAX_WORDS } from "./bookingController.js";

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

export async function getAppointmentProfile(req, res) {
  res.json({ data: await requireAppointmentProfile(req, req.params.id) });
}

export async function updateAppointmentProfileContext(req, res) {
  const existing = await requireAppointmentProfile(req, req.params.id);
  const purpose = Object.hasOwn(req.body || {}, "purpose") ? clean(req.body.purpose, 5000) || null : existing.purpose;
  const internalNotes = Object.hasOwn(req.body || {}, "internalNotes") ? clean(req.body.internalNotes, 10000) || null : existing.internalNotes;
  // Staff correcting a bad entry (e.g. a walk-in confirmation pasted into
  // the subject by mistake) must be held to the same required + word-cap
  // rule the booking sheet enforces at creation — otherwise "fixing" it
  // could just paste in another oversized blob.
  let subject = existing.subject;
  if (Object.hasOwn(req.body || {}, "subject")) {
    const trimmedSubject = clean(req.body.subject, 200);
    if (!trimmedSubject) throw createHttpError(400, "Add a subject for this appointment.", "SUBJECT_REQUIRED");
    const subjectWords = wordCount(trimmedSubject);
    if (subjectWords > APPOINTMENT_SUBJECT_MAX_WORDS) {
      throw createHttpError(400, `Keep the subject to ${APPOINTMENT_SUBJECT_MAX_WORDS} words or fewer (currently ${subjectWords}).`, "SUBJECT_TOO_LONG");
    }
    subject = trimmedSubject;
  }
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        subject,
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
      summary: subject !== existing.subject ? "Appointment subject and context updated" : "Appointment context updated",
    });
    return updated;
  });
  res.json({ data: { subject: data.subject, purpose: data.purpose || data.description || null, internalNotes: data.internalNotes } });
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
        createdById: req.auth.userId,
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
    actionUrl: appointment.caseId
      ? caseNotificationActionUrl(appointment.caseId, { type: "follow_up.assigned", category: "work", entityId: data.id })
      : `/app/follow-ups?highlight=${encodeURIComponent(data.id)}`,
    dedupeKey: `follow-up:${data.id}:assigned:${assignedUserId}`,
  });
  res.status(201).json({ data });
}
