import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { notifyUsers } from "../services/notificationService.js";
import { appointmentProfileAccessWhere } from "../services/appointmentProfileService.js";

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
  appointment: {
    select: { id: true, subject: true, startsAt: true, status: true },
  },
  assignedUser: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
};

function followUpAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  return { OR: [
    { client: clientAccessWhere(req) },
    { case: caseAccessWhere(req) },
    { appointment: appointmentProfileAccessWhere(req) },
  ] };
}

const fields = {
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  appointmentId: fieldParsers.relationField,
  assignedUserId: fieldParsers.relationField,
  title: fieldParsers.stringField,
  description: fieldParsers.stringField,
  dueDate: fieldParsers.dateField,
  status: fieldParsers.enumField(["Pending", "Completed", "Overdue", "Cancelled"]),
  completedAt: fieldParsers.dateField,
  reminderAt: fieldParsers.dateField,
  notificationChannels: (value) => Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).toLowerCase()).filter((item) => ["in_app", "email", "sms"].includes(item)))]
    : undefined,
  notifyClient: fieldParsers.booleanField,
};

const controller = createCrudController({
  model: "followUp",
  label: "Follow-up",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: followUpAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    ...(req.query.appointmentId ? { appointmentId: req.query.appointmentId } : {}),
    ...(req.query.assignedUserId ? { assignedUserId: req.query.assignedUserId } : {}),
    ...(req.query.status ? { status: req.query.status } : {}),
  }),
  activityEntity: "follow_up",
  afterCreate: async ({ req, data }) => {
    if (!data.assignedUserId) return;
    await notifyUsers({
      agencyId: req.auth.agencyId,
      recipientIds: [data.assignedUserId],
      actorUserId: req.auth.userId,
      type: "follow_up.assigned",
      category: "work",
      title: `Follow-up assigned: ${data.title}`,
      body: data.dueDate ? `Due ${data.dueDate.toISOString()}` : data.description,
      severity: "info",
      entityType: "follow_up",
      entityId: data.id,
      actionUrl: data.caseId ? `/app/cases/${data.caseId}` : "/app/follow-ups",
      dedupeKey: `follow-up:${data.id}:assigned:${data.assignedUserId}`,
    });
  },
  afterUpdate: async ({ req, existing, data }) => {
    if (!data.assignedUserId || data.assignedUserId === existing.assignedUserId) return;
    await notifyUsers({
      agencyId: req.auth.agencyId,
      recipientIds: [data.assignedUserId],
      actorUserId: req.auth.userId,
      type: "follow_up.reassigned",
      category: "work",
      title: `Follow-up reassigned: ${data.title}`,
      body: data.dueDate ? `Due ${data.dueDate.toISOString()}` : data.description,
      severity: "info",
      entityType: "follow_up",
      entityId: data.id,
      actionUrl: data.caseId ? `/app/cases/${data.caseId}` : "/app/follow-ups",
      dedupeKey: `follow-up:${data.id}:assigned:${data.assignedUserId}:${data.updatedAt.toISOString()}`,
    });
  },
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
  const appointmentId = Object.hasOwn(body, "appointmentId") ? relationValue(body.appointmentId) : existing?.appointmentId || null;
  const assignedUserId = Object.hasOwn(body, "assignedUserId")
    ? relationValue(body.assignedUserId)
    : existing?.assignedUserId || null;

  if (!clientId && !caseId && !appointmentId) {
    throw createHttpError(400, "Select an accessible client, case, or appointment for this follow-up.", "VALIDATION_ERROR");
  }

  const [client, caseItem, appointment, assignee] = await Promise.all([
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
    appointmentId
      ? prisma.appointment.findFirst({
          where: { id: appointmentId, agencyId: req.auth.agencyId, ...appointmentProfileAccessWhere(req) },
          select: { id: true, clientId: true, caseId: true },
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
  if (appointmentId && !appointment) throw createHttpError(403, "You do not have access to the selected appointment.", "FORBIDDEN");
  if (assignedUserId && !assignee) throw createHttpError(400, "Assigned staff member was not found or is inactive.", "VALIDATION_ERROR");
  if (clientId && caseItem && caseItem.clientId !== clientId) {
    throw createHttpError(400, "The selected case does not belong to the selected client.", "VALIDATION_ERROR");
  }
  if (clientId && appointment?.clientId && appointment.clientId !== clientId) throw createHttpError(400, "The selected appointment does not belong to the selected client.", "VALIDATION_ERROR");
  if (caseId && appointment?.caseId && appointment.caseId !== caseId) throw createHttpError(400, "The selected appointment does not belong to the selected case.", "VALIDATION_ERROR");
  return { clientId: clientId || appointment?.clientId || null, caseId: caseId || appointment?.caseId || null, appointmentId };
}

export async function createFollowUp(req, res) {
  req.body = { ...(req.body || {}) };
  const legacyReminder = String(req.body.description || "").match(/Send reminder:\s*([^\n]+)/i)?.[1]?.trim();
  const legacyChannels = String(req.body.description || "").match(/Notifications:\s*([^\n]+)/i)?.[1]?.trim().toLowerCase();
  if (!Object.hasOwn(req.body, "reminderAt") && legacyReminder && legacyReminder !== "Not set") req.body.reminderAt = legacyReminder;
  if (!Object.hasOwn(req.body, "notificationChannels") && legacyChannels) {
    req.body.notificationChannels = [
      ...(legacyChannels.includes("in-app") ? ["in_app"] : []),
      ...(legacyChannels.includes("email") ? ["email"] : []),
    ];
    req.body.notifyClient = true;
  }
  if (req.auth.role === "consultant" && !Object.hasOwn(req.body, "assignedUserId")) {
    req.body.assignedUserId = req.auth.userId;
  }
  const relationships = await validateRelationships(req);
  req.body = { ...req.body, ...relationships };
  return controller.create(req, res);
}

export async function updateFollowUp(req, res) {
  const existing = await prisma.followUp.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...followUpAccessWhere(req),
    },
    select: { id: true, clientId: true, caseId: true, appointmentId: true, assignedUserId: true },
  });
  if (!existing) throw createHttpError(404, "Follow-up not found.", "NOT_FOUND");
  await validateRelationships(req, existing);
  return controller.update(req, res);
}
export async function cancelFollowUp(req, res) {
  const existing = await prisma.followUp.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...followUpAccessWhere(req) },
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
