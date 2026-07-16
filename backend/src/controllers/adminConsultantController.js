import prisma from "../services/prisma/client.js";
import { deleteAuthUser, findAuthUserByEmail, generateAuthLink, inviteAuthUser, sendPasswordRecovery, updateAuthUser } from "../services/supabaseAuth.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { logger } from "../services/logger.js";

const consultantSelect = {
  id: true, fullName: true, email: true, status: true, phone: true, jobTitle: true,
  createdAt: true,
  consultantProfiles: { select: { employeeId: true, specializations: true, masteryLevel: true, maximumActiveCases: true } },
  memberships: { select: { id: true, role: true, isActive: true, permissions: true, mustChangePassword: true } },
};

function requiredText(value, name, max = 160) {
  const result = String(value || "").trim();
  if (!result || result.length > max) throw createHttpError(400, `${name} is required and must be ${max} characters or fewer.`, "VALIDATION_ERROR");
  return result;
}

function consultantPayload(body) {
  const maximumActiveCases = Number(body.maximumActiveCases ?? 20);
  if (!Number.isInteger(maximumActiveCases) || maximumActiveCases < 1 || maximumActiveCases > 500) {
    throw createHttpError(400, "maximumActiveCases must be between 1 and 500.", "VALIDATION_ERROR");
  }
  return {
    fullName: requiredText(body.fullName, "Full name"),
    email: requiredText(body.email, "Email").toLowerCase(),
    employeeId: body.employeeId ? requiredText(body.employeeId, "Employee ID", 80) : null,
    specializations: Array.isArray(body.specializations) ? body.specializations.map((item) => String(item).trim()).filter(Boolean).slice(0, 20) : [],
    masteryLevel: body.masteryLevel ? String(body.masteryLevel).trim().slice(0, 80) : null,
    maximumActiveCases,
  };
}

function invitationError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.statusCode === 429 || message.includes("rate limit")) {
    return createHttpError(429, "Invitation email limit reached. Please wait a few minutes and try again.", "INVITATION_RATE_LIMITED");
  }
  if (message.includes("already") && (message.includes("registered") || message.includes("exists"))) {
    return createHttpError(409, "An authentication account with this email already exists. Use a different email or contact support to link the existing account.", "AUTH_ACCOUNT_EXISTS");
  }
  if (message.includes("redirect") || message.includes("url is not allowed")) {
    return createHttpError(503, "The invitation callback URL is not configured in Supabase Auth.", "INVITATION_REDIRECT_NOT_CONFIGURED");
  }
  if (error?.code === "AUTH_NOT_CONFIGURED") return error;
  return createHttpError(502, "The consultant invitation could not be sent. Please try again shortly.", "AUTH_INVITATION_FAILED");
}

