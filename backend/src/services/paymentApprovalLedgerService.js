import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";

export const PAYMENT_APPROVAL_STATUSES = Object.freeze({
  pending: "Pending",
  processing: "Processing",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
});

export function normalizePaymentApprovalKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200) || null;
}

export function normalizePaymentApprovalDate(value) {
  const text = String(value || new Date().toISOString().slice(0, 10)).trim();
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
  if (!["Cash", "ETransfer"].includes(method)) throw createHttpError(400, "Choose Cash or E-transfer.", "VALIDATION_ERROR");
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000) {
    throw createHttpError(400, "Enter a payment amount between $0.01 and $1,000,000.", "VALIDATION_ERROR");
  }
  const reference = String(transactionReference || "").trim().slice(0, 100) || null;
  if (method === "ETransfer" && !reference) throw createHttpError(400, "Enter the e-transfer transaction number.", "VALIDATION_ERROR");
  return { numericAmount, reference, paymentDate: normalizePaymentApprovalDate(paymentDate) };
}

export async function createApprovedCashLedgerRecord({
  agencyId, clientId = null, caseId = null, appointmentId = null, caseInvoiceId = null,
  paymentId = null, entryType, amount, chargeAmount = null, paymentType = null,
  description = null, transactionReference = null, paymentDate, note = null,
  actorUserId, sourceRole = "admin", idempotencyKey,
}) {
  const key = normalizePaymentApprovalKey(idempotencyKey);
  if (!key) throw createHttpError(400, "A valid payment operation key is required.", "VALIDATION_ERROR");
  const data = {
    agencyId, clientId, caseId, appointmentId, caseInvoiceId, paymentId,
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
  return prisma.paymentApproval.upsert({
    where: { agencyId_idempotencyKey: { agencyId, idempotencyKey: key } },
    create: data,
    update: {},
  });
}

export function approvedCashAmount(rows = []) {
  return rows
    .filter((item) => item.status === PAYMENT_APPROVAL_STATUSES.approved && item.method === "Cash")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

export function applyLocalCashToInvoice(row) {
  const localCashPaid = approvedCashAmount(row.paymentApprovals);
  const balance = Math.max(0, Number(row.balance) - localCashPaid);
  return {
    ...row,
    quickBooksBalance: Number(row.balance),
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
