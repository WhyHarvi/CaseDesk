import webpush from "web-push";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { createHttpError } from "../utils/http.js";

function vapidConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  if (!vapidConfigured()) throw createHttpError(503, "Push notifications are not configured.", "PUSH_NOT_CONFIGURED");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  vapidReady = true;
}

export function pushEnabled() {
  return vapidConfigured();
}

// Called once per device/browser the moment the client grants permission —
// endpoint is the Push API's own unique subscription URL, so re-subscribing
// the same device (token refresh, permission re-granted) upserts in place
// rather than piling up duplicate rows.
export async function saveSubscription(agencyId, userId, subscription, userAgent) {
  ensureVapid();
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw createHttpError(400, "A valid push subscription is required.", "VALIDATION_ERROR");
  }
  return prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { agencyId, userId, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 500) || null },
    update: { agencyId, userId, p256dh, auth, userAgent: userAgent?.slice(0, 500) || null, lastSeenAt: new Date() },
  });
}

export async function removeSubscription(userId, endpoint) {
  if (!endpoint) return;
  // Scoped to userId too — a client can only ever remove their own
  // subscription, not guess another user's endpoint to delete it.
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function hasPushSubscription(userIds) {
  if (!userIds.length) return new Set();
  const rows = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return new Set(rows.map((row) => row.userId));
}

// One NotificationDelivery row covers every device a user has subscribed
// on — sends to all of them and only throws if every single one failed
// (so a stale phone subscription can't block delivery to an active one).
// A 404/410 from the push service means that specific subscription is
// gone for good (uninstalled, permission revoked) — deleted immediately
// rather than retried.
export async function sendWebPush(job) {
  ensureVapid();
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: job.recipientUserId },
  });
  if (!subscriptions.length) throw new Error("Recipient has no push subscription");

  const payload = JSON.stringify({
    title: job.notification.title,
    body: job.notification.body || "",
    url: job.notification.actionUrl || "/client-portal",
  });

  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
      ).catch(async (error) => {
        if ([404, 410].includes(error.statusCode)) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
        }
        throw error;
      }),
    ),
  );

  const delivered = results.filter((result) => result.status === "fulfilled");
  if (!delivered.length) {
    const reason = results[0]?.reason;
    logger.warn("web_push.all_subscriptions_failed", {
      agencyId: job.agencyId,
      recipientUserId: job.recipientUserId,
      subscriptionCount: subscriptions.length,
      reason: reason?.message,
    });
    throw new Error(reason?.message || "Push delivery failed for every subscribed device");
  }
  return `push:${delivered.length}/${subscriptions.length}`;
}
