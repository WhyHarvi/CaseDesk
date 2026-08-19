import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const userSelect = { id: true, fullName: true, email: true };

async function scopedCase(req) {
  const caseItem = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, deletedAt: null },
    select: { id: true, clientId: true, archivedAt: true },
  });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (caseItem.archivedAt) throw createHttpError(409, "Restore this case before changing its incentive roles.", "CASE_ARCHIVED");
  return caseItem;
}

export async function listCaseRoleAssignments(req, res) {
  await scopedCase(req);
  const data = await prisma.caseRoleAssignment.findMany({
    where: { agencyId: req.auth.agencyId, caseId: req.params.id, status: "active" },
    select: { id: true, caseRoleId: true, assignedAt: true, caseRole: { select: { id: true, code: true, name: true } }, user: { select: userSelect } },
    orderBy: [{ caseRole: { sortOrder: "asc" } }, { assignedAt: "asc" }],
  });
  res.json({ data });
}

export async function replaceCaseRoleAssignments(req, res) {
  const caseItem = await scopedCase(req);
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

  const [validRoles, validUsers] = await Promise.all([
    prisma.agencyCaseRole.findMany({ where: { agencyId: req.auth.agencyId, id: { in: deduped.map((pair) => pair.caseRoleId) }, isActive: true }, select: { id: true } }),
    prisma.user.findMany({ where: { agencyId: req.auth.agencyId, id: { in: deduped.map((pair) => pair.userId) }, status: "active" }, select: { id: true } }),
  ]);
  const validRoleIds = new Set(validRoles.map((role) => role.id));
  const validUserIds = new Set(validUsers.map((user) => user.id));
  if (deduped.some((pair) => !validRoleIds.has(pair.caseRoleId) || !validUserIds.has(pair.userId))) {
    throw createHttpError(400, "One or more selected roles or staff members are invalid.", "VALIDATION_ERROR");
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
    action: "case.incentive_roles_updated",
    details: `Incentive roles updated: ${deduped.length} assignment${deduped.length === 1 ? "" : "s"}`,
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
  const existing = await prisma.caseRoleAssignment.findFirst({ where: { id: req.params.assignmentId, agencyId: req.auth.agencyId, caseId: caseItem.id } });
  if (!existing) throw createHttpError(404, "Role assignment not found.", "NOT_FOUND");
  await prisma.caseRoleAssignment.delete({ where: { id: existing.id } });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    clientId: caseItem.clientId,
    caseId: caseItem.id,
    action: "case.incentive_role_removed",
    details: "An incentive role assignment was removed.",
  });
  res.status(204).end();
}
