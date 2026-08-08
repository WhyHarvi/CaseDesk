import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { notifyUsers } from "./notificationService.js";
import { recordActivity } from "../utils/prismaCrud.js";

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

// Fix 4.1 — the email CaseDesk sends alongside portal delivery when a
// consultant/admin approves a retainer for signature. Portal delivery
// itself was already enforced (updateCorrespondenceStatus/
// changeCorrespondenceStatus requires a ClientUser portal link before an
// Agreement can be issued) — this closes the one gap the audit found:
// nothing actually emailed the client that something was waiting for them.
// Best-effort, mirroring paymentNotificationService's pattern: an
// unconfigured mailbox must never block the approval itself.
export async function notifyRetainerIssued({ agencyId, caseItem, document, actorUserId = null }) {
  const client = caseItem.client || (await prisma.client.findUnique({ where: { id: caseItem.clientId }, select: { fullName: true, email: true } }));
  if (!client?.email) return;
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true } });
  const portalLink = `${frontendBase()}/client-portal/documents`;
  const subject = `${agency?.name || "Your consultant"} — please sign your retainer agreement`;
  const body = `Hi ${client.fullName || "there"},

Your retainer agreement (${document.title}) is ready for your signature. Please sign in your client portal:

${portalLink}

${agency?.name || "CaseDesk"}`;

  try {
    const config = await resolveAgencyMailConfig(agencyId);
    const transport = createMailTransport(config);
    await transport.sendMail({
      from: config.from,
      to: client.email,
      subject,
      text: body,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;white-space:pre-wrap;max-width:520px;margin:0 auto;color:#0f172a">${body.replace(/\n/g, "<br/>")}</div>`,
    });
  } catch (error) {
    logger.warn("agreement_notification.email_skipped", { agencyId, documentId: document.id, reason: error.message });
  }

  try {
    const links = await prisma.clientUser.findMany({ where: { clientId: caseItem.clientId }, select: { userId: true } });
    const recipientIds = links.map((link) => link.userId);
    if (recipientIds.length) {
      await notifyUsers({
        agencyId,
        recipientIds,
        actorUserId,
        type: "correspondence.retainer_sent",
        category: "documents",
        title: "Retainer ready for signature",
        body: document.title,
        severity: "info",
        entityType: "writtenDocument",
        entityId: document.id,
        actionUrl: "/client-portal/documents",
        dedupeKey: `retainer-issued:${document.id}`,
      });
    }
  } catch (error) {
    logger.warn("agreement_notification.portal_notify_skipped", { agencyId, documentId: document.id, reason: error.message });
  }

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: caseItem.clientId,
    caseId: caseItem.id,
    action: "correspondence.retainer_sent",
    details: `${document.title} approved and sent to ${client.fullName || "client"} for signature`,
    entityType: "writtenDocument",
    entityId: document.id,
  });
}
