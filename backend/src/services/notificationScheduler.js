import prisma from "./prisma/client.js";
import {
  adminRecipientIds,
  clientRecipientIds,
  internalCaseRecipientIds,
  notifyUsers,
  schedulingCoordinatorRecipientIds,
} from "./notificationService.js";

const INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_SCHEDULER_INTERVAL_MS) || 60_000, 15_000);
let timer = null;
let running = false;

const isoKey = (value) => new Date(value).toISOString();
const caseUrl = (caseId) => `/app/cases/${caseId}`;

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
      actionUrl: caseUrl(task.caseId),
      dedupeKey: `task:${task.id}:${overdue ? "overdue" : "due"}:${isoKey(task.dueAt)}`,
      scheduledFor: overdue ? null : task.dueAt,
    });
  }
}

async function followUpNotifications(now, horizon) {
  const followUps = await prisma.followUp.findMany({
    where: {
      status: { in: ["Pending", "Overdue"] },
      OR: [
        { reminderAt: { not: null, lte: now } },
        { reminderAt: null, dueDate: { not: null, lte: horizon } },
      ],
    },
    take: 500,
    select: {
      id: true, agencyId: true, clientId: true, caseId: true, assignedUserId: true,
      title: true, dueDate: true, reminderAt: true, notificationChannels: true, notifyClient: true,
    },
  });
  for (const item of followUps) {
    const milestone = item.reminderAt && item.reminderAt <= now ? "reminder" : item.dueDate < now ? "overdue" : "due";
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
      actionUrl: item.caseId ? caseUrl(item.caseId) : "/app/follow-ups",
      dedupeKey: `follow-up:${item.id}:${milestone}:${isoKey(item.reminderAt || item.dueDate)}`,
      scheduledFor: milestone === "due" ? item.dueDate : null,
    });
    if (item.notifyClient && item.clientId) {
      const channels = item.notificationChannels?.length ? item.notificationChannels : ["in_app"];
      await notifyUsers({
        agencyId: item.agencyId,
        recipientIds: await clientRecipientIds(item.agencyId, item.clientId),
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
      });
    }
  }
}

async function appointmentNotifications(now, horizon) {
  const appointmentHorizon = new Date(Math.min(horizon.getTime(), now.getTime() + 24 * 60 * 60_000));
  const appointments = await prisma.appointment.findMany({
    where: { status: "Scheduled", startsAt: { gt: now, lte: appointmentHorizon } },
    take: 500,
    select: { id: true, agencyId: true, clientId: true, caseId: true, assignedToId: true, subject: true, startsAt: true },
  });
  for (const item of appointments) {
    const minutes = Math.ceil((item.startsAt.getTime() - now.getTime()) / 60_000);
    const milestone = minutes <= 60 ? "1h" : "24h";
    const staff = new Set(await schedulingCoordinatorRecipientIds(item.agencyId));
    if (item.assignedToId) staff.add(item.assignedToId);
    const common = {
      agencyId: item.agencyId,
      type: "appointment.reminder",
      category: "appointments",
      title: `${item.subject} starts ${milestone === "1h" ? "within an hour" : "within 24 hours"}`,
      body: item.startsAt.toISOString(),
      severity: "warning",
      entityType: "appointment",
      entityId: item.id,
    };
    await notifyUsers({ ...common, recipientIds: [...staff], actionUrl: `/app/calendar?appointment=${encodeURIComponent(item.id)}&date=${item.startsAt.toISOString().slice(0, 10)}`, dedupeKey: `appointment:${item.id}:${milestone}:${isoKey(item.startsAt)}:staff` });
    await notifyUsers({ ...common, recipientIds: await clientRecipientIds(item.agencyId, item.clientId), actionUrl: "/client-portal", dedupeKey: `appointment:${item.id}:${milestone}:${isoKey(item.startsAt)}:client` });
  }
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
    });
  }
}

