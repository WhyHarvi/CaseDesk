import prisma from "../services/prisma/client.js";
import { verifyAccessToken } from "../services/supabaseAuth.js";

function fail(res, status, message, code) {
  return res.status(status).json({ success: false, message, code });
}

export async function requireOnboardingAuth(req, res, next) {
  try {
    const match = (req.header("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return fail(res, 401, "Your invitation session is missing or expired.", "INVITATION_SESSION_REQUIRED");

    let authUser;
    try {
      authUser = await verifyAccessToken(match[1]);
    } catch {
      return fail(res, 401, "Your invitation session is missing or expired.", "INVITATION_SESSION_REQUIRED");
    }

    const request = await prisma.onboardingRequest.findUnique({
      where: { authUserId: authUser.id },
      include: { agency: true, user: true },
    });
    if (!request || !request.agency || !request.user) {
      return fail(res, 403, "This invitation is not linked to a CaseDesk account.", "INVITATION_NOT_FOUND");
    }
    if (request.status === "completed") {
      return fail(res, 409, "This invitation has already been completed.", "INVITATION_COMPLETED");
    }
    if (!["invited", "pending"].includes(request.status) || (request.expiresAt && request.expiresAt < new Date())) {
      return fail(res, 410, "This invitation has expired. Request a new invitation.", "INVITATION_EXPIRED");
    }

    req.accessToken = match[1];
    req.authUser = authUser;
    req.onboardingRequest = request;
    next();
  } catch (error) {
    next(error);
  }
}

export default requireOnboardingAuth;
