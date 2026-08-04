import prisma from "../services/prisma/client.js";
import {
  deleteAuthUser,
  findAuthUserByEmail,
  generateAuthLink,
  updateAuthUser,
} from "../services/supabaseAuth.js";
import { sendAccountAccessEmail } from "../services/accountAccessMailService.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { publicAppUrl } from "../utils/publicAppUrl.js";
import { logger } from "../services/logger.js";
import {
  normalizePortalAccess,
  defaultPortalAccess,
  portalCapabilityKeys,
  portalCaseTabKeys,
  portalDataKeys,
  portalPageKeys,
} from "../services/portalAccessService.js";

const managedRoles = new Set(["consultant", "frontdesk"]);
const teamMemberSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  jobTitle: true,
  createdAt: true,
  updatedAt: true,
  consultantProfiles: {
    select: {
      employeeId: true,
      specializations: true,
      masteryLevel: true,
      maximumActiveCases: true,
    },
  },
  memberships: {
    select: {
      id: true,
      role: true,
      isActive: true,
      permissions: true,
      mustChangePassword: true,
    },
  },
};

function requiredText(value, name, max = 160) {
  const result = String(value || "").trim();
  if (!result || result.length > max)
    throw createHttpError(
      400,
      `${name} is required and must be ${max} characters or fewer.`,
      "VALIDATION_ERROR",
    );
  return result;
}

function optionalText(value, max) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim().slice(0, max) || null;
}

function memberPayload(body, { creating = false } = {}) {
  const role = String(body.role || "")
    .trim()
    .toLowerCase();
  if (!managedRoles.has(role))
    throw createHttpError(
      400,
      "Role must be consultant or frontdesk.",
      "INVALID_TEAM_MEMBER_ROLE",
    );
  const maximumActiveCases = Number(body.maximumActiveCases ?? 20);
  if (
    role === "consultant" &&
    (!Number.isInteger(maximumActiveCases) ||
      maximumActiveCases < 1 ||
      maximumActiveCases > 500)
  ) {
    throw createHttpError(
      400,
      "maximumActiveCases must be between 1 and 500.",
      "VALIDATION_ERROR",
    );
  }
  return {
    role,
    fullName: requiredText(body.fullName, "Full name"),
    ...(creating
      ? { email: requiredText(body.email, "Email").toLowerCase() }
      : {}),
    phone: optionalText(body.phone, 40),
    jobTitle:
      optionalText(body.jobTitle, 120) ||
      (role === "frontdesk" ? "Front Desk" : "Consultant"),
    consultantProfile:
      role === "consultant"
        ? {
            employeeId: optionalText(body.employeeId, 80),
            specializations: Array.isArray(body.specializations)
              ? body.specializations
                  .map((item) => String(item).trim())
                  .filter(Boolean)
                  .slice(0, 20)
              : [],
            masteryLevel: optionalText(body.masteryLevel, 80),
            maximumActiveCases,
          }
        : null,
  };
}

function defaultPermissions(role) {
  if (role === "frontdesk")
    return {
      leadAccess: "all",
      canCreateLead: true,
      canScheduleConsultation: true,
      portalAccess: defaultPortalAccess(role),
    };
  return { createClientPortal: true, portalAccess: defaultPortalAccess(role) };
}

function invitationError(error, action = "invitation") {
  const message = String(error?.message || "").toLowerCase();
  if (error?.statusCode === 429 || message.includes("rate limit"))
    return createHttpError(
      429,
      "Invitation email limit reached. Please wait a few minutes and try again.",
      "INVITATION_RATE_LIMITED",
    );
  if (
    message.includes("already") &&
    (message.includes("registered") || message.includes("exists"))
  )
    return createHttpError(
      409,
      "An authentication account with this email already exists.",
      "AUTH_ACCOUNT_EXISTS",
    );
  if (message.includes("redirect") || message.includes("url is not allowed"))
    return createHttpError(
      503,
      "The invitation callback URL is not configured in Supabase Auth.",
      "INVITATION_REDIRECT_NOT_CONFIGURED",
    );
  if (error?.code === "AUTH_NOT_CONFIGURED") return error;
  return createHttpError(
    502,
    `The team member ${action} could not be sent. Please try again shortly.`,
    "AUTH_INVITATION_FAILED",
  );
}

async function teamMemberRecord(req) {
  const user = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      memberships: {
        some: { agencyId: req.auth.agencyId, role: { in: [...managedRoles] } },
      },
    },
    select: { ...teamMemberSelect, authUserId: true },
  });
  if (!user) throw createHttpError(404, "Team member not found.", "NOT_FOUND");
  return user;
}

