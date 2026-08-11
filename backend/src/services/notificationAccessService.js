import prisma from "./prisma/client.js";
import { normalizePortalAccess } from "./portalAccessService.js";

export const NOTIFICATION_AUDIENCES = Object.freeze({
  ADMINS: "admins",
  CLIENT_PORTAL: "client_portal",
  COMMUNICATIONS: "communications",
  DESTINATION: "destination",
  DOCUMENTS: "documents",
  FINANCE: "finance",
  LEADS: "leads",
  SCHEDULING: "scheduling",
  SECURITY: "security",
  WORK: "work",
});

const FINANCIAL_TYPES = new Set([
  "appointment.payment_requested",
  "payment.approval_required",
  "installment.voided",
  "quickbooks.sync_failed",
]);

const PORTAL_DESTINATIONS = new Set([
  "portalHome",
  "portalDocuments",
  "portalForms",
  "portalAppointments",
  "portalPayments",
  "portalChat",
]);

function clean(value) {
  return String(value || "").trim();
}

function notificationPath(actionUrl) {
  try {
    return new URL(clean(actionUrl), "https://casedesk.local").pathname;
  } catch {
    return clean(actionUrl).split("?")[0];
  }
}

function isFinancialType(type) {
  const value = clean(type).toLowerCase();
  return (
    FINANCIAL_TYPES.has(value) ||
    value.startsWith("booking_payment.") ||
    value.startsWith("quickbooks.") ||
    value.startsWith("payment.") ||
    value.startsWith("invoice.") ||
    value.startsWith("installment.")
  );
}

export function notificationAudienceKey({
  audienceKey,
  type,
  category,
  actionUrl,
  destinationKey,
  metadata,
} = {}) {
  const explicit = clean(
    audienceKey ||
      (metadata && typeof metadata === "object"
        ? metadata.notificationAudience
        : ""),
  );
  if (Object.values(NOTIFICATION_AUDIENCES).includes(explicit)) return explicit;

  const path = notificationPath(actionUrl);
  if (path.startsWith("/client-portal") || PORTAL_DESTINATIONS.has(destinationKey)) {
    return NOTIFICATION_AUDIENCES.CLIENT_PORTAL;
  }
  if (
    isFinancialType(type) ||
    category === "payments" ||
    metadata?.paidCancellationReview === true
  ) {
    return NOTIFICATION_AUDIENCES.FINANCE;
  }
  if (category === "appointments" || clean(type).startsWith("appointment.")) {
    return NOTIFICATION_AUDIENCES.SCHEDULING;
  }
  if (category === "documents" || category === "questionnaires") {
    return NOTIFICATION_AUDIENCES.DOCUMENTS;
  }
  if (category === "communications") return NOTIFICATION_AUDIENCES.COMMUNICATIONS;
  if (category === "work") return NOTIFICATION_AUDIENCES.WORK;
  if (category === "leads") return NOTIFICATION_AUDIENCES.LEADS;
  if (category === "security") return NOTIFICATION_AUDIENCES.SECURITY;
  return NOTIFICATION_AUDIENCES.DESTINATION;
}

function destinationAllowed(access, destinationKey) {
  switch (destinationKey) {
    case "leads":
    case "calls":
      return access.pages.leads === true;
    case "leadIntake":
      return access.pages.leadIntake === true;
    case "clients":
      return access.pages.clients === true;
    case "cases":
      return access.pages.cases === true;
    case "followUps":
      return (
        access.pages.followUps === true ||
        access.caseTabs.reminders === true ||
        access.caseTabs.tasks === true
      );
    case "calendar":
      return access.pages.calendar === true || access.caseTabs.appointments === true;
    case "documents":
      return (
        access.pages.documents === true ||
        access.caseTabs.documents === true ||
        access.caseTabs.forms === true ||
        access.caseTabs.agreementsLetters === true
      );
    case "payments":
      return access.pages.payments === true && access.capabilities.financialData === true;
    case "caseEasyImport":
      return access.pages.caseEasyImport === true;
    case "settings":
    case "teamChat":
    case "":
      return true;
    default:
      return !PORTAL_DESTINATIONS.has(destinationKey);
  }
}

