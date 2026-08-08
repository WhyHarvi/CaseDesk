import prisma from "../services/prisma/client.js";
import { caseTabFromNotification, SIDEBAR_DESTINATIONS } from "../services/notificationService.js";
import { createHttpError } from "../utils/http.js";

const categories = new Set([
  "all",
  "cases",
  "leads",
  "documents",
  "appointments",
  "communications",
  "work",
  "questionnaires",
  "security",
  "payments",
  "clients",
]);

const CASE_TAB_KEYS = new Set([
  "profile",
  "reminders",
  "questionnaires",
  "documents",
  "forms",
  "tasks",
  "agreementsLetters",
  "appointments",
  "communication",
  "billing",
]);

export function focusedNotificationActionUrl(notification) {
  if (
    [
      "booking_payment.refund_unmatched",
      "booking_payment.refund_ambiguous",
    ].includes(notification?.type) &&
    notification.entityId
  ) {
    return `/app/payments?source=booking_payment&refund=${encodeURIComponent(notification.entityId)}`;
  }
  if (
    notification?.type === "booking_payment.orphaned" &&
    notification.entityId
  ) {
    return `/app/payments?source=booking_payment&hold=${encodeURIComponent(notification.entityId)}`;
  }
  if (
    notification?.type === "booking_payment.etransfer_pending" &&
    notification?.metadata?.appointmentId
  ) {
    return `/app/calendar?appointment=${encodeURIComponent(notification.metadata.appointmentId)}`;
  }
  if (notification?.entityType === "appointment" && notification.entityId) {
    return `/app/calendar?appointment=${encodeURIComponent(notification.entityId)}`;
  }
  if (
    notification?.entityType === "bookingPaymentHold" &&
    notification.entityId
  ) {
    return `/app/payments?source=booking_payment&hold=${encodeURIComponent(notification.entityId)}`;
  }
  if (notification?.entityType === "lead" && notification.entityId) {
    return `/leads?lead=${encodeURIComponent(notification.entityId)}`;
  }
  if (notification?.type === "lead.intake_failed" && notification.entityId) {
    return `/lead-intake?tab=events&event=${encodeURIComponent(notification.entityId)}`;
  }
  return notification?.actionUrl || null;
}

function activeNotificationWhere(req) {
  return {
    agencyId: req.auth.agencyId,
    recipientUserId: req.auth.userId,
    dismissedAt: null,
    resolvedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

function emptyCount() {
  return { updates: 0, actions: 0, total: 0, focus: null };
}

function addCount(target, key, kind, amount = 1) {
  if (!target[key]) target[key] = emptyCount();
  target[key][kind] += amount;
  target[key].total += amount;
}

function positiveInteger(value, fallback, maximum = 100) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function validTime(value, field) {
  if (value === null || value === "") return null;
  if (value === undefined) return undefined;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
    throw createHttpError(400, `${field} must use HH:mm format.`, "VALIDATION_ERROR");
  }
  return String(value);
}

async function ownNotification(req) {
  const notification = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      recipientUserId: req.auth.userId,
    },
  });
  if (!notification) throw createHttpError(404, "Notification not found.", "NOT_FOUND");
  return notification;
}

export async function listNotifications(req, res) {
  const page = positiveInteger(req.query.page, 1, 100000);
  const limit = positiveInteger(req.query.limit, 25, 100);
  const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
  const view = ["all", "action", "updates"].includes(req.query.view)
    ? req.query.view
    : "action";
  const now = new Date();
  const where = {
    agencyId: req.auth.agencyId,
    recipientUserId: req.auth.userId,
    dismissedAt: null,
    resolvedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    ...(view === "action"
      ? { attentionLevel: "action_required" }
      : view === "updates"
        ? { attentionLevel: "update" }
        : {}),
    ...(unreadOnly ? { readAt: null } : {}),
  };
  const [data, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { lastOccurredAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        type: true,
        category: true,
        title: true,
        body: true,
        severity: true,
        entityType: true,
        entityId: true,
        actionUrl: true,
        destinationKey: true,
        metadata: true,
        attentionLevel: true,
        occurrenceCount: true,
        lastOccurredAt: true,
        readAt: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true } },
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: {
        agencyId: req.auth.agencyId,
        recipientUserId: req.auth.userId,
        dismissedAt: null,
        readAt: null,
        resolvedAt: null,
        attentionLevel: "action_required",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
  ]);
  res.json({ data, meta: { page, limit, total, unread } });
}