async function leadNotifications(now, horizon) {
  const consultationHorizon = new Date(Math.min(horizon.getTime(), now.getTime() + 24 * 60 * 60_000));
  const [followUps, leads, consultations] = await Promise.all([
    prisma.leadFollowUp.findMany({ where: { status: "PENDING", dueAt: { lte: horizon } }, take: 500, select: { id: true, agencyId: true, leadId: true, assignedUserId: true, description: true, dueAt: true } }),
    prisma.lead.findMany({ where: { status: { in: ["OPEN", "NURTURE"] }, OR: [{ firstContactDueAt: { lte: horizon }, firstContactAt: null }, { nextActionAt: { lte: horizon } }, { nurtureUntil: { lte: now } }] }, take: 500, select: { id: true, agencyId: true, leadNumber: true, ownerUserId: true, nextActionOwnerId: true, firstContactDueAt: true, firstContactAt: true, nextActionAt: true, nurtureUntil: true } }),
    prisma.leadConsultation.findMany({ where: { status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] }, startAt: { gt: now, lte: consultationHorizon } }, take: 500, select: { id: true, agencyId: true, leadId: true, consultantUserId: true, startAt: true } }),
  ]);
  for (const item of followUps) {
    const overdue = item.dueAt < now;
    await notifyUsers({ agencyId: item.agencyId, recipientIds: [item.assignedUserId], type: overdue ? "lead.follow_up_overdue" : "lead.follow_up_due", category: "leads", title: overdue ? "Lead follow-up overdue" : "Lead follow-up due soon", body: item.description, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: item.leadId, actionUrl: "/leads", dedupeKey: `lead-follow-up:${item.id}:${overdue ? "overdue" : "due"}:${isoKey(item.dueAt)}`, scheduledFor: overdue ? null : item.dueAt });
  }
  for (const lead of leads) {
    const recipientIds = [lead.nextActionOwnerId || lead.ownerUserId];
    if (!lead.firstContactAt && lead.firstContactDueAt && lead.firstContactDueAt <= horizon) {
      const overdue = lead.firstContactDueAt < now;
      await notifyUsers({ agencyId: lead.agencyId, recipientIds, type: overdue ? "lead.first_response_breached" : "lead.first_response_due", category: "leads", title: `${lead.leadNumber}: first response ${overdue ? "overdue" : "due soon"}`, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:first-response:${overdue ? "overdue" : "due"}:${isoKey(lead.firstContactDueAt)}`, scheduledFor: overdue ? null : lead.firstContactDueAt });
    }
    if (lead.nextActionAt && lead.nextActionAt <= horizon) {
      const overdue = lead.nextActionAt < now;
      await notifyUsers({ agencyId: lead.agencyId, recipientIds, type: overdue ? "lead.next_action_overdue" : "lead.next_action_due", category: "leads", title: `${lead.leadNumber}: next action ${overdue ? "overdue" : "due soon"}`, severity: overdue ? "critical" : "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:next-action:${overdue ? "overdue" : "due"}:${isoKey(lead.nextActionAt)}`, scheduledFor: overdue ? null : lead.nextActionAt });
    }
    if (lead.nurtureUntil && lead.nurtureUntil <= now) {
      await notifyUsers({ agencyId: lead.agencyId, recipientIds: [lead.ownerUserId], type: "lead.nurture_due", category: "leads", title: `${lead.leadNumber} is ready for reactivation`, severity: "warning", entityType: "lead", entityId: lead.id, actionUrl: "/leads", dedupeKey: `lead:${lead.id}:nurture:${isoKey(lead.nurtureUntil)}` });
    }
  }
  for (const item of consultations) {
    const milestone = item.startAt.getTime() - now.getTime() <= 60 * 60_000 ? "1h" : "24h";
    await notifyUsers({ agencyId: item.agencyId, recipientIds: [item.consultantUserId], type: "lead.consultation_reminder", category: "leads", title: `Lead consultation starts ${milestone === "1h" ? "within an hour" : "within 24 hours"}`, body: item.startAt.toISOString(), severity: "warning", entityType: "lead", entityId: item.leadId, actionUrl: "/leads", dedupeKey: `lead-consultation:${item.id}:${milestone}:${isoKey(item.startAt)}` });
  }
}

async function communicationSlaNotifications(now, horizon) {
  const conversations = await prisma.communicationConversation.findMany({
    where: { state: { in: ["Open", "WaitingOnAgency"] }, deletedAt: null, OR: [{ responseDueAt: { not: null, lte: horizon } }, { resolutionDueAt: { not: null, lte: horizon } }] },
    take: 500,
    select: { id: true, agencyId: true, caseId: true, assignedToId: true, subject: true, responseDueAt: true, resolutionDueAt: true },
  });
  for (const item of conversations) {
    const recipients = item.assignedToId ? [item.assignedToId] : await internalCaseRecipientIds(item.agencyId, item.caseId);
    for (const [kind, dueAt] of [["response", item.responseDueAt], ["resolution", item.resolutionDueAt]]) {
      if (!dueAt || dueAt > horizon) continue;
      const overdue = dueAt < now;
      await notifyUsers({ agencyId: item.agencyId, recipientIds: recipients.length ? recipients : await adminRecipientIds(item.agencyId), type: `communication.${kind}_${overdue ? "breached" : "due"}`, category: "communications", title: `${kind === "response" ? "Response" : "Resolution"} ${overdue ? "SLA breached" : "due soon"}: ${item.subject || "client conversation"}`, severity: overdue ? "critical" : "warning", entityType: "conversation", entityId: item.id, actionUrl: caseUrl(item.caseId), dedupeKey: `conversation:${item.id}:${kind}:${overdue ? "overdue" : "due"}:${isoKey(dueAt)}`, scheduledFor: overdue ? null : dueAt });
    }
  }
}

export async function runNotificationScheduler(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
    await taskNotifications(now, horizon);
    await followUpNotifications(now, horizon);
    await appointmentNotifications(now, horizon);
    await documentNotifications(now, horizon);
    await questionnaireNotifications(now, horizon);
    await leadNotifications(now, horizon);
    await communicationSlaNotifications(now, horizon);
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
