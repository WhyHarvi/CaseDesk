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
import { defaultPortalAccess } from "../services/portalAccessService.js";

const consultantSelect = {
  id: true,
  fullName: true,
  email: true,
  status: true,
  phone: true,
  jobTitle: true,
  createdAt: true,
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

function consultantPayload(body) {
  const maximumActiveCases = Number(body.maximumActiveCases ?? 20);
  if (
    !Number.isInteger(maximumActiveCases) ||
    maximumActiveCases < 1 ||
    maximumActiveCases > 500
  ) {
    throw createHttpError(
      400,
      "maximumActiveCases must be between 1 and 500.",
      "VALIDATION_ERROR",
    );
  }
  return {
    fullName: requiredText(body.fullName, "Full name"),
    email: requiredText(body.email, "Email").toLowerCase(),
    employeeId: body.employeeId
      ? requiredText(body.employeeId, "Employee ID", 80)
      : null,
    specializations: Array.isArray(body.specializations)
      ? body.specializations
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 20)
      : [],
    masteryLevel: body.masteryLevel
      ? String(body.masteryLevel).trim().slice(0, 80)
      : null,
    maximumActiveCases,
  };
}

function invitationError(error, action = "invitation") {
  const message = String(error?.message || "").toLowerCase();
  if (error?.statusCode === 429 || message.includes("rate limit")) {
    return createHttpError(
      429,
      "Invitation email limit reached. Please wait a few minutes and try again.",
      "INVITATION_RATE_LIMITED",
    );
  }
  if (
    message.includes("already") &&
    (message.includes("registered") || message.includes("exists"))
  ) {
    return createHttpError(
      409,
      "An authentication account with this email already exists. Use a different email or contact support to link the existing account.",
      "AUTH_ACCOUNT_EXISTS",
    );
  }
  if (message.includes("redirect") || message.includes("url is not allowed")) {
    return createHttpError(
      503,
      "The invitation callback URL is not configured in Supabase Auth.",
      "INVITATION_REDIRECT_NOT_CONFIGURED",
    );
  }
  if (error?.code === "AUTH_NOT_CONFIGURED") return error;
  return createHttpError(
    502,
    `The consultant ${action} could not be sent. Please try again shortly.`,
    "AUTH_INVITATION_FAILED",
  );
}

export async function createConsultant(req, res) {
  const input = consultantPayload(req.body || {});
  const duplicate = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (duplicate)
    throw createHttpError(
      409,
      "An account with this email already exists.",
      "ACCOUNT_EXISTS",
    );

  let authUser;
  let authUserCreated = false;
  let manualInvitationLink = null;
  let generated;
  const frontendUrl = publicAppUrl();
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
    logger.error("auth.consultant_invitation_failed", {
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
    logger.warn("auth.consultant_invitation_email_failed", {
      requestId: req.requestId,
      agencyId: req.auth.agencyId,
      error: mailError.message,
    });
    manualInvitationLink = generated.actionLink;
  }

  try {
    const user = await prisma.$transaction(async (tx) =>
      tx.user.create({
        data: {
          agencyId: req.auth.agencyId,
          authUserId: authUser.id,
          fullName: input.fullName,
          email: input.email,
          role: "consultant",
          status: "invited",
          mustChangePassword: false,
          memberships: {
            create: {
              agencyId: req.auth.agencyId,
              role: "consultant",
              isActive: true,
              mustChangePassword: false,
              permissions: {
                createClientPortal: true,
                portalAccess: defaultPortalAccess("consultant"),
              },
            },
          },
          consultantProfiles: {
            create: {
              agencyId: req.auth.agencyId,
              employeeId: input.employeeId,
              specializations: input.specializations,
              masteryLevel: input.masteryLevel,
              maximumActiveCases: input.maximumActiveCases,
            },
          },
        },
        select: consultantSelect,
      }),
    );
    await recordActivity({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      action: "CONSULTANT_INVITED",
      details: `Consultant ${user.fullName} invited`,
    });
    res.status(201).json({
      success: true,
      data: user,
      message: manualInvitationLink
        ? "Consultant created. Copy and send the secure invitation link."
        : "Consultant invitation sent.",
      manualInvitationLink,
    });
  } catch (error) {
    if (authUserCreated) await deleteAuthUser(authUser.id).catch(() => {});
    throw error;
  }
}

export async function listConsultants(req, res) {
  const data = await prisma.user.findMany({
    where: {
      agencyId: req.auth.agencyId,
      memberships: {
        some: { agencyId: req.auth.agencyId, role: "consultant" },
      },
    },
    select: consultantSelect,
    orderBy: { fullName: "asc" },
  });
  res.json({ success: true, data });
}

export async function getConsultant(req, res) {
  const data = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      memberships: {
        some: { agencyId: req.auth.agencyId, role: "consultant" },
      },
    },
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
      fullName: profile.fullName,
      email: profile.email,
      consultantProfiles: {
        update: {
          where: {
            agencyId_userId: {
              agencyId: req.auth.agencyId,
              userId: req.params.id,
            },
          },
          data: {
            employeeId: profile.employeeId,
            specializations: profile.specializations,
            masteryLevel: profile.masteryLevel,
            maximumActiveCases: profile.maximumActiveCases,
          },
        },
      },
    },
    select: consultantSelect,
  });
  res.json({ success: true, data });
}

