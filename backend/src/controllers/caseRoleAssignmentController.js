import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { ensureRequiredCaseRoles, REQUIRED_CASE_ROLE_CODES } from "../services/caseRoleService.js";
import {
  requiredCaseTeamOptions,
  userCanManageCaseCollaboration,
} from "../services/caseRequiredTeamService.js";

const userSelect = { id: true, fullName: true, email: true };

async function scopedCase(req) {
  const caseItem = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, deletedAt: null },
    select: { id: true, clientId: true, archivedAt: true },
  });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (caseItem.archivedAt) throw createHttpError(409, "Restore this case before changing its case roles.", "CASE_ARCHIVED");
  return caseItem;
}

async function requireRoleManager(req, caseId) {
  const canManage = await userCanManageCaseCollaboration({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    role: req.auth.role,
    caseId,
  });
  if (!canManage) {
    throw createHttpError(403, "Only an administrator or an RCIC can change case roles.", "FORBIDDEN");
  }
}

export async function listCaseRoleAssignments(req, res) {
  await scopedCase(req);
  await ensureRequiredCaseRoles(req.auth.agencyId);
  const data = await prisma.caseRoleAssignment.findMany({
    where: { agencyId: req.auth.agencyId, caseId: req.params.id, status: "active" },
    select: { id: true, caseRoleId: true, assignedAt: true, caseRole: { select: { id: true, code: true, name: true } }, user: { select: userSelect } },
    orderBy: [{ caseRole: { sortOrder: "asc" } }, { assignedAt: "asc" }],
  });
  res.json({ data });
}

