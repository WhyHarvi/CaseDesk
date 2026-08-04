import prisma from "../services/prisma/client.js";
import { portalDataScope } from "../services/portalAccessService.js";

const denied = (res) =>
  res.status(403).json({
    success: false,
    message: "You do not have permission to perform this action.",
    code: "FORBIDDEN",
  });

export function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.auth?.role) ? next() : denied(res);
}

export function clientAccessWhere(req) {
  // Agency administrators choose whether a staff member sees all records,
  // only assigned records, or none. Client-portal identities remain scoped
  // exclusively through their portal relationship.
  const scope = portalDataScope(req, "clients");
  if (req.auth.role === "admin" || scope === "all") return {};
  if (
    ["consultant", "frontdesk"].includes(req.auth.role) &&
    scope === "assigned"
  ) {
    return {
      OR: [
        { assignedUserId: req.auth.userId },
        {
          cases: {
            some: {
              OR: [
                { assignedUserId: req.auth.userId },
                {
                  assignments: {
                    some: {
                      consultantUserId: req.auth.userId,
                      status: "active",
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    };
  }
  if (req.auth.role === "client")
    return { portalUsers: { some: { userId: req.auth.userId } } };
  return { id: "__portal_access_denied__" };
}

export function caseAccessWhere(req) {
  const scope = portalDataScope(req, "cases");
  if (req.auth.role === "admin" || scope === "all") return {};
  if (
    ["consultant", "frontdesk"].includes(req.auth.role) &&
    scope === "assigned"
  ) {
    return {
      OR: [
        { assignedUserId: req.auth.userId },
        {
          assignments: {
            some: { consultantUserId: req.auth.userId, status: "active" },
          },
        },
      ],
    };
  }
  if (req.auth.role === "client")
    return { client: { portalUsers: { some: { userId: req.auth.userId } } } };
  return { id: "__portal_access_denied__" };
}

export function relatedRecordAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  return {
    OR: [{ client: clientAccessWhere(req) }, { case: caseAccessWhere(req) }],
  };
}

export function requireClientAccess(param = "id") {
  return async (req, res, next) => {
    try {
      const record = await prisma.client.findFirst({
        where: {
          id: req.params[param],
          agencyId: req.auth.agencyId,
          ...clientAccessWhere(req),
        },
        select: { id: true },
      });
      if (!record) return denied(res);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireCaseAccess(param = "id") {
  return async (req, res, next) => {
    try {
      // deletedAt: undefined keeps trashed cases reachable here so their
      // profile can render the trash state and the restore route can work.
      const record = await prisma.case.findFirst({
        where: {
          id: req.params[param],
          agencyId: req.auth.agencyId,
          ...caseAccessWhere(req),
          deletedAt: undefined,
        },
        select: { id: true },
      });
      if (!record) return denied(res);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAgencyAccess = (req, res, next) =>
  req.auth?.agencyId ? next() : denied(res);