async function getConsultantRecord(req) {
  const user = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      memberships: {
        some: { agencyId: req.auth.agencyId, role: "consultant" },
      },
    },
  });
  if (!user) throw createHttpError(404, "Consultant not found.", "NOT_FOUND");
  return user;
}

export async function disableConsultant(req, res) {
  const user = await getConsultantRecord(req);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { status: "disabled" },
    }),
    prisma.agencyMember.update({
      where: {
        agencyId_userId: { agencyId: req.auth.agencyId, userId: user.id },
      },
      data: { isActive: false },
    }),
  ]);
  if (user.authUserId)
    await updateAuthUser(user.authUserId, { ban_duration: "876000h" }).catch(
      () => {},
    );
  await recordActivity({
    agencyId: req.auth.agencyId,
    userId: req.auth.userId,
    action: "CONSULTANT_DISABLED",
    details: `Consultant ${user.fullName} disabled`,
  });
  res.json({ success: true, message: "Consultant disabled." });
}

export async function resetConsultantPassword(req, res) {
  const user = await getConsultantRecord(req);
  if (!user.authUserId)
    throw createHttpError(
      409,
      "Consultant has no authentication account.",
      "AUTH_ACCOUNT_CREATION_FAILED",
    );
  const frontendUrl = publicAppUrl();
  try {
    const generated = await generateAuthLink({
      type: "recovery",
      email: user.email,
      fullName: user.fullName,
      redirectTo: `${frontendUrl}/auth/reset-password`,
    });
    if (!generated?.actionLink) throw new Error("Supabase did not return a recovery link");
    await sendAccountAccessEmail({
      agencyId: req.auth.agencyId,
      email: user.email,
      fullName: user.fullName,
      actionLink: generated.actionLink,
      kind: "reset",
      audience: "staff",
    });
  } catch (error) {
    logger.error("auth.consultant_password_reset_failed", {
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
    details: `Password reset for ${user.fullName}`,
  });
  res.json({ success: true, message: "Password recovery email sent." });
}

const OPEN_CASE_STATUSES = ["Open", "Active", "On Hold"];
const ACTION_DOCUMENT_STATUSES = [
  "Requested",
  "Uploaded",
  "UnderReview",
  "ChangesRequested",
];

const ownershipUserSelect = {
  id: true,
  status: true,
  memberships: { select: { role: true, isActive: true, agencyId: true } },
};

const workloadCaseSelect = {
  id: true,
  caseType: true,
  stage: true,
  status: true,
  nextAction: true,
  updatedAt: true,
  assignedUser: { select: ownershipUserSelect },
  assignments: {
    where: { status: "active" },
    select: {
      assignmentType: true,
      consultant: { select: ownershipUserSelect },
    },
  },
  client: {
    select: {
      id: true,
      fullName: true,
      assignedUser: { select: ownershipUserSelect },
    },
  },
};

function activeRole(user, agencyId) {
  if (!user || user.status !== "active") return null;
  return (
    user.memberships.find(
      (membership) =>
        membership.agencyId === agencyId &&
        membership.isActive &&
        ["admin", "consultant"].includes(membership.role),
    )?.role || null
  );
}

function emptyWorkloadBucket() {
  return {
    activeLeads: 0,
    overdueLeadActions: 0,
    activeCases: 0,
    pendingTasks: 0,
    overdueTasks: 0,
    documentsWaitingReview: 0,
    pendingFollowUps: 0,
    upcomingAppointments: 0,
    activeLeadItems: [],
    activeCaseItems: [],
    pendingTaskItems: [],
    overdueTaskItems: [],
    documentReviewItems: [],
    followUpItems: [],
    appointmentItems: [],
  };
}

export function resolveWorkOwner({
  agencyId,
  activeConsultantIds,
  explicitUser = null,
  caseItem = null,
  clientUser = null,
}) {
  const explicitRole = activeRole(explicitUser, agencyId);
  if (explicitRole) {
    return activeConsultantIds.has(explicitUser.id)
      ? { consultantId: explicitUser.id, source: "explicit" }
      : { consultantId: null, source: "outside_team" };
  }
  const caseOwnerRole = activeRole(caseItem?.assignedUser, agencyId);
  if (caseOwnerRole) {
    return activeConsultantIds.has(caseItem.assignedUser.id)
      ? { consultantId: caseItem.assignedUser.id, source: "case_owner" }
      : { consultantId: null, source: "outside_team" };
  }
  const primaryAssignment = caseItem?.assignments?.find(
    (assignment) =>
      assignment.assignmentType === "primary" &&
      activeConsultantIds.has(assignment.consultant.id),
  );
  if (primaryAssignment)
    return {
      consultantId: primaryAssignment.consultant.id,
      source: "case_assignment",
    };
  const clientOwnerRole = activeRole(clientUser, agencyId);
  if (clientOwnerRole) {
    return activeConsultantIds.has(clientUser.id)
      ? { consultantId: clientUser.id, source: "client_owner" }
      : { consultantId: null, source: "outside_team" };
  }
  return { consultantId: null, source: "unassigned" };
}

function addWork(bucket, type, item, owner, now) {
  const decorated = { ...item, assignmentSource: owner.source };
  if (type === "lead") {
    bucket.activeLeads += 1;
    if (item.nextActionAt && new Date(item.nextActionAt) < now) {
      bucket.overdueLeadActions += 1;
    }
    bucket.activeLeadItems.push(decorated);
  } else if (type === "case") {
    bucket.activeCases += 1;
    bucket.activeCaseItems.push(decorated);
  } else if (type === "task") {
    bucket.pendingTasks += 1;
    if (item.dueAt && new Date(item.dueAt) < now) {
      bucket.overdueTasks += 1;
      bucket.overdueTaskItems.push(decorated);
    } else {
      bucket.pendingTaskItems.push(decorated);
    }
  } else if (type === "document") {
    bucket.documentsWaitingReview += 1;
    bucket.documentReviewItems.push(decorated);
  } else if (type === "followUp") {
    bucket.pendingFollowUps += 1;
    bucket.followUpItems.push(decorated);
  } else if (type === "appointment") {
    bucket.upcomingAppointments += 1;
    bucket.appointmentItems.push(decorated);
  }
}

function finalizeBucket(bucket, capacity = null) {
  const byDueDate = (left, right) =>
    new Date(
      left.dueAt ||
        left.dueDate ||
        left.startsAt ||
        left.nextActionAt ||
        8640000000000000,
    ) -
    new Date(
      right.dueAt ||
        right.dueDate ||
        right.startsAt ||
        right.nextActionAt ||
        8640000000000000,
    );
  const byUpdatedAt = (left, right) =>
    new Date(left.updatedAt) - new Date(right.updatedAt);
  return {
    ...bucket,
    ...(capacity === null
      ? {}
      : {
          capacity,
          workloadPercentage: Math.min(
            100,
            Math.round((bucket.activeCases / Math.max(capacity, 1)) * 100),
          ),
        }),
    activeLeadItems: bucket.activeLeadItems.sort(byDueDate).slice(0, 10),
    activeCaseItems: bucket.activeCaseItems.sort(byUpdatedAt).slice(0, 10),
    pendingTaskItems: bucket.pendingTaskItems.sort(byDueDate).slice(0, 10),
    overdueTaskItems: bucket.overdueTaskItems.sort(byDueDate).slice(0, 10),
    documentReviewItems: bucket.documentReviewItems
      .sort(byUpdatedAt)
      .slice(0, 10),
    followUpItems: bucket.followUpItems.sort(byDueDate).slice(0, 10),
    appointmentItems: bucket.appointmentItems.sort(byDueDate).slice(0, 10),
  };
}

async function loadAgencyWorkloads(agencyId) {
  const now = new Date();
  const [profiles, leads, cases, tasks, documents, followUps, appointments] =
    await prisma.$transaction([
      prisma.consultantProfile.findMany({
        where: {
          agencyId,
          user: {
            status: "active",
            memberships: {
              some: { agencyId, role: "consultant", isActive: true },
            },
          },
        },
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.lead.findMany({
        where: {
          agencyId,
          deletedAt: null,
          status: "OPEN",
          importedRows: { none: {} },
        },
        select: {
          id: true,
          leadNumber: true,
          firstName: true,
          lastName: true,
          stage: true,
          priority: true,
          nextActionDescription: true,
          nextActionAt: true,
          updatedAt: true,
          owner: { select: ownershipUserSelect },
        },
      }),
      prisma.case.findMany({
        where: {
          agencyId,
          deletedAt: null,
          status: { in: OPEN_CASE_STATUSES },
        },
        select: workloadCaseSelect,
      }),
      prisma.caseWorkflowStep.findMany({
        where: {
          agencyId,
          status: "Pending",
          isActive: true,
          case: { deletedAt: null, status: { in: OPEN_CASE_STATUSES } },
        },
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          dueAt: true,
          assignedTo: { select: ownershipUserSelect },
          case: { select: workloadCaseSelect },
        },
      }),
      prisma.clientDocument.findMany({
        // Internal-visibility documents are staff-only working files (e.g. the
        // source copy behind an issued agreement/letter) — counting them here
        // alongside their client-visible counterpart double-counts the same
        // requirement. Mirrors dashboardController.js's documentWhere.
        where: {
          agencyId,
          status: { in: ACTION_DOCUMENT_STATUSES },
          visibility: "Client",
          OR: [
            { caseId: null },
            { case: { deletedAt: null, status: { in: OPEN_CASE_STATUSES } } },
          ],
        },
        select: {
          id: true,
          documentName: true,
          status: true,
          updatedAt: true,
          case: { select: workloadCaseSelect },
          client: {
            select: {
              id: true,
              fullName: true,
              assignedUser: { select: ownershipUserSelect },
            },
          },
        },
      }),
      prisma.followUp.findMany({
        where: {
          agencyId,
          status: { in: ["Pending", "Overdue"] },
          OR: [
            { caseId: null },
            { case: { deletedAt: null, status: { in: OPEN_CASE_STATUSES } } },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          dueDate: true,
          assignedUser: { select: ownershipUserSelect },
          case: { select: workloadCaseSelect },
          client: {
            select: {
              id: true,
              fullName: true,
              assignedUser: { select: ownershipUserSelect },
            },
          },
        },
      }),
      prisma.appointment.findMany({
        where: {
          agencyId,
          status: "Scheduled",
          startsAt: { gte: now },
          case: { deletedAt: null, status: { in: OPEN_CASE_STATUSES } },
        },
        select: {
          id: true,
          subject: true,
          startsAt: true,
          endsAt: true,
          location: true,
          assignedTo: { select: ownershipUserSelect },
          case: { select: workloadCaseSelect },
          client: {
            select: {
              id: true,
              fullName: true,
              assignedUser: { select: ownershipUserSelect },
            },
          },
        },
      }),
    ]);

  const activeConsultantIds = new Set(
    profiles.map((profile) => profile.userId),
  );
  const buckets = new Map(
    profiles.map((profile) => [profile.userId, emptyWorkloadBucket()]),
  );
  const unassignedBucket = emptyWorkloadBucket();
  const outsideTeamBucket = emptyWorkloadBucket();
  const route = (type, item, owner) =>
    addWork(
      owner.consultantId
        ? buckets.get(owner.consultantId)
        : owner.source === "outside_team"
          ? outsideTeamBucket
          : unassignedBucket,
      type,
      item,
      owner,
      now,
    );

  leads.forEach((item) =>
    route(
      "lead",
      item,
      resolveWorkOwner({
        agencyId,
        activeConsultantIds,
        explicitUser: item.owner,
      }),
    ),
  );
  cases.forEach((item) =>
    route(
      "case",
      item,
      resolveWorkOwner({ agencyId, activeConsultantIds, caseItem: item }),
    ),
  );
  tasks.forEach((item) =>
    route(
      "task",
      item,
      resolveWorkOwner({
        agencyId,
        activeConsultantIds,
        explicitUser: item.assignedTo,
        caseItem: item.case,
      }),
    ),
  );
  documents.forEach((item) =>
    route(
      "document",
      item,
      resolveWorkOwner({
        agencyId,
        activeConsultantIds,
        caseItem: item.case,
        clientUser: item.client.assignedUser,
      }),
    ),
  );
  followUps.forEach((item) =>
    route(
      "followUp",
      item,
      resolveWorkOwner({
        agencyId,
        activeConsultantIds,
        explicitUser: item.assignedUser,
        caseItem: item.case,
        clientUser: item.client.assignedUser,
      }),
    ),
  );
  appointments.forEach((item) =>
    route(
      "appointment",
      item,
      resolveWorkOwner({
        agencyId,
        activeConsultantIds,
        explicitUser: item.assignedTo,
        caseItem: item.case,
        clientUser: item.client.assignedUser,
      }),
    ),
  );

  const consultants = profiles.map((profile) => ({
    consultant: profile.user,
    profile: {
      employeeId: profile.employeeId,
      specializations: profile.specializations,
      masteryLevel: profile.masteryLevel,
    },
    ...finalizeBucket(buckets.get(profile.userId), profile.maximumActiveCases),
  }));
  const summary = {
    activeConsultants: consultants.length,
    activeLeads: leads.length,
    overdueLeadActions: leads.filter(
      (item) => item.nextActionAt && new Date(item.nextActionAt) < now,
    ).length,
    activeCases: cases.length,
    pendingTasks: tasks.length,
    overdueTasks: tasks.filter(
      (item) => item.dueAt && new Date(item.dueAt) < now,
    ).length,
    documentsWaitingReview: documents.length,
    pendingFollowUps: followUps.length,
    upcomingAppointments: appointments.length,
    overloadedConsultants: consultants.filter(
      (item) => item.workloadPercentage >= 100,
    ).length,
  };
  return {
    summary,
    consultants,
    unassigned: finalizeBucket(unassignedBucket),
    outsideTeam: finalizeBucket(outsideTeamBucket),
  };
}

export async function myWorkload(req, res) {
  const workload = await loadAgencyWorkloads(req.auth.agencyId);
  const data = workload.consultants.find(
    (item) => item.consultant.id === req.auth.userId,
  );
  if (!data)
    throw createHttpError(
      404,
      "Active consultant profile not found.",
      "NOT_FOUND",
    );
  res.json({ success: true, data });
}

export async function agencyWorkloads(req, res) {
  res.json({
    success: true,
    data: await loadAgencyWorkloads(req.auth.agencyId),
  });
}
