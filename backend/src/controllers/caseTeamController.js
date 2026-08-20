import prisma from "../services/prisma/client.js";
import { createCase, updateCase } from "./caseController.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { invalidateDashboardCache } from "../services/dashboardCache.js";
import {
  applyRequiredCaseTeam,
  collaborationUserSelect,
  currentRequiredCaseTeam,
  listCollaborationStaff,
  requiredCaseTeamOptions,
  userCanManageCaseCollaboration,
  validateRequiredCaseTeam,
} from "../services/caseRequiredTeamService.js";

async function collaborationData(req) {
  const agencyId = req.auth.agencyId;
  const caseId = req.params.id;
  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      caseType: true,
      archivedAt: true,
      assignedUserId: true,
      assignedUser: { select: collaborationUserSelect },
      assignments: {
        where: { status: "active", assignmentType: "supporting" },
        select: { consultant: { select: collaborationUserSelect } },
        orderBy: { assignedAt: "asc" },
      },
    },
  });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");

  const [requiredTeam, options, staff, canManageCollaboration] = await Promise.all([
    currentRequiredCaseTeam(agencyId, caseId),
    requiredCaseTeamOptions(agencyId),
    listCollaborationStaff(agencyId),
    userCanManageCaseCollaboration({
      agencyId,
      userId: req.auth.userId,
      role: req.auth.role,
      caseId,
    }),
  ]);

  return {
    caseId,
    caseType: caseItem.caseType,
    archived: Boolean(caseItem.archivedAt),
    canManageCollaboration,
    owner: caseItem.assignedUser,
    collaborators: caseItem.assignments.map((item) => item.consultant),
    consultants: staff,
    requiredTeam: {
      ...requiredTeam,
      rcicUsers: options.rcicUsers,
      caseWorkerUsers: options.caseWorkerUsers,
    },
  };
}

export async function getNewCaseCollaborationOptions(req, res) {
  const options = await requiredCaseTeamOptions(req.auth.agencyId);
  res.json({
    data: {
      ...options,
      ready: options.rcicUsers.length > 0 && options.caseWorkerUsers.length > 0,
      missing: [
        ...(options.rcicUsers.length ? [] : ["RCIC"]),
        ...(options.caseWorkerUsers.length ? [] : ["Case Worker"]),
      ],
    },
  });
}

export async function getCaseCollaboration(req, res) {
  res.json({ data: await collaborationData(req) });
}

export async function updateCaseCollaboration(req, res) {
  const agencyId = req.auth.agencyId;
  const caseId = req.params.id;
  const canManage = await userCanManageCaseCollaboration({
    agencyId,
    userId: req.auth.userId,
    role: req.auth.role,
    caseId,
  });
  if (!canManage) {
    throw createHttpError(
      403,
      "Only an administrator or an RCIC can manage case collaboration.",
      "FORBIDDEN",
    );
  }

  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId, deletedAt: null },
    select: { id: true, clientId: true, caseType: true, archivedAt: true },
  });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (caseItem.archivedAt) {
    throw createHttpError(409, "Restore this case before changing collaboration.", "CASE_ARCHIVED");
  }

  await validateRequiredCaseTeam(agencyId, req.body || {});
  await prisma.$transaction(async (tx) => {
    await applyRequiredCaseTeam(tx, {
      agencyId,
      caseId,
      rcicUserId: req.body.rcicUserId,
      caseWorkerUserId: req.body.caseWorkerUserId,
      collaboratorUserIds: req.body.collaboratorUserIds,
      actorUserId: req.auth.userId,
    });
  });

  await recordActivity({
    agencyId,
    userId: req.auth.userId,
    clientId: caseItem.clientId,
    caseId,
    action: "case.collaboration_updated",
    details: "Case collaboration updated with required RCIC and Case Worker assignments.",
    metadata: {
      rcicUserId: req.body.rcicUserId,
      caseWorkerUserId: req.body.caseWorkerUserId,
      collaboratorUserIds: Array.isArray(req.body.collaboratorUserIds) ? req.body.collaboratorUserIds : [],
    },
  });
  invalidateDashboardCache(agencyId);
  res.json({ data: await collaborationData(req), message: "Case collaboration updated." });
}

function captureResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

export async function createCaseWithRequiredCollaboration(req, res) {
  const agencyId = req.auth.agencyId;
  const required = await validateRequiredCaseTeam(agencyId, req.body || {});

  // The Case Worker is the operational owner throughout CaseDesk. The
  // create controller may temporarily normalize a consultant creator to
  // themselves; applyRequiredCaseTeam below makes the required team the
  // authoritative final assignment before this request returns.
  req.body.assignedUserId = required.caseWorkerUserId;

  const captured = captureResponse();
  await createCase(req, captured);
  const caseItem = captured.body?.data;
  if (!caseItem?.id) {
    throw createHttpError(500, "The case was created but its required team could not be confirmed.", "CASE_TEAM_CREATE_FAILED");
  }

  await prisma.$transaction(async (tx) => {
    await applyRequiredCaseTeam(tx, {
      agencyId,
      caseId: caseItem.id,
      rcicUserId: required.rcicUserId,
      caseWorkerUserId: required.caseWorkerUserId,
      collaboratorUserIds: [],
      actorUserId: req.auth.userId,
    });
  });

  await recordActivity({
    agencyId,
    userId: req.auth.userId,
    clientId: caseItem.client?.id || caseItem.clientId,
    caseId: caseItem.id,
    action: "case.required_team_assigned",
    details: "Required RCIC and Case Worker assigned when the case was created.",
    metadata: {
      rcicUserId: required.rcicUserId,
      caseWorkerUserId: required.caseWorkerUserId,
    },
  });

  const refreshed = await prisma.case.findUnique({
    where: { id: caseItem.id },
    include: {
      client: true,
      assignedUser: { select: collaborationUserSelect },
    },
  });
  invalidateDashboardCache(agencyId);
  res.status(captured.statusCode || 201).json({
    ...captured.body,
    data: refreshed || caseItem,
  });
}

export async function updateCaseWithRequiredCollaboration(req, res) {
  // Case.assignedUserId is now the Case Worker. Prevent the legacy generic
  // "Assigned staff" field from changing ownership independently of the
  // required role assignment. RCIC / Case Worker changes belong in the
  // Collaboration panel where both role and access records stay in sync.
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, "assignedUserId")) {
    delete req.body.assignedUserId;
  }
  return updateCase(req, res);
}
