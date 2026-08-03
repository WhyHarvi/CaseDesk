import prisma from "./prisma/client.js";

const INTERNAL_CASE_ACTIONS = [
  "case.created",
  "case.updated",
  "case.permissions_updated",
  "case.closed",
  "case.archived",
  "case.unarchived",
  "case.deleted",
  "case.restored",
  "task.created",
  "task.updated",
  "task.status_updated",
  "task.cancelled",
  "workflow.step.updated",
  "follow_up.created",
  "follow_up.updated",
  "follow_up.cancelled",
  "appointment.created",
  "appointment.updated",
  "appointment.deleted",
  "client_document.file_uploaded",
  "client_document.file_replaced",
  "client_document.portal_uploaded",
  "questionnaire.portal_submitted",
  "correspondence.portal_signed",
  "client.portal_profile_updated",
  "communication.inbound_received",
  "communication.client_chat_received",
  "communication.portal_message_received",
  "case_form.review_comment_added",
  "case_form.review_comment_resolved",
  "case_form.review_comment_reopened",
  "case_form.status_changed",
  "case_form.finalized",
  "case_form.unlocked",
];

const CLIENT_ACTIONS = [
  "case.closed",
  "client_document.created",
  "client_document.status_changed",
  "client_document.finalized",
  "case.document_checklist.created",
  "case.document.reassigned",
  "case.document.unassigned",
  "correspondence.status_updated",
  "appointment.created",
  "appointment.updated",
  "appointment.deleted",
  "CLIENT_PORTAL_ACCESS_RESTORED",
  "CLIENT_PORTAL_ACCESS_REVOKED",
];

const ADMIN_ACTIONS = [
  "communication.inbound_unmatched",
  "settings.mail_test_failed",
  "settings.ooma_sms_test_failed",
  "settings.mail_disconnected",
  "settings.ooma_disconnected",
  "MEMBER_INVITATION_ACCEPTED",
  "AGENCY_ONBOARDING_COMPLETED",
];

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function titleFromAction(action) {
  return clean(action, 160)
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function categoryFromAction(action) {
  const value = action.toLowerCase();
  if (value.includes("lead")) return "leads";
  if (value.includes("document") || value.includes("form")) return "documents";
  if (value.includes("appointment") || value.includes("consultation")) return "appointments";
  if (value.includes("communication") || value.includes("message") || value.includes("chat")) return "communications";
  if (value.includes("task") || value.includes("workflow") || value.includes("follow_up")) return "work";
  if (value.includes("questionnaire") || value.includes("assessment")) return "questionnaires";
  if (value.includes("member") || value.includes("password") || value.includes("settings")) return "security";
  return "cases";
}

function isAllowed(action, list) {
  return list.some((candidate) => action === candidate || action.startsWith(`${candidate}.`));
}

export async function internalCaseRecipientIds(agencyId, caseId) {
  if (!caseId) return [];
  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId, deletedAt: null },
    select: {
      assignedUserId: true,
      assignments: {
        where: { status: "active" },
        select: { consultantUserId: true },
      },
    },
  });
  return [...new Set([
    caseItem?.assignedUserId,
    ...(caseItem?.assignments || []).map((item) => item.consultantUserId),
  ].filter(Boolean))];
}

export async function clientRecipientIds(agencyId, clientId) {
  if (!clientId) return [];
  const links = await prisma.clientUser.findMany({
    where: { agencyId, clientId, user: { status: "active" } },
    select: { userId: true },
  });
  return links.map((item) => item.userId);
}

export async function adminRecipientIds(agencyId) {
  const users = await prisma.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: { some: { agencyId, isActive: true, role: "admin" } },
    },
    select: { id: true },
  });
  return users.map((item) => item.id);
}

export async function schedulingCoordinatorRecipientIds(agencyId) {
  const users = await prisma.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "frontdesk"] } } },
    },
    select: { id: true },
  });
  return users.map((item) => item.id);
}