export async function getUnreadNotificationCount(req, res) {
  const now = new Date();
  const unread = await prisma.notification.count({
    where: {
      agencyId: req.auth.agencyId,
      recipientUserId: req.auth.userId,
      dismissedAt: null,
      readAt: null,
      resolvedAt: null,
      attentionLevel: "action_required",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  res.json({ data: { unread } });
}

export async function getSidebarNotificationCounts(req, res) {
  const where = activeNotificationWhere(req);
  const [actionGroups, updateGroups, unreadActions, focusRows] = await Promise.all([
    prisma.notification.groupBy({
      by: ["destinationKey"],
      // Sidebar badges describe new/unseen work. Resolved actions remain in
      // the notification centre for follow-up, but must not permanently
      // inflate navigation badges after the user has reviewed the page.
      where: { ...where, attentionLevel: "action_required", readAt: null },
      _count: { _all: true },
    }),
    prisma.notification.groupBy({
      by: ["destinationKey"],
      where: { ...where, attentionLevel: "update", readAt: null },
      _count: { _all: true },
    }),
    prisma.notification.count({
      where: { ...where, attentionLevel: "action_required", readAt: null },
    }),
    prisma.notification.findMany({
      where: { ...where, readAt: null },
      distinct: ["destinationKey"],
      orderBy: [{ destinationKey: "asc" }, { lastOccurredAt: "desc" }],
      select: {
        destinationKey: true,
        type: true,
        title: true,
        body: true,
        actionUrl: true,
        entityType: true,
        entityId: true,
        attentionLevel: true,
        lastOccurredAt: true,
      },
    }),
  ]);
  const destinations = {};
  for (const group of actionGroups) addCount(destinations, group.destinationKey, "actions", group._count._all);
  for (const group of updateGroups) addCount(destinations, group.destinationKey, "updates", group._count._all);
  for (const row of focusRows) {
    if (!row.destinationKey || !destinations[row.destinationKey]) continue;
    const focusActionUrl = focusedNotificationActionUrl(row);
    destinations[row.destinationKey].focus = {
      type: row.type,
      title: row.title,
      body: row.body,
      actionUrl: focusActionUrl,
      entityType: row.entityType,
      entityId: row.entityId,
      attentionLevel: row.attentionLevel,
      lastOccurredAt: row.lastOccurredAt,
    };
  }

  const caseTabs = {};
  const caseId = String(req.query.caseId || "").trim();
  if (caseId) {
    const caseUrl = `/app/cases/${caseId}`;
    const rows = await prisma.notification.findMany({
      where: {
        ...where,
        readAt: null,
        actionUrl: { startsWith: caseUrl },
        AND: [{ OR: [
          { attentionLevel: "action_required" },
          { attentionLevel: "update" },
        ] }],
      },
      select: { type: true, category: true, actionUrl: true, attentionLevel: true },
    });
    for (const row of rows) {
      addCount(caseTabs, caseTabFromNotification(row), row.attentionLevel === "action_required" ? "actions" : "updates");
    }
  }

  const total = Object.values(destinations).reduce((sum, item) => sum + item.total, 0);
  res.json({ data: { unread: unreadActions, total, destinations, caseTabs } });
}

export async function markDestinationUpdatesRead(req, res) {
  const destinationKey = String(req.body?.destinationKey || "").trim();
  const caseId = String(req.body?.caseId || "").trim();
  const caseTabKey = String(req.body?.caseTabKey || "").trim();
  if (!SIDEBAR_DESTINATIONS.has(destinationKey)) {
    throw createHttpError(400, "Notification destination is invalid.", "VALIDATION_ERROR");
  }
  const where = {
    ...activeNotificationWhere(req),
    destinationKey,
    readAt: null,
  };
  let ids = null;
  if (caseId || caseTabKey) {
    if (!caseId || !CASE_TAB_KEYS.has(caseTabKey)) {
      throw createHttpError(400, "Case notification destination is invalid.", "VALIDATION_ERROR");
    }
    const rows = await prisma.notification.findMany({
      where: { ...where, actionUrl: { startsWith: `/app/cases/${caseId}` } },
      select: { id: true, type: true, category: true, actionUrl: true },
    });
    ids = rows.filter((row) => caseTabFromNotification(row) === caseTabKey).map((row) => row.id);
  }
  const result = ids && !ids.length
    ? { count: 0 }
    : await prisma.notification.updateMany({
        where: { ...where, ...(ids ? { id: { in: ids } } : {}) },
        data: { readAt: new Date() },
      });
  res.json({ data: { updated: result.count } });
}

export async function markNotificationRead(req, res) {
  const notification = await ownNotification(req);
  const read = req.body?.read !== false;
  const resolvesOnOpen =
    read &&
    req.auth.role === "client" &&
    (notification.type === "communication.staff_reply" ||
      (notification.category === "documents" &&
        notification.entityType === "client"));
  const data = await prisma.notification.update({
    where: { id: notification.id },
    data: {
      readAt: read ? notification.readAt || new Date() : null,
      ...(resolvesOnOpen ? { resolvedAt: new Date() } : {}),
    },
  });
  res.json({ data });
}

export async function markAllNotificationsRead(req, res) {
  const result = await prisma.notification.updateMany({
    where: {
      agencyId: req.auth.agencyId,
      recipientUserId: req.auth.userId,
      dismissedAt: null,
      readAt: null,
      resolvedAt: null,
    },
    data: { readAt: new Date() },
  });
  res.json({ data: { updated: result.count } });
}

export async function dismissNotification(req, res) {
  const notification = await ownNotification(req);
  const data = await prisma.notification.update({
    where: { id: notification.id },
    data: { dismissedAt: notification.dismissedAt || new Date(), readAt: notification.readAt || new Date() },
  });
  res.json({ data });
}

export async function getNotificationPreferences(req, res) {
  const data = await prisma.notificationPreference.findMany({
    where: { agencyId: req.auth.agencyId, userId: req.auth.userId },
    orderBy: { category: "asc" },
  });
  res.json({
    data: data.length ? data : [{
      category: "all",
      inAppEnabled: true,
      emailEnabled: false,
      smsEnabled: false,
      dueSoonMinutes: 1440,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: req.membership?.agency?.timezone || "America/Toronto",
      deliveryMode: "immediate",
      digestHour: 9,
    }],
  });
}

export async function updateNotificationPreferences(req, res) {
  const category = String(req.params.category || "all").trim().toLowerCase();
  if (!categories.has(category)) throw createHttpError(400, "Notification category is invalid.", "VALIDATION_ERROR");
  const dueSoonMinutes = req.body?.dueSoonMinutes === undefined ? undefined : Number(req.body.dueSoonMinutes);
  if (dueSoonMinutes !== undefined && (!Number.isInteger(dueSoonMinutes) || dueSoonMinutes < 5 || dueSoonMinutes > 10080)) {
    throw createHttpError(400, "dueSoonMinutes must be between 5 and 10080.", "VALIDATION_ERROR");
  }
  const timezone = req.body?.timezone === undefined ? undefined : String(req.body.timezone || "").trim().slice(0, 80);
  const deliveryMode = req.body?.deliveryMode === undefined
    ? undefined
    : String(req.body.deliveryMode || "").trim();
  if (deliveryMode !== undefined && !["immediate", "daily_digest"].includes(deliveryMode)) {
    throw createHttpError(400, "Notification delivery mode is invalid.", "VALIDATION_ERROR");
  }
  const digestHour = req.body?.digestHour === undefined ? undefined : Number(req.body.digestHour);
  if (digestHour !== undefined && (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23)) {
    throw createHttpError(400, "Digest hour must be between 0 and 23.", "VALIDATION_ERROR");
  }
  if (timezone !== undefined) {
    try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); }
    catch { throw createHttpError(400, "Timezone is invalid.", "VALIDATION_ERROR"); }
  }
  const data = {
    ...(typeof req.body?.inAppEnabled === "boolean" ? { inAppEnabled: req.body.inAppEnabled } : {}),
    ...(typeof req.body?.emailEnabled === "boolean" ? { emailEnabled: req.body.emailEnabled } : {}),
    ...(typeof req.body?.smsEnabled === "boolean" ? { smsEnabled: req.body.smsEnabled } : {}),
    ...(dueSoonMinutes !== undefined ? { dueSoonMinutes } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(deliveryMode !== undefined ? { deliveryMode } : {}),
    ...(digestHour !== undefined ? { digestHour } : {}),
    ...(req.body?.quietHoursStart !== undefined ? { quietHoursStart: validTime(req.body.quietHoursStart, "quietHoursStart") } : {}),
    ...(req.body?.quietHoursEnd !== undefined ? { quietHoursEnd: validTime(req.body.quietHoursEnd, "quietHoursEnd") } : {}),
  };
  const preference = await prisma.notificationPreference.upsert({
    where: { userId_category: { userId: req.auth.userId, category } },
    create: { agencyId: req.auth.agencyId, userId: req.auth.userId, category, ...data },
    update: data,
  });
  res.json({ data: preference });
}
