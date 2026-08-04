import prisma from "../services/prisma/client.js";
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
]);

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