async function preferencesFor(agencyId, recipientIds, category) {
  const preferences = await prisma.notificationPreference.findMany({
    where: { agencyId, userId: { in: recipientIds }, category: { in: ["all", category] } },
    orderBy: { category: "asc" },
  });
  const result = new Map();
  for (const preference of preferences) {
    const current = result.get(preference.userId);
    if (!current || preference.category === category) result.set(preference.userId, preference);
  }
  return result;
}

export async function notifyUsers({
  agencyId,
  recipientIds,
  actorUserId = null,
  type,
  category = "cases",
  title,
  body = null,
  severity = "info",
  entityType = null,
  entityId = null,
  actionUrl = null,
  metadata = {},
  dedupeKey,
  includeActor = false,
  channels = null,
  scheduledFor = null,
}) {
  const uniqueRecipients = [...new Set((recipientIds || []).filter(Boolean))]
    .filter((id) => includeActor || id !== actorUserId);
  if (!uniqueRecipients.length) return [];

  const validUsers = await prisma.user.findMany({
    where: { id: { in: uniqueRecipients }, agencyId },
    select: { id: true },
  });
  const validIds = validUsers.map((item) => item.id);
  const preferences = await preferencesFor(agencyId, validIds, category);
  const created = [];

  for (const recipientUserId of validIds) {
    const preference = preferences.get(recipientUserId);
    if (scheduledFor) {
      const dueAt = new Date(scheduledFor);
      const dueSoonMinutes = preference?.dueSoonMinutes || 1440;
      if (dueAt.getTime() > Date.now() + dueSoonMinutes * 60_000) continue;
    }
    const enabledChannels = channels || [
      ...(preference?.inAppEnabled === false ? [] : ["in_app"]),
      ...(preference?.emailEnabled ? ["email"] : []),
      ...(preference?.smsEnabled ? ["sms"] : []),
    ];
    if (!enabledChannels.length) continue;

    const notification = await prisma.notification.upsert({
      where: {
        agencyId_recipientUserId_dedupeKey: { agencyId, recipientUserId, dedupeKey },
      },
      create: {
        agencyId,
        recipientUserId,
        actorUserId: actorUserId === recipientUserId ? null : actorUserId,
        type: clean(type, 120),
        category: clean(category, 80),
        title: clean(title, 180),
        body: clean(body, 2000) || null,
        severity: clean(severity, 30) || "info",
        entityType: clean(entityType, 80) || null,
        entityId: clean(entityId, 120) || null,
        actionUrl: clean(actionUrl, 500) || null,
        metadata,
        dedupeKey: clean(dedupeKey, 300),
      },
      update: {},
    });
    const deliveryChannels = enabledChannels.filter((channel) => channel !== "in_app");
    if (deliveryChannels.length) {
      await prisma.notificationDelivery.createMany({
        data: deliveryChannels.map((channel) => ({
          agencyId,
          notificationId: notification.id,
          recipientUserId,
          channel,
        })),
        skipDuplicates: true,
      });
    }
    created.push(notification);
  }
  return created;
}

