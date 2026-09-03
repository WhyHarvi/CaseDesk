import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { caseAccessWhere, clientAccessWhere } from "../middleware/authorization.js";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { caseNotificationActionUrl, notifyUsers, resolveNotifications } from "../services/notificationService.js";
import { appointmentProfileAccessWhere } from "../services/appointmentProfileService.js";
import { portalDataScope } from "../services/portalAccessService.js";
import { leadFollowUpAccessWhere, leadSegmentWhere } from "../modules/leads/lead.permissions.js";
import { reportingBounds } from "../modules/leads/lead.metrics.js";
import { logger } from "../services/logger.js";
import { creditStudyPermitMilestone, POST_SUBMISSION_FOLLOW_UP_TYPE } from "../services/incentiveExpansionService.js";

export const FOLLOW_UP_PRIORITIES = ["High", "Medium", "Low"];
export const FOLLOW_UP_TYPES = [
  "General follow-up",
  "Client call",
  "Document request",
  "Payment reminder",
  "Case review",
  POST_SUBMISSION_FOLLOW_UP_TYPE,
];
export const FOLLOW_UP_COMPLETION_OUTCOMES = [
  "Client contacted",
  "No answer",
  "Documents received",
  "Payment promised",
  "New follow-up required",
  "Other",
];
const FOLLOW_UP_STATUSES = ["Pending", "Completed", "Cancelled"];
const TERMINAL_FOLLOW_UP_STATUSES = new Set(["Completed", "Cancelled"]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

// "Overdue" used to mean an exact `now` cutoff in this file but a
// start-of-today cutoff on the Dashboard and Lead Dashboard, so the same
// follow-up could read as overdue on one screen and not-yet-overdue on
// another. This resolves the same start-of-day-in-agency-timezone cutoff
// those surfaces already use, so "Overdue" means the same thing everywhere.
// See CD-003/CD-035.
async function resolveOverdueCutoff(req) {
  const agency = await prisma.agency.findUnique({
    where: { id: req.auth.agencyId },
    select: { timezone: true },
  });
  const timezone = agency?.timezone || "America/Toronto";
  const now = new Date();
  const { todayStart, tomorrowStart, weekStart } = reportingBounds(now, timezone);
  return { now, todayStart, tomorrowStart, weekStart, timezone };
}

async function resolveFollowUpNotificationsSafely({ agencyId, entityId, context }) {
  try {
    await resolveNotifications({ agencyId, entityType: "follow_up", entityId });
  } catch (error) {
    // The workflow mutation is already committed. Notification cleanup is
    // reconciled by the scheduler, so a transient cleanup failure must not
    // turn a successful completion/cancellation into an HTTP 500.
    logger.error("follow_up.notification_resolution_failed", {
      agencyId,
      entityId,
      context,
      error: error?.message,
    });
  }
}

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
      status: true,
      archivedAt: true,
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
  createdBy: { select: { id: true, fullName: true, email: true } },
  completedBy: { select: { id: true, fullName: true, email: true } },
  cancelledBy: { select: { id: true, fullName: true, email: true } },
  document: {
    select: { id: true, documentName: true, status: true, dueAt: true },
  },
  caseInvoice: {
    select: { id: true, description: true, status: true, amount: true, balance: true, dueDate: true },
  },
};

