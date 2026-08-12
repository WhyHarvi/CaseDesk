import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";

const administratorPermissions = Object.freeze({
  canView: true,
  canSendEmail: true,
  canSendSms: true,
  canUseChat: true,
  canInitiateCalls: true,
  canExport: true,
  canDelete: true,
  canManageConsent: true,
  canManageTemplates: true,
  canManageProviders: true,
  canViewAll: true,
});

const staffDefaults = Object.freeze({
  canView: true,
  canSendEmail: true,
  canSendSms: true,
  canUseChat: true,
  canInitiateCalls: true,
  canExport: false,
  canDelete: false,
  canManageConsent: false,
  canManageTemplates: false,
  canManageProviders: false,
  canViewAll: true,
});

export function defaultCommunicationPermissionsForRole(role) {
  return { ...(role === "admin" ? administratorPermissions : staffDefaults) };
}

export const communicationPermissionKeys = Object.keys(
  administratorPermissions,
);

export async function getCommunicationPermissions(req) {
  if (req.user.role === "admin") {
    return { ...administratorPermissions, source: "role" };
  }
  const stored = await prisma.communicationPermission.findUnique({
    where: { userId: req.user.id },
  });
  return stored
    ? Object.fromEntries([
        ...communicationPermissionKeys.map((key) => [key, stored[key]]),
        ["source", "user"],
      ])
    : { ...staffDefaults, source: "default" };
}

export async function requireCommunicationPermission(req, key) {
  if (!communicationPermissionKeys.includes(key)) {
    throw createHttpError(500, "Unknown communication permission");
  }
  const permissions = await getCommunicationPermissions(req);
  if (!permissions[key]) {
    throw createHttpError(
      403,
      `You do not have permission to ${key
        .replace(/^can/, "")
        .replaceAll(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase()}`,
    );
  }
  return permissions;
}

export function requireCommunicationAdministrator(req) {
  if (req.user.role !== "admin") {
    throw createHttpError(
      403,
      "Only agency administrators can change workspace communication settings",
    );
  }
}
