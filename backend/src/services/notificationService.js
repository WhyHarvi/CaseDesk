import prisma from "./prisma/client.js";
import {
  eligibleNotificationRecipientIds,
  notificationAudienceKey,
  NOTIFICATION_AUDIENCES,
} from "./notificationAccessService.js";

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
  "correspondence.status_updated",
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
  if (value.includes("payment") || value.includes("invoice") || value.includes("installment") || value.includes("refund") || value.includes("billing")) return "payments";
  if (value.includes("document") || value.includes("form")) return "documents";
  if (value.includes("appointment") || value.includes("consultation")) return "appointments";
  if (value.includes("communication") || value.includes("message") || value.includes("chat")) return "communications";
  if (value.includes("task") || value.includes("workflow") || value.includes("follow_up")) return "work";
  if (value.includes("questionnaire") || value.includes("assessment")) return "questionnaires";
  if (value.includes("member") || value.includes("password") || value.includes("settings")) return "security";
  return "cases";
}

export const SIDEBAR_DESTINATIONS = new Set([
  "leads",
  "calls",
  "leadIntake",
  "clients",
  "cases",
  "followUps",
  "calendar",
  "documents",
  "payments",
  "caseEasyImport",
  "settings",
  "portalHome",
  "portalDocuments",
  "portalForms",
  "portalAppointments",
  "portalPayments",
  "portalChat",
  "teamChat",
]);

function notificationPath(actionUrl) {
  try {
    return new URL(String(actionUrl || ""), "https://casedesk.local").pathname;
  } catch {
    return String(actionUrl || "").split("?")[0];
  }
}

export function destinationFromNotification({ destinationKey, actionUrl, category, type }) {
  if (SIDEBAR_DESTINATIONS.has(destinationKey)) return destinationKey;
  const path = notificationPath(actionUrl);
  if (path === "/app/cases" || path.startsWith("/app/cases/")) {
    if (category === "documents") return "documents";
    if (category === "appointments") return "calendar";
    if (category === "payments") return "payments";
    if (category === "work" && String(type || "").startsWith("follow_up.")) return "followUps";
    return "cases";
  }
  const routes = [
    ["/client-portal/documents", "portalDocuments"],
    ["/client-portal/questionnaires", "portalForms"],
    ["/client-portal/appointments", "portalAppointments"],
    ["/client-portal/payments", "portalPayments"],
    ["/client-portal/chat", "portalChat"],
    ["/team-chat", "teamChat"],
    ["/lead-intake", "leadIntake"],
    ["/leads", "leads"],
    ["/calls", "calls"],
    ["/app/clients", "clients"],
    ["/app/follow-ups", "followUps"],
    ["/app/calendar", "calendar"],
    ["/app/documents", "documents"],
    ["/app/payments", "payments"],
    ["/app/case-easy-import", "caseEasyImport"],
    ["/app/settings", "settings"],
    ["/client-portal", "portalHome"],
  ];
  const route = routes.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (route) return route[1];
  if (category === "leads") return "leads";
  if (category === "appointments") return "calendar";
  if (category === "documents") return "documents";
  if (category === "security") return "settings";
  if (category === "work" && String(type || "").startsWith("follow_up.")) return "followUps";
  return "cases";
}

