// Consultant self-service "request to join a case" workflow (Team Workload
// refinement plan, Phase 4) plus the admin-side approval queue that backs
// it. Approving a request still goes through the same ownership model the
// manual /cases/:id/permissions screen uses (assignedUserId for primary,
// CaseAssignment rows for supporting/reviewer) — this service only adds a
// lightweight, audited ask/grant layer on top of it.
import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { notifyUsers, adminRecipientIds } from "./notificationService.js";
import { TERMINAL_CASE_STATUSES } from "../controllers/caseController.js";

const REQUESTABLE_ROLES = new Set(["supporting", "reviewer"]);
const TERMINAL_CASE_STATUS_LIST = [...TERMINAL_CASE_STATUSES];

const caseSummarySelect = {
  id: true,
  caseType: true,
  stage: true,
  status: true,
  priority: true,
  updatedAt: true,
  archivedAt: true,
  deletedAt: true,
  assignedUser: { select: { id: true, fullName: true } },
  client: { select: { id: true, fullName: true } },
  assignments: { where: { status: "active" }, select: { consultantUserId: true, assignmentType: true } },
};

const requesterSelect = { id: true, fullName: true, email: true };

function shapeCase(caseItem) {
  return {
    id: caseItem.id,
    caseType: caseItem.caseType,
    stage: caseItem.stage,
    status: caseItem.status,
    priority: caseItem.priority,
    updatedAt: caseItem.updatedAt,
    client: caseItem.client,
    owner: caseItem.assignedUser,
    collaboratorCount: caseItem.assignments.filter((item) => item.assignmentType !== "primary").length,
  };
}

function shapeRequest(request) {
  return {
    id: request.id,
    status: request.status,
    requestedRole: request.requestedRole,
    note: request.note,
    reviewNote: request.reviewNote,
    reviewedAt: request.reviewedAt,
    createdAt: request.createdAt,
    case: request.case ? shapeCase(request.case) : null,
    requestedBy: request.requestedBy || null,
    reviewedBy: request.reviewedBy || null,
  };
}

export async function getRestrictedCaseAccessPreview(agencyId, userId, caseId) {
  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId, deletedAt: null },
    select: {
      id: true,
      caseType: true,
      status: true,
      assignedUser: { select: { id: true, fullName: true } },
      client: { select: { fullName: true } },
      assignments: { where: { consultantUserId: userId, status: "active" }, select: { id: true } },
      collaborationRequests: {
        where: { requestedById: userId, status: "Pending" },
        select: { id: true, status: true, createdAt: true, note: true },
        take: 1,
      },
    },
  });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  return {
    id: caseItem.id,
    clientName: caseItem.client?.fullName || "Restricted client",
    caseType: caseItem.caseType,
    owner: caseItem.assignedUser,
    accessStatus: caseItem.assignments.length ? "Granted" : caseItem.collaborationRequests.length ? "Pending" : "Restricted",
    pendingRequest: caseItem.collaborationRequests[0] || null,
  };
}

// Cases this consultant doesn't already have access to, oldest-touched
// first — a lightly loaded consultant browsing for work should see the
// cases most likely to be going stale, not whatever was edited five
// minutes ago.
export async function listOpenCasesForConsultant(agencyId, userId, { caseType, limit = 50 } = {}) {
  const cases = await prisma.case.findMany({
    where: {
      agencyId,
      deletedAt: null,
      archivedAt: null,
      status: { notIn: TERMINAL_CASE_STATUS_LIST },
      ...(caseType ? { caseType } : {}),
      AND: [
        { assignedUserId: { not: userId } },
        { assignments: { none: { consultantUserId: userId, status: "active" } } },
      ],
    },
    select: caseSummarySelect,
    orderBy: { updatedAt: "asc" },
    take: Math.min(100, Math.max(1, limit)),
  });

  const pendingByCase = await prisma.caseCollaborationRequest.findMany({
    where: { agencyId, requestedById: userId, status: "Pending", caseId: { in: cases.map((item) => item.id) } },
    select: { caseId: true },
  });
  const pendingCaseIds = new Set(pendingByCase.map((item) => item.caseId));

  return cases.map((item) => ({ ...shapeCase(item), hasPendingRequest: pendingCaseIds.has(item.id) }));
}

