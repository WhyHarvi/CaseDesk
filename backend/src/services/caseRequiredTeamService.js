import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { ensureRequiredCaseRoles } from "./caseRoleService.js";

const STAFF_ROLES = ["consultant", "frontdesk"];
export const CASE_TEAM_ROLE_CODES = { RCIC: "rcic", CASE_WORKER: "case-worker" };

export const collaborationUserSelect = {
  id: true,
  fullName: true,
  email: true,
  jobTitle: true,
  role: true,
  licenseNumber: true,
  representativeType: true,
};

function cleanId(value) {
  return String(value || "").trim();
}

function roleMap(roles) {
  return Object.fromEntries(roles.map((role) => [role.code, role]));
}

async function eligibleUsersForRole(agencyId, caseRoleId, db = prisma) {
  return db.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: {
        some: { agencyId, isActive: true, role: { in: STAFF_ROLES } },
      },
      incentiveRoleAssignments: {
        some: { agencyId, caseRoleId },
      },
    },
    select: collaborationUserSelect,
    orderBy: { fullName: "asc" },
  });
}

export async function listCollaborationStaff(agencyId, db = prisma) {
  return db.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: {
        some: { agencyId, isActive: true, role: { in: STAFF_ROLES } },
      },
    },
    select: collaborationUserSelect,
    orderBy: { fullName: "asc" },
  });
}

export async function requiredCaseTeamOptions(agencyId, db = prisma) {
  const roles = roleMap(await ensureRequiredCaseRoles(agencyId, db));
  const [rcicUsers, caseWorkerUsers] = await Promise.all([
    eligibleUsersForRole(agencyId, roles[CASE_TEAM_ROLE_CODES.RCIC].id, db),
    eligibleUsersForRole(agencyId, roles[CASE_TEAM_ROLE_CODES.CASE_WORKER].id, db),
  ]);
  return {
    roles: {
      rcic: roles[CASE_TEAM_ROLE_CODES.RCIC],
      caseWorker: roles[CASE_TEAM_ROLE_CODES.CASE_WORKER],
    },
    rcicUsers,
    caseWorkerUsers,
  };
}

export async function validateRequiredCaseTeam(agencyId, values, db = prisma) {
  const rcicUserId = cleanId(values?.rcicUserId);
  const caseWorkerUserId = cleanId(values?.caseWorkerUserId);
  if (!rcicUserId) {
    throw createHttpError(400, "Choose an RCIC for this case.", "RCIC_REQUIRED");
  }
  if (!caseWorkerUserId) {
    throw createHttpError(400, "Choose a Case Worker for this case.", "CASE_WORKER_REQUIRED");
  }

  const options = await requiredCaseTeamOptions(agencyId, db);
  if (!options.rcicUsers.some((user) => user.id === rcicUserId)) {
    throw createHttpError(400, "The selected RCIC is not an active team member with the RCIC role.", "INVALID_RCIC");
  }
  if (!options.caseWorkerUsers.some((user) => user.id === caseWorkerUserId)) {
    throw createHttpError(400, "The selected Case Worker is not an active team member with the Case Worker role.", "INVALID_CASE_WORKER");
  }
  return { ...options, rcicUserId, caseWorkerUserId };
}

async function replaceRequiredRoleAssignment(tx, { agencyId, caseId, caseRoleId, userId, actorUserId }) {
  await tx.caseRoleAssignment.updateMany({
    where: {
      agencyId,
      caseId,
      caseRoleId,
      status: "active",
      userId: { not: userId },
    },
    data: { status: "inactive" },
  });
  await tx.caseRoleAssignment.upsert({
    where: {
      agencyId_caseId_caseRoleId_userId: {
        agencyId,
        caseId,
        caseRoleId,
        userId,
      },
    },
    create: {
      agencyId,
      caseId,
      caseRoleId,
      userId,
      assignedById: actorUserId || null,
      status: "active",
    },
    update: {
      assignedById: actorUserId || null,
      assignedAt: new Date(),
      status: "active",
    },
  });
}

