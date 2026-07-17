import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";
import prisma from "./prisma/client.js";

const INTERVAL_MS = Math.max(Number(process.env.NOTIFICATION_DELIVERY_INTERVAL_MS) || 15_000, 5_000);
let timer = null;
let running = false;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function preferenceFor(job) {
  return job.recipient.notificationPreferences.find((item) => item.category === job.notification.category)
    || job.recipient.notificationPreferences.find((item) => item.category === "all")
    || null;
}

function inQuietHours(preference, now) {
  if (!preference?.quietHoursStart || !preference?.quietHoursEnd) return false;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: preference.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const current = Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value || 0);
  const minutes = (value) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
  const start = minutes(preference.quietHoursStart);
  const end = minutes(preference.quietHoursEnd);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

async function deliver(job) {
  if (job.channel === "email") {
    const config = await resolveAgencyMailConfig(job.agencyId);
    const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
    const link = job.notification.actionUrl ? `${frontendUrl}${job.notification.actionUrl}` : frontendUrl;
    const result = await createMailTransport(config).sendMail({
      from: config.from,
      to: job.recipient.email,
      subject: job.notification.title,
      text: [job.notification.body, job.notification.actionUrl ? `Open CaseDesk: ${link}` : null].filter(Boolean).join("\n\n"),
      html: `<p>${escapeHtml(job.notification.body || job.notification.title)}</p>${job.notification.actionUrl ? `<p><a href="${escapeHtml(link)}">Open CaseDesk</a></p>` : ""}`,
    });
    return result.messageId || null;
  }
  if (job.channel === "sms") {
    if (!job.recipient.phone) throw new Error("Recipient has no phone number");
    const clientLinks = await prisma.clientUser.findMany({ where: { agencyId: job.agencyId, userId: job.recipientUserId }, select: { clientId: true } });
    if (clientLinks.length) {
      const consent = await prisma.communicationConsent.findFirst({ where: { agencyId: job.agencyId, clientId: { in: clientLinks.map((item) => item.clientId) }, channel: "Sms", address: job.recipient.phone, status: "Consented" }, select: { id: true } });
      if (!consent) throw new Error("Recipient has not consented to SMS notifications");
    }
    const result = await sendAgencyOomaSms({
      agencyId: job.agencyId,
      to: job.recipient.phone,
      body: [job.notification.title, job.notification.body].filter(Boolean).join(": ").slice(0, 1200),
      idempotencyKey: `notification-${job.id}`,
    });
    return result.id || null;
  }
  throw new Error(`Unsupported notification channel: ${job.channel}`);
}

export async function processNotificationDeliveries(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    const jobs = await prisma.notificationDelivery.findMany({
      where: { status: { in: ["pending", "retry"] }, availableAt: { lte: now } },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: {
        notification: true,
        recipient: { select: { id: true, email: true, phone: true, status: true, notificationPreferences: true } },
      },
    });
    for (const job of jobs) {
      if (inQuietHours(preferenceFor(job), now)) {
        await prisma.notificationDelivery.update({ where: { id: job.id }, data: { availableAt: new Date(now.getTime() + 15 * 60_000) } });
        continue;
      }
      const claimed = await prisma.notificationDelivery.updateMany({
        where: { id: job.id, status: { in: ["pending", "retry"] } },
        data: { status: "processing", attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        if (job.recipient.status !== "active") throw new Error("Recipient account is inactive");
        const providerId = await deliver(job);
        await prisma.notificationDelivery.update({
          where: { id: job.id },
          data: { status: "delivered", providerId, sentAt: new Date(), deliveredAt: new Date(), lastError: null },
        });
      } catch (error) {
        const attempts = job.attempts + 1;
        const final = attempts >= job.maxAttempts;
        await prisma.notificationDelivery.update({
          where: { id: job.id },
          data: {
            status: final ? "failed" : "retry",
            lastError: String(error?.message || "Notification delivery failed").slice(0, 2000),
            failedAt: final ? new Date() : null,
            availableAt: final ? now : new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60_000),
          },
        });
        if (final) {
          await notifyUsers({
            agencyId: job.agencyId,
            recipientIds: await adminRecipientIds(job.agencyId),
            type: "notification.delivery_failed",
            category: "security",
            title: "Notification delivery failed",
            body: `${job.channel} delivery failed after ${attempts} attempts: ${String(error?.message || "Unknown error").slice(0, 500)}`,
            severity: "warning",
            entityType: "notification",
            entityId: job.notificationId,
            actionUrl: "/app/settings",
            channels: ["in_app"],
            dedupeKey: `delivery:${job.id}:failed`,
          });
        }
      }
    }
    return { skipped: false, processed: jobs.length };
  } finally {
    running = false;
  }
}

export function startNotificationDeliveryWorker() {
  if (timer || process.env.NOTIFICATION_DELIVERY_ENABLED === "false") return timer;
  const run = () => void processNotificationDeliveries().catch((error) => console.error("Notification delivery worker failed", error));
  run();
  timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export function stopNotificationDeliveryWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
