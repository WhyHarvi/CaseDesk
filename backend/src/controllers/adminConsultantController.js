import prisma from "../services/prisma/client.js";
import { leadSegmentWhere } from "../modules/leads/lead.permissions.js";
import { assignLead } from "../modules/leads/lead.service.js";
import { updateFollowUp } from "./followUpController.js";
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
import {
  approveCollaborationRequest,
  declineCollaborationRequest,
  listCollaborationRequestsForAdmin,
} from "../services/caseCollaborationService.js";

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
// Requested/ChangesRequested mean CaseDesk is waiting on the client to act;
// Uploaded/UnderReview mean a staff member needs to review something the
// client already provided. Counting all four together as one "document
// workload" number inflates it with items that aren't actually the
// consultant's to act on right now.
const CLIENT_WAITING_STATUSES = ["Requested", "ChangesRequested"];
const STAFF_REVIEW_STATUSES = ["Uploaded", "UnderReview"];
const ACTION_DOCUMENT_STATUSES = [
  ...CLIENT_WAITING_STATUSES,
  ...STAFF_REVIEW_STATUSES,
];
// A document has no built-in due date — treat a staff-review document whose
// updatedAt is older than this as review-overdue, the closest available
// signal without adding a new due-date column.
const REVIEW_OVERDUE_DAYS = 3;

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
        // Front-desk staff can be a real, explicit owner of work (a task,
        // follow-up, or appointment assignedUserId) — recognize them here
        // so that work doesn't fall through to case/client inheritance or
        // Unassigned. They get their own roster slot in resolveWorkOwner()/
        // route() like admins and consultants, just tagged source:
        // "front_desk" and with no case capacity.
        ["admin", "consultant", "frontdesk"].includes(membership.role),
    )?.role || null
  );
}

function emptyWorkloadBucket() {
  return {
    activeLeads: 0,
    overdueLeadActions: 0,
    activeCases: 0,
    // pendingTasks counts every Pending task, including overdue ones — kept
    // for backward compatibility with any existing caller. pendingTasks
    // ExcludingOverdue is the number that actually matches pendingTaskItems
    // (the "Pending Tasks" list), since overdue tasks are shown in their own
    // section. Use the Excluding field wherever the UI means "still pending,
    // not yet overdue."
    pendingTasks: 0,
    pendingTasksExcludingOverdue: 0,
    overdueTasks: 0,
    // documentsWaitingReview counts every action-needed document, client-
    // waiting and staff-review combined — kept for backward compatibility.
    // Split into documentsWaitingOnClient (informational, not the
    // consultant's to act on) and documentsReadyForReview (actually theirs).
    documentsWaitingReview: 0,
    documentsWaitingOnClient: 0,
    documentsReadyForReview: 0,
    documentsReviewOverdue: 0,
    documentWaitingItems: [],
    // Collaborating cases (supporting/reviewer CaseAssignment rows) are
    // tracked separately from activeCases — a consultant contributing to a
    // case they don't accountably own gets visible credit, but it doesn't
    // inflate the case-capacity percentage tied to accountable ownership.
    collaboratingCases: 0,
    collaboratingCaseItems: [],
    pendingFollowUps: 0,
    overdueFollowUps: 0,
    followUpsDueToday: 0,
    highPriorityOverdueFollowUps: 0,
    upcomingAppointments: 0,
    appointmentsToday: 0,
    appointmentsThisWeek: 0,
    activeLeadItems: [],
    activeCaseItems: [],
    pendingTaskItems: [],
    overdueTaskItems: [],
    documentReviewItems: [],
    followUpItems: [],
    overdueFollowUpItems: [],
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
      ? { consultantId: explicitUser.id, source: explicitRole === "frontdesk" ? "front_desk" : "explicit" }
      : { consultantId: null, source: "unassigned" };
  }

  // Check for a real consultant primary assignment BEFORE trusting an
  // admin-of-record as the final answer — an admin can be the nominal case
  // owner while a consultant does the actual work via CaseAssignment.
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

  const caseOwnerRole = activeRole(caseItem?.assignedUser, agencyId);
  if (caseOwnerRole) {
    return activeConsultantIds.has(caseItem.assignedUser.id)
      ? { consultantId: caseItem.assignedUser.id, source: caseOwnerRole === "frontdesk" ? "front_desk" : "case_owner" }
      : { consultantId: null, source: "unassigned" };
  }
  const clientOwnerRole = activeRole(clientUser, agencyId);
  if (clientOwnerRole) {
    return activeConsultantIds.has(clientUser.id)
      ? { consultantId: clientUser.id, source: clientOwnerRole === "frontdesk" ? "front_desk" : "client_owner" }
      : { consultantId: null, source: "unassigned" };
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
      bucket.pendingTasksExcludingOverdue += 1;
      bucket.pendingTaskItems.push(decorated);
    }
  } else if (type === "document") {
    bucket.documentsWaitingReview += 1;
    if (CLIENT_WAITING_STATUSES.includes(item.status)) {
      bucket.documentsWaitingOnClient += 1;
      bucket.documentWaitingItems.push(decorated);
    } else if (STAFF_REVIEW_STATUSES.includes(item.status)) {
      bucket.documentsReadyForReview += 1;
      bucket.documentReviewItems.push(decorated);
      const ageDays = (now - new Date(item.updatedAt)) / 86_400_000;
      if (ageDays > REVIEW_OVERDUE_DAYS) {
        bucket.documentsReviewOverdue += 1;
        decorated.reviewOverdue = true;
      }
    }
  } else if (type === "followUp") {
    bucket.pendingFollowUps += 1;
    const due = item.dueDate ? new Date(item.dueDate) : null;
    if (due && due < now) {
      bucket.overdueFollowUps += 1;
      bucket.overdueFollowUpItems.push(decorated);
      if (item.priority === "High") bucket.highPriorityOverdueFollowUps += 1;
    } else if (due && isSameCalendarDay(due, now)) {
      bucket.followUpsDueToday += 1;
      bucket.followUpItems.push(decorated);
    } else {
      bucket.followUpItems.push(decorated);
    }
  } else if (type === "appointment") {
    bucket.upcomingAppointments += 1;
    decorated.window = appointmentWindow(item.startsAt, now);
    if (decorated.window === "today") bucket.appointmentsToday += 1;
    if (decorated.window === "today" || decorated.window === "week") bucket.appointmentsThisWeek += 1;
    bucket.appointmentItems.push(decorated);
  }
}