export async function replaceCaseRoleAssignments(req, res) {
  const caseItem = await scopedCase(req);
  await requireRoleManager(req, caseItem.id);
  const supplied = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  if (supplied.length > 100) throw createHttpError(400, "Too many role assignments.", "VALIDATION_ERROR");
  const pairs = supplied
    .map((item) => ({ caseRoleId: String(item?.caseRoleId || "").trim(), userId: String(item?.userId || "").trim() }))
    .filter((item) => item.caseRoleId && item.userId);
  const dedupedKey = new Set();
  const deduped = pairs.filter((pair) => {
    const key = `${pair.caseRoleId}:${pair.userId}`;
    if (dedupedKey.has(key)) return false;
    dedupedKey.add(key);
    return true;
  });

  const requiredRoles = await ensureRequiredCaseRoles(req.auth.agencyId);
  const requiredByCode = new Map(requiredRoles.map((role) => [role.code, role]));
  const rcicRole = requiredByCode.get("rcic");
  const caseWorkerRole = requiredByCode.get("case-worker");
  const rcicPairs = deduped.filter((pair) => pair.caseRoleId === rcicRole.id);
  const caseWorkerPairs = deduped.filter((pair) => pair.caseRoleId === caseWorkerRole.id);
  if (rcicPairs.length !== 1) {
    throw createHttpError(400, "Every case must have exactly one RCIC.", "RCIC_REQUIRED");
  }
  if (caseWorkerPairs.length !== 1) {
    throw createHttpError(400, "Every case must have exactly one Case Worker.", "CASE_WORKER_REQUIRED");
  }

  const [validRoles, validUsers, requiredOptions] = await Promise.all([
    prisma.agencyCaseRole.findMany({ where: { agencyId: req.auth.agencyId, id: { in: deduped.map((pair) => pair.caseRoleId) }, isActive: true }, select: { id: true, code: true } }),
    prisma.user.findMany({ where: { agencyId: req.auth.agencyId, id: { in: deduped.map((pair) => pair.userId) }, status: "active" }, select: { id: true } }),
    requiredCaseTeamOptions(req.auth.agencyId),
  ]);
  const validRoleIds = new Set(validRoles.map((role) => role.id));
  const validUserIds = new Set(validUsers.map((user) => user.id));
  if (deduped.some((pair) => !validRoleIds.has(pair.caseRoleId) || !validUserIds.has(pair.userId))) {
    throw createHttpError(400, "One or more selected roles or staff members are invalid.", "VALIDATION_ERROR");
  }
  const eventDerivedRoleIds = new Set(validRoles.filter((role) => role.code === "frontdesk").map((role) => role.id));
  if (deduped.some((pair) => eventDerivedRoleIds.has(pair.caseRoleId))) {
    throw createHttpError(400, "Frontdesk is attributed from the person who records each payment and cannot be assigned permanently to a case.", "EVENT_ATTRIBUTION_REQUIRED");
  }
  if (!requiredOptions.rcicUsers.some((user) => user.id === rcicPairs[0].userId)) {
    throw createHttpError(400, "The selected RCIC does not have the RCIC team role.", "INVALID_RCIC");
  }
  if (!requiredOptions.caseWorkerUsers.some((user) => user.id === caseWorkerPairs[0].userId)) {
    throw createHttpError(400, "The selected Case Worker does not have the Case Worker team role.", "INVALID_CASE_WORKER");
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.caseRoleAssignment.findMany({ where: { agencyId: req.auth.agencyId, caseId: caseItem.id, status: "active" }, select: { id: true, caseRoleId: true, userId: true } });
    const existingByKey = new Map(existing.map((row) => [`${row.caseRoleId}:${row.userId}`, row]));
    const nextKeys = new Set(deduped.map((pair) => `${pair.caseRoleId}:${pair.userId}`));

    const toRemove = existing.filter((row) => !nextKeys.has(`${row.caseRoleId}:${row.userId}`));
    if (toRemove.length) {
      await tx.caseRoleAssignment.deleteMany({ where: { id: { in: toRemove.map((row) => row.id) } } });
    }
    for (const pair of deduped) {
      if (existingByKey.has(`${pair.caseRoleId}:${pair.userId}`)) continue;
      await tx.caseRoleAssignment.create({
        data: { agencyId: req.auth.agencyId, caseId: caseItem.id, caseRoleId: pair.caseRoleId, userId: pair.userId, assignedById: req.auth.userId, status: "active" },
      });
    }
  });

  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: caseItem.clientId,
    caseId: caseItem.id,
    action: "case.roles_updated",
    details: `Case roles updated: RCIC and Case Worker confirmed with ${Math.max(deduped.length - 2, 0)} additional role assignment${Math.max(deduped.length - 2, 0) === 1 ? "" : "s"}`,
  });

  const data = await prisma.caseRoleAssignment.findMany({
    where: { agencyId: req.auth.agencyId, caseId: caseItem.id, status: "active" },
    select: { id: true, caseRoleId: true, assignedAt: true, caseRole: { select: { id: true, code: true, name: true } }, user: { select: userSelect } },
    orderBy: [{ caseRole: { sortOrder: "asc" } }, { assignedAt: "asc" }],
  });
  res.json({ data });
}

export async function removeCaseRoleAssignment(req, res) {
  const caseItem = await scopedCase(req);
  await requireRoleManager(req, caseItem.id);
  const existing = await prisma.caseRoleAssignment.findFirst({
    where: { id: req.params.assignmentId, agencyId: req.auth.agencyId, caseId: caseItem.id },
    include: { caseRole: { select: { code: true, name: true } } },
  });
  if (!existing) throw createHttpError(404, "Role assignment not found.", "NOT_FOUND");
  if (REQUIRED_CASE_ROLE_CODES.has(existing.caseRole.code)) {
    throw createHttpError(409, `${existing.caseRole.name} is mandatory. Assign a replacement instead of removing it.`, "REQUIRED_CASE_ROLE");
  }
  await prisma.caseRoleAssignment.delete({ where: { id: existing.id } });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: caseItem.clientId,
    caseId: caseItem.id,
    action: "case.role_removed",
    details: `${existing.caseRole.name} assignment removed.`,
  });
  res.status(204).end();
}
