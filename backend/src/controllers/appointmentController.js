import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere } from "../middleware/authorization.js";

const statuses = new Set(["Scheduled", "Completed", "Cancelled"]);
const include = {
  client: { select: { id: true, fullName: true } },
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
  const assignedToId = await validateAssignee(req, req.body.assignedToId);
  const data = await prisma.appointment.create({
    data: {
      agencyId: req.user.agencyId,
      clientId: caseItem.clientId,
      caseId: caseItem.id,
      subject,
      location: clean(req.body.location, 300) || null,
      calendar: clean(req.body.calendar, 80, "Case Calendar") || "Case Calendar",
      startsAt,
      endsAt,
      description: clean(req.body.description, 5000) || null,
      assignedToId,
      createdById: req.user.id,
      status: statuses.has(req.body.status) ? req.body.status : "Scheduled",
    },
    include,
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: caseItem.clientId,
    caseId: caseItem.id,
    action: "appointment.created",
    details: `${data.subject} scheduled for ${data.startsAt.toISOString()}`,
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
  const data = await prisma.appointment.update({
    where: { id: existing.id },
    data: {
      subject,
      startsAt,
      endsAt,
      assignedToId,
      status,
      ...(req.body.location !== undefined ? { location: clean(req.body.location, 300) || null } : {}),
      ...(req.body.calendar !== undefined ? { calendar: clean(req.body.calendar, 80, "Case Calendar") || "Case Calendar" } : {}),
      ...(req.body.description !== undefined ? { description: clean(req.body.description, 5000) || null } : {}),
    },
    include,
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.updated",
    details: `${data.subject} appointment updated`,
  });
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
  await prisma.appointment.delete({ where: { id: existing.id } });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "appointment.deleted",
    details: `${existing.subject} appointment deleted`,
  });
  res.status(204).send();
}
