import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";

export const REQUIRED_CASE_ROLE_DEFINITIONS = [
  {
    code: "rcic",
    name: "RCIC",
    description: "Regulated Canadian Immigration Consultant responsible for the case.",
    sortOrder: 10,
  },
  {
    code: "case-worker",
    name: "Case Worker",
    description: "Primary staff member responsible for day-to-day case work.",
    sortOrder: 20,
  },
];

export const REQUIRED_CASE_ROLE_CODES = new Set(
  REQUIRED_CASE_ROLE_DEFINITIONS.map((role) => role.code),
);

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function ensureRequiredCaseRoles(agencyId, db = prisma) {
  const roles = [];
  for (const definition of REQUIRED_CASE_ROLE_DEFINITIONS) {
    const role = await db.agencyCaseRole.upsert({
      where: {
        agencyId_code: { agencyId, code: definition.code },
      },
      create: {
        agencyId,
        ...definition,
        isActive: true,
        isSystem: true,
      },
      update: {
        name: definition.name,
        description: definition.description,
        isActive: true,
        isSystem: true,
        sortOrder: definition.sortOrder,
      },
    });
    roles.push(role);
  }
  return roles;
}

export async function listCaseRoles(agencyId, { includeInactive = false } = {}) {
  await ensureRequiredCaseRoles(agencyId);
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
  await ensureRequiredCaseRoles(agencyId);
  const name = String(values?.name || "").trim().slice(0, 100);
  const code = normalizeCode(values?.code || name);
  if (!name || !code) throw createHttpError(400, "Enter a case role name.", "VALIDATION_ERROR");
  if (REQUIRED_CASE_ROLE_CODES.has(code)) {
    throw createHttpError(409, `${name} is a built-in required case role.`, "SYSTEM_ROLE");
  }
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

  if (REQUIRED_CASE_ROLE_CODES.has(current.code)) {
    const definition = REQUIRED_CASE_ROLE_DEFINITIONS.find((role) => role.code === current.code);
    if (values?.isActive === false) {
      throw createHttpError(409, `${definition.name} is required on every case and cannot be hidden.`, "REQUIRED_CASE_ROLE");
    }
    if (values?.name !== undefined && String(values.name || "").trim() !== definition.name) {
      throw createHttpError(409, `${definition.name} is a required system role and cannot be renamed.`, "REQUIRED_CASE_ROLE");
    }
    return prisma.agencyCaseRole.update({
      where: { id },
      data: {
        name: definition.name,
        description: values?.description !== undefined
          ? String(values.description || "").trim().slice(0, 300) || definition.description
          : current.description || definition.description,
        isActive: true,
        isSystem: true,
        sortOrder: definition.sortOrder,
      },
    });
  }

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
  if (current.isSystem || REQUIRED_CASE_ROLE_CODES.has(current.code)) throw createHttpError(409, "Built-in case roles cannot be deleted.", "SYSTEM_ROLE");
  const [caseAssignmentCount, teamAssignmentCount] = await Promise.all([
    prisma.caseRoleAssignment.count({ where: { agencyId, caseRoleId: id } }),
    prisma.teamIncentiveRoleAssignment.count({ where: { agencyId, caseRoleId: id } }),
  ]);
  if (caseAssignmentCount + teamAssignmentCount > 0) {
    throw createHttpError(409, "This role is already assigned to cases or team members. Hide it instead so history remains accurate.", "ROLE_IN_USE");
  }
  try {
    await prisma.agencyCaseRole.delete({ where: { id } });
  } catch (error) {
    if (error?.code === "P2003") throw createHttpError(409, "This role is used in an incentive plan. Hide it instead so the plan keeps working.", "ROLE_IN_USE");
    throw error;
  }
}
