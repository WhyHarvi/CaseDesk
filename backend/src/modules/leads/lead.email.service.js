import { randomUUID } from "node:crypto";
import prisma from "../../services/prisma/client.js";
import { requireCommunicationPermission } from "../../services/communicationPermissions.js";
import { sendEmailMessage } from "../../services/communicationProviderService.js";
import { logger } from "../../services/logger.js";
import { createHttpError } from "../../utils/http.js";
import { requireLead } from "./lead.repository.js";

const EMAIL_SUBJECT_MAX_WORDS = 10;

function clean(value, max) {
  const result = String(value || "").trim();
  if (result.length > max) throw createHttpError(400, "Email content is too long.", "VALIDATION_ERROR");
  return result;
}

function addresses(value) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => clean(item, 320)).filter(Boolean);
}

export async function sendLeadEmail(req, dependencies = {}) {
  const db = dependencies.db || prisma;
  const assertPermission = dependencies.requirePermission || requireCommunicationPermission;
  const deliver = dependencies.sendEmail || sendEmailMessage;
  await assertPermission(req, "canSendEmail");

  const lead = await requireLead(db, req, req.params.id);
  if (["CONVERTED", "ARCHIVED"].includes(lead.status)) {
    throw createHttpError(409, "Open the client record to email this converted lead.", "LEAD_CLOSED");
  }
  if (!lead.email) throw createHttpError(400, "Add an email address to this lead first.", "LEAD_EMAIL_REQUIRED");

  const subject = clean(req.body?.subject, 300);
  const body = clean(req.body?.bodyText, 20_000);
  if (!subject) throw createHttpError(400, "Add a subject before sending this email.", "VALIDATION_ERROR");
  if (subject.split(/\s+/).filter(Boolean).length > EMAIL_SUBJECT_MAX_WORDS) {
    throw createHttpError(400, `Keep the subject to ${EMAIL_SUBJECT_MAX_WORDS} words or fewer.`, "VALIDATION_ERROR");
  }
  if (!body) throw createHttpError(400, "Write a message before sending this email.", "VALIDATION_ERROR");

  const cc = addresses(req.body?.cc);
  const bcc = addresses(req.body?.bcc);
  const replyTo = clean(req.body?.replyTo, 320) || null;
  const operationKey = clean(req.header?.("idempotency-key") || req.body?.idempotencyKey, 200) || randomUUID();
  const dedupeKey = `lead-manual-email:${lead.id}:${operationKey}`;
  const delivery = await db.leadMessageDelivery.upsert({
    where: { agencyId_dedupeKey: { agencyId: req.auth.agencyId, dedupeKey } },
    create: {
      agencyId: req.auth.agencyId,
      leadId: lead.id,
      kind: "MANUAL_EMAIL",
      channel: "email",
      recipient: lead.email,
      status: "pending",
      dedupeKey,
      subject,
      body,
      sourceChannel: "CHATS_EMAIL_COMPOSER",
      payload: { cc, bcc, replyTo, userId: req.auth.userId },
    },
    update: {},
  });
  if (delivery.status === "sent") return delivery;

  const claimed = await db.leadMessageDelivery.updateMany({
    where: { id: delivery.id, status: { in: ["pending", "failed"] } },
    data: { status: "sending", attempts: { increment: 1 }, failedAt: null, lastError: null },
  });
  if (!claimed.count) throw createHttpError(409, "This email is already being sent.", "EMAIL_SEND_IN_PROGRESS");

  try {
    const result = await deliver({
      agencyId: req.auth.agencyId,
      userId: req.auth.userId,
      to: [lead.email],
      cc,
      bcc,
      replyTo,
      subject,
      text: body,
    });
    const sentAt = new Date();
    const sent = await db.leadMessageDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "sent",
        sentAt,
        provider: result?.provider || "Email",
        providerId: result?.id ? String(result.id) : null,
        lastError: null,
      },
    });
    try {
      await db.$transaction(async (tx) => {
        await tx.leadActivity.create({
          data: {
            agencyId: req.auth.agencyId,
            leadId: lead.id,
            activityType: "EMAIL_SENT",
            direction: "OUTBOUND",
            channel: "EMAIL",
            title: `Email sent: ${subject}`,
            description: body,
            performedById: req.auth.userId,
            externalId: delivery.id,
            metadata: { deliveryId: delivery.id, kind: "MANUAL_EMAIL" },
          },
        });
        const nextStage = ["NEW", "ASSIGNED"].includes(lead.stage) ? "CONTACTING" : lead.stage;
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            firstContactAt: lead.firstContactAt || sentAt,
            lastContactAt: sentAt,
            ...(nextStage !== lead.stage ? { stage: nextStage } : {}),
            version: { increment: 1 },
          },
        });
        if (nextStage !== lead.stage) {
          await tx.leadStageHistory.create({
            data: { agencyId: req.auth.agencyId, leadId: lead.id, previousStage: lead.stage, newStage: nextStage, changedById: req.auth.userId, reason: "Email sent" },
          });
        }
        await tx.activityLog.create({
          data: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: "lead.email_sent", details: `${lead.leadNumber}: ${subject}`, entityType: "lead", entityId: lead.id, metadata: { deliveryId: delivery.id } },
        });
      });
    } catch (auditError) {
      logger.warn("lead.manual_email_audit_failed", { agencyId: req.auth.agencyId, leadId: lead.id, deliveryId: delivery.id, reason: auditError.message });
    }
    return sent;
  } catch (error) {
    await db.leadMessageDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", failedAt: new Date(), lastError: String(error?.message || "Email delivery failed").slice(0, 1000) },
    }).catch(() => {});
    throw error;
  }
}
