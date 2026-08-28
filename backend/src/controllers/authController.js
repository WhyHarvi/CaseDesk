import prisma from "../services/prisma/client.js";
import { generateAuthLink, updateAuthenticatedUser } from "../services/supabaseAuth.js";
import { sendAccountAccessEmail } from "../services/accountAccessMailService.js";
import { logger } from "../services/logger.js";
import { createHttpError } from "../utils/http.js";
import { publicAppUrl } from "../utils/publicAppUrl.js";
import { recordActivity } from "../utils/prismaCrud.js";

const PASSWORD_RECOVERY_RESPONSE = "If an eligible account exists for that email, a secure recovery link has been sent.";

function publicIdentity(req) {
  return {
    user: {
      id: req.appUser.id,
      email: req.appUser.email,
      fullName: req.appUser.fullName,
      phone: req.appUser.phone,
      jobTitle: req.appUser.jobTitle,
      hasAvatar: true,
      avatarPreset: req.appUser.avatarPreset,
      mustChangePassword: req.appUser.mustChangePassword || req.membership.mustChangePassword,
    },
    agency: {
      id: req.membership.agency.id,
      name: req.membership.agency.name,
      onboardingStatus: req.membership.agency.onboardingStatus,
      accessStatus: req.membership.agency.accessStatus,
      hasAvatar: Boolean(req.membership.agency.avatarMimeType),
      avatarUpdatedAt: req.membership.agency.updatedAt,
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

// Lightweight identity snapshot for long-lived browser sessions. Unlike
// /auth/me this endpoint does not record a login activity, so the frontend
// can safely refresh role and portal-access changes while the app is open.
export async function getAccessSnapshot(req, res) {
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

export async function requestPasswordRecovery(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createHttpError(400, "Enter a valid email address.", "VALIDATION_ERROR");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      agencyId: true,
      authUserId: true,
      fullName: true,
      role: true,
      status: true,
      agency: { select: { accessStatus: true } },
      memberships: { where: { isActive: true }, select: { id: true, agencyId: true } },
    },
  });
  const eligible = user
    && ["active", "invited"].includes(user.status)
    && user.agency?.accessStatus === "active"
    && user.memberships.some((membership) => membership.agencyId === user.agencyId);

  if (eligible) {
    try {
      const onboarding = user.status === "invited";
      const generated = await generateAuthLink({
        type: "recovery",
        email,
        fullName: user.fullName,
        redirectTo: `${publicAppUrl()}${onboarding ? "/auth/accept-invite" : "/auth/reset-password"}`,
      });
      if (!generated?.actionLink) throw new Error("Supabase did not return a recovery link");
      if (!user.authUserId && generated.user?.id) {
        await prisma.user.update({ where: { id: user.id }, data: { authUserId: generated.user.id } });
      }
      await sendAccountAccessEmail({
        agencyId: user.agencyId,
        email,
        fullName: user.fullName,
        actionLink: generated.actionLink,
        kind: onboarding ? "onboarding" : "reset",
        audience: user.role === "client" ? "client" : "staff",
      });
      await recordActivity({
        agencyId: user.agencyId,
        userId: user.id,
        action: onboarding ? "ACCOUNT_ONBOARDING_LINK_REQUESTED" : "PASSWORD_RECOVERY_REQUESTED",
        details: onboarding ? "Secure onboarding link sent from the system mailbox" : "Secure password recovery link sent from the system mailbox",
      });
      logger.info("auth.password_recovery_sent", { agencyId: user.agencyId, userId: user.id });
    } catch (error) {
      // Never expose whether the account exists, which mailbox it belongs to,
      // or whether delivery failed. Operators still receive a searchable log.
      logger.error("auth.password_recovery_failed", { agencyId: user.agencyId, userId: user.id, error: error.message });
    }
  }

  res.status(202).json({ success: true, message: PASSWORD_RECOVERY_RESPONSE });
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
  // MEMBER_INVITATION_ACCEPTED notifies admins via the Settings badge —
  // appropriate for a staff member joining the team, not for a client
  // setting up their portal account. A client's own activation gets its own
  // action name so it never lands in that admin notification bucket (see
  // ADMIN_ACTIONS in notificationService.js).
  const isStaffMembership = membership.role !== "client";
  await recordActivity({
    agencyId: membership.agencyId,
    userId: user.id,
    action: isFirstActivation
      ? (isStaffMembership ? "MEMBER_INVITATION_ACCEPTED" : "CLIENT_PORTAL_ACCOUNT_ACTIVATED")
      : "MEMBER_PASSWORD_RESET",
    details: isFirstActivation ? `${membership.role} account activated` : `${membership.role} account password reset`,
  });
  res.json({ success: true, message: isFirstActivation ? "Your CaseDesk account is ready." : "Your password has been updated." });
}

export default { getMe, logout, changePassword, requestPasswordRecovery, getInvitation, acceptMemberInvitation };