export async function listMyCollaborationRequests(agencyId, userId) {
  const requests = await prisma.caseCollaborationRequest.findMany({
    where: { agencyId, requestedById: userId },
    select: fullRequestSelect(),
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return requests.map(shapeRequest);
}

function fullRequestSelect() {
  return {
    id: true,
    status: true,
    requestedRole: true,
    note: true,
    reviewNote: true,
    reviewedAt: true,
    createdAt: true,
    case: { select: caseSummarySelect },
    requestedBy: { select: requesterSelect },
    reviewedBy: { select: requesterSelect },
  };
}

export async function submitCollaborationRequest(agencyId, userId, { caseId, requestedRole = "supporting", note = "" } = {}) {
  const role = REQUESTABLE_ROLES.has(requestedRole) ? requestedRole : "supporting";
  const trimmedNote = String(note || "").trim().slice(0, 500);

  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId, deletedAt: null },
    select: {
      id: true,
      caseType: true,
      assignedUserId: true,
      archivedAt: true,
      assignments: { where: { status: "active" }, select: { consultantUserId: true } },
    },
  });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (caseItem.archivedAt) throw createHttpError(409, "This case is archived.", "CASE_ARCHIVED");

  const alreadyHasAccess = caseItem.assignedUserId === userId || caseItem.assignments.some((item) => item.consultantUserId === userId);
  if (alreadyHasAccess) throw createHttpError(409, "You already have access to this case.", "ALREADY_COLLABORATING");

  const existingPending = await prisma.caseCollaborationRequest.findFirst({
    where: { agencyId, caseId, requestedById: userId, status: "Pending" },
    select: { id: true },
  });
  if (existingPending) throw createHttpError(409, "You already have a pending request for this case.", "REQUEST_EXISTS");

  let created;
  try {
    created = await prisma.caseCollaborationRequest.create({
      data: { agencyId, caseId, requestedById: userId, requestedRole: role, note: trimmedNote || null },
      select: fullRequestSelect(),
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw createHttpError(409, "You already have a pending request for this case.", "REQUEST_EXISTS");
    }
    throw error;
  }

  await recordActivity({
    agencyId,
    userId,
    clientId: created.case?.client?.id,
    caseId,
    action: "case.collaboration_requested",
    details: `${created.requestedBy.fullName} requested collaborator access${trimmedNote ? `: ${trimmedNote}` : ""}`,
  });

  const [admins, approverAssignments] = await Promise.all([
    adminRecipientIds(agencyId),
    prisma.case.findFirst({
      where: { id: caseId, agencyId },
      select: {
        assignedUserId: true,
        assignments: { where: { status: "active", assignmentType: "reviewer" }, select: { consultantUserId: true } },
      },
    }),
  ]);
  const approverIds = [...new Set([
    ...admins,
    approverAssignments?.assignedUserId,
    ...(approverAssignments?.assignments || []).map((item) => item.consultantUserId),
  ].filter((id) => id && id !== userId))];

  await notifyUsers({
    agencyId,
    recipientIds: approverIds,
    actorUserId: userId,
    type: "case.collaboration_requested",
    category: "cases",
    title: `${created.requestedBy.fullName} wants to join a case`,
    body: `Requested ${role} access to ${created.case.client?.fullName || created.case.caseType}${trimmedNote ? ` — "${trimmedNote}"` : ""}`,
    severity: "info",
    entityType: "case",
    entityId: caseId,
    actionUrl: `/app/workload?accessRequest=${created.id}`,
    dedupeKey: `case-collab:${created.id}:requested`,
  });

  return shapeRequest(created);
}

async function assertCanReviewRequest(agencyId, actorUserId, request) {
  if (request.requestedById === actorUserId) {
    throw createHttpError(403, "You cannot approve or decline your own access request.", "SELF_REVIEW_FORBIDDEN");
  }
  const actor = await prisma.user.findFirst({
    where: { id: actorUserId, agencyId, status: "active" },
    select: {
      memberships: { where: { agencyId, isActive: true }, select: { role: true }, take: 1 },
    },
  });
  const isAdmin = actor?.memberships[0]?.role === "admin";
  if (isAdmin) return;
  const caseAccess = await prisma.case.findFirst({
    where: {
      id: request.caseId,
      agencyId,
      OR: [
        { assignedUserId: actorUserId },
        { assignments: { some: { consultantUserId: actorUserId, assignmentType: "reviewer", status: "active" } } },
      ],
    },
    select: { id: true },
  });
  if (!caseAccess) throw createHttpError(403, "Only an administrator, the case RCIC, or an assigned reviewer can review this request.", "FORBIDDEN");
}

export async function withdrawCollaborationRequest(agencyId, userId, requestId) {
  const existing = await prisma.caseCollaborationRequest.findFirst({
    where: { id: requestId, agencyId, requestedById: userId, status: "Pending" },
    select: { id: true },
  });
  if (!existing) throw createHttpError(404, "Request not found.", "NOT_FOUND");
  const updated = await prisma.caseCollaborationRequest.update({
    where: { id: existing.id },
    data: { status: "Withdrawn", reviewedAt: new Date() },
    select: fullRequestSelect(),
  });
  await recordActivity({
    agencyId,
    userId,
    clientId: updated.case?.client?.id,
    caseId: updated.case?.id,
    action: "case.collaboration_withdrawn",
    details: `${updated.requestedBy?.fullName || "A staff member"} cancelled their collaborator access request`,
  });
  return shapeRequest(updated);
}

