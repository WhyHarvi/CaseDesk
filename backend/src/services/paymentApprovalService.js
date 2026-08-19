import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { notifyUsers, resolveNotifications } from "./notificationService.js";
import { invalidateDashboardCache } from "./dashboardCache.js";
import { assertNoLivePaymentApproval, recordWalkInManualPayment, updatePaidAppointmentPaymentDetails } from "./bookingPaymentHoldService.js";
import { ACCOUNTING_PROVIDERS, completeCashInvoiceRefund, createCaseInvoice, recordManualPayment } from "./caseInvoiceService.js";
import {
  normalizePaymentApprovalKey,
  PAYMENT_APPROVAL_STATUSES,
  postApprovedCashTransaction,
  validateStaffPayment,
} from "./paymentApprovalLedgerService.js";

const approvalInclude = {
  client: { select: { id: true, fullName: true, clientNumber: true } },
  case: { select: { id: true, caseType: true } },
  appointment: { select: { id: true, subject: true, startsAt: true, guestName: true } },
  caseInvoice: { select: { id: true, description: true, qbInvoiceNumber: true, amount: true, balance: true } },
  submittedBy: { select: { id: true, fullName: true, role: true } },
  reviewedBy: { select: { id: true, fullName: true } },
};

function safeText(value, length) {
  return String(value || "").trim().slice(0, length) || null;
}

async function notifyPaymentSubmitter(row, { type, title, body, severity = "info", attentionLevel = "update" }) {
  if (!row?.submittedById) return;
  const actionUrl = row.appointmentId
    ? `/app/calendar?appointment=${encodeURIComponent(row.appointmentId)}`
    : row.caseId
      ? `/app/cases/${encodeURIComponent(row.caseId)}?tab=billing`
      : "/app/payments";
  await notifyUsers({
    agencyId: row.agencyId,
    recipientIds: [row.submittedById],
    type,
    category: "payments",
    title,
    body,
    severity,
    attentionLevel,
    entityType: "paymentApproval",
    entityId: row.id,
    actionUrl,
    dedupeKey: `payment-approval:${row.id}:${type}`,
    channels: ["in_app"],
  }).catch(() => {});
}