// Same-case (or same-client, when an item has no case — a client-level
// follow-up or document) items collapse into one row: five pending tasks
// on Jashandeep Dhaliwal's case become one "Jashandeep Dhaliwal · 5 tasks"
// row instead of five nearly-identical ones repeating the same name. Built
// from the already-sorted array so group order matches item order within
// each group; sliceLimit then caps the number of *groups* shown inline,
// not raw items, since grouping already did the real compression — a
// person with 30 tasks spread across 6 cases should see all 6 rows, not
// get cut off at item #10 mid-case.
function groupByCase(sortedItems, sliceLimit) {
  const groups = [];
  const byKey = new Map();
  for (const item of sortedItems) {
    const caseId = item.case?.id || null;
    const clientId = item.case?.client?.id || item.client?.id || null;
    const key = caseId ? `case:${caseId}` : clientId ? `client:${clientId}` : `item:${item.id}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        caseId,
        clientId,
        clientName: item.case?.client?.fullName || item.client?.fullName || "General",
        caseType: item.case?.caseType || null,
        items: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups.slice(0, sliceLimit).map((group) => ({ ...group, count: group.items.length }));
}

// sliceLimit caps how many items each category shows inline on the main
// workload page (10, matching the original behavior). The drill-down
// endpoint below (consultantWorkloadCategory) calls this with
// sliceLimit = Infinity to get the full, unsliced list before paginating
// it itself — the true totals (bucket.overdueTasks etc.) are unaffected
// either way since those are counted in addWork(), not here.
function finalizeBucket(bucket, capacity = null, sliceLimit = 10) {
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
  // Renamed from "workloadPercentage" — this has only ever measured
  // active-case capacity usage, not overall workload (leads, tasks,
  // follow-ups, documents, and appointments never factored in).
  // Uncapped (a consultant genuinely at 300% of capacity should show 300%,
  // not a value indistinguishable from someone at exactly 100%) — cap only
  // the *visual* bar width in the frontend.
  const caseCapacityPercentage =
    capacity === null
      ? null
      : Math.round((bucket.activeCases / Math.max(capacity, 1)) * 100);

  const pendingTasksSorted = bucket.pendingTaskItems.sort(byDueDate);
  const overdueTasksSorted = bucket.overdueTaskItems.sort(byDueDate);
  const followUpsSorted = bucket.followUpItems.sort(byDueDate);
  const overdueFollowUpsSorted = bucket.overdueFollowUpItems.sort(byDueDate);
  const documentReviewSorted = bucket.documentReviewItems.sort(byUpdatedAt);
  const documentWaitingSorted = bucket.documentWaitingItems.sort(byUpdatedAt);

  return {
    ...bucket,
    ...(capacity === null
      ? {}
      : {
          capacity,
          caseCapacityPercentage,
          // Deprecated alias, capped at 100 for any caller not yet updated
          // to the renamed/uncapped field. Remove once nothing reads it.
          workloadPercentage: Math.min(100, caseCapacityPercentage),
        }),
    activeLeadItems: bucket.activeLeadItems.sort(byDueDate).slice(0, sliceLimit),
    activeCaseItems: bucket.activeCaseItems.sort(byUpdatedAt).slice(0, sliceLimit),
    collaboratingCaseItems: bucket.collaboratingCaseItems
      .sort(byUpdatedAt)
      .slice(0, sliceLimit),
    pendingTaskItems: pendingTasksSorted.slice(0, sliceLimit),
    overdueTaskItems: overdueTasksSorted.slice(0, sliceLimit),
    documentReviewItems: documentReviewSorted.slice(0, sliceLimit),
    documentWaitingItems: documentWaitingSorted.slice(0, sliceLimit),
    followUpItems: followUpsSorted.slice(0, sliceLimit),
    overdueFollowUpItems: overdueFollowUpsSorted.slice(0, sliceLimit),
    appointmentItems: bucket.appointmentItems.sort(byDueDate).slice(0, sliceLimit),
    // Grouped views — additive, alongside the flat *Items arrays above
    // (which the drill-down "view all" drawer still paginates flat).
    // sliceLimit here bounds group *count*, so it's intentionally not
    // reused for the drill-down call (Infinity there means "all groups").
    pendingTaskGroups: groupByCase(pendingTasksSorted, sliceLimit),
    overdueTaskGroups: groupByCase(overdueTasksSorted, sliceLimit),
    followUpGroups: groupByCase(followUpsSorted, sliceLimit),
    overdueFollowUpGroups: groupByCase(overdueFollowUpsSorted, sliceLimit),
    documentReviewGroups: groupByCase(documentReviewSorted, sliceLimit),
    documentWaitingGroups: groupByCase(documentWaitingSorted, sliceLimit),
  };
}

function appointmentWindow(startsAt, now) {
  const days = (new Date(startsAt) - now) / 86_400_000;
  return days < 1 ? "today" : days <= 7 ? "week" : "month";
}

function isSameCalendarDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export async function loadAgencyWorkloads(agencyId, { sliceLimit = 10 } = {}) {
  const now = new Date();
  // 30-day look-ahead — an appointment scheduled six months out shouldn't
  // count identically to one happening in the next hour.
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const [staffMembers, leads, cases, tasks, documents, followUps, leadFollowUps, appointments] =
    await prisma.$transaction([
      // The full team roster — every active admin, consultant, and front-desk
      // member, not just consultants. This is what used to be a
      // consultant-only ConsultantProfile query; broadening it is what makes
      // admin- and front-desk-owned work land in a real per-person bucket
      // instead of the old "outside the consultant roster" catch-all.
      prisma.agencyMember.findMany({
        where: {
          agencyId,
          isActive: true,
          role: { in: ["admin", "consultant", "frontdesk"] },
          user: { status: "active" },
        },
        select: {
          role: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              consultantProfiles: {
                where: { agencyId },
                select: { employeeId: true, specializations: true, masteryLevel: true, maximumActiveCases: true },
              },
            },
          },
        },
      }),
      prisma.lead.findMany({
        where: {
          agencyId,
          deletedAt: null,
          // NURTURE leads still have a real, dated reactivation action that
          // can sit on someone's calendar — only OPEN previously counted,
          // which made a nurtured lead's workload vanish the moment it was
          // paused.
          status: { in: ["OPEN", "NURTURE"] },
          ...leadSegmentWhere(),
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
          nextActionOwner: { select: ownershipUserSelect },
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
          createdAt: true,
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
          status: "Pending",
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
          priority: true,
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
      prisma.leadFollowUp.findMany({
        where: {
          agencyId,
          status: "PENDING",
          lead: {
            deletedAt: null,
            status: { in: ["OPEN", "NURTURE"] },
            ...leadSegmentWhere(),
          },
        },
        select: {
          id: true,
          description: true,
          type: true,
          dueAt: true,
          assignedUser: { select: ownershipUserSelect },
          lead: {
            select: {
              id: true,
              leadNumber: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      prisma.appointment.findMany({
        where: {
          agencyId,
          status: "Scheduled",
          startsAt: { gte: now, lte: horizon },
          // Previously required a case relation, which silently dropped
          // guest bookings, lead consultations (leadId, not caseId), and
          // client-only appointments. Accept any legitimately-staffed
          // appointment instead.
          OR: [
            { caseId: null },
            // No status filter here — a scheduled appointment on a since-
            // closed case is still a real commitment on the calendar.
            { case: { deletedAt: null } },
            { leadId: { not: null } },
          ],
        },
        select: {
          id: true,
          subject: true,
          startsAt: true,
          endsAt: true,
          location: true,
          assignedTo: { select: ownershipUserSelect },
          case: { select: workloadCaseSelect },
          lead: {
            select: {
              id: true,
              leadNumber: true,
              firstName: true,
              lastName: true,
              ownerUserId: true,
            },
          },
          client: {
            select: {
              id: true,
              fullName: true,
              assignedUser: { select: ownershipUserSelect },
            },
          },
          guestName: true,
          guestEmail: true,
        },
      }),
    ]);

  // Despite the name, this now covers every active roster member (admin,
  // consultant, front desk) — kept as-is rather than renamed everywhere
  // since resolveWorkOwner()'s call sites all pass it by this name.
  const activeConsultantIds = new Set(
    staffMembers.map((member) => member.user.id),
  );
  // Cheap name lookup for decorating case rows with who else is on them
  // (Team Workload's "who's collaborating" indicator) — every consultant's
  // fullName is already in memory from the roster query above, so this
  // needs no extra round trip.
  const nameById = new Map(staffMembers.map((member) => [member.user.id, member.user.fullName]));
  // Case staleness ("last touched") — the most recent ActivityLog entry per
  // case, not case.updatedAt, since plenty of real progress (notes, tasks,
  // documents, appointments) never mutates the case row itself. Falls back
  // to case.updatedAt for cases with no logged activity yet rather than
  // showing nothing.
  const caseIdsForActivity = cases.map((item) => item.id);
  const lastActivityRows = caseIdsForActivity.length
    ? await prisma.activityLog.groupBy({
        by: ["caseId"],
        where: { agencyId, caseId: { in: caseIdsForActivity } },
        _max: { createdAt: true },
      })
    : [];
  const lastActivityByCaseId = new Map(lastActivityRows.map((row) => [row.caseId, row._max.createdAt]));
  const buckets = new Map(
    staffMembers.map((member) => [member.user.id, emptyWorkloadBucket()]),
  );
  const unassignedBucket = emptyWorkloadBucket();
  const route = (type, item, owner) =>
    addWork(
      owner.consultantId ? buckets.get(owner.consultantId) : unassignedBucket,
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
        // Prefer the next-action owner over the lead owner — mirrors how
        // the lead detail screen already computes nextActionOwner. A lead
        // whose next action was reassigned should count against the new
        // owner, not the original one.
        explicitUser: item.nextActionOwner || item.owner,
      }),
    ),
  );
  cases.forEach((item) => {
    // Who else has active access to this case, by name — carried on the
    // case row itself (not queried separately) so the frontend can show a
    // collaborator avatar stack without a second request.
    const collaborators = (item.assignments || [])
      .filter((assignment) => activeConsultantIds.has(assignment.consultant.id))
      .map((assignment) => ({
        id: assignment.consultant.id,
        fullName: nameById.get(assignment.consultant.id) || "Team member",
        assignmentType: assignment.assignmentType,
      }));
    const decoratedCase = { ...item, collaborators, lastActivityAt: lastActivityByCaseId.get(item.id) || item.updatedAt };
    route(
      "case",
      decoratedCase,
      resolveWorkOwner({ agencyId, activeConsultantIds, caseItem: item }),
    );
    // Second, parallel pass: supporting/reviewer consultants get their own
    // visible credit for real, scheduled case involvement, distinct from
    // the single accountable owner resolved above.
    (item.assignments || [])
      .filter(
        (assignment) =>
          assignment.assignmentType !== "primary" &&
          activeConsultantIds.has(assignment.consultant.id),
      )
      .forEach((assignment) => {
        const bucket = buckets.get(assignment.consultant.id);
        bucket.collaboratingCases += 1;
        bucket.collaboratingCaseItems.push({
          ...decoratedCase,
          assignmentSource: assignment.assignmentType,
        });
      });
  });
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
        clientUser: item.client?.assignedUser,
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
        clientUser: item.client?.assignedUser,
      }),
    ),
  );
  leadFollowUps.forEach((item) =>
    route(
      "followUp",
      {
        ...item,
        source: "lead",
        leadId: item.lead.id,
        title: item.description,
        dueDate: item.dueAt,
        priority: "Medium",
        client: {
          id: item.lead.id,
          fullName: [item.lead.firstName, item.lead.lastName].filter(Boolean).join(" ") || item.lead.leadNumber,
        },
      },
      resolveWorkOwner({
        agencyId,
        activeConsultantIds,
        explicitUser: item.assignedUser,
      }),
    ),
  );
  appointments.forEach((item) => {
    let owner = resolveWorkOwner({
      agencyId,
      activeConsultantIds,
      explicitUser: item.assignedTo,
      caseItem: item.case,
      clientUser: item.client?.assignedUser,
    });
    // A lead-only appointment (no case, no client) still has a real owner —
    // the lead's owner — even though resolveWorkOwner has nothing case- or
    // client-shaped to check.
    if (
      owner.source === "unassigned" &&
      item.lead?.ownerUserId &&
      activeConsultantIds.has(item.lead.ownerUserId)
    ) {
      owner = { consultantId: item.lead.ownerUserId, source: "lead_owner" };
    }
    route("appointment", item, owner);
  });

  const consultants = staffMembers.map((member) => {
    // Only ever populated for role: "consultant" — createConsultant() is the
    // only path that creates a ConsultantProfile row. Admins and front desk
    // simply have none, which is exactly what makes finalizeBucket() omit
    // capacity/caseCapacityPercentage for them below (capacity === null).
    const consultantProfile = member.user.consultantProfiles[0] || null;
    return {
      consultant: { id: member.user.id, fullName: member.user.fullName, email: member.user.email },
      role: member.role,
      profile: consultantProfile
        ? {
            employeeId: consultantProfile.employeeId,
            specializations: consultantProfile.specializations,
            masteryLevel: consultantProfile.masteryLevel,
          }
        : null,
      ...finalizeBucket(buckets.get(member.user.id), consultantProfile?.maximumActiveCases ?? null, sliceLimit),
    };
  });
  const unassigned = finalizeBucket(unassignedBucket, null, sliceLimit);
  const summary = {
    activeStaff: consultants.length,
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
    documentsWaitingOnClient: documents.filter((item) =>
      CLIENT_WAITING_STATUSES.includes(item.status),
    ).length,
    documentsReadyForReview: documents.filter((item) =>
      STAFF_REVIEW_STATUSES.includes(item.status),
    ).length,
    pendingFollowUps: followUps.length + leadFollowUps.length,
    upcomingAppointments: appointments.length,
    overloadedConsultants: consultants.filter(
      (item) => item.caseCapacityPercentage >= 100,
    ).length,
    // Urgent unassigned follow-ups matter especially — they're both overdue
    // and high priority, and nobody is on the hook for them.
    unassignedUrgentFollowUps: unassigned.highPriorityOverdueFollowUps,
  };
  return {
    summary,
    consultants,
    unassigned,
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

// Maps a drill-down :category to the (already-loaded, ownership-resolved)
// bucket field it reads from — reusing loadAgencyWorkloads()'s existing
// ownership-resolution logic instead of duplicating it, at the cost of
// still doing the full in-memory agency load to serve one page of one
// category. That tradeoff is deliberate for now: it's fully correct with
// zero duplicated logic, and it's the natural first step toward Phase 10's
// larger "replace full in-memory load with DB-level pagination" work —
// this endpoint's shape won't need to change when that lands, only its
// internals.
const CATEGORY_ITEM_FIELDS = {
  lead: "activeLeadItems",
  case: "activeCaseItems",
  collaboratingCase: "collaboratingCaseItems",
  pendingTask: "pendingTaskItems",
  overdueTask: "overdueTaskItems",
  document: "documentReviewItems",
  documentWaiting: "documentWaitingItems",
  followUp: "followUpItems",
  overdueFollowUp: "overdueFollowUpItems",
  appointment: "appointmentItems",
};

const BUCKET_KEY_FIELDS = {
  unassigned: "unassigned",
};

export async function consultantWorkloadCategory(req, res) {
  const { consultantKey, category } = req.params;
  const itemField = CATEGORY_ITEM_FIELDS[category];
  if (!itemField)
    throw createHttpError(400, "Unknown workload category.", "BAD_REQUEST");

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
  );

  const workload = await loadAgencyWorkloads(req.auth.agencyId, {
    sliceLimit: Infinity,
  });
  const bucketKey = BUCKET_KEY_FIELDS[consultantKey];
  const bucket = bucketKey
    ? workload[bucketKey]
    : workload.consultants.find(
        (item) => item.consultant.id === consultantKey,
      );
  if (!bucket)
    throw createHttpError(404, "Consultant not found.", "NOT_FOUND");

  const items = bucket[itemField] || [];
  const start = (page - 1) * limit;
  res.json({
    success: true,
    data: {
      items: items.slice(start, start + limit),
      total: items.length,
      page,
      limit,
    },
  });
}

// Phase 9 (scoped): a thin dispatcher over each item type's own existing
// assignment logic — assignLead() / updateFollowUp() — rather than
// reimplementing reassignment here, so the normal recordActivity()/
// notifyUsers() calls those already make happen for free. Deliberately
// scoped to "lead" and "followUp"/"overdueFollowUp" only for now: those are
// the two categories most likely to end up Unassigned (the audit's own
// highest-value case), and both authorize off req.auth exactly like this
// controller does. Tasks (CaseWorkflowStep) and appointments have their own
// reassignment endpoints too, but those read identity off req.user plus
// case-scoped access helpers (caseAccessWhere/findScopedCase) that would
// need to be re-verified against a live server before wiring them in here —
// left for a follow-up pass rather than guessed at blind.
const REASSIGNABLE_CATEGORIES = new Set(["lead", "followUp", "overdueFollowUp"]);

export async function reassignWorkloadItem(req, res) {
  const { category, itemId, newOwnerUserId, reason } = req.body || {};
  if (!REASSIGNABLE_CATEGORIES.has(category))
    throw createHttpError(
      400,
      "This category can't be reassigned from Team Workload yet — open the item on its own page instead.",
      "BAD_REQUEST",
    );
  if (!itemId || !newOwnerUserId)
    throw createHttpError(
      400,
      "itemId and newOwnerUserId are required.",
      "VALIDATION_ERROR",
    );

  if (category === "lead") {
    req.params.id = itemId;
    req.body = {
      ownerUserId: newOwnerUserId,
      reason: reason || "Reassigned from Team Workload",
    };
    const result = await assignLead(req, prisma);
    return res.json({ success: true, data: result });
  }

  // followUp and overdueFollowUp both resolve to the same FollowUp model.
  // Note: this only covers case/client-side follow-ups. Lead-side
  // LeadFollowUp rows — merged into the same "followUp" category on this
  // page since Phase 2 — use a different model and aren't reassignable
  // here yet; passing one of their ids fails safely with a 404 from
  // updateFollowUp() rather than writing to the wrong table.
  req.params.id = itemId;
  req.body = { assignedUserId: newOwnerUserId };
  return updateFollowUp(req, res);
}

// Admin-side queue for the consultant self-service "request to join a case"
// workflow (Team Workload refinement plan, Phase 4). The actual grant still
// runs through the same ownership model /cases/:id/permissions uses —
// approveCollaborationRequest() just does it on the requester's behalf and
// records who approved it.
export async function listCollaborationRequestsHandler(req, res) {
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "Pending";
  const data = await listCollaborationRequestsForAdmin(req.auth.agencyId, { status });
  res.json({ success: true, data });
}

export async function approveCollaborationRequestHandler(req, res) {
  const reviewNote = typeof req.body?.reviewNote === "string" ? req.body.reviewNote : "";
  const data = await approveCollaborationRequest(req.auth.agencyId, req.auth.userId, req.params.id, { reviewNote });
  res.json({ success: true, data, message: "Access granted." });
}

export async function declineCollaborationRequestHandler(req, res) {
  const reviewNote = typeof req.body?.reviewNote === "string" ? req.body.reviewNote : "";
  const data = await declineCollaborationRequest(req.auth.agencyId, req.auth.userId, req.params.id, { reviewNote });
  res.json({ success: true, data, message: "Request declined." });
}
