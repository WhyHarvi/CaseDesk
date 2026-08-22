import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { resolveCustomPaymentLedger } from "./customPaymentLedgerService.js";

export const PAYMENT_APPROVAL_STATUSES = Object.freeze({
  pending: "Pending",
  processing: "Processing",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
});
export const STAFF_PAYMENT_METHODS = Object.freeze(["Cash", "ETransfer", "Cheque", "Wire", "Debit", "BankDraft"]);

export function normalizePaymentApprovalKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200) || null;
}

export function normalizePaymentApprovalDate(value) {
  const text = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value || new Date().toISOString().slice(0, 10)).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw createHttpError(400, "Choose a valid payment date.", "VALIDATION_ERROR");
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw createHttpError(400, "Choose a valid payment date.", "VALIDATION_ERROR");
  }
  if (text > new Date().toISOString().slice(0, 10)) {
    throw createHttpError(400, "The payment date cannot be in the future.", "VALIDATION_ERROR");
  }
  return date;
}

export function validateStaffPayment({ method, amount, transactionReference, paymentDate }) {
  if (!STAFF_PAYMENT_METHODS.includes(method)) throw createHttpError(400, "Choose a supported payment method.", "VALIDATION_ERROR");
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000) {
    throw createHttpError(400, "Enter a payment amount between $0.01 and $1,000,000.", "VALIDATION_ERROR");
  }
  const reference = String(transactionReference || "").trim().slice(0, 100) || null;
  if (method !== "Cash" && !reference) throw createHttpError(400, method === "ETransfer" ? "Enter the e-transfer transaction number." : "Enter the payment transaction or cheque reference.", "VALIDATION_ERROR");
  return { numericAmount, reference, paymentDate: normalizePaymentApprovalDate(paymentDate) };
}

export async function postApprovedCashTransaction({
  agencyId,
  paymentApprovalId,
  clientId = null,
  caseId = null,
  appointmentId = null,
  caseInvoiceId = null,
  amount,
  transactionReference = null,
  paymentDate,
  note = null,
  actorUserId = null,
  type = "Payment",
  customLedgerId = undefined,
}) {
  const owningLedgerId = customLedgerId === undefined
    ? (await prisma.paymentApproval.findUnique({ where: { id: paymentApprovalId }, select: { customLedgerId: true } }))?.customLedgerId || null
    : customLedgerId;
  const transaction = await prisma.cashTransaction.upsert({
    where: { paymentApprovalId },
    create: {
      agencyId,
      paymentApprovalId,
      clientId,
      caseId,
      appointmentId,
      customLedgerId: owningLedgerId,
      type,
      amount,
      // Cash has no bank transaction identifier. Optional receipt text stays
      // on PaymentApproval; this unique cross-ledger reference must remain null.
      reference: null,
      occurredAt: normalizePaymentApprovalDate(paymentDate),
      note: String(note || "").trim().slice(0, 500) || null,
      createdById: actorUserId,
    },
    update: {},
  });
  if (caseInvoiceId) {
    await prisma.cashAllocation.upsert({
      where: { transactionId_invoiceId: { transactionId: transaction.id, invoiceId: caseInvoiceId } },
      create: { agencyId, transactionId: transaction.id, invoiceId: caseInvoiceId, amount },
      update: {},
    });
  }
  return transaction;
}

export async function createApprovedCashLedgerRecord({
  agencyId, clientId = null, caseId = null, appointmentId = null, caseInvoiceId = null,
  paymentId = null, entryType, amount, chargeAmount = null, paymentType = null,
  description = null, transactionReference = null, paymentDate, note = null,
  actorUserId, sourceRole = "admin", idempotencyKey,
}) {
  const key = normalizePaymentApprovalKey(idempotencyKey);
  if (!key) throw createHttpError(400, "A valid payment operation key is required.", "VALIDATION_ERROR");
  const customLedger = await resolveCustomPaymentLedger(agencyId, caseId, "Cash");
  const data = {
    agencyId, clientId, caseId, appointmentId, caseInvoiceId, paymentId, customLedgerId: customLedger?.id || null,
    entryType, method: "Cash", amount, chargeAmount, paymentType,
    description: String(description || "").trim().slice(0, 500) || null,
    transactionReference: String(transactionReference || "").trim().slice(0, 100) || null,
    paymentDate: normalizePaymentApprovalDate(paymentDate),
    note: String(note || "").trim().slice(0, 500) || null,
    status: PAYMENT_APPROVAL_STATUSES.approved,
    sourceRole,
    idempotencyKey: key,
    submittedById: actorUserId,
    reviewedById: actorUserId,
    reviewedAt: new Date(),
  };
  const approval = await prisma.paymentApproval.upsert({
    where: { agencyId_idempotencyKey: { agencyId, idempotencyKey: key } },
    create: data,
    update: {},
  });
  await postApprovedCashTransaction({
    agencyId, paymentApprovalId: approval.id, clientId, caseId, appointmentId,
    caseInvoiceId, amount, transactionReference, paymentDate, note,
    actorUserId, customLedgerId: customLedger?.id || null,
  });
  return approval;
}

export function approvedCashAmount(rows = []) {
  return rows
    .filter((item) => item.status === PAYMENT_APPROVAL_STATUSES.approved && item.method === "Cash")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

export function applyLocalCashToInvoice(row) {
  const localCashPaid = approvedCashAmount(row.paymentApprovals);
  const quickBooksBacked = row.accountingProvider !== "CaseDeskCash";
  const balance = Math.max(0, Number(row.balance) - (quickBooksBacked ? localCashPaid : 0));
  return {
    ...row,
    quickBooksBalance: quickBooksBacked ? Number(row.balance) : null,
    localCashPaid,
    balance,
    status: row.status === "Void" || row.status === "Voided"
      ? row.status
      : balance <= 0 ? "Paid" : balance < Number(row.amount) ? "PartiallyPaid" : row.status,
    lastPaymentMethod: localCashPaid > 0 ? "Cash" : row.lastPaymentMethod,
    lastPaymentAt: localCashPaid > 0
      ? row.paymentApprovals
        .filter((item) => item.status === "Approved" && item.method === "Cash")
        .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0]?.paymentDate || row.lastPaymentAt
      : row.lastPaymentAt,
  };
}