async function targetContext(agencyId, values) {
  if (["appointment_payment", "appointment_payment_details"].includes(values.entryType)) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: values.appointmentId, agencyId },
      include: { paymentHold: { select: { amount: true } }, client: { select: { id: true } } },
    });
    if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
    if (values.clientId && appointment.clientId && appointment.clientId !== values.clientId) throw createHttpError(404, "Appointment not found for this client.", "NOT_FOUND");
    // A fresh payment submission (not an edit to an already-paid record's
    // details, which callers pass as "appointment_payment_details") must
    // not stack on top of one already awaiting review.
    if (values.entryType === "appointment_payment") {
      await assertNoLivePaymentApproval(agencyId, appointment.id);
    }
    const settings = appointment.paymentHold ? null : await prisma.bookingSettings.findUnique({ where: { agencyId }, select: { consultFeeAmount: true } });
    return {
      clientId: values.clientId || appointment.clientId,
      caseId: appointment.caseId,
      appointmentId: appointment.id,
      amount: values.amount ?? appointment.paymentHold?.amount ?? settings?.consultFeeAmount,
      existingPaid: appointment.paymentHold?.status === "Paid",
    };
  }
  if (values.entryType === "invoice_payment") {
    const invoice = await prisma.caseInvoice.findFirst({
      where: { id: values.caseInvoiceId || values.invoiceId, agencyId },
      include: { paymentApprovals: { where: { status: "Approved", method: "Cash" } } },
    });
    if (!invoice) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
    if (values.clientId && invoice.clientId !== values.clientId) throw createHttpError(404, "Invoice not found for this client.", "NOT_FOUND");
    const localCashPaid = invoice.accountingProvider === "QuickBooks" ? invoice.paymentApprovals.reduce((sum, item) => sum + Number(item.amount), 0) : 0;
    const effectiveBalance = Math.max(0, Number(invoice.balance) - localCashPaid);
    if (Number(values.amount) > effectiveBalance + 0.01) throw createHttpError(400, "The payment is greater than the outstanding invoice balance.", "VALIDATION_ERROR");
    return { clientId: invoice.clientId, caseId: invoice.caseId, caseInvoiceId: invoice.id, amount: values.amount };
  }
  if (values.entryType === "invoice_refund") {
    const invoice = await prisma.caseInvoice.findFirst({
      where: { id: values.caseInvoiceId || values.invoiceId, agencyId },
      include: { refunds: { where: { status: { in: ["Requested", "AwaitingQuickBooks", "Completed"] } } } },
    });
    if (!invoice) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
    if (values.clientId && invoice.clientId !== values.clientId) throw createHttpError(404, "Invoice not found for this client.", "NOT_FOUND");
    if (invoice.accountingProvider !== ACCOUNTING_PROVIDERS.CASH) throw createHttpError(409, "Only cash invoices are refunded through the approval queue.", "INVALID_STATE");
    if (["Void", "Voided"].includes(invoice.status)) throw createHttpError(409, "A void invoice cannot be refunded.", "INVALID_STATE");
    if (!safeText(values.description, 500)) throw createHttpError(400, "Add a reason for the refund.", "VALIDATION_ERROR");
    const collected = Math.max(0, Number(invoice.amount) - Number(invoice.balance));
    const committedRefunds = invoice.refunds.reduce((sum, item) => sum + Number(item.amount), 0);
    const refundable = Math.round((collected - committedRefunds) * 100) / 100;
    if (!Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0 || Number(values.amount) > refundable + 0.01) {
      throw createHttpError(400, "The refund is greater than the invoice's available balance.", "VALIDATION_ERROR");
    }
    return { clientId: invoice.clientId, caseId: invoice.caseId, caseInvoiceId: invoice.id, amount: values.amount };
  }
  if (values.entryType === "new_charge_payment") {
    const caseItem = await prisma.case.findFirst({ where: { id: values.caseId, agencyId, deletedAt: null }, select: { id: true, clientId: true } });
    if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
    if (values.clientId && caseItem.clientId !== values.clientId) throw createHttpError(404, "Case not found for this client.", "NOT_FOUND");
    const chargeAmount = Number(values.chargeAmount);
    const [category, billing] = await Promise.all([
      prisma.agencyFeeCategory.findFirst({ where: { agencyId, code: values.paymentType, isActive: true }, select: { kind: true } }),
      prisma.agencyBillingSettings.findUnique({ where: { agencyId }, select: { taxRatePercent: true } }),
    ]);
    const taxable = ["Professional", "Consultation"].includes(category?.kind);
    const invoiceTotal = Math.round(chargeAmount * (taxable ? 1 + Number(billing?.taxRatePercent ?? 13) / 100 : 1) * 100) / 100;
    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0 || Number(values.amount) > invoiceTotal + 0.01) {
      throw createHttpError(400, "The charge must cover the payment amount.", "VALIDATION_ERROR");
    }
    if (!safeText(values.description, 500) || !safeText(values.paymentType, 100)) {
      throw createHttpError(400, "A fee category and description are required.", "VALIDATION_ERROR");
    }
    return { clientId: caseItem.clientId, caseId: caseItem.id, amount: values.amount, chargeAmount };
  }
  throw createHttpError(400, "Choose an appointment, invoice, or new charge.", "VALIDATION_ERROR");
}

