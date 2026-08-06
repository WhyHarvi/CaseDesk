import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { caseNotificationActionUrl, notifyUsers, resolveNotifications } from "../services/notificationService.js";
import { appointmentProfileAccessWhere } from "../services/appointmentProfileService.js";
import { portalDataScope } from "../services/portalAccessService.js";

export const FOLLOW_UP_PRIORITIES = ["High", "Medium", "Low"];
export const FOLLOW_UP_TYPES = [
  "General follow-up",
  "Client call",
  "Document request",
  "Payment reminder",
  "Case review",
];
const FOLLOW_UP_STATUSES = ["Pending", "Completed", "Overdue", "Cancelled"];
const TERMINAL_FOLLOW_UP_STATUSES = new Set(["Completed", "Cancelled"]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

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
      client: { select: { id: true, fullName: true } },
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

export function followUpAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  const branches = [];
  const clientScope = portalDataScope(req, "clients");
  const caseScope = portalDataScope(req, "cases");
  if (clientScope === "all") branches.push({ clientId: { not: null } });
  else if (clientScope === "assigned") branches.push({ client: clientAccessWhere(req) });
  if (caseScope === "all") branches.push({ caseId: { not: null } });
  else if (caseScope === "assigned") branches.push({ case: caseAccessWhere(req) });

  const appointmentWhere = appointmentProfileAccessWhere(req);
  if (Object.keys(appointmentWhere).length === 0) {
    branches.push({ appointmentId: { not: null } });
  } else if (appointmentWhere.id !== "__appointment_access_denied__") {
    branches.push({ appointment: appointmentWhere });
  }
  return branches.length ? { OR: branches } : { id: "__follow_up_access_denied__" };
}

const fields = {
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  appointmentId: fieldParsers.relationField,
  assignedUserId: fieldParsers.relationField,
  title: fieldParsers.stringField,
  description: fieldParsers.stringField,
  followUpType: fieldParsers.enumField(FOLLOW_UP_TYPES),
  priority: fieldParsers.enumField(FOLLOW_UP_PRIORITIES),
  dueDate: fieldParsers.dateField,
  status: fieldParsers.enumField(FOLLOW_UP_STATUSES),
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
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
      severity: data.priority === "High" ? "warning" : "info",
      entityType: "follow_up",
      entityId: data.id,
      actionUrl: data.caseId
        ? caseNotificationActionUrl(data.caseId, { type: "follow_up.assigned", category: "work", entityId: data.id })
        : `/app/follow-ups?highlight=${encodeURIComponent(data.id)}`,
      dedupeKey: `follow-up:${data.id}:assigned:${data.assignedUserId}`,
    });
  },
  afterUpdate: async ({ req, existing, data }) => {
    const notificationContextChanged =
      existing.title !== data.title ||
      existing.assignedUserId !== data.assignedUserId ||
      existing.status !== data.status ||
      new Date(existing.dueDate || 0).getTime() !== new Date(data.dueDate || 0).getTime() ||
      new Date(existing.reminderAt || 0).getTime() !== new Date(data.reminderAt || 0).getTime();
    if (notificationContextChanged || TERMINAL_FOLLOW_UP_STATUSES.has(data.status)) {
      await resolveNotifications({
        agencyId: req.auth.agencyId,
        entityType: "follow_up",
        entityId: data.id,
      });
    }
    if (data.assignedUserId && data.assignedUserId !== existing.assignedUserId) {
      await notifyUsers({
        agencyId: req.auth.agencyId,
        recipientIds: [data.assignedUserId],
        actorUserId: req.auth.userId,
        type: "follow_up.reassigned",
        category: "work",
        title: `Follow-up reassigned: ${data.title}`,
        body: data.dueDate ? `Due ${data.dueDate.toISOString()}` : data.description,
        severity: data.priority === "High" ? "warning" : "info",
        entityType: "follow_up",
        entityId: data.id,
        actionUrl: data.caseId
          ? caseNotificationActionUrl(data.caseId, { type: "follow_up.reassigned", category: "work", entityId: data.id })
          : `/app/follow-ups?highlight=${encodeURIComponent(data.id)}`,
        dedupeKey: `follow-up:${data.id}:assigned:${data.assignedUserId}:${data.updatedAt.toISOString()}`,
      });
    }
  },
});

export const listFollowUps = controller.list;
export const getFollowUpById = controller.getById;
function relationValue(value) {
  return value === "" || value === undefined ? null : value;
}

function normalizeText(value, maximumLength, label) {
  const normalized = String(value || "").trim();
  if (normalized.length > maximumLength) {
    throw createHttpError(400, `${label} must be ${maximumLength} characters or fewer.`, "VALIDATION_ERROR");
  }
  return normalized || null;
}

function sameInstant(left, right) {
  if (!left || !right) return left === right;
  return new Date(left).getTime() === new Date(right).getTime();
}