export async function createTeamMember(req, res) {
  const input = memberPayload(req.body || {}, { creating: true });
  if (
    await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })
  )
    throw createHttpError(
      409,
      "An account with this email already exists.",
      "ACCOUNT_EXISTS",
    );

  const frontendUrl = publicAppUrl();
  let authUser;
  let authUserCreated = false;
  let manualInvitationLink = null;
  let generated;
  try {
    const existingAuthUser = await findAuthUserByEmail(input.email);
    generated = await generateAuthLink({
      type: existingAuthUser ? "recovery" : "invite",
      email: input.email,
      fullName: input.fullName,
      redirectTo: `${frontendUrl}/auth/accept-invite`,
    });
    authUser = existingAuthUser || generated.user;
    authUserCreated = !existingAuthUser;
    if (!authUser?.id || !generated.actionLink)
      throw new Error("Supabase did not return an invitation link");
  } catch (error) {
    logger.error("auth.team_member_invitation_failed", {
      requestId: req.requestId,
      agencyId: req.auth.agencyId,
      statusCode: error.statusCode,
      code: error.code,
      error: error.message,
    });
    throw invitationError(error);
  }

  // Best-effort: if the agency's mailbox isn't reachable, still create the
  // account and hand staff the link to send manually rather than failing
  // the whole invite.
  try {
    await sendAccountAccessEmail({
      agencyId: req.auth.agencyId,
      email: input.email,
      fullName: input.fullName,
      actionLink: generated.actionLink,
      kind: authUserCreated ? "onboarding" : "reset",
      audience: "staff",
    });
  } catch (mailError) {
    logger.warn("auth.team_member_invitation_email_failed", {
      requestId: req.requestId,
      agencyId: req.auth.agencyId,
      error: mailError.message,
    });
    manualInvitationLink = generated.actionLink;
  }

  try {
    const data = await prisma.user.create({
      data: {
        agencyId: req.auth.agencyId,
        authUserId: authUser.id,
        fullName: input.fullName,
        email: input.email,
        role: input.role,
        status: "invited",
        mustChangePassword: false,
        phone: input.phone,
        jobTitle: input.jobTitle,
        memberships: {
          create: {
            agencyId: req.auth.agencyId,
            role: input.role,
            isActive: true,
            mustChangePassword: false,
            permissions: defaultPermissions(input.role),
          },
        },
        ...(input.consultantProfile
          ? {
              consultantProfiles: {
                create: {
                  agencyId: req.auth.agencyId,
                  ...input.consultantProfile,
                },
              },
            }
          : {}),
      },
      select: teamMemberSelect,
    });
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      action: "TEAM_MEMBER_INVITED",
      details: `${data.fullName} invited as ${data.role}`,
    });
    res
      .status(201)
      .json({
        success: true,
        data,
        message: manualInvitationLink
          ? "Team member created. Copy and send the secure invitation link."
          : "Team member invitation sent.",
        manualInvitationLink,
      });
  } catch (error) {
    if (authUserCreated) await deleteAuthUser(authUser.id).catch(() => {});
    throw error;
  }
}

export async function listTeamMembers(req, res) {
  const requestedRole = String(req.query.role || "")
    .trim()
    .toLowerCase();
  if (requestedRole && !managedRoles.has(requestedRole))
    throw createHttpError(400, "Role filter is invalid.", "VALIDATION_ERROR");
  const data = await prisma.user.findMany({
    where: {
      agencyId: req.auth.agencyId,
      memberships: {
        some: {
          agencyId: req.auth.agencyId,
          role: requestedRole ? requestedRole : { in: [...managedRoles] },
        },
      },
    },
    select: teamMemberSelect,
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });
  res.json({ success: true, data });
}

export async function listPortalAccessMembers(req, res) {
  const data = await prisma.user.findMany({
    where: {
      agencyId: req.auth.agencyId,
      memberships: {
        some: { agencyId: req.auth.agencyId, role: { in: [...managedRoles] } },
      },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      status: true,
      jobTitle: true,
      memberships: {
        where: { agencyId: req.auth.agencyId },
        select: { id: true, role: true, isActive: true, permissions: true },
        take: 1,
      },
    },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });
  res.json({
    success: true,
    data: data.map((user) => {
      const membership = user.memberships[0];
      return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: membership?.role || user.role,
        status: user.status,
        jobTitle: user.jobTitle,
        isActive: membership?.isActive === true,
        portalAccess: normalizePortalAccess(
          membership?.role || user.role,
          membership?.permissions?.portalAccess,
          membership?.permissions || {},
        ),
      };
    }),
    meta: {
      catalog: {
        pages: portalPageKeys,
        caseTabs: portalCaseTabKeys,
        data: portalDataKeys,
        capabilities: portalCapabilityKeys,
      },
    },
  });
}

export async function updateTeamMemberPortalAccess(req, res) {
  const existing = await teamMemberRecord(req);
  const membership = await prisma.agencyMember.findUnique({
    where: {
      agencyId_userId: { agencyId: req.auth.agencyId, userId: existing.id },
    },
    select: { id: true, role: true, permissions: true },
  });
  if (!membership || !managedRoles.has(membership.role))
    throw createHttpError(404, "Team member not found.", "NOT_FOUND");
  const portalAccess = normalizePortalAccess(
    membership.role,
    req.body?.portalAccess,
    membership.permissions || {},
  );
  const permissions = {
    ...(membership.permissions && typeof membership.permissions === "object"
      ? membership.permissions
      : {}),
    portalAccess,
    createClientPortal: portalAccess.capabilities.manageClientPortal,
  };
  await prisma.agencyMember.update({
    where: { id: membership.id },
    data: { permissions },
  });
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "TEAM_MEMBER_PORTAL_ACCESS_UPDATED",
    details: `Portal access updated for ${existing.fullName}`,
    entityType: "user",
    entityId: existing.id,
    metadata: {
      targetUserId: existing.id,
      role: membership.role,
      portalAccess,
    },
  });
  res.json({
    success: true,
    data: { userId: existing.id, portalAccess },
    message: `Access updated for ${existing.fullName}.`,
  });
}