export async function submitPaymentApproval(agencyId, {
  entryType, method, amount, chargeAmount, paymentType, description,
  transactionReference, paymentDate, note, appointmentId, caseInvoiceId,
  invoiceId, caseId, actorUserId, sourceRole, idempotencyKey,
  clientId = null,
  overrideFreeConsultation = false,
}) {
  const context = await targetContext(agencyId, { entryType, amount, chargeAmount, paymentType, description, appointmentId, caseInvoiceId, invoiceId, caseId, clientId });
  const resolvedEntryType = entryType === "appointment_payment" && context.existingPaid ? "appointment_payment_details" : entryType;
  const validated = validateStaffPayment({ method, amount: context.amount, transactionReference, paymentDate });
  const key = normalizePaymentApprovalKey(idempotencyKey)
    || normalizePaymentApprovalKey(`${entryType}:${appointmentId || caseInvoiceId || invoiceId || caseId}:${method}:${validated.reference || validated.paymentDate.toISOString().slice(0, 10)}`);
  const row = await prisma.paymentApproval.upsert({
    where: { agencyId_idempotencyKey: { agencyId, idempotencyKey: key } },
    create: {
      agencyId,
      clientId: context.clientId || null,
      caseId: context.caseId || null,
      appointmentId: context.appointmentId || null,
      caseInvoiceId: context.caseInvoiceId || null,
      entryType: resolvedEntryType,
      method,
      amount: validated.numericAmount,
      chargeAmount: context.chargeAmount || null,
      paymentType: safeText(paymentType, 100),
      description: safeText(description, 500),
      transactionReference: validated.reference,
      paymentDate: validated.paymentDate,
      note: safeText(note, 500),
      status: PAYMENT_APPROVAL_STATUSES.pending,
      sourceRole,
      idempotencyKey: key,
      submittedById: actorUserId,
      result: overrideFreeConsultation ? { overrideFreeConsultation: true } : undefined,
    },
    update: {},
    include: approvalInclude,
  });

  if (row.status === PAYMENT_APPROVAL_STATUSES.pending && sourceRole === "frontdesk") {
    const admins = await prisma.user.findMany({ where: { agencyId, role: "admin", status: "active" }, select: { id: true } });
    await notifyUsers({
      agencyId,
      recipientIds: admins.map((item) => item.id),
      actorUserId,
      type: "payment.approval_required",
      category: "payments",
      title: "Payment needs approval",
      body: `${row.submittedBy.fullName} submitted a ${row.method === "ETransfer" ? "e-transfer" : row.method === "BankDraft" ? "bank draft" : row.method.toLowerCase()} payment of ${Number(row.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}.`,
      severity: "warning",
      attentionLevel: "action_required",
      entityType: "paymentApproval",
      entityId: row.id,
      actionUrl: `/app/payments?view=approvals&approval=${encodeURIComponent(row.id)}`,
      dedupeKey: `payment-approval:${row.id}:pending`,
      channels: ["in_app"],
    }).catch(() => {});
  }
  invalidateDashboardCache(agencyId);
  return row;
}