export function normalizeFollowUpPayload(body, existing = null) {
  const payload = { ...(body || {}) };
  if (!existing && !hasOwn(payload, "status")) payload.status = "Pending";
  if (!existing || hasOwn(payload, "title")) {
    payload.title = normalizeText(payload.title, 180, "Follow-up title");
    if (!payload.title) throw createHttpError(400, "Follow-up title is required.", "VALIDATION_ERROR");
  }
  if (hasOwn(payload, "description")) {
    payload.description = normalizeText(payload.description, 2000, "Follow-up notes");
  }

  if (hasOwn(payload, "priority") && !FOLLOW_UP_PRIORITIES.includes(payload.priority)) {
    throw createHttpError(400, "Follow-up priority is invalid.", "VALIDATION_ERROR");
  }
  if (hasOwn(payload, "followUpType") && !FOLLOW_UP_TYPES.includes(payload.followUpType)) {
    throw createHttpError(400, "Follow-up type is invalid.", "VALIDATION_ERROR");
  }
  if (hasOwn(payload, "status") && !FOLLOW_UP_STATUSES.includes(payload.status)) {
    throw createHttpError(400, "Follow-up status is invalid.", "VALIDATION_ERROR");
  }

  const finalStatus = payload.status ?? existing?.status ?? "Pending";
  if (!FOLLOW_UP_STATUSES.includes(finalStatus)) {
    throw createHttpError(400, "Follow-up status is invalid.", "VALIDATION_ERROR");
  }
  if (TERMINAL_FOLLOW_UP_STATUSES.has(finalStatus)) {
    if (!hasOwn(payload, "completedAt") || !payload.completedAt) {
      payload.completedAt = existing?.completedAt || new Date();
    }
  } else if (!existing || hasOwn(payload, "status") || hasOwn(payload, "completedAt")) {
    payload.completedAt = null;
  }

  // Appointment-created follow-ups use reminderAt === dueDate. Keep those
  // paired when staff edits or clears the due date, while preserving a
  // deliberately separate custom reminder.
  if (
    existing &&
    existing.reminderAt &&
    hasOwn(payload, "dueDate") &&
    !hasOwn(payload, "reminderAt") &&
    sameInstant(existing.reminderAt, existing.dueDate)
  ) {
    payload.reminderAt = payload.dueDate || null;
  }
  return payload;
}

async function validateRelationships(req, existing = null) {
  const body = req.body || {};
  const assignedUserWasChanged = hasOwn(body, "assignedUserId");
  const clientId = hasOwn(body, "clientId") ? relationValue(body.clientId) : existing?.clientId || null;
  const caseId = hasOwn(body, "caseId") ? relationValue(body.caseId) : existing?.caseId || null;
  const appointmentId = hasOwn(body, "appointmentId") ? relationValue(body.appointmentId) : existing?.appointmentId || null;
  const assignedUserId = hasOwn(body, "assignedUserId")
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
    assignedUserId && (!existing || assignedUserWasChanged)
      ? prisma.user.findFirst({
          where: {
            id: assignedUserId,
            agencyId: req.auth.agencyId,
            status: "active",
            memberships: {
              some: {
                agencyId: req.auth.agencyId,
                isActive: true,
                role: { in: ["admin", "consultant", "frontdesk"] },
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
  if (assignedUserId && (!existing || assignedUserWasChanged) && !assignee) throw createHttpError(400, "Assigned staff member was not found or is inactive.", "VALIDATION_ERROR");
  if (clientId && caseItem && caseItem.clientId !== clientId) {
    throw createHttpError(400, "The selected case does not belong to the selected client.", "VALIDATION_ERROR");
  }
  if (clientId && appointment?.clientId && appointment.clientId !== clientId) throw createHttpError(400, "The selected appointment does not belong to the selected client.", "VALIDATION_ERROR");
  if (caseId && appointment?.caseId && appointment.caseId !== caseId) throw createHttpError(400, "The selected appointment does not belong to the selected case.", "VALIDATION_ERROR");
  return {
    clientId: clientId || caseItem?.clientId || appointment?.clientId || null,
    caseId: caseId || appointment?.caseId || null,
    appointmentId,
    assignedUserId,
  };
}

export async function listFollowUpOptions(req, res) {
  const [clients, cases, users] = await Promise.all([
    prisma.client.findMany({
      where: { agencyId: req.auth.agencyId, ...clientAccessWhere(req) },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    prisma.case.findMany({
      where: { agencyId: req.auth.agencyId, deletedAt: null, ...caseAccessWhere(req) },
      select: {
        id: true,
        caseType: true,
        stage: true,
        status: true,
        archivedAt: true,
        client: { select: { id: true, fullName: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
    prisma.user.findMany({
      where: {
        agencyId: req.auth.agencyId,
        status: "active",
        memberships: {
          some: {
            agencyId: req.auth.agencyId,
            isActive: true,
            role: { in: ["admin", "consultant", "frontdesk"] },
          },
        },
      },
      select: { id: true, fullName: true, email: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
  ]);
  res.json({ data: { clients, cases, users } });
}

export async function createFollowUp(req, res) {
  req.body = normalizeFollowUpPayload(req.body);
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
  if (req.auth.role === "consultant" && !req.body.assignedUserId) {
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
    select: {
      id: true,
      clientId: true,
      caseId: true,
      appointmentId: true,
      assignedUserId: true,
      title: true,
      status: true,
      completedAt: true,
      dueDate: true,
      reminderAt: true,
    },
  });
  if (!existing) throw createHttpError(404, "Follow-up not found.", "NOT_FOUND");
  req.body = normalizeFollowUpPayload(req.body, existing);
  const relationships = await validateRelationships(req, existing);
  req.body = { ...req.body, ...relationships };
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
  await resolveNotifications({ agencyId: req.auth.agencyId, entityType: "follow_up", entityId: data.id });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, clientId: data.clientId, caseId: data.caseId, action: "follow_up.cancelled", details: `${data.title} cancelled` });
  res.json({ data });
}

export default controller;
