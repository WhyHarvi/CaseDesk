import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere, clientAccessWhere, relatedRecordAccessWhere } from "../middleware/authorization.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";

const include = {
  client: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
    },
  },
  case: {
    select: {
      id: true,
      caseType: true,
      stage: true,
    },
  },
  assignedUser: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
};

const fields = {
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  assignedUserId: fieldParsers.relationField,
  title: fieldParsers.stringField,
  description: fieldParsers.stringField,
  dueDate: fieldParsers.dateField,
  status: fieldParsers.enumField(["Pending", "Completed", "Overdue", "Cancelled"]),
  completedAt: fieldParsers.dateField,
};

const controller = createCrudController({
  model: "followUp",
  label: "Follow-up",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: relatedRecordAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    ...(req.query.assignedUserId ? { assignedUserId: req.query.assignedUserId } : {}),
    ...(req.query.status ? { status: req.query.status } : {}),
  }),
  activityEntity: "follow_up",
});

export const listFollowUps = controller.list;
export const getFollowUpById = controller.getById;
function relationValue(value) {
  return value === "" || value === undefined ? null : value;
}

async function validateRelationships(req, existing = null) {
  const body = req.body || {};
  const clientId = Object.hasOwn(body, "clientId") ? relationValue(body.clientId) : existing?.clientId || null;
  const caseId = Object.hasOwn(body, "caseId") ? relationValue(body.caseId) : existing?.caseId || null;
  const assignedUserId = Object.hasOwn(body, "assignedUserId")
    ? relationValue(body.assignedUserId)
    : existing?.assignedUserId || null;

  if (!clientId && !caseId) {
    throw createHttpError(400, "Select an accessible client or case for this follow-up.", "VALIDATION_ERROR");
  }

  const [client, caseItem, assignee] = await Promise.all([
    clientId
      ? prisma.client.findFirst({
          where: { id: clientId, agencyId: req.auth.agencyId, ...clientAccessWhere(req) },
          select: { id: true },
        })
      : null,
    caseId
      ? prisma.case.findFirst({
          where: { id: caseId, agencyId: req.auth.agencyId, ...caseAccessWhere(req) },
          select: { id: true, clientId: true },
        })
      : null,
    assignedUserId
      ? prisma.user.findFirst({
          where: {
            id: assignedUserId,
            agencyId: req.auth.agencyId,
            status: "active",
            memberships: {
              some: {
                agencyId: req.auth.agencyId,
                isActive: true,
                role: { in: ["admin", "consultant"] },
              },
            },
          },
          select: { id: true },
        })
      : null,
  ]);

  if (clientId && !client) throw createHttpError(403, "You do not have access to the selected client.", "FORBIDDEN");
  if (caseId && !caseItem) throw createHttpError(403, "You do not have access to the selected case.", "FORBIDDEN");
  if (assignedUserId && !assignee) throw createHttpError(400, "Assigned staff member was not found or is inactive.", "VALIDATION_ERROR");
  if (clientId && caseItem && caseItem.clientId !== clientId) {
    throw createHttpError(400, "The selected case does not belong to the selected client.", "VALIDATION_ERROR");
  }
}

export async function createFollowUp(req, res) {
  req.body = { ...(req.body || {}) };
  if (req.auth.role === "consultant" && !Object.hasOwn(req.body, "assignedUserId")) {
    req.body.assignedUserId = req.auth.userId;
  }
  await validateRelationships(req);
  return controller.create(req, res);
}

export async function updateFollowUp(req, res) {
  const existing = await prisma.followUp.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...relatedRecordAccessWhere(req),
    },
    select: { id: true, clientId: true, caseId: true, assignedUserId: true },
  });
  if (!existing) throw createHttpError(404, "Follow-up not found.", "NOT_FOUND");
  await validateRelationships(req, existing);
  return controller.update(req, res);
}
export async function cancelFollowUp(req, res) {
  const existing = await prisma.followUp.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...relatedRecordAccessWhere(req) },
    include,
  });
  if (!existing) throw createHttpError(404, "Follow-up not found.", "NOT_FOUND");
  if (existing.status === "Cancelled") throw createHttpError(409, "Follow-up is already cancelled.", "FOLLOW_UP_ALREADY_CANCELLED");
  if (existing.status === "Completed") throw createHttpError(409, "A completed follow-up cannot be cancelled.", "FOLLOW_UP_COMPLETED");
  const data = await prisma.followUp.update({ where: { id: existing.id }, data: { status: "Cancelled", completedAt: new Date() }, include });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: data.clientId, caseId: data.caseId, action: "follow_up.cancelled", details: `${data.title} cancelled` });
  res.json({ data });
}

export default controller;
