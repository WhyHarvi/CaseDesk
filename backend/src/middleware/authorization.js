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
    // A client can have cases assigned to different consultants. Once a
    // record is attached to a case, client-level access must not be allowed
    // to bypass that case's assignment boundary. Only genuinely client-level
    // records (caseId = null) fall back to the client predicate.
    OR: [
      {
        caseId: { not: null },
        case: {
          agencyId: req.auth.agencyId,
          ...caseAccessWhere(req),
        },
      },
      {
        caseId: null,
        client: {
          agencyId: req.auth.agencyId,
          ...clientAccessWhere(req),
        },
      },
    ],
  };
}

// Case-only child records (folders, Writer documents, forms, etc.) use this
// predicate so an ID-based request cannot stop at agencyId and skip the
// user's assigned/all/none case scope.
export function caseLinkedRecordAccessWhere(req) {
  return {
    case: {
      agencyId: req.auth.agencyId,
      ...caseAccessWhere(req),
    },
  };
}

// A parent relation can use this directly, e.g. an attachment whose
// `message` must itself satisfy the related-record boundary.
export function relatedRecordParentAccessWhere(req) {
  return {
    agencyId: req.auth.agencyId,
    ...relatedRecordAccessWhere(req),
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