export function caseTabFromNotification({ type, category, actionUrl }) {
  let requestedTab = "";
  try { requestedTab = new URL(String(actionUrl || ""), "https://casedesk.local").searchParams.get("tab") || ""; }
  catch { /* use the event classification below */ }
  const explicit = {
    reminders: "reminders",
    questionnaires: "questionnaires",
    documents: "documents",
    forms: "forms",
    tasks: "tasks",
    "agreements-letters": "agreementsLetters",
    appointments: "appointments",
    communication: "communication",
    billing: "billing",
    profile: "profile",
  }[requestedTab];
  if (explicit) return explicit;
  const value = String(type || "").toLowerCase();
  if (value.includes("questionnaire") || category === "questionnaires") return "questionnaires";
  if (value.includes("case_form") || value.includes("form.")) return "forms";
  if (value.includes("document") || category === "documents") return "documents";
  if (value.includes("appointment") || value.includes("consultation") || category === "appointments") return "appointments";
  if (value.includes("communication") || value.includes("message") || value.includes("chat") || category === "communications") return "communication";
  // follow_up.* shares the "work" category with task.*, so it must be
  // checked first — otherwise the category === "work" fallback below claims
  // every follow-up notification as the Tasks tab before this line runs.
  if (value.includes("follow_up") || value.includes("reminder")) return "reminders";
  if (value.includes("task") || value.includes("workflow") || category === "work") return "tasks";
  if (value.includes("correspondence") || value.includes("agreement") || value.includes("letter")) return "agreementsLetters";
  if (value.includes("payment") || value.includes("invoice") || value.includes("installment") || category === "payments") return "billing";
  return "profile";
}

const CASE_TAB_ID_TO_SLUG = {
  profile: "profile",
  reminders: "reminders",
  questionnaires: "questionnaires",
  documents: "documents",
  forms: "forms",
  tasks: "tasks",
  agreementsLetters: "agreements-letters",
  appointments: "appointments",
  communication: "communication",
  billing: "billing",
};

// Builds a case deep-link that lands on the tab a notification is actually
// about instead of always the Profile tab, and highlights the specific row
// when that tab's frontend workspace supports it (tasks, reminders,
// documents, billing today — see useFadingHighlight.js consumers). Tabs
// without row-highlight support yet still get routed to the correct tab.
export function caseNotificationActionUrl(caseId, { type, category, entityId } = {}) {
  const slug = CASE_TAB_ID_TO_SLUG[caseTabFromNotification({ type, category })] || "profile";
  const highlight = entityId ? `&highlight=${encodeURIComponent(entityId)}` : "";
  return `/app/cases/${caseId}?tab=${slug}${highlight}`;
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

export async function financialOperationsRecipientIds(agencyId) {
  const users = await prisma.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: { some: { agencyId, isActive: true } },
    },
    select: { id: true },
  });
  return eligibleNotificationRecipientIds({
    agencyId,
    recipientIds: users.map((item) => item.id),
    notification: {
      audienceKey: NOTIFICATION_AUDIENCES.FINANCE,
      category: "payments",
      destinationKey: "payments",
      actionUrl: "/app/payments",
    },
  });
}

