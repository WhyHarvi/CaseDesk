import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function listCaseRoles(agencyId, { includeInactive = false } = {}) {
  return prisma.agencyCaseRole.findMany({
    where: { agencyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function requireCaseRole(agencyId, id) {
  const role = await prisma.agencyCaseRole.findFirst({ where: { id, agencyId, isActive: true } });
  if (!role) throw createHttpError(400, "Choose a valid active case role.", "VALIDATION_ERROR");
  return role;
}

export async function createCaseRole(agencyId, values) {
  const name = String(values?.name || "").trim().slice(0, 100);
  const code = normalizeCode(values?.code || name);
  if (!name || !code) throw createHttpError(400, "Enter a case role name.", "VALIDATION_ERROR");
  try {
    return await prisma.agencyCaseRole.create({
      data: {
        agencyId,
        code,
        name,
        description: String(values?.description || "").trim().slice(0, 300) || null,
        isActive: true,
        sortOrder: Number.isInteger(values?.sortOrder) ? values.sortOrder : 100,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") throw createHttpError(409, "A case role with this name or code already exists.", "DUPLICATE");
    throw error;
  }
}

export async function updateCaseRole(agencyId, id, values) {
  const current = await prisma.agencyCaseRole.findFirst({ where: { id, agencyId } });
  if (!current) throw createHttpError(404, "Case role not found.", "NOT_FOUND");
  const data = {};
  if (values?.name !== undefined) {
    data.name = String(values.name || "").trim().slice(0, 100);
    if (!data.name) throw createHttpError(400, "Enter a case role name.", "VALIDATION_ERROR");
  }
  if (values?.description !== undefined) data.description = String(values.description || "").trim().slice(0, 300) || null;
  if (typeof values?.isActive === "boolean") data.isActive = values.isActive;
  if (Number.isInteger(values?.sortOrder)) data.sortOrder = values.sortOrder;
  return prisma.agencyCaseRole.update({ where: { id }, data });
}

export async function deleteCaseRole(agencyId, id) {
  const current = await prisma.agencyCaseRole.findFirst({ where: { id, agencyId } });
  if (!current) throw createHttpError(404, "Case role not found.", "NOT_FOUND");
  if (current.isSystem) throw createHttpError(409, "Built-in case roles can be hidden but not deleted.", "SYSTEM_ROLE");
  const assignmentCount = await prisma.caseRoleAssignment.count({ where: { agencyId, caseRoleId: id } });
  if (assignmentCount > 0) {
    throw createHttpError(409, "This role is already assigned on a case. Hide it instead so history remains accurate.", "ROLE_IN_USE");
  }
  try {
    await prisma.agencyCaseRole.delete({ where: { id } });
  } catch (error) {
    // IncentivePlanRoleShare.caseRoleId is onDelete: Restrict — a role used
    // in a plan's split config can't be deleted out from under it.
    if (error?.code === "P2003") throw createHttpError(409, "This role is used in an incentive plan. Hide it instead so the plan keeps working.", "ROLE_IN_USE");
    throw error;
  }
}
