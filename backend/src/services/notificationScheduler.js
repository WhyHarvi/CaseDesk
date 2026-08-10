import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { leadSegmentWhere } from "../modules/leads/lead.permissions.js";
import {
  adminRecipientIds,
  caseNotificationActionUrl,
  clientRecipientIds,
  internalCaseRecipientIds,
  notifyUsers,
} from "./notificationService.js";
import { queueDirectFollowUpEmail } from "./followUpClientReminderService.js";
import { reconcileMissingAppointmentPaymentAlerts } from "./bookingPaymentHoldService.js";

const INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_SCHEDULER_INTERVAL_MS) || 60_000, 15_000);
let timer = null;
let running = false;

const isoKey = (value) => new Date(value).toISOString();
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

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

async function taskNotifications(now, horizon) {
  const tasks = await prisma.caseWorkflowStep.findMany({
    where: { isActive: true, status: "Pending", dueAt: { not: null, lte: horizon } },
    take: 500,
    select: { id: true, agencyId: true, caseId: true, assignedToId: true, title: true, dueAt: true },
  });
  for (const task of tasks) {
    const overdue = task.dueAt < now;
    const recipients = task.assignedToId ? [task.assignedToId] : await internalCaseRecipientIds(task.agencyId, task.caseId);
    await notifyUsers({
      agencyId: task.agencyId,
      recipientIds: recipients.length ? recipients : await adminRecipientIds(task.agencyId),
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
}

async function followUpNotifications(now, horizon) {
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
  for (const item of followUps) {
    const milestone = item.dueDate && item.dueDate < now
      ? "overdue"
      : item.reminderAt && item.reminderAt <= now
        ? "reminder"
        : "due";
    const recipients = item.assignedUserId
      ? [item.assignedUserId]
      : item.caseId ? await internalCaseRecipientIds(item.agencyId, item.caseId) : await adminRecipientIds(item.agencyId);
    await notifyUsers({
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
      await notifyUsers({
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
}

export async function resolveCompletedAndExpiredNotifications(now = new Date()) {
  await prisma.notification.updateMany({
    where: { resolvedAt: null, expiresAt: { lte: now } },
    data: { resolvedAt: now, readAt: now },
  });

  const open = await prisma.notification.findMany({
    where: {
      resolvedAt: null,
      entityId: { not: null },
      entityType: {
        in: ["task", "follow_up", "document", "questionnaire_assignment", "questionnaire_collection", "conversation"],
      },
    },
    select: { entityType: true, entityId: true },
    distinct: ["entityType", "entityId"],
    take: 2000,
  });
  const idsFor = (type) => open.filter((item) => item.entityType === type).map((item) => item.entityId);
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
  }
  await prisma.notificationDelivery.updateMany({
    where: {
      status: { in: ["pending", "retry"] },
      notification: { resolvedAt: { not: null } },
    },
    data: {
      status: "cancelled",
      lastError: "Cancelled because the notification was resolved",
    },
  });
}

async function documentNotifications(now, horizon) {
  const documents = await prisma.clientDocument.findMany({
    where: { visibility: "Client", status: { in: ["Requested", "ChangesRequested"] }, dueAt: { not: null, lte: horizon } },
    take: 500,
    select: { id: true, agencyId: true, clientId: true, caseId: true, documentName: true, dueAt: true },
  });
  for (const item of documents) {
    const overdue = item.dueAt < now;
    await notifyUsers({
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
}

async function questionnaireNotifications(now, horizon) {
  const assignments = await prisma.questionnaireAssignment.findMany({
    where: { sharing: "Shared", locked: false, status: { not: "Submitted" }, dueAt: { not: null, lte: horizon } },
    take: 500,
    select: { id: true, agencyId: true, clientId: true, name: true, dueAt: true },
  });
  for (const item of assignments) {
    const overdue = item.dueAt < now;
    await notifyUsers({
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
}

async function leadNotifications(now, horizon) {
  const consultationHorizon = new Date(Math.min(horizon.getTime(), now.getTime() + 24 * 60 * 60_000));
  const [followUps, leads, consultations] = await Promise.all([
    prisma.leadFollowUp.findMany({ where: { status: "PENDING", dueAt: { lte: horizon }, lead: leadSegmentWhere() }, take: 500, select: { id: true, agencyId: true, leadId: true, assignedUserId: true, description: true, dueAt: true } }),
    prisma.lead.findMany({ where: { status: { in: ["OPEN", "NURTURE"] }, ...leadSegmentWhere(), OR: [{ firstContactDueAt: { lte: horizon }, firstContactAt: null }, { nextActionAt: { lte: horizon } }, { nurtureUntil: { lte: now } }] }, take: 500, select: { id: true, agencyId: true, leadNumber: true, ownerUserId: true, nextActionOwnerId: true, firstContactDueAt: true, firstContactAt: true, nextActionAt: true, nurtureUntil: true } }),
    prisma.leadConsultation.findMany({ where: { status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] }, startAt: { gt: now, lte: consultationHorizon }, lead: leadSegmentWhere() }, take: 500, select: { id: true, agencyId: true, leadId: true, consultantUserId: true, startAt: true } }),
  ]);
  for (const item of followUps) {
    const overdue = item.dueAt < now;
    await notifyUsers({ agencyId: item.agencyId, recipientIds: [item.assignedUserId], type: overdue ? "lead.follow_up_overdue" : "lead.follow_up_due", category: "leads", title: overdue ? "Lead follow-up overdue" : "Lead follow-up due soon", body: item.description, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: item.leadId, actionUrl: "/leads", dedupeKey: `lead-follow-up:${item.id}:${overdue ? "overdue" : "due"}:${isoKey(item.dueAt)}`, scheduledFor: overdue ? null : item.dueAt, attentionLevel: overdue ? "action_required" : "update" });
  }
  for (const lead of leads) {
    const recipientIds = [lead.nextActionOwnerId || lead.ownerUserId];
    if (!lead.firstContactAt && lead.firstContactDueAt && lead.firstContactDueAt <= horizon) {
      const overdue = lead.firstContactDueAt < now;
      await notifyUsers({ agencyId: lead.agencyId, recipientIds, type: overdue ? "lead.first_response_breached" : "lead.first_response_due", category: "leads", title: `${lead.leadNumber}: first response ${overdue ? "overdue" : "due soon"}`, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:first-response:${overdue ? "overdue" : "due"}:${isoKey(lead.firstContactDueAt)}`, scheduledFor: overdue ? null : lead.firstContactDueAt, attentionLevel: overdue ? "action_required" : "update" });
    }
    if (lead.nextActionAt && lead.nextActionAt <= horizon) {
      const overdue = lead.nextActionAt < now;
      await notifyUsers({ agencyId: lead.agencyId, recipientIds, type: overdue ? "lead.next_action_overdue" : "lead.next_action_due", category: "leads", title: `${lead.leadNumber}: next action ${overdue ? "overdue" : "due soon"}`, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:next-action:${overdue ? "overdue" : "due"}:${isoKey(lead.nextActionAt)}`, scheduledFor: overdue ? null : lead.nextActionAt, attentionLevel: overdue ? "action_required" : "update" });
    }
    if (lead.nurtureUntil && lead.nurtureUntil <= now) {
      await notifyUsers({ agencyId: lead.agencyId, recipientIds: [lead.ownerUserId], type: "lead.nurture_due", category: "leads", title: `${lead.leadNumber} is ready for reactivation`, severity: "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:nurture:${isoKey(lead.nurtureUntil)}` });
    }
  }
  for (const item of consultations) {
    const milestone = item.startAt.getTime() - now.getTime() <= 60 * 60_000 ? "1h" : "24h";
    await notifyUsers({ agencyId: item.agencyId, recipientIds: [item.consultantUserId], type: "lead.consultation_reminder", category: "leads", title: `Lead consultation starts ${milestone === "1h" ? "within an hour" : "within 24 hours"}`, body: item.startAt.toISOString(), severity: "warning", entityType: "lead", entityId: item.leadId, actionUrl: "/leads", dedupeKey: `lead-consultation:${item.id}:${milestone}:${isoKey(item.startAt)}`, attentionLevel: "update" });
  }
}

async function communicationSlaNotifications(now, horizon) {
  const conversations = await prisma.communicationConversation.findMany({
    where: { state: { in: ["Open", "WaitingOnAgency"] }, deletedAt: null, OR: [{ responseDueAt: { not: null, lte: horizon } }, { resolutionDueAt: { not: null, lte: horizon } }] },
    take: 500,
    select: { id: true, agencyId: true, clientId: true, caseId: true, assignedToId: true, subject: true, responseDueAt: true, resolutionDueAt: true },
  });
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
      await notifyUsers({ agencyId: item.agencyId, recipientIds: recipients.length ? recipients : await adminRecipientIds(item.agencyId), type, category: "communications", title: `${kind === "response" ? "Response" : "Resolution"} ${overdue ? "SLA breached" : "due soon"}: ${item.subject || "client conversation"}`, severity: overdue ? "critical" : "warning", entityType: "conversation", entityId: item.id, actionUrl, dedupeKey: `conversation:${item.id}:${kind}:${overdue ? "overdue" : "due"}:${isoKey(dueAt)}`, scheduledFor: overdue ? null : dueAt, attentionLevel: overdue ? "action_required" : "update" });
    }
  }
}

export async function runNotificationScheduler(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
    await resolveCompletedAndExpiredNotifications(now);
    await reconcileMissingAppointmentPaymentAlerts();
    await taskNotifications(now, horizon);
    await followUpNotifications(now, horizon);
    // Appointment confirmations and reminders already use the dedicated
    // booking email/SMS pipeline. The reconciliation above is only for the
    // staff-facing billing exception, not a duplicate client reminder.
    await documentNotifications(now, horizon);
    await questionnaireNotifications(now, horizon);
    await leadNotifications(now, horizon);
    await communicationSlaNotifications(now, horizon);
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
