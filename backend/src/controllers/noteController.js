import {
  createCrudController,
  fieldParsers,
  recordActivity,
} from "../utils/prismaCrud.js";
import {
  caseAccessWhere,
  clientAccessWhere,
} from "../middleware/authorization.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { appointmentProfileAccessWhere } from "../services/appointmentProfileService.js";
import { recordAppointmentEvent } from "../services/appointmentOperationsService.js";

const include = {
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
  client: {
    select: {
      id: true,
      fullName: true,
    },
  },
  case: {
    select: {
      id: true,
      caseType: true,
      stage: true,
    },
  },
  appointment: {
    select: { id: true, subject: true, startsAt: true, status: true },
  },
};

function noteAccessWhere(req) {
  if (req.auth.role === "admin") return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [
      { client: clientAccessWhere(req) },
      { case: caseAccessWhere(req) },
      { appointment: appointmentProfileAccessWhere(req) },
    ],
  };
}

const fields = {
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  appointmentId: fieldParsers.relationField,
  userId: fieldParsers.relationField,
  content: fieldParsers.stringField,
};

const controller = createCrudController({
  model: "note",
  label: "Note",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: noteAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    ...(req.query.appointmentId
      ? { appointmentId: req.query.appointmentId }
      : {}),
    ...(req.query.userId ? { userId: req.query.userId } : {}),
  }),
  activityEntity: "note",
  afterCreate: async ({ req, data }) => {
    if (!data.appointmentId) return;
    await recordAppointmentEvent(prisma, {
      agencyId: req.auth.agencyId,
      appointmentId: data.appointmentId,
      actorUserId: req.auth.userId,
      type: "NOTE_ADDED",
      summary: "Internal appointment note added",
      metadata: { noteId: data.id },
    });
  },
  afterUpdate: async ({ req, data }) => {
    if (!data.appointmentId) return;
    await recordAppointmentEvent(prisma, {
      agencyId: req.auth.agencyId,
      appointmentId: data.appointmentId,
      actorUserId: req.auth.userId,
      type: "NOTE_UPDATED",
      summary: "Internal appointment note updated",
      metadata: { noteId: data.id },
    });
  },
});

export const listNotes = controller.list;
export const getNoteById = controller.getById;

async function manageableNote(req) {
  const note = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...noteAccessWhere(req),
    },
    select: {
      id: true,
      userId: true,
      clientId: true,
      caseId: true,
      appointmentId: true,
    },
  });
  if (!note) throw createHttpError(404, "Note not found", "NOT_FOUND");
  if (req.auth.role !== "admin" && note.userId !== req.auth.userId) {
    throw createHttpError(
      403,
      "You can only change notes that you created.",
      "FORBIDDEN",
    );
  }
  return note;
}

export async function createNote(req, res) {
  const content = String(req.body.content || "").trim();
  if (!content) throw createHttpError(400, "Enter a note before saving");

  if (req.body.appointmentId) {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: req.body.appointmentId,
        agencyId: req.auth.agencyId,
        ...appointmentProfileAccessWhere(req),
      },
      select: { id: true, clientId: true, caseId: true },
    });
    if (!appointment)
      throw createHttpError(403, "You do not have access to this appointment");
    req.body.clientId = req.body.clientId || appointment.clientId;
    req.body.caseId = req.body.caseId || appointment.caseId;
  } else if (req.body.caseId) {
    const caseItem = await prisma.case.findFirst({
      where: {
        id: req.body.caseId,
        agencyId: req.auth.agencyId,
        ...caseAccessWhere(req),
      },
      select: { id: true },
    });
    if (!caseItem)
      throw createHttpError(403, "You do not have access to this case");
  } else if (req.body.clientId) {
    const client = await prisma.client.findFirst({
      where: {
        id: req.body.clientId,
        agencyId: req.auth.agencyId,
        ...clientAccessWhere(req),
      },
      select: { id: true },
    });
    if (!client)
      throw createHttpError(403, "You do not have access to this client");
  }

  req.body = {
    ...req.body,
    content,
    userId: req.user.id,
  };
  return controller.create(req, res);
}

export async function updateNote(req, res) {
  await manageableNote(req);
  const content = String(req.body?.content || "").trim();
  if (!content)
    throw createHttpError(
      400,
      "Enter a note before saving",
      "VALIDATION_ERROR",
    );
  req.body = { content };
  return controller.update(req, res);
}

export async function deleteNote(req, res) {
  const existing = await manageableNote(req);
  await prisma.$transaction(async (tx) => {
    await tx.note.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedById: req.auth.userId },
    });
    if (existing.appointmentId) {
      await recordAppointmentEvent(tx, {
        agencyId: req.auth.agencyId,
        appointmentId: existing.appointmentId,
        actorUserId: req.auth.userId,
        type: "NOTE_ARCHIVED",
        summary: "Internal appointment note archived",
        metadata: { noteId: existing.id },
      });
    }
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "note.archived",
    details: "Note archived",
    entityType: "note",
    entityId: existing.id,
    metadata: { appointmentId: existing.appointmentId },
  });
  res.status(204).send();
}

export default controller;
