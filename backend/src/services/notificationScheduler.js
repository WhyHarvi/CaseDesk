import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { leadSegmentWhere } from "../modules/leads/lead.permissions.js";
import {
  adminRecipientIds,
  caseNotificationActionUrl,
  clientRecipientIds,
  internalCaseRecipientIds,
  loadNotificationPreferencesByUser,
  notifyUsers,
} from "./notificationService.js";
import { loadEligibleMembershipsByAgency } from "./notificationAccessService.js";
import { hasPushSubscription } from "./webPushService.js";
import { queueDirectFollowUpEmail } from "./followUpClientReminderService.js";
import { reconcileMissingAppointmentPaymentAlerts } from "./bookingPaymentHoldService.js";
import { acquireWorkerLease } from "./workerLeaseService.js";

const INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_SCHEDULER_INTERVAL_MS) || 60_000, 15_000);
const NOTIFICATION_DEADLINE_SCAN_MS = Math.max(
  Number(process.env.NOTIFICATION_DEADLINE_SCAN_MS) || 10 * 60_000,
  INTERVAL_MS,
);
const NOTIFICATION_RESOLUTION_BATCH_SIZE = Math.min(
  Math.max(Number(process.env.NOTIFICATION_RESOLUTION_BATCH_SIZE) || 250, 25),
  1_000,
);
const NOTIFICATION_ENTITY_RECHECK_MS = Math.max(
  Number(process.env.NOTIFICATION_ENTITY_RECHECK_MS) || 5 * 60_000,
  INTERVAL_MS,
);
const NOTIFICATION_SCHEDULER_LEASE_MS = Math.max(INTERVAL_MS * 3, 5 * 60_000);
let timer = null;
let running = false;
let nextEntityResolutionAt = 0;
let nextDeadlineScanAt = 0;
let notificationResolutionCursor = null;

const isoKey = (value) => new Date(value).toISOString();
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

// Each scheduler pass builds one of these. It exists to fold the
// fallback-admin lookup into the same "resolve once per agency per pass"
// batching as the three hot notifyUsers() queries below — several
// candidate loops fall back to the agency's admins when a candidate has no
// otherwise-eligible recipient, and previously each of those fallbacks ran
// its own fresh prisma.user.findMany, sometimes more than once for the same
// agency within a single pass (see communicationSlaNotifications, which
// could call it twice for one conversation).
// loadAdminRecipientIds is overridable purely for testing this memoization
// with a fake counter instead of a live database — production always uses
// the real adminRecipientIds.
export function createSchedulerPassContext({ loadAdminRecipientIds = adminRecipientIds } = {}) {
  const adminIdsByAgency = new Map();
  return {
    async cachedAdminRecipientIds(agencyId) {
      if (!adminIdsByAgency.has(agencyId)) {
        adminIdsByAgency.set(agencyId, await loadAdminRecipientIds(agencyId));
      }
      return adminIdsByAgency.get(agencyId);
    },
  };
}

// Pure grouping step, exported so its call-count/shape behavior (one bucket
// per agency touched by the pass, one flat set of user ids overall) is
// directly testable without a database — this is the structural reason the
// three hot queries below become O(agencies-with-candidates) instead of
// O(candidates).
export function groupRecipientIdsForDispatch(jobs) {
  const recipientIdsByAgency = new Map();
  const allUserIds = new Set();
  for (const job of jobs || []) {
    if (!job.agencyId) continue;
    const set = recipientIdsByAgency.get(job.agencyId) || new Set();
    for (const recipientId of job.recipientIds || []) {
      if (!recipientId) continue;
      set.add(recipientId);
      allUserIds.add(recipientId);
    }
    recipientIdsByAgency.set(job.agencyId, set);
  }
  return { recipientIdsByAgency, allUserIds };
}