export async function createConsultant(req, res) {
  const input = consultantPayload(req.body || {});
  const duplicate = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (duplicate) throw createHttpError(409, "An account with this email already exists.", "ACCOUNT_EXISTS");

  let authUser;
  let authUserCreated = false;
  let manualInvitationLink = null;
  const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
  try {
    authUser = await inviteAuthUser({ email: input.email, fullName: input.fullName, redirectTo: `${frontendUrl}/auth/accept-invite` });
    authUserCreated = true;
  } catch (error) {
    logger.error("auth.consultant_invitation_failed", {
      requestId: req.requestId,
      agencyId: req.auth.agencyId,
      statusCode: error.statusCode,
      code: error.code,
      error: error.message,
    });
    const rateLimited = error?.statusCode === 429 || /rate limit/i.test(error?.message || "");
    if (!rateLimited) throw invitationError(error);
    try {
      const existingAuthUser = await findAuthUserByEmail(input.email);
      const generated = await generateAuthLink({
        type: existingAuthUser ? "recovery" : "invite",
        email: input.email,
        fullName: input.fullName,
        redirectTo: `${frontendUrl}/auth/accept-invite`,
      });
      authUser = existingAuthUser || generated.user;
      authUserCreated = !existingAuthUser;
      manualInvitationLink = generated.actionLink;
      if (!authUser?.id || !manualInvitationLink) throw new Error("Supabase did not return an invitation link");
    } catch (fallbackError) {
      logger.error("auth.consultant_invitation_fallback_failed", {
        requestId: req.requestId,
        agencyId: req.auth.agencyId,
        statusCode: fallbackError.statusCode,
        code: fallbackError.code,
        error: fallbackError.message,
      });
      throw invitationError(error);
    }
  }

  try {
    const user = await prisma.$transaction(async (tx) => tx.user.create({
      data: {
        agencyId: req.auth.agencyId, authUserId: authUser.id, fullName: input.fullName,
        email: input.email, role: "consultant", status: "invited", mustChangePassword: false,
        memberships: { create: { agencyId: req.auth.agencyId, role: "consultant", isActive: true, mustChangePassword: false } },
        consultantProfiles: { create: { agencyId: req.auth.agencyId, employeeId: input.employeeId, specializations: input.specializations, masteryLevel: input.masteryLevel, maximumActiveCases: input.maximumActiveCases } },
      },
      select: consultantSelect,
    }));
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "CONSULTANT_INVITED", details: `Consultant ${user.fullName} invited` });
    res.status(201).json({
      success: true,
      data: user,
      message: manualInvitationLink ? "Consultant created. Copy and send the secure invitation link." : "Consultant invitation sent.",
      manualInvitationLink,
    });
  } catch (error) {
    if (authUserCreated) await deleteAuthUser(authUser.id).catch(() => {});
    throw error;
  }
}

export async function listConsultants(req, res) {
  const data = await prisma.user.findMany({
    where: { agencyId: req.auth.agencyId, memberships: { some: { agencyId: req.auth.agencyId, role: "consultant" } } },
    select: consultantSelect, orderBy: { fullName: "asc" },
  });
  res.json({ success: true, data });
}

export async function getConsultant(req, res) {
  const data = await prisma.user.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, memberships: { some: { agencyId: req.auth.agencyId, role: "consultant" } } },
    select: consultantSelect,
  });
  if (!data) throw createHttpError(404, "Consultant not found.", "NOT_FOUND");
  res.json({ success: true, data });
}

export async function updateConsultant(req, res) {
  await getConsultantRecord(req);
  const profile = consultantPayload(req.body || {});
  const data = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      fullName: profile.fullName, email: profile.email,
      consultantProfiles: { update: { where: { agencyId_userId: { agencyId: req.auth.agencyId, userId: req.params.id } }, data: { employeeId: profile.employeeId, specializations: profile.specializations, masteryLevel: profile.masteryLevel, maximumActiveCases: profile.maximumActiveCases } } },
    }, select: consultantSelect,
  });
  res.json({ success: true, data });
}

async function getConsultantRecord(req) {
  const user = await prisma.user.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId, memberships: { some: { agencyId: req.auth.agencyId, role: "consultant" } } } });
  if (!user) throw createHttpError(404, "Consultant not found.", "NOT_FOUND");
  return user;
}

export async function disableConsultant(req, res) {
  const user = await getConsultantRecord(req);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { status: "disabled" } }),
    prisma.agencyMember.update({ where: { agencyId_userId: { agencyId: req.auth.agencyId, userId: user.id } }, data: { isActive: false } }),
  ]);
  if (user.authUserId) await updateAuthUser(user.authUserId, { ban_duration: "876000h" }).catch(() => {});
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "CONSULTANT_DISABLED", details: `Consultant ${user.fullName} disabled` });
  res.json({ success: true, message: "Consultant disabled." });
}

export async function resetConsultantPassword(req, res) {
  const user = await getConsultantRecord(req);
  if (!user.authUserId) throw createHttpError(409, "Consultant has no authentication account.", "AUTH_ACCOUNT_CREATION_FAILED");
  const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
  await sendPasswordRecovery(user.email, `${frontendUrl}/auth/reset-password`);
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "PASSWORD_RESET_REQUESTED", details: `Password reset for ${user.fullName}` });
  res.json({ success: true, message: "Password recovery email sent." });
}

