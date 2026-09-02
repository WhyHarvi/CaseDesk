import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { logger } from "./logger.js";
import { ensureRequiredCaseRoles, listCaseRoles, REQUIRED_CASE_ROLE_CODES } from "./caseRoleService.js";
import { refreshOpenInvoiceSnapshots } from "./incentiveCreditingService.js";

// Administrators can hold case roles in Team Members just like consultants
// and front-desk staff, so they must remain eligible everywhere those role
// assignments are consumed (new-case selectors, collaboration, and access).
const STAFF_ROLES = ["admin", "consultant", "frontdesk"];
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

// Optional (non-required) case roles, e.g. Reviewer, restricted the same way
// RCIC/Case Worker already are: only people already granted that role in
// Team Members (TeamIncentiveRoleAssignment) are offered as options.
// Collaboration must never let someone assign a role at the case level that
// wasn't first set up at the team level.
export async function optionalCaseRoleOptions(agencyId, db = prisma) {
  const roles = (await listCaseRoles(agencyId)).filter((role) => !REQUIRED_CASE_ROLE_CODES.has(role.code));
  const eligibleUsersByRole = await Promise.all(roles.map((role) => eligibleUsersForRole(agencyId, role.id, db)));
  return roles.map((role, index) => ({ roleId: role.id, users: eligibleUsersByRole[index] }));
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

// Every case whose required team isn't complete yet — existing cases from
// before this requirement existed, or ones an automated/no-review path
// (bulk Case Easy import, a public booking, etc.) couldn't fully resolve on
// its own. Batched (all cases + their role assignments in two queries), not
// N+1, matching resolveHolders'/getPipeline's existing style elsewhere.
export async function getCasesMissingRequiredTeam(agencyId, db = prisma) {
  const roles = roleMap(await ensureRequiredCaseRoles(agencyId, db));
  const rcicRoleId = roles[CASE_TEAM_ROLE_CODES.RCIC].id;
  const caseWorkerRoleId = roles[CASE_TEAM_ROLE_CODES.CASE_WORKER].id;

  const cases = await db.case.findMany({
    where: { agencyId, archivedAt: null, deletedAt: null, status: { not: "Closed" } },
    select: {
      id: true,
      caseType: true,
      assignedUserId: true,
      client: { select: { fullName: true } },
      roleAssignments: {
        where: { status: "active", caseRoleId: { in: [rcicRoleId, caseWorkerRoleId] } },
        select: { caseRoleId: true, userId: true },
      },
    },
  });

  const results = [];
  for (const caseItem of cases) {
    const rcicUserId = caseItem.roleAssignments.find((row) => row.caseRoleId === rcicRoleId)?.userId || null;
    const caseWorkerUserId = caseItem.roleAssignments.find((row) => row.caseRoleId === caseWorkerRoleId)?.userId || null;
    if (rcicUserId && caseWorkerUserId) continue;
    results.push({
      caseId: caseItem.id,
      caseType: caseItem.caseType,
      clientName: caseItem.client?.fullName || null,
      assignedUserId: caseItem.assignedUserId,
      rcicUserId,
      caseWorkerUserId,
    });
  }
  return results;
}

// Admin-triggered, idempotent — a second run only ever looks at each case's
// CURRENT coverage, so it fixes nothing new once everything resolves. Same
// best-effort default rule as everywhere else a required role needs a
// default: the sole eligible candidate wins; otherwise, if the case
// already has an assignee who happens to be eligible, use them; otherwise
// leave it for a human to pick via Collaboration.
export async function backfillRequiredCaseTeams(agencyId, actorUserId, db = prisma) {
  const [missing, options] = await Promise.all([
    getCasesMissingRequiredTeam(agencyId, db),
    requiredCaseTeamOptions(agencyId, db),
  ]);

  let fixedCount = 0;
  const stillNeedsReview = [];
  for (const item of missing) {
    let rcicUserId = item.rcicUserId;
    let caseWorkerUserId = item.caseWorkerUserId;

    if (!rcicUserId) {
      if (options.rcicUsers.length === 1) rcicUserId = options.rcicUsers[0].id;
      else if (item.assignedUserId && options.rcicUsers.some((user) => user.id === item.assignedUserId)) rcicUserId = item.assignedUserId;
    }
    if (!caseWorkerUserId) {
      if (options.caseWorkerUsers.length === 1) caseWorkerUserId = options.caseWorkerUsers[0].id;
      else if (item.assignedUserId && options.caseWorkerUsers.some((user) => user.id === item.assignedUserId)) caseWorkerUserId = item.assignedUserId;
    }

    if (!rcicUserId || !caseWorkerUserId) {
      stillNeedsReview.push({
        caseId: item.caseId,
        clientName: item.clientName,
        caseType: item.caseType,
        missing: [!rcicUserId ? "RCIC" : null, !caseWorkerUserId ? "Case Worker" : null].filter(Boolean),
      });
      continue;
    }

    // Preserve any collaborators the case already has — applyRequiredCaseTeam
    // replaces the full supporting-collaborator set, so an empty list here
    // would silently strip anyone already added for unrelated reasons.
    const existingCollaborators = await db.caseAssignment.findMany({
      where: { agencyId, caseId: item.caseId, assignmentType: "supporting", status: "active" },
      select: { consultantUserId: true },
    });

    await db.$transaction(async (tx) => {
      await applyRequiredCaseTeam(tx, {
        agencyId,
        caseId: item.caseId,
        rcicUserId,
        caseWorkerUserId,
        actorUserId,
        collaboratorUserIds: existingCollaborators.map((row) => row.consultantUserId),
      });
    });
    // This backfill exists precisely for cases whose invoices were created
    // before a team existed — re-freeze those invoices' incentive
    // snapshots with the team that's now actually on the case, or future
    // collections would credit nobody (the RCIC gap). After the team
    // transaction commits, best-effort. See refreshOpenInvoiceSnapshots.
    await refreshOpenInvoiceSnapshots(agencyId, item.caseId, db).catch((error) => {
      logger.warn("incentive.snapshot_refresh_failed", { agencyId, caseId: item.caseId, reason: error.message });
    });
    fixedCount += 1;
  }
  return { fixedCount, stillNeedsReviewCount: stillNeedsReview.length, stillNeedsReview };
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