// Candidate loops below no longer call notifyUsers() directly. Instead they
// resolve recipients exactly as before (including the per-pass admin
// fallback above) and collect a plain job object per notifyUsers() call.
// Once every loop has finished collecting for this pass, dispatchNotificationJobs
// resolves membership eligibility, preferences, and push-subscription status
// once — grouped by agency where that scoping matters, globally where it
// doesn't (see notificationAccessService.js / notificationService.js) —
// and only then calls the real notifyUsers() for each job, passing that
// pass-scoped data through the `precomputed` parameter so no per-candidate
// query is repeated.
//
// The loaders/notify are overridable (defaulting to the real
// implementations) purely so tests can assert call counts and wiring with
// fakes instead of a live database — production callers never pass these.
export async function dispatchNotificationJobs(jobs, {
  loadMembershipsByAgency = loadEligibleMembershipsByAgency,
  loadPreferencesByUser = loadNotificationPreferencesByUser,
  loadPushSubscribedUserIds = hasPushSubscription,
  notify = notifyUsers,
} = {}) {
  if (!jobs.length) return;
  const { recipientIdsByAgency, allUserIds } = groupRecipientIdsForDispatch(jobs);
  const [membershipsByAgency, preferencesByUserId, pushSubscribedUserIds] = await Promise.all([
    loadMembershipsByAgency(recipientIdsByAgency),
    loadPreferencesByUser([...allUserIds]),
    loadPushSubscribedUserIds([...allUserIds]),
  ]);
  for (const job of jobs) {
    await notify({
      ...job,
      precomputed: {
        membershipsByUserId: membershipsByAgency.get(job.agencyId) || new Map(),
        preferencesByUserId,
        pushSubscribedUserIds,
      },
    });
  }
}

