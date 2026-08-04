import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { clientRecipientIds, notifyUsers } from "./notificationService.js";
import { logger } from "./logger.js";
import { runExpiringDocumentReminderPass } from "./expiringDocumentReminderService.js";

const DAY_MS = 86_400_000;
const POLL_MS = Math.max(Number(process.env.AUTOMATED_REMINDER_INTERVAL_MS) || 15 * 60_000, 60_000);
let timer = null;
let running = false;

export const AUTOMATED_REMINDER_KINDS = ["Invoice", "Document", "Agreement", "Questionnaire"];
export const AUTOMATED_REMINDER_PLACEHOLDERS = ["clientName", "agencyName", "itemName", "dueDate", "portalLink", "reminderNumber", "maxReminders"];

export const AUTOMATED_REMINDER_DEFAULTS = {
  Invoice: {
    subjectTemplate: "Payment reminder — {{itemName}}",
    messageTemplate: "Hello {{clientName}},\n\nThis is reminder {{reminderNumber}} of {{maxReminders}} that {{itemName}} remains outstanding. It was due on {{dueDate}}.\n\nYou can review payment details here: {{portalLink}}\n\n{{agencyName}}",
    smsTemplate: "{{agencyName}}: Payment reminder for {{itemName}}, due {{dueDate}}. View: {{portalLink}}",
  },
  Document: {
    subjectTemplate: "Document reminder — {{itemName}}",
    messageTemplate: "Hello {{clientName}},\n\nWe are still waiting for {{itemName}}. It was due on {{dueDate}}.\n\nPlease upload it securely here: {{portalLink}}\n\n{{agencyName}}",
    smsTemplate: "{{agencyName}}: Please upload {{itemName}}, due {{dueDate}}. Upload: {{portalLink}}",
  },
  Agreement: {
    subjectTemplate: "Signature reminder — {{itemName}}",
    messageTemplate: "Hello {{clientName}},\n\nYour signature is still required for {{itemName}}. Please review and sign it by {{dueDate}}.\n\nOpen the agreement here: {{portalLink}}\n\n{{agencyName}}",
    smsTemplate: "{{agencyName}}: Your signature is required for {{itemName}}. Review: {{portalLink}}",
  },
  Questionnaire: {
    subjectTemplate: "Questionnaire reminder — {{itemName}}",
    messageTemplate: "Hello {{clientName}},\n\nYour questionnaire, {{itemName}}, is still outstanding and was due on {{dueDate}}.\n\nContinue it here: {{portalLink}}\n\n{{agencyName}}",
    smsTemplate: "{{agencyName}}: Please complete {{itemName}}, due {{dueDate}}. Continue: {{portalLink}}",
  },
};

const portalPath = {
  Invoice: "/client-portal/payments",
  Document: "/client-portal/documents",
  Agreement: "/client-portal/documents",
  Questionnaire: "/client-portal/questionnaires",
};

const labelFor = {
  Invoice: "Invoice",
  Document: "Document",
  Agreement: "Agreement",
  Questionnaire: "Questionnaire",
};

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function fillAutomatedReminderTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key] ?? "") : match
  ));
}

export function effectiveReminderDueAt(explicitDueAt, originAt, defaultDueDays) {
  const explicit = explicitDueAt ? new Date(explicitDueAt) : null;
  if (explicit && !Number.isNaN(explicit.getTime())) return explicit;
  const origin = new Date(originAt);
  return new Date(origin.getTime() + defaultDueDays * DAY_MS);
}

function previewValues(kind, policy, agencyName = "Your immigration practice") {
  const due = new Date(Date.now() + 30 * DAY_MS).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
  return {
    clientName: "Alex Morgan",
    agencyName,
    itemName: kind === "Invoice" ? "Invoice #1042" : kind === "Document" ? "Passport copy" : kind === "Agreement" ? "Immigration Service Agreement" : "Client information questionnaire",
    dueDate: due,
    portalLink: `${frontendBase()}${portalPath[kind]}`,
    reminderNumber: 1,
    maxReminders: policy.maxReminders,
  };
}

export function renderAutomatedReminderPreview(policy, agencyName) {
  const values = previewValues(policy.kind, policy, agencyName);
  return {
    subject: fillAutomatedReminderTemplate(policy.subjectTemplate, values),
    message: fillAutomatedReminderTemplate(policy.messageTemplate, values),
    sms: fillAutomatedReminderTemplate(policy.smsTemplate, values),
    sample: values,
  };
}