async function processApprovedPayment(row, actorUserId) {
  if (row.entryType === "appointment_payment_details") {
    const hold = await updatePaidAppointmentPaymentDetails(row.agencyId, {
      appointmentId: row.appointmentId,
      method: row.method,
      transactionReference: row.transactionReference,
      paymentDate: row.paymentDate.toISOString().slice(0, 10),
      actorUserId,
      actorRole: "admin",
      approvalId: row.id,
    });
    return { qbPaymentId: hold.qbPaymentId || null, result: { bookingPaymentHoldId: hold.id, appointmentId: row.appointmentId } };
  }
  if (row.entryType === "appointment_payment") {
    const existingHold = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId: row.appointmentId } });
    const paymentDate = row.paymentDate.toISOString().slice(0, 10);
    const matchingPartialSuccess = existingHold?.status === "Paid"
      && existingHold.paymentMethod === row.method
      && Number(existingHold.amount) === Number(row.amount)
      && String(existingHold.manualPaymentReference || "") === String(row.transactionReference || "")
      && existingHold.paidAt?.toISOString().slice(0, 10) === paymentDate;
    if (matchingPartialSuccess) {
      return { qbPaymentId: existingHold.qbPaymentId || null, result: { bookingPaymentHoldId: existingHold.id, appointmentId: row.appointmentId, reconciledPartialApproval: true } };
    }
    const hold = await recordWalkInManualPayment(row.agencyId, {
      appointmentId: row.appointmentId,
      method: row.method,
      transactionReference: row.transactionReference,
      paymentDate,
      note: row.note,
      actorUserId,
      overrideFreeConsultation: row.result?.overrideFreeConsultation === true,
      approvalId: row.id,
    });
    return { qbPaymentId: hold.qbPaymentId || null, result: { bookingPaymentHoldId: hold.id, appointmentId: row.appointmentId } };
  }
  if (row.entryType === "invoice_payment") {
    const invoice = await recordManualPayment(row.agencyId, {
      caseId: row.caseId,
      invoiceId: row.caseInvoiceId,
      amount: Number(row.amount),
      method: row.method,
      transactionReference: row.transactionReference,
      paymentDate: row.paymentDate.toISOString().slice(0, 10),
      note: row.note,
      idempotencyKey: `approval-${row.id}`,
      actorUserId,
      approvalId: row.id,
    });
    return { qbPaymentId: invoice.lastQbPaymentId || null, result: { caseInvoiceId: invoice.id } };
  }
  if (row.entryType === "invoice_refund") {
    const refund = await completeCashInvoiceRefund(row.agencyId, {
      invoiceId: row.caseInvoiceId,
      caseId: row.caseId,
      amount: Number(row.amount),
      reason: row.description,
      actorUserId,
      approvalId: row.id,
    });
    return { result: { caseInvoiceId: row.caseInvoiceId, invoiceRefundId: refund.id } };
  }
  if (row.entryType === "new_charge_payment") {
    const invoice = await createCaseInvoice(row.agencyId, {
      caseId: row.caseId,
      paymentType: row.paymentType,
      description: row.description,
      amount: Number(row.chargeAmount),
      dueDate: row.paymentDate.toISOString().slice(0, 10),
      actorUserId,
      idempotencyKey: `approval-${row.id}`,
      notifyClient: false,
      accountingProvider: row.method === "Cash" ? ACCOUNTING_PROVIDERS.CASH : ACCOUNTING_PROVIDERS.QUICKBOOKS,
    });
    const updated = await recordManualPayment(row.agencyId, {
      caseId: row.caseId,
      invoiceId: invoice.id,
      amount: Number(row.amount),
      method: row.method,
      transactionReference: row.transactionReference,
      paymentDate: row.paymentDate.toISOString().slice(0, 10),
      note: row.note,
      idempotencyKey: `approval-${row.id}`,
      actorUserId,
      approvalId: row.id,
    });
    return { qbPaymentId: updated.lastQbPaymentId || null, caseInvoiceId: invoice.id, result: { caseInvoiceId: invoice.id } };
  }
  throw createHttpError(409, "This payment request has an unsupported target.", "INVALID_STATE");
}

export async function approvePaymentApproval(agencyId, id, actorUserId) {
  const claimed = await prisma.paymentApproval.updateMany({
    where: { id, agencyId, status: { in: [PAYMENT_APPROVAL_STATUSES.pending, PAYMENT_APPROVAL_STATUSES.failed] } },
    data: { status: PAYMENT_APPROVAL_STATUSES.processing, reviewedById: actorUserId, reviewedAt: new Date(), rejectionReason: null, processingError: null },
  });
  if (!claimed.count) {
    const current = await prisma.paymentApproval.findFirst({ where: { id, agencyId }, include: approvalInclude });
    if (!current) throw createHttpError(404, "Payment approval was not found.", "NOT_FOUND");
    if (current.status === PAYMENT_APPROVAL_STATUSES.approved) return current;
    throw createHttpError(409, "This payment has already been reviewed or is being processed.", "INVALID_STATE");
  }
  const row = await prisma.paymentApproval.findUnique({ where: { id } });
  try {
    const processed = await processApprovedPayment(row, actorUserId);
    const updated = await prisma.paymentApproval.update({
      where: { id },
      data: {
        status: PAYMENT_APPROVAL_STATUSES.approved,
        reviewedById: actorUserId,
        reviewedAt: new Date(),
        qbPaymentId: processed.qbPaymentId || null,
        caseInvoiceId: processed.caseInvoiceId || row.caseInvoiceId,
        paymentId: processed.paymentId || null,
        result: processed.result || undefined,
        processingError: null,
      },
      include: approvalInclude,
    });
    // invoice_refund already posts its own (negative) cash transaction inside
    // completeCashInvoiceRefund — posting again here would try to re-create
    // it with the wrong sign; skip the generic hook for that entry type.
    if (updated.method === "Cash" && row.entryType !== "invoice_refund") {
      await postApprovedCashTransaction({
        agencyId,
        paymentApprovalId: updated.id,
        clientId: updated.clientId,
        caseId: updated.caseId,
        appointmentId: updated.appointmentId,
        caseInvoiceId: updated.caseInvoiceId,
        amount: Number(updated.amount),
        transactionReference: updated.transactionReference,
        paymentDate: updated.paymentDate,
        note: updated.note,
        actorUserId,
      });
    }
    await resolveNotifications({ agencyId, entityType: "paymentApproval", entityId: id, types: ["payment.approval_required"] }).catch(() => {});
    await notifyPaymentSubmitter(updated, {
      type: "payment.approval_approved",
      title: "Payment approved",
      body: `${updated.method} payment of $${Number(updated.amount).toFixed(2)} was approved and recorded. No further submission is needed.`,
    });
    await recordActivity({ agencyId, userId: actorUserId, clientId: updated.clientId, caseId: updated.caseId, action: "payment.approved", details: `${updated.method} payment of $${Number(updated.amount).toFixed(2)} approved`, entityType: "paymentApproval", entityId: id }).catch(() => {});
    invalidateDashboardCache(agencyId);
    return updated;
  } catch (error) {
    const failed = await prisma.paymentApproval.update({ where: { id }, data: { status: PAYMENT_APPROVAL_STATUSES.failed, processingError: String(error.message || "Payment processing failed.").slice(0, 1000) } });
    await notifyPaymentSubmitter(failed, {
      type: "payment.approval_failed",
      title: "Payment approval needs attention",
      body: `The $${Number(failed.amount).toFixed(2)} ${failed.method.toLowerCase()} payment could not be completed. An administrator is reviewing it; do not submit it again.`,
      severity: "warning",
      attentionLevel: "action_required",
    });
    throw error;
  }
}