export async function frontDeskRecipientIds(agencyId) {
  const users = await prisma.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: {
        some: { agencyId, isActive: true, role: "frontdesk" },
      },
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
  destinationKey = null,
  metadata = {},
  dedupeKey,
  includeActor = false,
  channels = null,
  scheduledFor = null,
  attentionLevel = null,
  aggregate = false,
  expiresAt = undefined,
  audienceKey = null,
}) {
  const uniqueRecipients = [...new Set((recipientIds || []).filter(Boolean))]
    .filter((id) => includeActor || id !== actorUserId);
  if (!uniqueRecipients.length) return [];

  const resolvedDestinationKey = destinationFromNotification({
    destinationKey,
    actionUrl,
    category,
    type,
  });
  const resolvedAudienceKey = notificationAudienceKey({
    audienceKey,
    type,
    category,
    actionUrl,
    destinationKey: resolvedDestinationKey,
    metadata,
  });
  const validIds = await eligibleNotificationRecipientIds({
    agencyId,
    recipientIds: uniqueRecipients,
    notification: {
      audienceKey: resolvedAudienceKey,
      type,
      category,
      actionUrl,
      destinationKey: resolvedDestinationKey,
      metadata,
    },
  });
  const storedMetadata = {
    ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {}),
    notificationAudience: resolvedAudienceKey,
  };
  const preferences = await preferencesFor(agencyId, validIds, category);
  const created = [];

  for (const recipientUserId of validIds) {
    const preference = preferences.get(recipientUserId);
    if (scheduledFor) {
      const dueAt = new Date(scheduledFor);
      const dueSoonMinutes = preference?.dueSoonMinutes || 1440;
      if (dueAt.getTime() > Date.now() + dueSoonMinutes * 60_000) continue;
    }
    let enabledChannels = channels || [
      ...(preference?.inAppEnabled === false ? [] : ["in_app"]),
      ...(preference?.emailEnabled ? ["email"] : []),
      ...(preference?.smsEnabled ? ["sms"] : []),
    ];
    const occurredAt = new Date();
    const resolvedAttentionLevel =
      attentionLevel === "action_required" || attentionLevel === "update"
        ? attentionLevel
        : ["critical", "warning"].includes(severity)
          ? "action_required"
          : "update";
    if (
      preference?.deliveryMode === "daily_digest" &&
      resolvedAttentionLevel === "update"
    ) {
      enabledChannels = enabledChannels.filter((channel) => channel === "in_app");
    }
    if (!enabledChannels.length) continue;
    const resolvedExpiry =
      expiresAt === null
        ? null
        : expiresAt
          ? new Date(expiresAt)
          : new Date(
              occurredAt.getTime() +
                (resolvedAttentionLevel === "action_required" ? 90 : 30) *
                  24 *
                  60 *
                  60_000,
            );
    const createData = {
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
      destinationKey: resolvedDestinationKey,
      metadata: storedMetadata,
      dedupeKey: clean(dedupeKey, 300),
      attentionLevel: resolvedAttentionLevel,
      lastOccurredAt: occurredAt,
      expiresAt: resolvedExpiry,
    };
    const notificationKey = {
      agencyId_recipientUserId_dedupeKey: {
        agencyId,
        recipientUserId,
        dedupeKey,
      },
    };
    const priorNotification = aggregate
      ? await prisma.notification.findUnique({
          where: notificationKey,
          select: { id: true, readAt: true, resolvedAt: true },
        })
      : null;
    const notification = await prisma.notification.upsert({
      where: notificationKey,
      create: createData,
      update: aggregate
        ? {
            actorUserId: createData.actorUserId,
            type: createData.type,
            title: createData.title,
            body: createData.body,
            severity: createData.severity,
            actionUrl: createData.actionUrl,
            destinationKey: createData.destinationKey,
            metadata: storedMetadata,
            attentionLevel: resolvedAttentionLevel,
            occurrenceCount: { increment: 1 },
            lastOccurredAt: occurredAt,
            expiresAt: resolvedExpiry,
            resolvedAt: null,
            dismissedAt: null,
            readAt: null,
          }
        : {},
    });
    const deliveryChannels = enabledChannels.filter((channel) => channel !== "in_app");
    if (deliveryChannels.length) {
      const rearmDelivery = Boolean(
        aggregate && priorNotification &&
          (priorNotification.readAt || priorNotification.resolvedAt),
      );
      await Promise.all(
        deliveryChannels.map((channel) =>
          prisma.notificationDelivery.upsert({
            where: {
              notificationId_channel: {
                notificationId: notification.id,
                channel,
              },
            },
            create: {
              agencyId,
              notificationId: notification.id,
              recipientUserId,
              channel,
            },
            update: rearmDelivery
              ? {
                  status: "pending",
                  attempts: 0,
                  availableAt: occurredAt,
                  sentAt: null,
                  deliveredAt: null,
                  failedAt: null,
                  providerId: null,
                  lastError: null,
                }
              : {},
          }),
        ),
      );
    }
    created.push(notification);
  }
  return created;
}