export function followUpAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  const branches = [
    { assignedUserId: req.auth.userId },
    { createdById: req.auth.userId },
  ];
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
  documentId: fieldParsers.relationField,
  caseInvoiceId: fieldParsers.relationField,
  assignedUserId: fieldParsers.relationField,
  createdById: fieldParsers.relationField,
  completedById: fieldParsers.relationField,
  cancelledById: fieldParsers.relationField,
  title: fieldParsers.stringField,
  description: fieldParsers.stringField,
  followUpType: fieldParsers.enumField(FOLLOW_UP_TYPES),
  priority: fieldParsers.enumField(FOLLOW_UP_PRIORITIES),
  dueDate: fieldParsers.dateField,
  status: fieldParsers.enumField(FOLLOW_UP_STATUSES),
  completedAt: fieldParsers.dateField,
  completionOutcome: fieldParsers.stringField,
  cancellationReason: fieldParsers.stringField,
  reminderAt: fieldParsers.dateField,
  expiresAt: fieldParsers.dateField,
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
  afterCreate: async ({ req, data }) => {
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: data.clientId,
      caseId: data.caseId,
      action: "follow_up.created",
      details: `${data.title} created`,
      entityType: "follow_up",
      entityId: data.id,
    });
    if (req.body.overrideReason) {
      await recordActivity({
        agencyId: req.auth.agencyId,
        userId: req.auth.userId,
        clientId: data.clientId,
        caseId: data.caseId,
        action: "follow_up.archived_case_override",
        details: req.body.overrideReason,
        entityType: "follow_up",
        entityId: data.id,
        metadata: { overrideReason: req.body.overrideReason },
      });
    }
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
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      clientId: data.clientId,
      caseId: data.caseId,
      action: "follow_up.updated",
      details: `${data.title} updated`,
      entityType: "follow_up",
      entityId: data.id,
    });
    if (req.body.overrideReason) {
      await recordActivity({
        agencyId: req.auth.agencyId,
        userId: req.auth.userId,
        clientId: data.clientId,
        caseId: data.caseId,
        action: "follow_up.archived_case_override",
        details: req.body.overrideReason,
        entityType: "follow_up",
        entityId: data.id,
        metadata: { overrideReason: req.body.overrideReason },
      });
    }
    if (existing.status !== "Completed" && data.status === "Completed") {
      await recordActivity({
        agencyId: req.auth.agencyId,
        userId: req.auth.userId,
        clientId: data.clientId,
        caseId: data.caseId,
        action: "follow_up.completed",
        details: `${data.title}: ${data.completionOutcome}`,
        entityType: "follow_up",
        entityId: data.id,
        metadata: { completionOutcome: data.completionOutcome },
      });
      if (data.caseId && data.followUpType === POST_SUBMISSION_FOLLOW_UP_TYPE) {
        await creditStudyPermitMilestone(req.auth.agencyId, {
          caseId: data.caseId,
          eventType: "POST_SUBMISSION_FOLLOW_UP_COMPLETED",
          triggerSource: "FOLLOW_UP_COMPLETED",
          triggerRef: data.id,
          occurredAt: data.completedAt || new Date(),
          actorUserId: req.auth.userId,
        }).catch((error) => logger.warn("follow_up.milestone_incentive_failed", { followUpId: data.id, reason: error.message }));
      }
    }
    const notificationContextChanged =
      existing.title !== data.title ||
      existing.assignedUserId !== data.assignedUserId ||
      existing.status !== data.status ||
      new Date(existing.dueDate || 0).getTime() !== new Date(data.dueDate || 0).getTime() ||
      new Date(existing.reminderAt || 0).getTime() !== new Date(data.reminderAt || 0).getTime();
    if (notificationContextChanged || TERMINAL_FOLLOW_UP_STATUSES.has(data.status)) {
      await resolveFollowUpNotificationsSafely({
        agencyId: req.auth.agencyId,
        entityId: data.id,
        context: "update",
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

export async function getFollowUpById(req, res) {
  const [item, { todayStart }] = await Promise.all([
    prisma.followUp.findFirst({
      where: {
        id: req.params.id,
        agencyId: req.auth.agencyId,
        ...followUpAccessWhere(req),
      },
      include,
    }),
    resolveOverdueCutoff(req),
  ]);
  if (!item) throw createHttpError(404, "Follow-up not found.", "NOT_FOUND");
  res.json({ data: normalizeCaseFollowUp(item, req, todayStart) });
}

function pagination(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  return { page, limit, take: page * limit };
}

function parsedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function caseStatusFilter(status, now) {
  if (status === "Overdue") return { status: "Pending", dueDate: { lt: now } };
  if (status === "Pending") {
    return {
      status: "Pending",
      OR: [{ dueDate: null }, { dueDate: { gte: now } }],
    };
  }
  if (["Completed", "Cancelled"].includes(status)) return { status };
  if (status === "Open") return { status: "Pending" };
  return null;
}

function leadStatusFilter(status, now) {
  if (status === "Overdue") return { status: "PENDING", dueAt: { lt: now } };
  if (status === "Pending") return { status: "PENDING", dueAt: { gte: now } };
  if (status === "Completed") return { status: "COMPLETED" };
  if (status === "Cancelled") return { status: "CANCELLED" };
  if (status === "Open") return { status: "PENDING" };
  return null;
}

function buildCaseListWhere(req, { combined = false, cutoff } = {}) {
  const now = cutoff || new Date();
  const clauses = [followUpAccessWhere(req)];
  const view = String(req.query.view || (combined ? "my_open" : "")).toLowerCase();
  const explicitStatus = String(req.query.status || "");
  const statusClause = caseStatusFilter(explicitStatus, now);
  if (statusClause) clauses.push(statusClause);
  else if (combined && view !== "all") clauses.push({ status: "Pending" });
  if (view === "my_open") clauses.push({ assignedUserId: req.auth.userId });
  if (view === "unassigned") clauses.push({ assignedUserId: null });
  if (req.query.clientId) clauses.push({ clientId: String(req.query.clientId) });
  if (req.query.caseId) clauses.push({ caseId: String(req.query.caseId) });
  if (req.query.appointmentId) clauses.push({ appointmentId: String(req.query.appointmentId) });
  if (req.query.assignedUserId) clauses.push({ assignedUserId: String(req.query.assignedUserId) });
  if (req.query.priority) clauses.push({ priority: String(req.query.priority) });
  if (req.query.type) clauses.push({ followUpType: String(req.query.type) });
  const from = parsedDate(req.query.from);
  const to = parsedDate(req.query.to);
  if (from || to) clauses.push({ dueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  const search = String(req.query.search || "").trim();
  if (search) {
    clauses.push({
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { client: { fullName: { contains: search, mode: "insensitive" } } },
        { case: { caseType: { contains: search, mode: "insensitive" } } },
        { document: { documentName: { contains: search, mode: "insensitive" } } },
        { caseInvoice: { description: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  return { agencyId: req.auth.agencyId, AND: clauses };
}

function buildLeadListWhere(req, { combined = false, cutoff } = {}) {
  const now = cutoff || new Date();
  // Import-review work is intentionally isolated to the Import Review tab.
  // It must not inflate or leak into the shared operational follow-up queue.
  const clauses = [leadFollowUpAccessWhere(req), { lead: leadSegmentWhere() }];
  const view = String(req.query.view || (combined ? "my_open" : "")).toLowerCase();
  const explicitStatus = String(req.query.status || "");
  const statusClause = leadStatusFilter(explicitStatus, now);
  if (statusClause) clauses.push(statusClause);
  else if (combined && view !== "all") clauses.push({ status: "PENDING" });
  if (view === "my_open") clauses.push({ assignedUserId: req.auth.userId });
  if (view === "unassigned") clauses.push({ id: "__lead_follow_up_cannot_be_unassigned__" });
  if (req.query.assignedUserId) clauses.push({ assignedUserId: String(req.query.assignedUserId) });
  if (req.query.type) clauses.push({ type: String(req.query.type) });
  if (req.query.priority && req.query.priority !== "Medium") clauses.push({ id: "__priority_not_available__" });
  const from = parsedDate(req.query.from);
  const to = parsedDate(req.query.to);
  if (from || to) clauses.push({ dueAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  const search = String(req.query.search || "").trim();
  if (search) {
    clauses.push({
      OR: [
        { description: { contains: search, mode: "insensitive" } },
        { lead: { leadNumber: { contains: search, mode: "insensitive" } } },
        { lead: { firstName: { contains: search, mode: "insensitive" } } },
        { lead: { lastName: { contains: search, mode: "insensitive" } } },
        { lead: { email: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  return { agencyId: req.auth.agencyId, AND: clauses };
}

function normalizeCaseFollowUp(item, req, now = new Date()) {
  const overdue = item.status === "Pending" && item.dueDate && new Date(item.dueDate) < now;
  return {
    ...item,
    source: "case",
    status: overdue ? "Overdue" : item.status,
    persistedStatus: item.status,
    isOverdue: Boolean(overdue),
    canEdit: req.auth.role === "admin" || item.assignedUserId === req.auth.userId || item.createdById === req.auth.userId,
    openUrl: item.caseId
      ? `/app/cases/${item.caseId}?tab=reminders&highlight=${encodeURIComponent(item.id)}`
      : item.clientId
        ? `/app/clients/${item.clientId}`
        : item.appointmentId
          ? `/app/calendar?appointment=${encodeURIComponent(item.appointmentId)}`
          : "/app/follow-ups",
  };
}

const leadInclude = {
  lead: {
    select: {
      id: true,
      leadNumber: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      immigrationInterest: true,
      stage: true,
      status: true,
      _count: { select: { followUps: { where: { status: "PENDING" } } } },
    },
  },
  assignedUser: { select: { id: true, fullName: true, email: true } },
  completedBy: { select: { id: true, fullName: true, email: true } },
};

function normalizeLeadFollowUp(item, req, now = new Date()) {
  const fullName = [item.lead.firstName, item.lead.lastName].filter(Boolean).join(" ") || "Unnamed lead";
  const overdue = item.status === "PENDING" && new Date(item.dueAt) < now;
  return {
    id: item.id,
    source: "lead",
    leadId: item.leadId,
    title: item.description,
    description: item.description,
    dueDate: item.dueAt,
    status: overdue ? "Overdue" : item.status === "PENDING" ? "Pending" : item.status === "COMPLETED" ? "Completed" : "Cancelled",
    persistedStatus: item.status,
    isOverdue: overdue,
    followUpType: item.type,
    priority: "Medium",
    completedAt: item.completedAt,
    completionOutcome: item.completionOutcome,
    completedBy: item.completedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    assignedUserId: item.assignedUserId,
    assignedUser: item.assignedUser,
    canEdit: req.auth.role === "admin" || item.assignedUserId === req.auth.userId,
    requiresNextFollowUp:
      item.status === "PENDING" &&
      item.lead._count.followUps <= 1 &&
      (item.lead.status === "OPEN" || (item.lead.status === "NURTURE" && item.type === "REACTIVATE")),
    client: { id: item.lead.id, fullName, phone: item.lead.phone, email: item.lead.email },
    lead: item.lead,
    openUrl: `/leads?lead=${encodeURIComponent(item.leadId)}`,
  };
}

function compareFollowUps(left, right, query) {
  const direction = String(query.sortDir || "asc").toLowerCase() === "desc" ? -1 : 1;
  const sort = String(query.sort || "dueDate");
  if (sort === "createdAt") {
    return direction * (new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }
  if (sort === "client") {
    return direction * String(left.client?.fullName || "").localeCompare(String(right.client?.fullName || ""));
  }
  if (sort === "priority") {
    const rank = { High: 0, Medium: 1, Low: 2 };
    return direction * ((rank[left.priority] ?? 9) - (rank[right.priority] ?? 9));
  }
  const leftDue = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  return direction * (leftDue - rightDue) || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function caseOrderBy(query) {
  const direction = String(query.sortDir || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  if (query.sort === "createdAt") return [{ createdAt: direction }, { id: direction }];
  if (query.sort === "client") return [{ client: { fullName: direction } }, { createdAt: "asc" }];
  return [{ dueDate: direction }, { createdAt: "asc" }];
}

function leadOrderBy(query) {
  const direction = String(query.sortDir || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  if (query.sort === "createdAt") return [{ createdAt: direction }, { id: direction }];
  if (query.sort === "client") return [{ lead: { firstName: direction } }, { lead: { lastName: direction } }];
  return [{ dueAt: direction }, { createdAt: "asc" }];
}

async function caseCandidates(where, take, query) {
  if (query.sort !== "priority") {
    return prisma.followUp.findMany({ where, include, orderBy: caseOrderBy(query), take });
  }
  const orderedPriorities = String(query.sortDir || "asc").toLowerCase() === "desc"
    ? [...FOLLOW_UP_PRIORITIES].reverse()
    : FOLLOW_UP_PRIORITIES;
  const groups = await Promise.all(orderedPriorities.map((priority) => prisma.followUp.findMany({
    where: { agencyId: where.agencyId, AND: [where, { priority }] },
    include,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take,
  })));
  return groups.flat();
}

export async function listFollowUps(req, res) {
  const { page, limit, take } = pagination(req.query);
  const { todayStart } = await resolveOverdueCutoff(req);
  const where = buildCaseListWhere(req, { cutoff: todayStart });
  const [items, total, uniqueClients] = await Promise.all([
    prisma.followUp.findMany({ where, include, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], skip: (page - 1) * limit, take: limit }),
    prisma.followUp.count({ where }),
    prisma.followUp.findMany({ where: { ...where, clientId: { not: null } }, distinct: ["clientId"], select: { clientId: true } }),
  ]);
  res.json({
    data: items.map((item) => normalizeCaseFollowUp(item, req, todayStart)),
    meta: { page, limit, total, uniqueClients: uniqueClients.length, hasMore: page * limit < total, requested: take },
  });
}

export async function listMyWork(req, res) {
  const { page, limit, take } = pagination(req.query);
  const includeCases = req.query.source !== "lead";
  const includeLeads = req.query.source !== "case";
  const { timezone, todayStart, tomorrowStart, weekStart } = await resolveOverdueCutoff(req);
  const caseWhere = buildCaseListWhere(req, { combined: true, cutoff: todayStart });
  const leadWhere = buildLeadListWhere(req, { combined: true, cutoff: todayStart });
  const andCase = (condition) => ({ agencyId: req.auth.agencyId, AND: [caseWhere, condition] });
  const andLead = (condition) => ({ agencyId: req.auth.agencyId, AND: [leadWhere, condition] });
  const [
    caseFollowUps, leadFollowUps, caseTotal, leadTotal, caseClients, leadClients,
    caseDueToday, leadDueToday, caseOverdue, leadOverdue, casePending, leadPending,
    caseCompletedThisWeek, leadCompletedThisWeek, missingDocumentClients,
  ] = await Promise.all([
    includeCases ? caseCandidates(caseWhere, take, req.query) : [],
    includeLeads ? prisma.leadFollowUp.findMany({ where: leadWhere, include: leadInclude, orderBy: leadOrderBy(req.query), take }) : [],
    includeCases ? prisma.followUp.count({ where: caseWhere }) : 0,
    includeLeads ? prisma.leadFollowUp.count({ where: leadWhere }) : 0,
    includeCases ? prisma.followUp.findMany({ where: { ...caseWhere, clientId: { not: null } }, distinct: ["clientId"], select: { clientId: true } }) : [],
    includeLeads ? prisma.leadFollowUp.findMany({ where: leadWhere, distinct: ["leadId"], select: { leadId: true } }) : [],
    includeCases ? prisma.followUp.count({ where: andCase({ status: "Pending", dueDate: { gte: todayStart, lt: tomorrowStart } }) }) : 0,
    includeLeads ? prisma.leadFollowUp.count({ where: andLead({ status: "PENDING", dueAt: { gte: todayStart, lt: tomorrowStart } }) }) : 0,
    includeCases ? prisma.followUp.count({ where: andCase({ status: "Pending", dueDate: { lt: todayStart } }) }) : 0,
    includeLeads ? prisma.leadFollowUp.count({ where: andLead({ status: "PENDING", dueAt: { lt: todayStart } }) }) : 0,
    includeCases ? prisma.followUp.count({ where: andCase({ status: "Pending" }) }) : 0,
    includeLeads ? prisma.leadFollowUp.count({ where: andLead({ status: "PENDING" }) }) : 0,
    includeCases ? prisma.followUp.count({ where: andCase({ status: "Completed", completedAt: { gte: weekStart, lt: tomorrowStart } }) }) : 0,
    includeLeads ? prisma.leadFollowUp.count({ where: andLead({ status: "COMPLETED", completedAt: { gte: weekStart, lt: tomorrowStart } }) }) : 0,
    includeCases ? prisma.followUp.findMany({
      where: andCase({ status: "Pending", documentId: { not: null }, clientId: { not: null } }),
      distinct: ["clientId"],
      select: { clientId: true },
    }) : [],
  ]);
  const merged = [
    ...caseFollowUps.map((item) => normalizeCaseFollowUp(item, req, todayStart)),
    ...leadFollowUps.map((item) => normalizeLeadFollowUp(item, req, todayStart)),
  ].sort((left, right) => compareFollowUps(left, right, req.query));
  const total = caseTotal + leadTotal;
  const data = merged.slice((page - 1) * limit, page * limit);
  res.json({
    data,
    meta: {
      page,
      limit,
      total,
      hasMore: page * limit < total,
      uniqueClients: caseClients.length + leadClients.length,
      sourceTotals: { case: caseTotal, lead: leadTotal },
      timezone,
      summary: {
        dueToday: caseDueToday + leadDueToday,
        overdue: caseOverdue + leadOverdue,
        pending: casePending + leadPending,
        completedThisWeek: caseCompletedThisWeek + leadCompletedThisWeek,
        missingDocumentClients: missingDocumentClients.length,
      },
    },
  });
}
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
  if (payload.status === "Overdue") {
    throw createHttpError(400, "Overdue is calculated from the due date and cannot be set manually.", "VALIDATION_ERROR");
  }
  if (!existing && !hasOwn(payload, "status")) payload.status = "Pending";
  if (!existing || hasOwn(payload, "title")) {
    payload.title = normalizeText(payload.title, 180, "Follow-up title");
    if (!payload.title) throw createHttpError(400, "Follow-up title is required.", "VALIDATION_ERROR");
  }
  if (hasOwn(payload, "description")) {
    payload.description = normalizeText(payload.description, 2000, "Follow-up notes");
  }
  if (hasOwn(payload, "completionOutcome")) {
    payload.completionOutcome = normalizeText(payload.completionOutcome, 500, "Completion outcome");
    if (payload.completionOutcome && !FOLLOW_UP_COMPLETION_OUTCOMES.includes(payload.completionOutcome)) {
      throw createHttpError(400, "Completion outcome is invalid.", "VALIDATION_ERROR");
    }
  }
  if (hasOwn(payload, "cancellationReason")) {
    payload.cancellationReason = normalizeText(payload.cancellationReason, 500, "Cancellation reason");
  }
  if (hasOwn(payload, "overrideReason")) {
    payload.overrideReason = normalizeText(payload.overrideReason, 500, "Archived case override reason");
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
  if (finalStatus === "Completed") {
    const transitioning = existing?.status !== "Completed";
    if (transitioning && !payload.completionOutcome) {
      throw createHttpError(400, "Select a completion outcome before completing this follow-up.", "COMPLETION_OUTCOME_REQUIRED");
    }
    payload.completedAt = existing?.status === "Completed" && existing.completedAt
      ? existing.completedAt
      : new Date();
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
  const clientWasChanged = !existing || (hasOwn(body, "clientId") && relationValue(body.clientId) !== existing.clientId);
  const caseWasChanged = !existing || (hasOwn(body, "caseId") && relationValue(body.caseId) !== existing.caseId);
  const appointmentWasChanged = !existing || (hasOwn(body, "appointmentId") && relationValue(body.appointmentId) !== existing.appointmentId);
  const documentWasChanged = !existing || (hasOwn(body, "documentId") && relationValue(body.documentId) !== existing.documentId);
  const invoiceWasChanged = !existing || (hasOwn(body, "caseInvoiceId") && relationValue(body.caseInvoiceId) !== existing.caseInvoiceId);
  const assignedUserWasChanged = !existing || (hasOwn(body, "assignedUserId") && relationValue(body.assignedUserId) !== existing.assignedUserId);
  const clientId = hasOwn(body, "clientId") ? relationValue(body.clientId) : existing?.clientId || null;
  const caseId = hasOwn(body, "caseId") ? relationValue(body.caseId) : existing?.caseId || null;
  const appointmentId = hasOwn(body, "appointmentId") ? relationValue(body.appointmentId) : existing?.appointmentId || null;
  const documentId = hasOwn(body, "documentId") ? relationValue(body.documentId) : existing?.documentId || null;
  const caseInvoiceId = hasOwn(body, "caseInvoiceId") ? relationValue(body.caseInvoiceId) : existing?.caseInvoiceId || null;
  const assignedUserId = hasOwn(body, "assignedUserId")
    ? relationValue(body.assignedUserId)
    : existing?.assignedUserId || null;

  if (!clientId && !caseId && !appointmentId && !documentId && !caseInvoiceId) {
    throw createHttpError(400, "Select an accessible client, case, or appointment for this follow-up.", "VALIDATION_ERROR");
  }

  const [client, caseItem, appointment, document, caseInvoice, assignee] = await Promise.all([
    clientId
      ? prisma.client.findFirst({
          where: { id: clientId, agencyId: req.auth.agencyId, ...(clientWasChanged ? clientAccessWhere(req) : {}) },
          select: { id: true },
        })
      : null,
    caseId
      ? prisma.case.findFirst({
          where: { id: caseId, agencyId: req.auth.agencyId, ...(caseWasChanged ? caseAccessWhere(req) : {}) },
          select: { id: true, clientId: true, archivedAt: true },
      })
      : null,
    appointmentId
      ? prisma.appointment.findFirst({
          where: { id: appointmentId, agencyId: req.auth.agencyId, ...(appointmentWasChanged ? appointmentProfileAccessWhere(req) : {}) },
          select: { id: true, clientId: true, caseId: true },
        })
      : null,
    documentId
      ? prisma.clientDocument.findFirst({
          where: {
            id: documentId,
            agencyId: req.auth.agencyId,
            ...(documentWasChanged ? {
              OR: [
                { client: clientAccessWhere(req) },
                { case: caseAccessWhere(req) },
              ],
            } : {}),
          },
          select: { id: true, clientId: true, caseId: true },
        })
      : null,
    caseInvoiceId
      ? prisma.caseInvoice.findFirst({
          where: {
            id: caseInvoiceId,
            agencyId: req.auth.agencyId,
            ...(invoiceWasChanged ? {
              OR: [
                { client: clientAccessWhere(req) },
                { case: caseAccessWhere(req) },
              ],
            } : {}),
          },
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
          select: {
            id: true,
            memberships: {
              where: { agencyId: req.auth.agencyId, isActive: true },
              take: 1,
              select: { role: true, permissions: true },
            },
          },
        })
      : null,
  ]);

  if (clientId && !client) throw createHttpError(403, "You do not have access to the selected client.", "FORBIDDEN");
  if (caseId && !caseItem) throw createHttpError(403, "You do not have access to the selected case.", "FORBIDDEN");
  if (appointmentId && !appointment) throw createHttpError(403, "You do not have access to the selected appointment.", "FORBIDDEN");
  if (documentId && !document) throw createHttpError(403, "You do not have access to the selected document.", "FORBIDDEN");
  if (caseInvoiceId && !caseInvoice) throw createHttpError(403, "You do not have access to the selected invoice.", "FORBIDDEN");
  if (assignedUserId && (!existing || assignedUserWasChanged) && !assignee) throw createHttpError(400, "Assigned staff member was not found or is inactive.", "VALIDATION_ERROR");
  if (clientId && caseItem && caseItem.clientId !== clientId) {
    throw createHttpError(400, "The selected case does not belong to the selected client.", "VALIDATION_ERROR");
  }
  if (clientId && appointment?.clientId && appointment.clientId !== clientId) throw createHttpError(400, "The selected appointment does not belong to the selected client.", "VALIDATION_ERROR");
  if (caseId && appointment?.caseId && appointment.caseId !== caseId) throw createHttpError(400, "The selected appointment does not belong to the selected case.", "VALIDATION_ERROR");
  const resolvedClientId = clientId || caseItem?.clientId || appointment?.clientId || document?.clientId || caseInvoice?.clientId || null;
  const resolvedCaseId = caseId || appointment?.caseId || document?.caseId || caseInvoice?.caseId || null;
  if (document && resolvedClientId && document.clientId !== resolvedClientId) {
    throw createHttpError(400, "The selected document does not belong to the selected client.", "VALIDATION_ERROR");
  }
  if (document?.caseId && resolvedCaseId && document.caseId !== resolvedCaseId) {
    throw createHttpError(400, "The selected document does not belong to the selected case.", "VALIDATION_ERROR");
  }
  if (caseInvoice && (caseInvoice.clientId !== resolvedClientId || caseInvoice.caseId !== resolvedCaseId)) {
    throw createHttpError(400, "The selected invoice does not belong to the selected client and case.", "VALIDATION_ERROR");
  }
  if (caseItem?.archivedAt && (!existing || existing.caseId !== caseItem.id) && !body.overrideReason) {
    throw createHttpError(409, "Explain why this follow-up is required for an archived case.", "ARCHIVED_CASE_OVERRIDE_REQUIRED");
  }

  if (
    assignee &&
    req.auth.role !== "admin" &&
    assignedUserId !== req.auth.userId &&
    (!existing || assignedUserWasChanged)
  ) {
    const membership = assignee.memberships[0];
    const assigneeReq = {
      auth: {
        agencyId: req.auth.agencyId,
        userId: assignedUserId,
        role: membership.role,
        permissions: membership.permissions || {},
      },
    };
    const canAccessTarget = resolvedCaseId
      ? await prisma.case.count({
          where: { id: resolvedCaseId, agencyId: req.auth.agencyId, ...caseAccessWhere(assigneeReq) },
        })
      : resolvedClientId
        ? await prisma.client.count({
            where: { id: resolvedClientId, agencyId: req.auth.agencyId, ...clientAccessWhere(assigneeReq) },
          })
        : appointmentId
          ? await prisma.appointment.count({
              where: { id: appointmentId, agencyId: req.auth.agencyId, ...appointmentProfileAccessWhere(assigneeReq) },
            })
          : 0;
    if (!canAccessTarget) {
      throw createHttpError(
        403,
        "That staff member does not have access to the linked client or case. Ask an administrator to assign it.",
        "ASSIGNEE_RECORD_ACCESS_REQUIRED",
      );
    }
  }
  return {
    clientId: resolvedClientId,
    caseId: resolvedCaseId,
    appointmentId,
    documentId,
    caseInvoiceId,
    assignedUserId,
  };
}

export async function listFollowUpOptions(req, res) {
  const [clients, cases, users, documents, invoices, agency] = await Promise.all([
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
    prisma.clientDocument.findMany({
      where: {
        agencyId: req.auth.agencyId,
        OR: [{ client: clientAccessWhere(req) }, { case: caseAccessWhere(req) }],
      },
      select: {
        id: true,
        clientId: true,
        caseId: true,
        documentName: true,
        status: true,
        dueAt: true,
      },
      orderBy: [{ dueAt: "asc" }, { documentName: "asc" }],
      take: 1000,
    }),
    prisma.caseInvoice.findMany({
      where: {
        agencyId: req.auth.agencyId,
        OR: [{ client: clientAccessWhere(req) }, { case: caseAccessWhere(req) }],
      },
      select: {
        id: true,
        clientId: true,
        caseId: true,
        description: true,
        status: true,
        amount: true,
        balance: true,
        dueDate: true,
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 1000,
    }),
    prisma.agency.findUnique({
      where: { id: req.auth.agencyId },
      select: { timezone: true },
    }),
  ]);
  res.json({ data: { clients, cases, users, documents, invoices, timezone: agency?.timezone || "America/Toronto" } });
}

export async function createFollowUp(req, res) {
  req.body = { ...(req.body || {}) };
  delete req.body.createdById;
  delete req.body.completedById;
  delete req.body.cancelledById;
  delete req.body.completedAt;
  delete req.body.cancellationReason;
  req.body = normalizeFollowUpPayload(req.body);
  if (req.body.status !== "Pending") {
    throw createHttpError(400, "New follow-ups must start as Pending.", "VALIDATION_ERROR");
  }
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
  req.body = {
    ...req.body,
    ...relationships,
    createdById: req.auth.userId,
    completedById: null,
    cancelledById: null,
    completionOutcome: null,
  };
  return controller.create(req, res);
}

function assertFollowUpWritable(req, followUp) {
  if (
    req.auth.role === "admin" ||
    followUp.assignedUserId === req.auth.userId ||
    followUp.createdById === req.auth.userId
  ) return;
  throw createHttpError(
    403,
    "Only an administrator, the assignee, or the creator can change this follow-up.",
    "FOLLOW_UP_WRITE_FORBIDDEN",
  );
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
      documentId: true,
      caseInvoiceId: true,
      assignedUserId: true,
      createdById: true,
      title: true,
      status: true,
      completedAt: true,
      dueDate: true,
      reminderAt: true,
      completionOutcome: true,
      cancellationReason: true,
    },
  });
  if (!existing) throw createHttpError(404, "Follow-up not found.", "NOT_FOUND");
  assertFollowUpWritable(req, existing);
  req.body = { ...(req.body || {}) };
  delete req.body.createdById;
  delete req.body.completedById;
  delete req.body.cancelledById;
  delete req.body.completedAt;
  delete req.body.cancellationReason;
  if (req.body.status === "Cancelled") {
    throw createHttpError(400, "Use the cancel action and provide a reason.", "CANCELLATION_REASON_REQUIRED");
  }
  req.body = normalizeFollowUpPayload(req.body, existing);
  const finalStatus = req.body.status ?? existing.status;
  if (finalStatus === "Completed") {
    req.body.completedById = existing.status === "Completed"
      ? undefined
      : req.auth.userId;
    req.body.cancelledById = null;
    req.body.cancellationReason = null;
  } else if (TERMINAL_FOLLOW_UP_STATUSES.has(existing.status) && finalStatus === "Pending") {
    req.body.completedById = null;
    req.body.completionOutcome = null;
    req.body.cancelledById = null;
    req.body.cancellationReason = null;
  }
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
  assertFollowUpWritable(req, existing);
  if (existing.status === "Cancelled") throw createHttpError(409, "Follow-up is already cancelled.", "FOLLOW_UP_ALREADY_CANCELLED");
  if (existing.status === "Completed") throw createHttpError(409, "A completed follow-up cannot be cancelled.", "FOLLOW_UP_COMPLETED");
  const cancellationReason = normalizeText(req.body?.cancellationReason, 500, "Cancellation reason");
  if (!cancellationReason) {
    throw createHttpError(400, "A cancellation reason is required.", "CANCELLATION_REASON_REQUIRED");
  }
  const data = await prisma.followUp.update({
    where: { id: existing.id },
    data: {
      status: "Cancelled",
      completedAt: new Date(),
      cancelledById: req.auth.userId,
      cancellationReason,
      completedById: null,
      completionOutcome: null,
    },
    include,
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: data.clientId,
    caseId: data.caseId,
    action: "follow_up.cancelled",
    details: `${data.title} cancelled: ${cancellationReason}`,
    entityType: "follow_up",
    entityId: data.id,
    metadata: { cancellationReason },
  });
  await resolveFollowUpNotificationsSafely({
    agencyId: req.auth.agencyId,
    entityId: data.id,
    context: "cancel",
  });
  res.json({ data });
}

export default controller;
