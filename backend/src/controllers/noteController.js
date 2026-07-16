import { createCrudController, fieldParsers } from "../utils/prismaCrud.js";
import {
  caseAccessWhere,
  clientAccessWhere,
  relatedRecordAccessWhere,
} from "../middleware/authorization.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";

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
};

const fields = {
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  userId: fieldParsers.relationField,
  content: fieldParsers.stringField,
};

const controller = createCrudController({
  model: "note",
  label: "Note",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: relatedRecordAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    ...(req.query.userId ? { userId: req.query.userId } : {}),
  }),
  activityEntity: "note",
});

export const listNotes = controller.list;
export const getNoteById = controller.getById;

async function manageableNote(req) {
  const note = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...relatedRecordAccessWhere(req),
    },
    select: { id: true, userId: true },
  });
  if (!note) throw createHttpError(404, "Note not found", "NOT_FOUND");
  if (req.auth.role === "consultant" && note.userId !== req.auth.userId) {
    throw createHttpError(403, "You can only change notes that you created.", "FORBIDDEN");
  }
  return note;
}

export async function createNote(req, res) {
  const content = String(req.body.content || "").trim();
  if (!content) throw createHttpError(400, "Enter a note before saving");

  if (req.body.caseId) {
    const caseItem = await prisma.case.findFirst({
      where: {
        id: req.body.caseId,
        agencyId: req.auth.agencyId,
        ...caseAccessWhere(req),
      },
      select: { id: true },
    });
    if (!caseItem) throw createHttpError(403, "You do not have access to this case");
  } else if (req.body.clientId) {
    const client = await prisma.client.findFirst({
      where: {
        id: req.body.clientId,
        agencyId: req.auth.agencyId,
        ...clientAccessWhere(req),
      },
      select: { id: true },
    });
    if (!client) throw createHttpError(403, "You do not have access to this client");
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
  if (!content) throw createHttpError(400, "Enter a note before saving", "VALIDATION_ERROR");
  req.body = { content };
  return controller.update(req, res);
}

export async function deleteNote(req, res) {
  await manageableNote(req);
  return controller.remove(req, res);
}

export default controller;