export async function dispatchActivityNotification(activity) {
  const { agencyId, userId: actorUserId, clientId, caseId, action, details, entityType, entityId, metadata, id } = activity;
  const common = {
    agencyId,
    actorUserId,
    type: action,
    category: categoryFromAction(action),
    title: titleFromAction(action),
    body: details,
    entityType: entityType || (caseId ? "case" : clientId ? "client" : null),
    entityId: entityId || caseId || clientId || null,
    metadata: metadata || {},
  };

  const operations = [];
  if (caseId && isAllowed(action, INTERNAL_CASE_ACTIONS)) {
    const recipients = await internalCaseRecipientIds(agencyId, caseId);
    operations.push(notifyUsers({
      ...common,
      recipientIds: recipients.length ? recipients : await adminRecipientIds(agencyId),
      actionUrl: `/app/cases/${caseId}`,
      dedupeKey: `activity:${id}:internal`,
    }));
  }
  const clientEventAllowed = action !== "correspondence.status_updated" || /marked (issued|finalized)/i.test(details || "");
  if (clientId && clientEventAllowed && isAllowed(action, CLIENT_ACTIONS)) {
    operations.push(notifyUsers({
      ...common,
      recipientIds: await clientRecipientIds(agencyId, clientId),
      actionUrl: "/client-portal",
      dedupeKey: `activity:${id}:client`,
    }));
  }
  if (isAllowed(action, ADMIN_ACTIONS)) {
    operations.push(notifyUsers({
      ...common,
      recipientIds: await adminRecipientIds(agencyId),
      severity: action.includes("unmatched") || action.includes("disconnected") ? "warning" : "info",
      actionUrl: "/app/settings",
      dedupeKey: `activity:${id}:admin`,
    }));
  }
  await Promise.all(operations);
}

export async function dispatchCommunicationAuditNotification(event) {
  const inbound = ["communication.inbound_received", "communication.client_chat_received", "communication.portal_message_received"].includes(event.action);
  const failed = ["communication.failed", "communication.bounced"].includes(event.action);
  const outbound = ["communication.created", "communication.queued"].includes(event.action);
  if (!inbound && !failed && !outbound) return;
  const [conversation, message] = await Promise.all([
    event.conversationId ? prisma.communicationConversation.findUnique({ where: { id: event.conversationId }, select: { id: true, caseId: true, clientId: true, assignedToId: true, subject: true } }) : null,
    event.messageId ? prisma.communicationMessage.findUnique({ where: { id: event.messageId }, select: { id: true, caseId: true, clientId: true, senderUserId: true, channel: true, direction: true } }) : null,
  ]);
  const caseId = conversation?.caseId || message?.caseId;
  const clientId = conversation?.clientId || message?.clientId;
  if (inbound && (caseId || clientId)) {
    const recipients = conversation?.assignedToId
      ? [conversation.assignedToId]
      : caseId
        ? await internalCaseRecipientIds(event.agencyId, caseId)
        : await adminRecipientIds(event.agencyId);
    await notifyUsers({ agencyId: event.agencyId, recipientIds: recipients.length ? recipients : await adminRecipientIds(event.agencyId), actorUserId: event.userId, type: event.action, category: "communications", title: `New client message${conversation?.subject ? `: ${conversation.subject}` : ""}`, body: event.details, severity: "warning", entityType: "conversation", entityId: event.conversationId, actionUrl: caseId ? `/app/cases/${caseId}` : `/app/clients/${clientId}?conversation=${event.conversationId}`, dedupeKey: `communication-audit:${event.id}:internal` });
  }
  if (failed) {
    const recipients = [...new Set([message?.senderUserId, ...(await adminRecipientIds(event.agencyId))].filter(Boolean))];
    await notifyUsers({ agencyId: event.agencyId, recipientIds: recipients, type: event.action, category: "communications", title: "Communication delivery failed", body: event.details, severity: "critical", entityType: "message", entityId: event.messageId, actionUrl: caseId ? `/app/cases/${caseId}` : "/app/dashboard", dedupeKey: `communication-audit:${event.id}:failure` });
  }
  if (outbound && message?.channel === "Chat" && message.direction === "Outbound" && clientId) {
    await notifyUsers({ agencyId: event.agencyId, recipientIds: await clientRecipientIds(event.agencyId, clientId), actorUserId: event.userId, type: "communication.staff_reply", category: "communications", title: "New message from your case team", body: event.details, severity: "info", entityType: "message", entityId: event.messageId, actionUrl: "/client-portal/chat", dedupeKey: `communication-audit:${event.id}:client` });
  }
}

export function notificationTitle(action) {
  return titleFromAction(action);
}