export async function resolveNotifications({
  agencyId,
  entityType,
  entityId,
  types = null,
  dedupeKeys = null,
  resolvedAt = new Date(),
}) {
  if (!agencyId) return 0;
  const where = {
      agencyId,
      resolvedAt: null,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(Array.isArray(types) && types.length ? { type: { in: types } } : {}),
      ...(Array.isArray(dedupeKeys) && dedupeKeys.length
        ? { dedupeKey: { in: dedupeKeys } }
        : {}),
  };
  const notifications = await prisma.notification.findMany({
    where,
    select: { id: true },
  });
  if (!notifications.length) return 0;
  const notificationIds = notifications.map((item) => item.id);
  const [result] = await prisma.$transaction([
    prisma.notification.updateMany({
      where: { id: { in: notificationIds }, resolvedAt: null },
      data: { resolvedAt, readAt: resolvedAt },
    }),
    prisma.notificationDelivery.updateMany({
      where: {
        notificationId: { in: notificationIds },
        status: { in: ["pending", "retry"] },
      },
      data: {
        status: "cancelled",
        lastError: "Cancelled because the notification was resolved",
      },
    }),
  ]);
  return result.count;
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
      actionUrl: caseNotificationActionUrl(caseId, { type: action, category: common.category, entityId: entityId || null }),
      dedupeKey: `activity:${id}:internal`,
    }));
  }
  const clientEventAllowed = action !== "correspondence.status_updated" || /marked (issued|finalized)/i.test(details || "");
  if (clientId && clientEventAllowed && isAllowed(action, CLIENT_ACTIONS)) {
    const documentEvent = action.includes("document");
    operations.push(notifyUsers({
      ...common,
      recipientIds: await clientRecipientIds(agencyId, clientId),
      actionUrl: "/client-portal",
      ...(documentEvent
        ? {
            title: "Your document checklist was updated",
            body: "Open Documents to review the latest requirements and statuses.",
            actionUrl: "/client-portal/documents",
            entityType: "client",
            entityId: clientId,
            dedupeKey: `client:${clientId}:document-checklist`,
            aggregate: true,
            attentionLevel: action.includes("created") ? "action_required" : "update",
          }
        : {
            dedupeKey: `activity:${id}:client`,
            attentionLevel: action.includes("updated") ? "action_required" : "update",
          }),
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
    await notifyUsers({ agencyId: event.agencyId, recipientIds: recipients.length ? recipients : await adminRecipientIds(event.agencyId), actorUserId: event.userId, type: event.action, category: "communications", title: `New client message${conversation?.subject ? `: ${conversation.subject}` : ""}`, body: event.details, severity: "warning", entityType: "conversation", entityId: event.conversationId, actionUrl: caseId ? `/app/cases/${caseId}` : `/app/clients/${clientId}?conversation=${event.conversationId}`, dedupeKey: `conversation:${event.conversationId}:unread:staff`, aggregate: true, attentionLevel: "action_required" });
  }
  if (failed) {
    const recipients = [...new Set([message?.senderUserId, ...(await adminRecipientIds(event.agencyId))].filter(Boolean))];
    await notifyUsers({ agencyId: event.agencyId, recipientIds: recipients, type: event.action, category: "communications", title: "Communication delivery failed", body: event.details, severity: "critical", entityType: "conversation", entityId: event.conversationId, actionUrl: caseId ? `/app/cases/${caseId}` : "/app/dashboard", dedupeKey: `conversation:${event.conversationId}:delivery-failed`, aggregate: true, attentionLevel: "action_required" });
  }
  if (outbound && message?.channel === "Chat" && message.direction === "Outbound" && clientId) {
    await notifyUsers({ agencyId: event.agencyId, recipientIds: await clientRecipientIds(event.agencyId, clientId), actorUserId: event.userId, type: "communication.staff_reply", category: "communications", title: "New message from your case team", body: event.details, severity: "info", entityType: "conversation", entityId: event.conversationId, actionUrl: "/client-portal/chat", dedupeKey: `conversation:${event.conversationId}:unread:client`, aggregate: true, attentionLevel: "action_required" });
  }
}

export function notificationTitle(action) {
  return titleFromAction(action);
}