export async function rejectPaymentApproval(agencyId, id, actorUserId, reason) {
  const rejectionReason = safeText(reason, 500);
  if (!rejectionReason) throw createHttpError(400, "Add a reason so the frontdesk can correct the entry.", "VALIDATION_ERROR");
  const changed = await prisma.paymentApproval.updateMany({
    where: { id, agencyId, status: { in: [PAYMENT_APPROVAL_STATUSES.pending, PAYMENT_APPROVAL_STATUSES.failed] } },
    data: { status: PAYMENT_APPROVAL_STATUSES.rejected, reviewedById: actorUserId, reviewedAt: new Date(), rejectionReason, processingError: null },
  });
  if (!changed.count) throw createHttpError(409, "This payment has already been reviewed or is being processed.", "INVALID_STATE");
  const updated = await prisma.paymentApproval.findUnique({ where: { id }, include: approvalInclude });
  await resolveNotifications({ agencyId, entityType: "paymentApproval", entityId: id, types: ["payment.approval_required"] }).catch(() => {});
  await notifyPaymentSubmitter(updated, {
    type: "payment.approval_rejected",
    title: "Payment request rejected",
    body: `The $${Number(updated.amount).toFixed(2)} ${updated.method.toLowerCase()} payment was rejected: ${rejectionReason}`,
    severity: "warning",
    attentionLevel: "action_required",
  });
  await recordActivity({ agencyId, userId: actorUserId, clientId: updated.clientId, caseId: updated.caseId, action: "payment.rejected", details: `${updated.method} payment rejected — ${rejectionReason}`, entityType: "paymentApproval", entityId: id }).catch(() => {});
  invalidateDashboardCache(agencyId);
  return updated;
}

export async function listPaymentApprovals(agencyId, { status = "Pending", page = 1, pageSize = 25 } = {}) {
  const validStatuses = ["Pending", "Processing", "Approved", "Rejected", "Failed"];
  const where = { agencyId, ...(validStatuses.includes(status) ? { status } : {}) };
  const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [rows, total, pendingCount] = await Promise.all([
    prisma.paymentApproval.findMany({ where, include: approvalInclude, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.paymentApproval.count({ where }),
    prisma.paymentApproval.count({ where: { agencyId, status: "Pending" } }),
  ]);
  return { rows, total, pendingCount, page: Math.max(Number(page) || 1, 1), pageSize: take };
}