export async function getTeamMember(req, res) {
  const data = await teamMemberRecord(req);
  const { authUserId: _authUserId, ...safeData } = data;
  res.json({ success: true, data: safeData });
}

export async function updateTeamMember(req, res) {
  const existing = await teamMemberRecord(req);
  const input = memberPayload({
    ...req.body,
    role: req.body.role || existing.role,
  });
  if (input.role !== existing.role)
    throw createHttpError(
      409,
      "Role changes require a dedicated role-transition workflow.",
      "ROLE_CHANGE_NOT_ALLOWED",
    );
  const data = await prisma.user.update({
    where: { id: existing.id },
    data: {
      fullName: input.fullName,
      phone: input.phone,
      jobTitle: input.jobTitle,
      ...(input.consultantProfile
        ? {
            consultantProfiles: {
              upsert: {
                where: {
                  agencyId_userId: {
                    agencyId: req.auth.agencyId,
                    userId: existing.id,
                  },
                },
                create: {
                  agencyId: req.auth.agencyId,
                  ...input.consultantProfile,
                },
                update: input.consultantProfile,
              },
            },
          }
        : {}),
    },
    select: teamMemberSelect,
  });
  if (existing.authUserId)
    await updateAuthUser(existing.authUserId, {
      user_metadata: { full_name: input.fullName },
    }).catch(() => {});
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "TEAM_MEMBER_UPDATED",
    details: `${data.fullName} updated`,
  });
  res.json({ success: true, data });
}

export async function disableTeamMember(req, res) {
  const existing = await teamMemberRecord(req);
  const [openLeadAssignments, openCaseAssignments] = await Promise.all([
    prisma.lead.count({
      where: {
        agencyId: req.auth.agencyId,
        status: { in: ["OPEN", "NURTURE"] },
        OR: [{ ownerUserId: existing.id }, { nextActionOwnerId: existing.id }],
      },
    }),
    existing.role === "consultant"
      ? prisma.case.count({
          where: {
            agencyId: req.auth.agencyId,
            status: { notIn: ["Completed", "Closed", "Cancelled", "Inactive"] },
            OR: [
              { assignedUserId: existing.id },
              {
                assignments: {
                  some: { consultantUserId: existing.id, status: "active" },
                },
              },
            ],
          },
        })
      : 0,
  ]);
  if (openLeadAssignments || openCaseAssignments)
    throw createHttpError(
      409,
      `Reassign ${openLeadAssignments} open lead(s) and ${openCaseAssignments} open case(s) before disabling this team member.`,
      "ACTIVE_ASSIGNMENTS",
    );
  await prisma.$transaction([
    prisma.user.update({
      where: { id: existing.id },
      data: { status: "disabled" },
    }),
    prisma.agencyMember.update({
      where: {
        agencyId_userId: { agencyId: req.auth.agencyId, userId: existing.id },
      },
      data: { isActive: false },
    }),
  ]);
  if (existing.authUserId)
    await updateAuthUser(existing.authUserId, {
      ban_duration: "876000h",
    }).catch(() => {});
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "TEAM_MEMBER_DISABLED",
    details: `${existing.fullName} disabled`,
  });
  res.json({ success: true, message: "Team member disabled." });
}

export async function resetTeamMemberPassword(req, res) {
  const existing = await teamMemberRecord(req);
  if (!existing.authUserId)
    throw createHttpError(
      409,
      "Team member has no authentication account.",
      "AUTH_ACCOUNT_CREATION_FAILED",
    );
  const frontendUrl = publicAppUrl();
  let generated;
  try {
    generated = await generateAuthLink({
      type: "recovery",
      email: existing.email,
      fullName: existing.fullName,
      redirectTo: `${frontendUrl}/auth/reset-password`,
    });
    if (!generated?.actionLink) throw new Error("Supabase did not return a recovery link");
    await sendAccountAccessEmail({
      agencyId: req.auth.agencyId,
      email: existing.email,
      fullName: existing.fullName,
      actionLink: generated.actionLink,
      kind: "reset",
      audience: "staff",
    });
  } catch (error) {
    logger.error("auth.team_member_password_reset_failed", {
      requestId: req.requestId,
      agencyId: req.auth.agencyId,
      statusCode: error.statusCode,
      code: error.code,
      error: error.message,
    });
    throw invitationError(error, "password reset link");
  }
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "PASSWORD_RESET_REQUESTED",
    details: `Password reset for ${existing.fullName}`,
  });
  res.json({ success: true, message: "Password recovery email sent." });
}