export async function ensureAutomatedReminderPolicies(agencyId) {
  await prisma.automatedReminderPolicy.createMany({
    data: AUTOMATED_REMINDER_KINDS.map((kind) => ({
      agencyId,
      kind,
      enabled: false,
      cadenceDays: 7,
      maxReminders: 3,
      defaultDueDays: 30,
      emailEnabled: true,
      smsEnabled: false,
      ...AUTOMATED_REMINDER_DEFAULTS[kind],
    })),
    skipDuplicates: true,
  });
  return prisma.automatedReminderPolicy.findMany({ where: { agencyId }, orderBy: { kind: "asc" } });
}

export async function automatedReminderSettings(agencyId) {
  const [policies, agency] = await Promise.all([
    ensureAutomatedReminderPolicies(agencyId),
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true } }),
  ]);
  const deliveryStats = await prisma.automatedReminderDelivery.groupBy({
    by: ["policyId"],
    where: { agencyId, status: "sent" },
    _count: { _all: true },
    _max: { sentAt: true },
  });
  const stats = new Map(deliveryStats.map((item) => [item.policyId, item]));
  return {
    policies: policies.map((policy) => ({
      ...policy,
      sentCount: stats.get(policy.id)?._count?._all || 0,
      lastSentAt: stats.get(policy.id)?._max?.sentAt || null,
      preview: renderAutomatedReminderPreview(policy, agency?.legalName || agency?.name),
    })),
    placeholders: AUTOMATED_REMINDER_PLACEHOLDERS,
  };
}

function targetValues(target, policy, agencyName, sequence, effectiveDueAt) {
  return {
    clientName: target.client.fullName || "there",
    agencyName,
    itemName: target.itemName,
    dueDate: effectiveDueAt.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }),
    portalLink: `${frontendBase()}${portalPath[policy.kind]}`,
    reminderNumber: sequence,
    maxReminders: policy.maxReminders,
  };
}