export async function listReviewableCollaborationRequests(agencyId, actorUserId) {
  const membership = await prisma.agencyMember.findFirst({
    where: { agencyId, userId: actorUserId, isActive: true },
    select: { role: true },
  });
  const isAdmin = membership?.role === "admin";
  const requests = await prisma.caseCollaborationRequest.findMany({
    where: {
      agencyId,
      status: "Pending",
      requestedById: { not: actorUserId },
      ...(!isAdmin ? {
        case: {
          OR: [
            { assignedUserId: actorUserId },
            { assignments: { some: { consultantUserId: actorUserId, assignmentType: "reviewer", status: "active" } } },
          ],
        },
      } : {}),
    },
    select: fullRequestSelect(),
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return requests.map(shapeRequest);
}

export async function listCollaborationRequestsForAdmin(agencyId, { status = "Pending" } = {}) {
  const requests = await prisma.caseCollaborationRequest.findMany({
    where: { agencyId, ...(status && status !== "all" ? { status } : {}) },
    select: fullRequestSelect(),
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return requests.map(shapeRequest);
}

async function reviewedRequestOrThrow(agencyId, requestId) {
  const request = await prisma.caseCollaborationRequest.findFirst({
    where: { id: requestId, agencyId, status: "Pending" },
    select: {
      id: true,
      caseId: true,
      requestedById: true,
      requestedRole: true,
      case: { select: { id: true, clientId: true, caseType: true, assignedUserId: true, archivedAt: true } },
      requestedBy: { select: requesterSelect },
    },
  });
  if (!request) throw createHttpError(404, "Request not found or already reviewed.", "NOT_FOUND");
  return request;
}

export async function approveCollaborationRequest(agencyId, adminUserId, requestId, { reviewNote = "" } = {}) {
  const request = await reviewedRequestOrThrow(agencyId, requestId);
  await assertCanReviewRequest(agencyId, adminUserId, request);
  if (request.case.archivedAt) throw createHttpError(409, "Restore this case before granting access.", "CASE_ARCHIVED");

  const trimmedNote = String(reviewNote || "").trim().slice(0, 500);
  const assignmentType = request.requestedRole === "reviewer" ? "reviewer" : "supporting";

  const result = await prisma.$transaction(async (tx) => {
    await tx.caseAssignment.upsert({
        where: { agencyId_caseId_consultantUserId_assignmentType: { agencyId, caseId: request.caseId, consultantUserId: request.requestedById, assignmentType } },
        create: { agencyId, caseId: request.caseId, consultantUserId: request.requestedById, assignmentType, status: "active", assignedById: adminUserId },
        update: { status: "active", assignedById: adminUserId, assignedAt: new Date() },
    });
    return tx.caseCollaborationRequest.update({
      where: { id: request.id },
      data: { status: "Approved", reviewedById: adminUserId, reviewedAt: new Date(), reviewNote: trimmedNote || null },
      select: fullRequestSelect(),
    });
  });

  await recordActivity({
    agencyId,
    userId: adminUserId,
    clientId: request.case.clientId,
    caseId: request.caseId,
    action: "case.collaboration_approved",
    details: `${request.requestedBy.fullName} granted ${assignmentType} access to this case`,
  });

  await notifyUsers({
    agencyId,
    recipientIds: [request.requestedById],
    actorUserId: adminUserId,
    type: "case.collaboration_approved",
    category: "cases",
    title: "Your case access request was approved",
    body: `You now have ${assignmentType} access to this case.${trimmedNote ? ` Note: ${trimmedNote}` : ""}`,
    severity: "success",
    entityType: "case",
    entityId: request.caseId,
    actionUrl: `/app/cases/${request.caseId}`,
    dedupeKey: `case-collab:${request.id}:approved`,
  });

  return result;
}

export async function declineCollaborationRequest(agencyId, adminUserId, requestId, { reviewNote = "" } = {}) {
  const request = await reviewedRequestOrThrow(agencyId, requestId);
  await assertCanReviewRequest(agencyId, adminUserId, request);
  const trimmedNote = String(reviewNote || "").trim().slice(0, 500);

  const updated = await prisma.caseCollaborationRequest.update({
    where: { id: request.id },
    data: { status: "Declined", reviewedById: adminUserId, reviewedAt: new Date(), reviewNote: trimmedNote || null },
    select: fullRequestSelect(),
  });

  await recordActivity({
    agencyId,
    userId: adminUserId,
    clientId: request.case.clientId,
    caseId: request.caseId,
    action: "case.collaboration_declined",
    details: `${request.requestedBy.fullName}'s collaborator access request was declined${trimmedNote ? `: ${trimmedNote}` : ""}`,
  });

  await notifyUsers({
    agencyId,
    recipientIds: [request.requestedById],
    actorUserId: adminUserId,
    type: "case.collaboration_declined",
    category: "cases",
    title: "Your case access request was declined",
    body: trimmedNote || "The admin team declined this request.",
    severity: "warning",
    entityType: "case",
    entityId: request.caseId,
    actionUrl: "/app/my-workload",
    dedupeKey: `case-collab:${request.id}:declined`,
  });

  return updated ? shapeRequest(updated) : null;
}
