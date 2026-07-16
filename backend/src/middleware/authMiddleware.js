import prisma from "../services/prisma/client.js";
import { verifyAccessToken } from "../services/supabaseAuth.js";

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, code });
}

export async function requireAuth(req, res, next) {
  try {
    const authorization = req.header("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return fail(res, 401, "Authentication is required.", "UNAUTHENTICATED");

    let authUser;
    try {
      authUser = await verifyAccessToken(match[1]);
    } catch {
      return fail(res, 401, "Authentication is required.", "UNAUTHENTICATED");
    }

    const appUser = await prisma.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        id: true,
        agencyId: true,
        authUserId: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        mustChangePassword: true,
        phone: true,
        jobTitle: true,
        memberships: {
          where: { isActive: true },
          include: { agency: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!appUser) return fail(res, 403, "No application profile is linked to this account.", "MEMBERSHIP_NOT_FOUND");
    if (appUser.status === "invited") return fail(res, 403, "Complete your account setup to continue.", "ACCOUNT_SETUP_REQUIRED");
    if (appUser.status !== "active") return fail(res, 403, "This account is inactive.", "ACCOUNT_INACTIVE");

    const membership = appUser.memberships[0];
    if (!membership) return fail(res, 403, "No active agency membership was found.", "MEMBERSHIP_NOT_FOUND");
    if (membership.agency.onboardingStatus !== "active") return fail(res, 403, "Complete your agency setup to continue.", "ACCOUNT_SETUP_REQUIRED");
    if (membership.agency.status !== "active" || membership.agency.accessStatus === "blocked") return fail(res, 403, "This account is inactive.", "ACCOUNT_INACTIVE");
    if (!["admin", "consultant", "frontdesk", "client"].includes(membership.role)) {
      return fail(res, 403, "This account role is not supported.", "INVALID_ROLE");
    }

    req.accessToken = match[1];
    req.auth = {
      authUserId: authUser.id,
      userId: appUser.id,
      agencyId: membership.agencyId,
      role: membership.role,
      membershipId: membership.id,
      permissions: membership.permissions || {},
      agencyAccessStatus: membership.agency.accessStatus,
      readOnly: membership.agency.accessStatus === "read_only",
    };
    // Keep the existing controllers compatible while identity now comes only
    // from the verified token and database membership.
    req.user = {
      id: appUser.id,
      agencyId: membership.agencyId,
      email: appUser.email,
      role: membership.role,
      fullName: appUser.fullName,
    };
    req.appUser = appUser;
    req.membership = membership;
    next();
  } catch (error) {
    next(error);
  }
}

export default requireAuth;
