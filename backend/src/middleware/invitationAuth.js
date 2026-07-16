import prisma from "../services/prisma/client.js";
import { verifyAccessToken } from "../services/supabaseAuth.js";

export async function requireInvitationAuth(req, res, next) {
  try {
    const match = (req.header("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ success: false, message: "Your invitation session is missing or expired.", code: "INVITATION_SESSION_REQUIRED" });
    let authUser;
    try { authUser = await verifyAccessToken(match[1]); }
    catch { return res.status(401).json({ success: false, message: "Your invitation session is missing or expired.", code: "INVITATION_SESSION_REQUIRED" }); }
    const appUser = await prisma.user.findUnique({
      where: { authUserId: authUser.id },
      include: { memberships: { where: { isActive: true }, include: { agency: true }, orderBy: { createdAt: "asc" } } },
    });
    const membership = appUser?.memberships?.[0];
    if (!appUser || !membership) return res.status(403).json({ success: false, message: "This invitation is not linked to a CaseDesk account.", code: "INVITATION_NOT_FOUND" });
    req.accessToken = match[1];
    req.authUser = authUser;
    req.invitedAppUser = appUser;
    req.invitedMembership = membership;
    next();
  } catch (error) { next(error); }
}

export default requireInvitationAuth;