export async function applyRequiredCaseTeam(tx, {
  agencyId,
  caseId,
  rcicUserId,
  caseWorkerUserId,
  actorUserId,
  collaboratorUserIds = [],
}) {
  const validated = await validateRequiredCaseTeam(agencyId, { rcicUserId, caseWorkerUserId }, tx);
  const requestedCollaboratorIds = [...new Set(
    (Array.isArray(collaboratorUserIds) ? collaboratorUserIds : [])
      .map(cleanId)
      .filter(Boolean),
  )];

  if (requestedCollaboratorIds.length) {
    const eligible = await tx.user.findMany({
      where: {
        agencyId,
        id: { in: requestedCollaboratorIds },
        status: "active",
        memberships: {
          some: { agencyId, isActive: true, role: { in: STAFF_ROLES } },
        },
      },
      select: { id: true },
    });
    if (eligible.length !== requestedCollaboratorIds.length) {
      throw createHttpError(400, "One or more selected collaborators are inactive or unavailable.", "INVALID_COLLABORATOR");
    }
  }

  // RCIC is the primary case owner (Case.assignedUserId); the Case Worker
  // is a mandatory supporting collaborator underneath them.
  const collaborationIds = new Set(requestedCollaboratorIds);
  if (rcicUserId !== caseWorkerUserId) collaborationIds.add(caseWorkerUserId);
  collaborationIds.delete(rcicUserId);

  await tx.case.update({
    where: { id: caseId },
    data: { assignedUserId: rcicUserId },
  });

  const activeSupporting = await tx.caseAssignment.findMany({
    where: { agencyId, caseId, assignmentType: "supporting", status: "active" },
    select: { id: true, consultantUserId: true },
  });
  const removeIds = activeSupporting
    .filter((assignment) => !collaborationIds.has(assignment.consultantUserId))
    .map((assignment) => assignment.id);
  if (removeIds.length) {
    await tx.caseAssignment.updateMany({
      where: { id: { in: removeIds } },
      data: { status: "inactive" },
    });
  }

  for (const consultantUserId of collaborationIds) {
    await tx.caseAssignment.upsert({
      where: {
        agencyId_caseId_consultantUserId_assignmentType: {
          agencyId,
          caseId,
          consultantUserId,
          assignmentType: "supporting",
        },
      },
      create: {
        agencyId,
        caseId,
        consultantUserId,
        assignmentType: "supporting",
        status: "active",
        assignedById: actorUserId || null,
      },
      update: {
        status: "active",
        assignedById: actorUserId || null,
        assignedAt: new Date(),
      },
    });
  }

  await replaceRequiredRoleAssignment(tx, {
    agencyId,
    caseId,
    caseRoleId: validated.roles.rcic.id,
    userId: rcicUserId,
    actorUserId,
  });
  await replaceRequiredRoleAssignment(tx, {
    agencyId,
    caseId,
    caseRoleId: validated.roles.caseWorker.id,
    userId: caseWorkerUserId,
    actorUserId,
  });

  return validated;
}

export async function currentRequiredCaseTeam(agencyId, caseId, db = prisma) {
  const roles = roleMap(await ensureRequiredCaseRoles(agencyId, db));
  const rcicRole = roles[CASE_TEAM_ROLE_CODES.RCIC];
  const caseWorkerRole = roles[CASE_TEAM_ROLE_CODES.CASE_WORKER];
  const assignments = await db.caseRoleAssignment.findMany({
    where: {
      agencyId,
      caseId,
      status: "active",
      caseRoleId: { in: [rcicRole.id, caseWorkerRole.id] },
    },
    select: {
      id: true,
      caseRoleId: true,
      assignedAt: true,
      user: { select: collaborationUserSelect },
    },
    orderBy: { assignedAt: "asc" },
  });
  const rcicAssignments = assignments.filter((item) => item.caseRoleId === rcicRole.id);
  const caseWorkerAssignments = assignments.filter((item) => item.caseRoleId === caseWorkerRole.id);
  return {
    roles: { rcic: rcicRole, caseWorker: caseWorkerRole },
    rcic: rcicAssignments[0]?.user || null,
    caseWorker: caseWorkerAssignments[0]?.user || null,
    complete: rcicAssignments.length === 1 && caseWorkerAssignments.length === 1,
    assignmentCounts: { rcic: rcicAssignments.length, caseWorker: caseWorkerAssignments.length },
  };
}

export async function userCanManageCaseCollaboration({ agencyId, userId, role, caseId = null }, db = prisma) {
  if (role === "admin") return true;
  if (role !== "consultant") return false;
  const roles = roleMap(await ensureRequiredCaseRoles(agencyId, db));
  const rcicRoleId = roles[CASE_TEAM_ROLE_CODES.RCIC].id;
  const [globalRcic, caseRcic] = await Promise.all([
    db.teamIncentiveRoleAssignment.findFirst({
      where: { agencyId, userId, caseRoleId: rcicRoleId },
      select: { id: true },
    }),
    caseId
      ? db.caseRoleAssignment.findFirst({
          where: { agencyId, caseId, userId, caseRoleId: rcicRoleId, status: "active" },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  return Boolean(globalRcic || caseRcic);
}

export async function cloneRequiredCaseTeam(tx, { agencyId, sourceCaseId, successorCaseId, actorUserId }) {
  const sourceTeam = await currentRequiredCaseTeam(agencyId, sourceCaseId, tx);
  if (!sourceTeam.complete || !sourceTeam.rcic?.id || !sourceTeam.caseWorker?.id) {
    throw createHttpError(
      409,
      "Assign an RCIC and Case Worker to the refused case before starting a new case from it.",
      "CASE_TEAM_INCOMPLETE",
    );
  }
  const extra = await tx.caseAssignment.findMany({
    where: { agencyId, caseId: sourceCaseId, status: "active", assignmentType: "supporting" },
    select: { consultantUserId: true },
  });
  await applyRequiredCaseTeam(tx, {
    agencyId,
    caseId: successorCaseId,
    rcicUserId: sourceTeam.rcic.id,
    caseWorkerUserId: sourceTeam.caseWorker.id,
    actorUserId,
    collaboratorUserIds: extra.map((item) => item.consultantUserId),
  });
  return sourceTeam;
}
