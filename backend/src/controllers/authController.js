import prisma from "../services/prisma/client.js";
import { updateAuthenticatedUser } from "../services/supabaseAuth.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

function publicIdentity(req) {
  return {
    user: {
      id: req.appUser.id,
      email: req.appUser.email,
      fullName: req.appUser.fullName,
      phone: req.appUser.phone,
      jobTitle: req.appUser.jobTitle,
      mustChangePassword: req.appUser.mustChangePassword || req.membership.mustChangePassword,
    },
    agency: {
      id: req.membership.agency.id,
      name: req.membership.agency.name,
      onboardingStatus: req.membership.agency.onboardingStatus,
      accessStatus: req.membership.agency.accessStatus,
    },
    membership: {
      id: req.membership.id,
      role: req.membership.role,
      isActive: req.membership.isActive,
      permissions: req.membership.permissions || {},
    },
  };
}

export async function getMe(req, res) {
  const recentLogin = await prisma.activityLog.findFirst({
    where: {
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      action: "USER_LOGIN",
      createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    select: { id: true },
  });
  if (!recentLogin) {
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "USER_LOGIN", details: "Authenticated session restored", metadata: { authUserId: req.auth.authUserId } });
  }
  res.json({ success: true, ...publicIdentity(req) });
}

export async function logout(req, res) {
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "USER_LOGOUT",
    details: "User signed out",
  });
  res.status(204).send();
}

export async function changePassword(req, res) {
  const password = String(req.body?.password || "");
  if (password.length < 10) {
    throw createHttpError(400, "Password must be at least 10 characters.", "VALIDATION_ERROR");
  }
  await updateAuthenticatedUser(req.accessToken, { password });
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.auth.userId }, data: { mustChangePassword: false } }),
    prisma.agencyMember.update({ where: { id: req.auth.membershipId }, data: { mustChangePassword: false } }),
  ]);
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "PASSWORD_CHANGED",
    details: "Account password changed",
  });
  res.json({ success: true, message: "Password changed successfully." });
}

export async function getInvitation(req, res) {
  const membership = req.invitedMembership;
  res.json({
    success: true,
    data: {
      email: req.invitedAppUser.email,
      fullName: req.invitedAppUser.fullName,
      role: membership.role,
      agencyName: membership.agency.name,
      requiresAgencySetup: membership.role === "admin" && membership.agency.onboardingStatus !== "active",
      alreadyActive: req.invitedAppUser.status === "active",
    },
  });
}

export async function acceptMemberInvitation(req, res) {
  const password = String(req.body?.password || "");
  if (password.length < 10 || password.length > 128) throw createHttpError(400, "Password must be between 10 and 128 characters.", "VALIDATION_ERROR");
  const user = req.invitedAppUser;
  const membership = req.invitedMembership;
  if (membership.agency.onboardingStatus !== "active") {
    throw createHttpError(409, "Complete workspace onboarding before activating this account.", "AGENCY_SETUP_REQUIRED");
  }
  // Same link + form is used for two cases: first-time onboarding
  // ("invited" -> "active") and a staff-triggered password reset on an
  // account that's already active — see sendPortalAccessLink in
  // portalController.js, which emails a Supabase "recovery" link that
  // lands here too. Only a genuinely unavailable account (e.g. "disabled")
  // should be rejected.
  const isFirstActivation = user.status === "invited";
  if (!isFirstActivation && user.status !== "active") {
    throw createHttpError(409, "This account is not available for a password reset.", "ACCOUNT_UNAVAILABLE");
  }
  await updateAuthenticatedUser(req.accessToken, { password, data: { full_name: user.fullName } });
  if (isFirstActivation) {
    await prisma.user.update({ where: { id: user.id }, data: { status: "active", mustChangePassword: false } });
  }
  await recordActivity({
    agencyId: membership.agencyId,
    userId: user.id,
    action: isFirstActivation ? "MEMBER_INVITATION_ACCEPTED" : "MEMBER_PASSWORD_RESET",
    details: isFirstActivation ? `${membership.role} account activated` : `${membership.role} account password reset`,
  });
  res.json({ success: true, message: isFirstActivation ? "Your CaseDesk account is ready." : "Your password has been updated." });
}

export default { getMe, logout, changePassword, getInvitation, acceptMemberInvitation };