async function workloadFor(agencyId, userId, capacity) {
  const now = new Date();
  const caseWhere = { agencyId, status: { not: "Closed" }, OR: [{ assignedUserId: userId }, { assignments: { some: { consultantUserId: userId, status: "active" } } }] };
  const [activeCases, pendingTasks, overdueTasks, documentsWaitingReview] = await Promise.all([
    prisma.case.count({ where: caseWhere }),
    prisma.caseWorkflowStep.count({ where: { agencyId, assignedToId: userId, status: "Pending", isActive: true } }),
    prisma.caseWorkflowStep.count({ where: { agencyId, assignedToId: userId, status: "Pending", isActive: true, dueAt: { lt: now } } }),
    prisma.clientDocument.count({ where: { agencyId, status: "UnderReview", case: caseWhere } }),
  ]);
  return { activeCases, pendingTasks, overdueTasks, documentsWaitingReview, capacity, workloadPercentage: Math.min(100, Math.round((activeCases / Math.max(capacity, 1)) * 100)) };
}

async function workloadDetails(agencyId, userId) {
  const now = new Date();
  const caseWhere = {
    agencyId,
    status: { not: "Closed" },
    OR: [
      { assignedUserId: userId },
      { assignments: { some: { consultantUserId: userId, status: "active" } } },
    ],
  };
  const caseSelect = {
    id: true,
    caseType: true,
    stage: true,
    status: true,
    nextAction: true,
    updatedAt: true,
    client: { select: { id: true, fullName: true } },
  };
  const taskSelect = {
    id: true,
    title: true,
    description: true,
    priority: true,
    dueAt: true,
    case: { select: caseSelect },
  };

  const [activeCaseItems, pendingTaskItems, overdueTaskItems, documentReviewItems] = await Promise.all([
    prisma.case.findMany({
      where: caseWhere,
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: caseSelect,
    }),
    prisma.caseWorkflowStep.findMany({
      where: {
        agencyId,
        assignedToId: userId,
        status: "Pending",
        isActive: true,
        OR: [{ dueAt: null }, { dueAt: { gte: now } }],
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      take: 10,
      select: taskSelect,
    }),
    prisma.caseWorkflowStep.findMany({
      where: {
        agencyId,
        assignedToId: userId,
        status: "Pending",
        isActive: true,
        dueAt: { lt: now },
      },
      orderBy: { dueAt: "asc" },
      take: 10,
      select: taskSelect,
    }),
    prisma.clientDocument.findMany({
      where: { agencyId, status: "UnderReview", case: caseWhere },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: {
        id: true,
        documentName: true,
        status: true,
        updatedAt: true,
        client: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true } },
      },
    }),
  ]);

  return { activeCaseItems, pendingTaskItems, overdueTaskItems, documentReviewItems };
}

export async function myWorkload(req, res) {
  const profile = await prisma.consultantProfile.findUnique({ where: { agencyId_userId: { agencyId: req.auth.agencyId, userId: req.auth.userId } } });
  if (!profile) throw createHttpError(404, "Consultant profile not found.", "NOT_FOUND");
  const [summary, details] = await Promise.all([
    workloadFor(req.auth.agencyId, req.auth.userId, profile.maximumActiveCases),
    workloadDetails(req.auth.agencyId, req.auth.userId),
  ]);
  res.json({ success: true, data: { ...summary, ...details } });
}

export async function agencyWorkloads(req, res) {
  const profiles = await prisma.consultantProfile.findMany({ where: { agencyId: req.auth.agencyId, user: { status: "active" } }, include: { user: { select: { id: true, fullName: true, email: true } } } });
  const data = await Promise.all(profiles.map(async (profile) => ({ consultant: profile.user, ...(await workloadFor(req.auth.agencyId, profile.userId, profile.maximumActiveCases)) })));
  res.json({ success: true, data });
}
