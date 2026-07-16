import prisma from "../services/prisma/client.js";

const denied = (res) => res.status(403).json({
  success: false,
  message: "You do not have permission to perform this action.",
  code: "FORBIDDEN",
});

export function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.auth?.role) ? next() : denied(res);
}

export function clientAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  if (req.auth.role === "consultant") {
    return {
      OR: [
        { assignedUserId: req.auth.userId },
        { cases: { some: { OR: [
          { assignedUserId: req.auth.userId },
          { assignments: { some: { consultantUserId: req.auth.userId, status: "active" } } },
        ] } } },
      ],
    };
  }
  return { portalUsers: { some: { userId: req.auth.userId } } };
}

export function caseAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  if (req.auth.role === "consultant") {
    return { OR: [
      { assignedUserId: req.auth.userId },
      { assignments: { some: { consultantUserId: req.auth.userId, status: "active" } } },
    ] };
  }
  return { client: { portalUsers: { some: { userId: req.auth.userId } } } };
}

export function relatedRecordAccessWhere(req) {
  if (req.auth.role === "admin") return {};
  return { OR: [
    { client: clientAccessWhere(req) },
    { case: caseAccessWhere(req) },
  ] };
}

export function requireClientAccess(param = "id") {
  return async (req, res, next) => {
    try {
      const record = await prisma.client.findFirst({
        where: { id: req.params[param], agencyId: req.auth.agencyId, ...clientAccessWhere(req) },
        select: { id: true },
      });
      if (!record) return denied(res);
      next();
    } catch (error) { next(error); }
  };
}

export function requireCaseAccess(param = "id") {
  return async (req, res, next) => {
    try {
      const record = await prisma.case.findFirst({
        where: { id: req.params[param], agencyId: req.auth.agencyId, ...caseAccessWhere(req) },
        select: { id: true },
      });
      if (!record) return denied(res);
      next();
    } catch (error) { next(error); }
  };
}

export const requireAgencyAccess = (req, res, next) => req.auth?.agencyId ? next() : denied(res);