function localClock(now, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function sendDailyDigests(now) {
  const preferences = await prisma.notificationPreference.findMany({
    where: {
      category: "all",
      deliveryMode: "daily_digest",
      emailEnabled: true,
      user: { status: "active", memberships: { some: { isActive: true } } },
    },
    include: { user: { select: { id: true, email: true, fullName: true } } },
    take: 500,
  });
  for (const preference of preferences) {
    const clock = localClock(now, preference.timezone);
    if (clock.hour !== preference.digestHour) continue;
    if (preference.lastDigestAt && localClock(preference.lastDigestAt, preference.timezone).date === clock.date) continue;
    const since = preference.lastDigestAt || new Date(now.getTime() - 24 * 60 * 60_000);
    const notifications = await prisma.notification.findMany({
      where: {
        agencyId: preference.agencyId,
        recipientUserId: preference.userId,
        attentionLevel: "update",
        lastOccurredAt: { gt: since, lte: now },
        dismissedAt: null,
        resolvedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { lastOccurredAt: "desc" },
      take: 100,
    });
    if (!notifications.length) {
      await prisma.notificationPreference.update({ where: { id: preference.id }, data: { lastDigestAt: now } });
      continue;
    }
    const byCategory = notifications.reduce((map, item) => {
      map.set(item.category, (map.get(item.category) || 0) + item.occurrenceCount);
      return map;
    }, new Map());
    const summary = [...byCategory].map(([category, count]) => `${count} ${category}`).join(" · ");
    const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
    try {
      const config = await resolveAgencyMailConfig(preference.agencyId);
      await createMailTransport(config).sendMail({
        from: config.from,
        to: preference.user.email,
        subject: `Your CaseDesk daily summary — ${notifications.length} update${notifications.length === 1 ? "" : "s"}`,
        text: [
          `Hello ${preference.user.fullName || "there"},`,
          summary,
          ...notifications.slice(0, 10).map((item) => `• ${item.title}${item.occurrenceCount > 1 ? ` (${item.occurrenceCount})` : ""}`),
          `Open CaseDesk: ${frontendUrl}`,
        ].join("\n\n"),
        html: `<p>Hello ${escapeHtml(preference.user.fullName || "there")},</p><p>${escapeHtml(summary)}</p><ul>${notifications.slice(0, 10).map((item) => `<li>${escapeHtml(item.title)}${item.occurrenceCount > 1 ? ` (${item.occurrenceCount})` : ""}</li>`).join("")}</ul><p><a href="${escapeHtml(frontendUrl)}">Open CaseDesk</a></p>`,
      });
      await prisma.notificationPreference.update({ where: { id: preference.id }, data: { lastDigestAt: now } });
    } catch (error) {
      if (process.env.NODE_ENV !== "test") console.error("Notification digest delivery failed", error);
    }
  }
}

async function taskNotifications(now, horizon, pass) {
  const tasks = await prisma.caseWorkflowStep.findMany({
    where: { isActive: true, status: "Pending", dueAt: { not: null, lte: horizon } },
    take: 500,
    select: { id: true, agencyId: true, caseId: true, assignedToId: true, title: true, dueAt: true },
  });
  const jobs = [];
  for (const task of tasks) {
    const overdue = task.dueAt < now;
    const recipients = task.assignedToId ? [task.assignedToId] : await internalCaseRecipientIds(task.agencyId, task.caseId);
    jobs.push({
      agencyId: task.agencyId,
      recipientIds: recipients.length ? recipients : await pass.cachedAdminRecipientIds(task.agencyId),
      type: overdue ? "task.overdue" : "task.due_soon",
      category: "work",
      title: overdue ? `Overdue task: ${task.title}` : `Task due soon: ${task.title}`,
      body: `Due ${task.dueAt.toISOString()}`,
      severity: overdue ? "critical" : "warning",
      entityType: "task",
      entityId: task.id,
      actionUrl: caseNotificationActionUrl(task.caseId, { type: overdue ? "task.overdue" : "task.due_soon", category: "work", entityId: task.id }),
      dedupeKey: `task:${task.id}:${overdue ? "overdue" : "due"}:${isoKey(task.dueAt)}`,
      scheduledFor: overdue ? null : task.dueAt,
      attentionLevel: overdue ? "action_required" : "update",
    });
  }
  return jobs;
}

async function followUpNotifications(now, horizon, pass) {
  const followUps = await prisma.followUp.findMany({
    where: {
      status: "Pending",
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      OR: [
        { dueDate: { not: null, lt: now } },
        { reminderAt: { not: null, lte: now } },
        { reminderAt: null, dueDate: { not: null, lte: horizon } },
      ],
    },
    take: 500,
    select: {
      id: true, agencyId: true, clientId: true, caseId: true, assignedUserId: true,
      title: true, description: true, dueDate: true, reminderAt: true, expiresAt: true, notificationChannels: true, notifyClient: true,
      client: { select: { email: true } },
    },
  });
  const jobs = [];
  for (const item of followUps) {
    const milestone = item.dueDate && item.dueDate < now
      ? "overdue"
      : item.reminderAt && item.reminderAt <= now
        ? "reminder"
        : "due";
    const recipients = item.assignedUserId
      ? [item.assignedUserId]
      : item.caseId ? await internalCaseRecipientIds(item.agencyId, item.caseId) : await pass.cachedAdminRecipientIds(item.agencyId);
    jobs.push({
      agencyId: item.agencyId,
      recipientIds: recipients,
      type: `follow_up.${milestone}`,
      category: "work",
      title: milestone === "overdue" ? `Overdue follow-up: ${item.title}` : `Follow-up reminder: ${item.title}`,
      severity: milestone === "overdue" ? "critical" : "warning",
      entityType: "follow_up",
      entityId: item.id,
      actionUrl: item.caseId
        ? caseNotificationActionUrl(item.caseId, { type: `follow_up.${milestone}`, category: "work", entityId: item.id })
        : `/app/follow-ups?highlight=${encodeURIComponent(item.id)}`,
      dedupeKey: `follow-up:${item.id}:${milestone}:${isoKey(item.reminderAt || item.dueDate)}`,
      scheduledFor: milestone === "due" ? item.dueDate : null,
      attentionLevel: milestone === "overdue" || milestone === "reminder" ? "action_required" : "update",
      expiresAt: item.expiresAt || undefined,
    });
    if (item.notifyClient && item.clientId) {
      const channels = item.notificationChannels?.length ? item.notificationChannels : ["in_app"];
      const portalRecipientIds = await clientRecipientIds(item.agencyId, item.clientId);
      jobs.push({
        agencyId: item.agencyId,
        recipientIds: portalRecipientIds,
        type: `client_reminder.${milestone}`,
        category: "work",
        title: item.title,
        body: item.dueDate ? `Due ${item.dueDate.toISOString()}` : null,
        severity: milestone === "overdue" ? "warning" : "info",
        entityType: "follow_up",
        entityId: item.id,
        actionUrl: "/client-portal",
        channels,
        dedupeKey: `follow-up:${item.id}:${milestone}:client:${isoKey(item.reminderAt || item.dueDate)}`,
        scheduledFor: milestone === "due" ? item.dueDate : null,
        attentionLevel: milestone === "overdue" ? "action_required" : "update",
        expiresAt: item.expiresAt || undefined,
      });
      if (!portalRecipientIds.length && channels.includes("email")) {
        await queueDirectFollowUpEmail({
          followUp: item,
          milestone,
          scheduledKey: isoKey(item.reminderAt || item.dueDate),
        });
      }
    }
  }
  return jobs;
}

export async function resolveCompletedAndExpiredNotifications(now = new Date()) {
  // Expiry stays responsive on every scheduler tick, but is bounded so a
  // backlog can never turn one pass into an unbounded update/egress spike.
  const expired = await prisma.notification.findMany({
    where: { resolvedAt: null, expiresAt: { lte: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: NOTIFICATION_RESOLUTION_BATCH_SIZE,
  });
  const expiredIds = expired.map((item) => item.id);
  if (expiredIds.length) {
    await prisma.notification.updateMany({
      where: { id: { in: expiredIds }, resolvedAt: null },
      data: { resolvedAt: now, readAt: now },
    });
    await prisma.notificationDelivery.updateMany({
      where: { notificationId: { in: expiredIds }, status: { in: ["pending", "retry"] } },
      data: { status: "cancelled", lastError: "Cancelled because the notification was resolved" },
    });
  }

  // Entity reconciliation is a safety net for state changes that did not
  // resolve their notification at write time. Walk a small rotating batch
  // every few minutes rather than rereading up to thousands of open rows on
  // every 60-second scheduler pass.
  if (now.getTime() < nextEntityResolutionAt) return { expired: expiredIds.length, checked: 0 };
  nextEntityResolutionAt = now.getTime() + NOTIFICATION_ENTITY_RECHECK_MS;

  const open = await prisma.notification.findMany({
    where: {
      resolvedAt: null,
      entityId: { not: null },
      ...(notificationResolutionCursor ? { id: { gt: notificationResolutionCursor } } : {}),
      entityType: {
        in: ["task", "follow_up", "document", "questionnaire_assignment", "questionnaire_collection", "conversation"],
      },
    },
    select: { id: true, entityType: true, entityId: true },
    orderBy: { id: "asc" },
    take: NOTIFICATION_RESOLUTION_BATCH_SIZE,
  });
  notificationResolutionCursor = open.length === NOTIFICATION_RESOLUTION_BATCH_SIZE ? open.at(-1).id : null;
  const idsFor = (type) => [...new Set(open.filter((item) => item.entityType === type).map((item) => item.entityId))];
  const [tasks, followUps, documents, questionnaires, questionnaireCollections, conversations] = await Promise.all([
    idsFor("task").length ? prisma.caseWorkflowStep.findMany({ where: { id: { in: idsFor("task") }, OR: [{ isActive: false }, { status: { in: ["Completed", "Cancelled"] } }] }, select: { id: true } }) : [],
    idsFor("follow_up").length ? prisma.followUp.findMany({ where: { id: { in: idsFor("follow_up") }, status: { in: ["Completed", "Cancelled"] } }, select: { id: true } }) : [],
    idsFor("document").length ? prisma.clientDocument.findMany({ where: { id: { in: idsFor("document") }, status: { notIn: ["Requested", "ChangesRequested"] } }, select: { id: true } }) : [],
    idsFor("questionnaire_assignment").length ? prisma.questionnaireAssignment.findMany({ where: { id: { in: idsFor("questionnaire_assignment") }, OR: [{ status: "Submitted" }, { locked: true }] }, select: { id: true } }) : [],
    idsFor("questionnaire_collection").length ? prisma.case.findMany({ where: { id: { in: idsFor("questionnaire_collection") }, questionnaireAssignments: { none: { sharing: "Shared", locked: false, status: { not: "Submitted" } } } }, select: { id: true } }) : [],
    idsFor("conversation").length ? prisma.communicationConversation.findMany({ where: { id: { in: idsFor("conversation") }, state: { notIn: ["Open", "WaitingOnAgency"] } }, select: { id: true } }) : [],
  ]);
  const resolvedByType = new Map([
    ["task", tasks.map((item) => item.id)],
    ["follow_up", followUps.map((item) => item.id)],
    ["document", documents.map((item) => item.id)],
    ["questionnaire_assignment", questionnaires.map((item) => item.id)],
    ["questionnaire_collection", questionnaireCollections.map((item) => item.id)],
    ["conversation", conversations.map((item) => item.id)],
  ]);
  for (const [entityType, entityIds] of resolvedByType) {
    if (!entityIds.length) continue;
    await prisma.notification.updateMany({
      where: { resolvedAt: null, entityType, entityId: { in: entityIds } },
      data: { resolvedAt: now, readAt: now },
    });
    await prisma.notificationDelivery.updateMany({
      where: {
        status: { in: ["pending", "retry"] },
        notification: { resolvedAt: { not: null }, entityType, entityId: { in: entityIds } },
      },
      data: { status: "cancelled", lastError: "Cancelled because the notification was resolved" },
    });
  }
  return { expired: expiredIds.length, checked: open.length };
}

async function documentNotifications(now, horizon) {
  const documents = await prisma.clientDocument.findMany({
    where: { visibility: "Client", status: { in: ["Requested", "ChangesRequested"] }, dueAt: { not: null, lte: horizon } },
    take: 500,
    select: { id: true, agencyId: true, clientId: true, caseId: true, documentName: true, dueAt: true },
  });
  const jobs = [];
  for (const item of documents) {
    const overdue = item.dueAt < now;
    jobs.push({
      agencyId: item.agencyId,
      recipientIds: await clientRecipientIds(item.agencyId, item.clientId),
      type: overdue ? "document.overdue" : "document.due_soon",
      category: "documents",
      title: overdue ? `Document overdue: ${item.documentName}` : `Document due soon: ${item.documentName}`,
      body: `Due ${item.dueAt.toISOString()}`,
      severity: overdue ? "critical" : "warning",
      entityType: "document",
      entityId: item.id,
      actionUrl: "/client-portal/documents",
      dedupeKey: `document:${item.id}:${overdue ? "overdue" : "due"}:${isoKey(item.dueAt)}`,
      scheduledFor: overdue ? null : item.dueAt,
      attentionLevel: overdue ? "action_required" : "update",
    });
  }
  return jobs;
}

async function questionnaireNotifications(now, horizon) {
  const assignments = await prisma.questionnaireAssignment.findMany({
    where: { sharing: "Shared", locked: false, status: { not: "Submitted" }, dueAt: { not: null, lte: horizon } },
    take: 500,
    select: { id: true, agencyId: true, clientId: true, name: true, dueAt: true },
  });
  const jobs = [];
  for (const item of assignments) {
    const overdue = item.dueAt < now;
    jobs.push({
      agencyId: item.agencyId,
      recipientIds: await clientRecipientIds(item.agencyId, item.clientId),
      type: overdue ? "questionnaire.overdue" : "questionnaire.due_soon",
      category: "questionnaires",
      title: overdue ? `Questionnaire overdue: ${item.name}` : `Questionnaire due soon: ${item.name}`,
      body: `Due ${item.dueAt.toISOString()}`,
      severity: overdue ? "critical" : "warning",
      entityType: "questionnaire_assignment",
      entityId: item.id,
      actionUrl: "/client-portal/questionnaires",
      dedupeKey: `questionnaire:${item.id}:${overdue ? "overdue" : "due"}:${isoKey(item.dueAt)}`,
      scheduledFor: overdue ? null : item.dueAt,
      attentionLevel: overdue ? "action_required" : "update",
    });
  }
  return jobs;
}

async function leadNotifications(now, horizon) {
  const consultationHorizon = new Date(Math.min(horizon.getTime(), now.getTime() + 24 * 60 * 60_000));
  const [followUps, leads, consultations] = await Promise.all([
    prisma.leadFollowUp.findMany({ where: { status: "PENDING", dueAt: { lte: horizon }, lead: leadSegmentWhere() }, take: 500, select: { id: true, agencyId: true, leadId: true, assignedUserId: true, description: true, dueAt: true } }),
    prisma.lead.findMany({ where: { status: { in: ["OPEN", "NURTURE"] }, ...leadSegmentWhere(), OR: [{ firstContactDueAt: { lte: horizon }, firstContactAt: null }, { nextActionAt: { lte: horizon } }, { nurtureUntil: { lte: now } }] }, take: 500, select: { id: true, agencyId: true, leadNumber: true, ownerUserId: true, nextActionOwnerId: true, firstContactDueAt: true, firstContactAt: true, nextActionAt: true, nurtureUntil: true } }),
    prisma.leadConsultation.findMany({ where: { status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] }, startAt: { gt: now, lte: consultationHorizon }, lead: leadSegmentWhere() }, take: 500, select: { id: true, agencyId: true, leadId: true, consultantUserId: true, startAt: true } }),
  ]);
  const jobs = [];
  for (const item of followUps) {
    const overdue = item.dueAt < now;
    jobs.push({ agencyId: item.agencyId, recipientIds: [item.assignedUserId], type: overdue ? "lead.follow_up_overdue" : "lead.follow_up_due", category: "leads", title: overdue ? "Lead follow-up overdue" : "Lead follow-up due soon", body: item.description, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: item.leadId, actionUrl: "/leads", dedupeKey: `lead-follow-up:${item.id}:${overdue ? "overdue" : "due"}:${isoKey(item.dueAt)}`, scheduledFor: overdue ? null : item.dueAt, attentionLevel: overdue ? "action_required" : "update" });
  }
  for (const lead of leads) {
    const recipientIds = [lead.nextActionOwnerId || lead.ownerUserId];
    if (!lead.firstContactAt && lead.firstContactDueAt && lead.firstContactDueAt <= horizon) {
      const overdue = lead.firstContactDueAt < now;
      jobs.push({ agencyId: lead.agencyId, recipientIds, type: overdue ? "lead.first_response_breached" : "lead.first_response_due", category: "leads", title: `${lead.leadNumber}: first response ${overdue ? "overdue" : "due soon"}`, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:first-response:${overdue ? "overdue" : "due"}:${isoKey(lead.firstContactDueAt)}`, scheduledFor: overdue ? null : lead.firstContactDueAt, attentionLevel: overdue ? "action_required" : "update" });
    }
    if (lead.nextActionAt && lead.nextActionAt <= horizon) {
      const overdue = lead.nextActionAt < now;
      jobs.push({ agencyId: lead.agencyId, recipientIds, type: overdue ? "lead.next_action_overdue" : "lead.next_action_due", category: "leads", title: `${lead.leadNumber}: next action ${overdue ? "overdue" : "due soon"}`, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:next-action:${overdue ? "overdue" : "due"}:${isoKey(lead.nextActionAt)}`, scheduledFor: overdue ? null : lead.nextActionAt, attentionLevel: overdue ? "action_required" : "update" });
    }
    if (lead.nurtureUntil && lead.nurtureUntil <= now) {
      jobs.push({ agencyId: lead.agencyId, recipientIds: [lead.ownerUserId], type: "lead.nurture_due", category: "leads", title: `${lead.leadNumber} is ready for reactivation`, severity: "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:nurture:${isoKey(lead.nurtureUntil)}` });
    }
  }
  for (const item of consultations) {
    const milestone = item.startAt.getTime() - now.getTime() <= 60 * 60_000 ? "1h" : "24h";
    jobs.push({ agencyId: item.agencyId, recipientIds: [item.consultantUserId], type: "lead.consultation_reminder", category: "leads", title: `Lead consultation starts ${milestone === "1h" ? "within an hour" : "within 24 hours"}`, body: item.startAt.toISOString(), severity: "warning", entityType: "lead", entityId: item.leadId, actionUrl: "/leads", dedupeKey: `lead-consultation:${item.id}:${milestone}:${isoKey(item.startAt)}`, attentionLevel: "update" });
  }
  return jobs;
}

async function communicationSlaNotifications(now, horizon, pass) {
  const conversations = await prisma.communicationConversation.findMany({
    where: { state: { in: ["Open", "WaitingOnAgency"] }, deletedAt: null, OR: [{ responseDueAt: { not: null, lte: horizon } }, { resolutionDueAt: { not: null, lte: horizon } }] },
    take: 500,
    select: { id: true, agencyId: true, clientId: true, caseId: true, assignedToId: true, subject: true, responseDueAt: true, resolutionDueAt: true },
  });
  const jobs = [];
  for (const item of conversations) {
    const recipients = item.assignedToId ? [item.assignedToId] : await internalCaseRecipientIds(item.agencyId, item.caseId);
    for (const [kind, dueAt] of [["response", item.responseDueAt], ["resolution", item.resolutionDueAt]]) {
      if (!dueAt || dueAt > horizon) continue;
      const overdue = dueAt < now;
      const type = `communication.${kind}_${overdue ? "breached" : "due"}`;
      // Conversations aren't always case-scoped — client-only chats have no
      // caseId, and building a case link for those produced "/app/cases/null".
      const actionUrl = item.caseId
        ? caseNotificationActionUrl(item.caseId, { type, category: "communications" })
        : `/app/clients/${item.clientId}?conversation=${encodeURIComponent(item.id)}`;
      jobs.push({ agencyId: item.agencyId, recipientIds: recipients.length ? recipients : await pass.cachedAdminRecipientIds(item.agencyId), type, category: "communications", title: `${kind === "response" ? "Response" : "Resolution"} ${overdue ? "SLA breached" : "due soon"}: ${item.subject || "client conversation"}`, severity: overdue ? "critical" : "warning", entityType: "conversation", entityId: item.id, actionUrl, dedupeKey: `conversation:${item.id}:${kind}:${overdue ? "overdue" : "due"}:${isoKey(dueAt)}`, scheduledFor: overdue ? null : dueAt, attentionLevel: overdue ? "action_required" : "update" });
    }
  }
  return jobs;
}

export async function runNotificationScheduler(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    // Every application replica starts this worker. A database-backed lease
    // makes exactly one replica perform each pass instead of multiplying all
    // deadline scans and per-recipient dedupe checks by the replica count.
    if (!await acquireWorkerLease("notification-scheduler", {
      ttlMs: NOTIFICATION_SCHEDULER_LEASE_MS,
      now,
    })) {
      return { skipped: true, reason: "distributed_lease" };
    }
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
    await resolveCompletedAndExpiredNotifications(now);
    await reconcileMissingAppointmentPaymentAlerts();
    if (now.getTime() < nextDeadlineScanAt) {
      return { skipped: false, deadlineScanSkipped: true, completedAt: new Date() };
    }
    nextDeadlineScanAt = now.getTime() + NOTIFICATION_DEADLINE_SCAN_MS;
    // Every candidate loop below only *collects* the notifyUsers() jobs it
    // would previously have fired immediately — recipient resolution
    // (assignee lookups, internalCaseRecipientIds, clientRecipientIds, and
    // the per-pass admin fallback) still happens exactly as before, per
    // candidate. Once every loop has finished, dispatchNotificationJobs
    // resolves membership eligibility, preferences, and push-subscription
    // status once for the whole pass and only then creates the actual
    // notifications — see dispatchNotificationJobs above for why.
    const pass = createSchedulerPassContext();
    const jobs = [
      ...(await taskNotifications(now, horizon, pass)),
      ...(await followUpNotifications(now, horizon, pass)),
      // Appointment confirmations and reminders already use the dedicated
      // booking email/SMS pipeline. The reconciliation above is only for the
      // staff-facing billing exception, not a duplicate client reminder.
      ...(await documentNotifications(now, horizon)),
      ...(await questionnaireNotifications(now, horizon)),
      ...(await leadNotifications(now, horizon)),
      ...(await communicationSlaNotifications(now, horizon, pass)),
    ];
    await dispatchNotificationJobs(jobs);
    await sendDailyDigests(now);
    return { skipped: false, completedAt: new Date() };
  } finally {
    running = false;
  }
}

export function startNotificationScheduler() {
  if (timer || process.env.NOTIFICATION_SCHEDULER_ENABLED === "false") return timer;
  const run = () => void runNotificationScheduler().catch((error) => console.error("Notification scheduler failed", error));
  run();
  timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export function stopNotificationScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