export function notificationAllowedForMembership(
  { role, permissions } = {},
  notification = {},
) {
  const destinationKey = clean(notification.destinationKey);
  const audience = notificationAudienceKey(notification);
  if (role === "admin") return audience !== NOTIFICATION_AUDIENCES.CLIENT_PORTAL;
  if (role === "client") {
    return (
      audience === NOTIFICATION_AUDIENCES.CLIENT_PORTAL &&
      (PORTAL_DESTINATIONS.has(destinationKey) ||
        notificationPath(notification.actionUrl).startsWith("/client-portal"))
    );
  }
  if (!["consultant", "frontdesk"].includes(role)) return false;

  const access = normalizePortalAccess(
    role,
    permissions?.portalAccess,
    permissions || {},
  );
  const audienceAllowed =
    audience === NOTIFICATION_AUDIENCES.ADMINS
      ? false
      : audience === NOTIFICATION_AUDIENCES.FINANCE
        ? access.pages.payments === true &&
          access.capabilities.financialData === true
        : audience === NOTIFICATION_AUDIENCES.SCHEDULING
          ? access.pages.calendar === true ||
            access.caseTabs.appointments === true
          : audience === NOTIFICATION_AUDIENCES.DOCUMENTS
            ? access.pages.documents === true ||
              access.caseTabs.documents === true ||
              access.caseTabs.forms === true ||
              access.caseTabs.agreementsLetters === true ||
              access.caseTabs.questionnaires === true
            : audience === NOTIFICATION_AUDIENCES.COMMUNICATIONS
              ? access.caseTabs.communication === true
              : audience === NOTIFICATION_AUDIENCES.WORK
                ? access.pages.followUps === true ||
                  access.caseTabs.reminders === true ||
                  access.caseTabs.tasks === true
                : audience === NOTIFICATION_AUDIENCES.LEADS
                  ? access.pages.leads === true || access.pages.leadIntake === true
                  : audience !== NOTIFICATION_AUDIENCES.CLIENT_PORTAL;

  return audienceAllowed && destinationAllowed(access, destinationKey);
}

export async function eligibleNotificationRecipientIds({
  agencyId,
  recipientIds,
  notification,
}) {
  const uniqueIds = [...new Set((recipientIds || []).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const users = await prisma.user.findMany({
    where: {
      id: { in: uniqueIds },
      agencyId,
      status: "active",
      memberships: { some: { agencyId, isActive: true } },
    },
    select: {
      id: true,
      memberships: {
        where: { agencyId, isActive: true },
        select: { role: true, permissions: true },
        take: 1,
      },
    },
  });
  return users
    .filter((user) =>
      notificationAllowedForMembership(user.memberships[0], notification),
    )
    .map((user) => user.id);
}

const accessReconciliationCache = new Map();

function accessSignature(role, permissions) {
  return JSON.stringify({ role, portalAccess: permissions?.portalAccess || null });
}

export async function reconcileNotificationAccessForUser({
  agencyId,
  userId,
  role,
  permissions,
  force = false,
}) {
  if (!agencyId || !userId || !role) return 0;
  const cacheKey = `${agencyId}:${userId}`;
  const signature = accessSignature(role, permissions);
  if (!force && accessReconciliationCache.get(cacheKey) === signature) return 0;

  const notifications = await prisma.notification.findMany({
    where: {
      agencyId,
      recipientUserId: userId,
      dismissedAt: null,
      resolvedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      id: true,
      type: true,
      category: true,
      actionUrl: true,
      destinationKey: true,
      metadata: true,
    },
    take: 5000,
  });
  const invalidIds = notifications
    .filter(
      (notification) =>
        !notificationAllowedForMembership(
          { role, permissions },
          notification,
        ),
    )
    .map((notification) => notification.id);

  if (invalidIds.length) {
    const resolvedAt = new Date();
    await prisma.$transaction([
      prisma.notification.updateMany({
        where: { id: { in: invalidIds }, resolvedAt: null },
        data: { resolvedAt, readAt: resolvedAt },
      }),
      prisma.notificationDelivery.updateMany({
        where: {
          notificationId: { in: invalidIds },
          status: { in: ["pending", "retry"] },
        },
        data: {
          status: "cancelled",
          lastError: "Cancelled because the recipient no longer has access",
        },
      }),
    ]);
  }
  accessReconciliationCache.set(cacheKey, signature);
  return invalidIds.length;
}

export function clearNotificationAccessReconciliation(agencyId, userId) {
  if (agencyId && userId) {
    accessReconciliationCache.delete(`${agencyId}:${userId}`);
  }
}