async function outstandingTargets(policy, now) {
  const common = { agencyId: policy.agencyId };
  let rows = [];
  if (policy.kind === "Invoice") {
    rows = await prisma.caseInvoice.findMany({
      where: { ...common, balance: { gt: 0 }, status: { notIn: ["Paid", "Void", "Voided", "Cancelled"] } },
      take: 500,
      select: { id: true, description: true, qbInvoiceNumber: true, dueDate: true, createdAt: true, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    return rows.map((row) => ({ ...row, clientId: row.client.id, itemName: row.qbInvoiceNumber ? `Invoice #${row.qbInvoiceNumber}` : row.description, explicitDueAt: row.dueDate, originAt: row.createdAt }));
  }
  if (policy.kind === "Document") {
    rows = await prisma.clientDocument.findMany({
      where: { ...common, visibility: "Client", status: { in: ["Requested", "ChangesRequested"] } },
      take: 500,
      select: { id: true, documentName: true, dueAt: true, createdAt: true, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    return rows.map((row) => ({ ...row, clientId: row.client.id, itemName: row.documentName, explicitDueAt: row.dueAt, originAt: row.createdAt }));
  }
  if (policy.kind === "Agreement") {
    rows = await prisma.writtenDocument.findMany({
      where: { ...common, correspondenceKind: "Agreement", correspondenceStatus: "Issued" },
      take: 500,
      select: { id: true, title: true, issuedAt: true, createdAt: true, client: { select: { id: true, fullName: true, email: true, phone: true } } },
    });
    return rows.map((row) => ({ ...row, clientId: row.client.id, itemName: row.title, explicitDueAt: null, originAt: row.issuedAt || row.createdAt }));
  }
  rows = await prisma.questionnaireAssignment.findMany({
    where: { ...common, sharing: "Shared", locked: false, status: { notIn: ["Submitted", "Completed"] } },
    take: 500,
    select: { id: true, name: true, dueAt: true, assignedAt: true, client: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  return rows.map((row) => ({ ...row, clientId: row.client.id, itemName: row.name, explicitDueAt: row.dueAt, originAt: row.assignedAt }));
}

async function deliverReminder({ policy, delivery, target, agencyName, effectiveDueAt }) {
  const values = targetValues(target, policy, agencyName, delivery.sequence, effectiveDueAt);
  const successes = [];
  const failures = [];
  const update = {};

  if (policy.emailEnabled && target.client.email) {
    try {
      const config = await resolveAgencyMailConfig(policy.agencyId);
      const message = fillAutomatedReminderTemplate(policy.messageTemplate, values);
      await createMailTransport(config).sendMail({
        from: config.from,
        to: target.client.email,
        subject: fillAutomatedReminderTemplate(policy.subjectTemplate, values),
        text: message,
        html: `<div style="max-width:560px;margin:0 auto;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.65"><div style="font-size:12px;color:#64748b;margin-bottom:18px">${escapeHtml(agencyName)}</div><div style="white-space:pre-wrap">${escapeHtml(message)}</div></div>`,
      });
      update.emailSentAt = new Date();
      successes.push("email");
    } catch (error) {
      failures.push(`Email: ${error.message}`);
    }
  }

  if (policy.smsEnabled && target.client.phone) {
    try {
      await sendAgencyOomaSms({
        agencyId: policy.agencyId,
        to: target.client.phone,
        body: fillAutomatedReminderTemplate(policy.smsTemplate, values).slice(0, 500),
        idempotencyKey: `automated-reminder:${delivery.id}:sms`,
      });
      update.smsSentAt = new Date();
      successes.push("sms");
    } catch (error) {
      failures.push(`SMS: ${error.message}`);
    }
  }

  try {
    const recipients = await clientRecipientIds(policy.agencyId, target.clientId);
    if (recipients.length) {
      await notifyUsers({
        agencyId: policy.agencyId,
        recipientIds: recipients,
        type: `automated_reminder.${policy.kind.toLowerCase()}`,
        category: policy.kind === "Questionnaire" ? "questionnaires" : policy.kind === "Invoice" ? "cases" : "documents",
        title: `${labelFor[policy.kind]} items need your attention`,
        body: `Latest reminder: ${target.itemName} · due ${values.dueDate}`,
        severity: "warning",
        entityType: "client",
        entityId: target.clientId,
        actionUrl: portalPath[policy.kind],
        channels: ["in_app"],
        dedupeKey: `client:${target.clientId}:${policy.kind.toLowerCase()}-reminders`,
        aggregate: true,
        attentionLevel: "action_required",
      });
      update.portalSentAt = new Date();
      successes.push("portal");
    }
  } catch (error) {
    failures.push(`Portal: ${error.message}`);
  }

  const sent = successes.length > 0;
  await prisma.automatedReminderDelivery.update({
    where: { id: delivery.id },
    data: {
      ...update,
      attempts: { increment: 1 },
      status: sent ? "sent" : "failed",
      sentAt: sent ? new Date() : null,
      nextAttemptAt: sent ? null : new Date(Date.now() + 60 * 60_000),
      lastError: failures.join(" · ").slice(0, 2000) || (sent ? null : "The client has no enabled delivery destination."),
    },
  });
}

async function processPolicy(policy, agencyName, now) {
  const targets = await outstandingTargets(policy, now);
  for (const target of targets) {
    const effectiveDueAt = effectiveReminderDueAt(target.explicitDueAt, target.originAt, policy.defaultDueDays);
    if (effectiveDueAt > now) continue;
    const sent = await prisma.automatedReminderDelivery.findMany({
      where: { policyId: policy.id, targetId: target.id, status: "sent" },
      select: { sequence: true },
      orderBy: { sequence: "desc" },
      take: 1,
    });
    const sequence = (sent[0]?.sequence || 0) + 1;
    if (sequence > policy.maxReminders) continue;
    const scheduledAt = new Date(effectiveDueAt.getTime() + (sequence - 1) * policy.cadenceDays * DAY_MS);
    if (scheduledAt > now) continue;

    let delivery = await prisma.automatedReminderDelivery.findUnique({
      where: { policyId_targetId_sequence: { policyId: policy.id, targetId: target.id, sequence } },
    });
    if (delivery?.status === "sent" || (delivery?.nextAttemptAt && delivery.nextAttemptAt > now)) continue;
    if (!delivery) {
      try {
        delivery = await prisma.automatedReminderDelivery.create({
          data: { agencyId: policy.agencyId, policyId: policy.id, targetId: target.id, clientId: target.clientId, sequence, effectiveDueAt },
        });
      } catch (error) {
        if (error?.code === "P2002") continue;
        throw error;
      }
    }
    await deliverReminder({ policy, delivery, target, agencyName, effectiveDueAt });
  }
}

export async function runAutomatedReminderPass(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    const policies = await prisma.automatedReminderPolicy.findMany({
      where: { enabled: true },
      include: { agency: { select: { name: true, legalName: true } } },
    });
    for (const policy of policies) {
      await processPolicy(policy, policy.agency.legalName || policy.agency.name || "CaseDesk", now).catch((error) => {
        logger.warn("automated_reminder.policy_failed", { agencyId: policy.agencyId, kind: policy.kind, reason: error.message });
      });
    }
    return { skipped: false, policies: policies.length };
  } finally {
    running = false;
  }
}

export function startAutomatedReminderWorker() {
  if (timer || process.env.AUTOMATED_REMINDER_ENABLED === "false") return timer;
  const run = () => void Promise.all([runAutomatedReminderPass(), runExpiringDocumentReminderPass()]).catch((error) => logger.warn("automated_reminder.worker_failed", { reason: error.message }));
  run();
  timer = setInterval(run, POLL_MS);
  timer.unref?.();
  return timer;
}

export function stopAutomatedReminderWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
