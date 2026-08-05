import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

const DEFAULT_EMAIL_SUBJECT = "New payment due — {{installmentLabel}}";
const DEFAULT_EMAIL_BODY = `Hi {{clientName}},

A new invoice has been created on your file: {{installmentLabel}}.

Amount due: {{amount}}
{{dueDateLine}}
{{paymentInstructionsLine}}

You can review this anytime in your client portal: {{portalLink}}

{{agencyName}}`;
const DEFAULT_SMS = "{{agencyName}}: {{installmentLabel}} — {{amount}} is now due. {{paymentInstructionsShort}}Details: {{portalLink}}";

export const PAYMENT_TEMPLATE_PLACEHOLDERS = [
  "clientName",
  "agencyName",
  "caseType",
  "installmentLabel",
  "amount",
  "dueDate",
  "paymentInstructions",
  "portalLink",
];

function fillTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (Object.hasOwn(values, key) ? values[key] : match));
}

function buildValues({ client, agency, caseItem, label, amount, dueDate, paymentInstructions }) {
  const formattedAmount = Number(amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  const formattedDueDate = dueDate ? new Date(dueDate).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }) : "";
  return {
    clientName: client.fullName || "there",
    agencyName: agency?.name || "CaseDesk",
    caseType: caseItem?.caseType || "your file",
    installmentLabel: label,
    amount: formattedAmount,
    dueDate: formattedDueDate,
    dueDateLine: formattedDueDate ? `Due date: ${formattedDueDate}` : "",
    paymentInstructions: paymentInstructions || "",
    paymentInstructionsLine: paymentInstructions ? `\nHow to pay: ${paymentInstructions}` : "",
    paymentInstructionsShort: paymentInstructions ? `${paymentInstructions.slice(0, 100)} ` : "",
    portalLink: `${frontendBase()}/client-portal/payments`,
  };
}

/**
 * Notifies a client that a real invoice now exists on their file, using the
 * agency's customized (or default) email/SMS wording and their configured
 * payment instructions. Best-effort on every channel — an unconfigured
 * mailbox or Ooma line must never block the invoice itself. Shared by both
 * schedule-triggered installments and manually-created invoices.
 */
async function notifyClientPaymentDue({ agencyId, clientId, caseId, caseInvoiceId, label, amount, dueDate, actorUserId, notificationType, dedupeKey }) {
  const [client, agency, caseItem, settings] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { fullName: true, email: true, phone: true } }),
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, paymentInstructions: true } }),
    prisma.case.findUnique({ where: { id: caseId }, select: { caseType: true } }),
    prisma.agencyPaymentNotificationSettings.findUnique({ where: { agencyId } }),
  ]);
  if (!client) return;

  const notifyByEmail = settings?.notifyByEmail ?? true;
  const notifyBySms = settings?.notifyBySms ?? false;
  const values = buildValues({ client, agency, caseItem, label, amount, dueDate, paymentInstructions: agency?.paymentInstructions });

  if (notifyByEmail && client.email) {
    try {
      const config = await resolveAgencyMailConfig(agencyId);
      const transport = createMailTransport(config);
      const subject = fillTemplate(settings?.emailSubjectTemplate || DEFAULT_EMAIL_SUBJECT, values);
      const body = fillTemplate(settings?.emailBodyTemplate || DEFAULT_EMAIL_BODY, values);
      await transport.sendMail({
        from: config.from,
        to: client.email,
        subject,
        text: body,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;white-space:pre-wrap;max-width:520px;margin:0 auto;color:#0f172a">${body.replace(/\n/g, "<br/>")}</div>`,
      });
    } catch (error) {
      logger.warn("payment_notification.email_skipped", { agencyId, caseInvoiceId, reason: error.message });
    }
  }

  if (notifyBySms && client.phone) {
    try {
      const body = fillTemplate(settings?.smsTemplate || DEFAULT_SMS, values).slice(0, 320);
      await sendAgencyOomaSms({ agencyId, to: client.phone, body, idempotencyKey: `${dedupeKey}:sms` });
    } catch (error) {
      logger.warn("payment_notification.sms_skipped", { agencyId, caseInvoiceId, reason: error.message });
    }
  }

  try {
    const links = await prisma.clientUser.findMany({ where: { clientId }, select: { userId: true } });
    const recipientIds = links.map((link) => link.userId);
    if (recipientIds.length) {
      await notifyUsers({
        agencyId,
        recipientIds,
        actorUserId,
        type: notificationType,
        category: "payments",
        title: "New payment due",
        body: `${label} — ${values.amount}`,
        severity: "info",
        entityType: "caseInvoice",
        entityId: caseInvoiceId,
        actionUrl: "/client-portal/payments",
        dedupeKey,
      });
    }
  } catch (error) {
    logger.warn("payment_notification.portal_notify_skipped", { agencyId, caseInvoiceId, reason: error.message });
  }
}

export async function notifyInstallmentInvoiced({ agencyId, installment, actorUserId = null }) {
  await notifyClientPaymentDue({
    agencyId,
    clientId: installment.clientId,
    caseId: installment.caseId,
    caseInvoiceId: installment.caseInvoiceId,
    label: installment.label,
    amount: installment.amount,
    dueDate: installment.dueDate,
    actorUserId,
    notificationType: "installment.invoiced",
    dedupeKey: `installment-invoiced:${installment.id}`,
  });
}

/**
 * Notifies a client about an invoice created directly from the case billing
 * tab (not from a payment schedule) — keeps ad-hoc invoices on parity with
 * scheduled ones instead of only firing the in-app notification.
 */
export async function notifyInvoiceCreated({ agencyId, invoice, actorUserId = null }) {
  await notifyClientPaymentDue({
    agencyId,
    clientId: invoice.clientId,
    caseId: invoice.caseId,
    caseInvoiceId: invoice.id,
    label: invoice.description,
    amount: invoice.amount,
    dueDate: invoice.dueDate,
    actorUserId,
    notificationType: "invoice.created",
    dedupeKey: `invoice-created:${invoice.id}`,
  });
}

export async function notifyStaffInstallmentVoided({ agencyId, installment, actorUserId }) {
  try {
    const recipients = (await adminRecipientIds(agencyId)).filter((id) => id !== actorUserId);
    if (!recipients.length) return;
    await notifyUsers({
      agencyId,
      recipientIds: recipients,
      actorUserId,
      type: "installment.voided",
      category: "payments",
      title: "Payment installment voided",
      body: `${installment.label} was voided${installment.voidReason ? `: ${installment.voidReason}` : ""}`,
      severity: "warning",
      entityType: "casePaymentInstallment",
      entityId: installment.id,
      actionUrl: `/app/cases/${installment.caseId}?tab=billing`,
      dedupeKey: `installment-voided:${installment.id}`,
    });
  } catch (error) {
    logger.warn("payment_notification.void_notify_skipped", { agencyId, installmentId: installment.id, reason: error.message });
  }
}
