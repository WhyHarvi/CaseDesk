import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";

export const formPermissionKeys = ["canAssign", "canEdit", "canReview", "canApprove", "canFinalize", "canDelete", "canUnlock"];
const administratorPermissions = Object.fromEntries(formPermissionKeys.map((key) => [key, true]));
const staffDefaults = { canAssign: true, canEdit: true, canReview: true, canApprove: false, canFinalize: false, canDelete: false, canUnlock: false };

export async function getFormPermissions(req) {
  if (req.user.role === "admin") return { ...administratorPermissions, canManageTemplates: true, source: "role" };
  const saved = await prisma.formPermission.findUnique({ where: { userId: req.user.id } });
  return { ...staffDefaults, ...(saved ? Object.fromEntries(formPermissionKeys.map((key) => [key, saved[key]])) : {}), canManageTemplates: false, source: saved ? "custom" : "default" };
}

export async function requireFormPermission(req, key) {
  const permissions = await getFormPermissions(req);
  if (!permissions[key]) throw createHttpError(403, `You do not have permission to ${key.replace(/^can/, "").toLowerCase()} forms`);
  return permissions;
}

export function assertFormUnlocked(form) {
  if (form.lockedAt) throw createHttpError(423, "This finalized form is locked. An authorized user must unlock it before changes can be made.");
}
