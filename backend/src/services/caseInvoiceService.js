import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { logger } from "./logger.js";
import { notifyInvoiceCreated } from "./paymentNotificationService.js";
import { syncClientToQuickBooks } from "./clientQuickBooksSyncService.js";
import {
  createQuickBooksInvoice,
  createQuickBooksReceivePayment,
  findOrCreateQuickBooksPaymentMethod,
  getQuickBooksInvoicePdf,
  getQuickBooksInvoicesByIds,
} from "./quickbooksService.js";
import { requireFeeCategory, listFeeCategories } from "./feeCategoryService.js";
import { applyLocalCashToInvoice, createApprovedCashLedgerRecord } from "./paymentApprovalLedgerService.js";

export const PAYMENT_TYPES = { fees: "Professional fees", disbursement: "Government fee disbursement" };

function normalizeIdempotencyKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200) || null;
}

export function deriveCaseInvoiceStatus(row) {
  const balance = Number(row.balance);
  const amount = Number(row.amount);
  if (balance <= 0) return "Paid";
  if (balance < amount) return "PartiallyPaid";
  if (row.dueDate && new Date(row.dueDate) < new Date()) return "Overdue";
  return "Open";
}

export async function requireMappedItem(agencyId, paymentType) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId } });
  if (!settings || settings.status !== "connected") {
    throw createHttpError(409, "Connect QuickBooks in Settings before creating invoices.", "QBO_NOT_CONNECTED");
  }
  const category = await requireFeeCategory(agencyId, paymentType, { requireMapping: true });
  return category.qboItemId;
}

/**
 * Resolves the mapped QuickBooks item, links the client if needed, creates
 * the QuickBooks invoice, and persists the CaseInvoice row. No validation,
 * activity logging, or notification — callers (manual creation, schedule
 * triggers) each layer those on since the details differ between them.
 */
export async function createInvoiceRecord(agencyId, { caseId, clientId, paymentType, description, amount, dueDate, actorUserId, idempotencyKey = null }) {
  const operationKey = normalizeIdempotencyKey(idempotencyKey);
  if (operationKey) {
    const existing = await prisma.caseInvoice.findUnique({
      where: { agencyId_creationIdempotencyKey: { agencyId, creationIdempotencyKey: operationKey } },
    });
    if (existing) return existing;
  }
  const itemId = await requireMappedItem(agencyId, paymentType);

  // Validate the cached customer link before every new invoice. A numeric
  // QBO id can become stale or resolve to a different contact after a
  // company reconnect/import; merely checking that the column is non-null
  // can therefore send an invoice to the wrong customer.
  let client = await syncClientToQuickBooks(agencyId, clientId);
  if (!client?.qbCustomerId) {
    throw createHttpError(409, client?.qbSyncError || "This client could not be linked to QuickBooks yet.", "QBO_CLIENT_NOT_LINKED");
  }

  let invoice;
  try {
    invoice = await createQuickBooksInvoice(agencyId, {
      customerId: client.qbCustomerId,
      itemId,
      description,
      amount,
      dueDate: dueDate || undefined,
      requestId: operationKey ? `case-invoice-${operationKey}` : undefined,
    });
  } catch (error) {
    // The client's cached QuickBooks customer id can go stale (deleted,
    // merged, or a sandbox company reset) without CaseDesk ever finding
    // out — QuickBooks only reports it as an "Invalid Reference Id" fault
    // on the invoice create itself, not on lookup. syncClientToQuickBooks
    // already knows how to recover from this ("linked customer is gone —
    // fall through and treat as a fresh link"); this just wasn't reached
    // before because createInvoiceRecord only called it when qbCustomerId
    // was empty, not when it was set but no longer valid. Re-sync once and
    // retry before giving up — a scheduled installment stuck retrying the
    // same stale id every 15 minutes would otherwise never invoice.
    if (!String(error.message || "").toLowerCase().includes("invalid reference id")) throw error;
    const resynced = await syncClientToQuickBooks(agencyId, client.id);
    if (!resynced?.qbCustomerId) throw error;
    client = resynced;
    invoice = await createQuickBooksInvoice(agencyId, {
      customerId: client.qbCustomerId,
      itemId,
      description,
      amount,
      dueDate: dueDate || undefined,
      requestId: operationKey ? `case-invoice-${operationKey}` : undefined,
    });
  }

  try {
    return await prisma.caseInvoice.create({
      data: {
        agencyId,
        caseId,
        clientId: client.id,
        paymentType,
        description,
        qbInvoiceId: invoice.id,
        qbInvoiceNumber: invoice.docNumber,
        qbInvoiceLink: invoice.invoiceLink,
        qbSyncToken: invoice.syncToken,
        amount,
        balance: invoice.balance,
        status: deriveCaseInvoiceStatus({ balance: invoice.balance, amount, dueDate: invoice.dueDate }),
        dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
        createdById: actorUserId,
        creationIdempotencyKey: operationKey,
        lastSyncedAt: new Date(),
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const existing = await prisma.caseInvoice.findFirst({
      where: {
        agencyId,
        OR: [
          { qbInvoiceId: invoice.id },
          ...(operationKey ? [{ creationIdempotencyKey: operationKey }] : []),
        ],
      },
    });
    if (existing) return existing;
    throw error;
  }
}

export async function createCaseInvoice(agencyId, { caseId, paymentType, description, amount, dueDate, actorUserId, idempotencyKey = null, notifyClient = true }) {
  const operationKey = normalizeIdempotencyKey(idempotencyKey);
  if (operationKey) {
    const existing = await prisma.caseInvoice.findUnique({
      where: { agencyId_creationIdempotencyKey: { agencyId, creationIdempotencyKey: operationKey } },
    });
    if (existing) return existing;
  }
  const category = await requireFeeCategory(agencyId, paymentType);
  const trimmedDescription = String(description || "").trim().slice(0, 500);
  if (!trimmedDescription) throw createHttpError(400, "A description is required.", "VALIDATION_ERROR");
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000) {
    throw createHttpError(400, "Enter an invoice amount between $0.01 and $1,000,000.", "VALIDATION_ERROR");
  }

  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId, deletedAt: null }, select: { id: true, clientId: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");

  const row = await createInvoiceRecord(agencyId, {
    caseId,
    clientId: caseItem.clientId,
    paymentType,
    description: trimmedDescription,
    amount: numericAmount,
    dueDate,
    actorUserId,
    idempotencyKey: operationKey,
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: row.clientId,
    caseId,
    action: "invoice.created",
    details: `${category.name} invoice for $${numericAmount.toFixed(2)} created — ${trimmedDescription}`,
    entityType: "caseInvoice",
    entityId: row.id,
  });

  // Best-effort on every channel — a notification hiccup here must never
  // surface as a failure to the staff member who just billed.
  if (notifyClient) {
    await notifyInvoiceCreated({ agencyId, invoice: row, actorUserId }).catch((error) => {
      logger.warn("invoice.notify_failed", { agencyId, invoiceId: row.id, reason: error.message });
    });
  }

  return row;
}

// Shared by every reader (staff case tab, client portal): re-verifies
// cached rows against QuickBooks and persists anything that moved, falling
// back to the last-known cache if QuickBooks itself is unreachable rather
// than failing the whole read over a transient API blip.
async function refreshInvoiceRows(agencyId, rows) {
  if (!rows.length) return [];
  let live = [];
  try {
    live = await getQuickBooksInvoicesByIds(agencyId, rows.map((row) => row.qbInvoiceId));
  } catch {
    return rows;
  }
  const liveById = new Map(live.map((invoice) => [invoice.id, invoice]));

  return Promise.all(
    rows.map(async (row) => {
      const fresh = liveById.get(row.qbInvoiceId);
      if (!fresh) return row;
      const status = fresh.isVoided
        ? "Void"
        : deriveCaseInvoiceStatus({ balance: fresh.balance, amount: row.amount, dueDate: fresh.dueDate });
      if (Number(fresh.balance) === Number(row.balance) && status === row.status) return row;
      return prisma.caseInvoice.update({
        where: { id: row.id },
        data: { balance: fresh.balance, status, qbSyncToken: fresh.syncToken, qbInvoiceNumber: fresh.docNumber, lastSyncedAt: new Date() },
      });
    }),
  );
}

export async function listCaseInvoices(agencyId, caseId) {
  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { id: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  const rows = await prisma.caseInvoice.findMany({ where: { agencyId, caseId }, orderBy: { createdAt: "desc" } });
  const [refreshed, categories] = await Promise.all([refreshInvoiceRows(agencyId, rows), listFeeCategories(agencyId, { includeInactive: true })]);
  const cashRows = await prisma.paymentApproval.findMany({ where: { agencyId, caseInvoiceId: { in: refreshed.map((row) => row.id) }, status: "Approved", method: "Cash" }, orderBy: { paymentDate: "desc" } });
  const cashByInvoice = new Map();
  for (const payment of cashRows) cashByInvoice.set(payment.caseInvoiceId, [...(cashByInvoice.get(payment.caseInvoiceId) || []), payment]);
  const names = new Map(categories.map((category) => [category.code, category.name]));
  return refreshed.map((row) => ({ ...applyLocalCashToInvoice({ ...row, paymentApprovals: cashByInvoice.get(row.id) || [] }), paymentTypeLabel: names.get(row.paymentType) || PAYMENT_TYPES[row.paymentType] || row.paymentType }));
}

// Client-portal reader: scoped by clientId (resolved server-side from the
// caller's ClientUser link, never from a client-supplied id) so it covers
// every case that client has, not just one.
export async function listClientInvoices(agencyId, clientId) {
  const rows = await prisma.caseInvoice.findMany({ where: { agencyId, clientId }, orderBy: { createdAt: "desc" } });
  const refreshed = await refreshInvoiceRows(agencyId, rows);
  const cashRows = await prisma.paymentApproval.findMany({ where: { agencyId, clientId, caseInvoiceId: { in: refreshed.map((row) => row.id) }, status: "Approved", method: "Cash" }, orderBy: { paymentDate: "desc" } });
  const cashByInvoice = new Map();
  for (const payment of cashRows) cashByInvoice.set(payment.caseInvoiceId, [...(cashByInvoice.get(payment.caseInvoiceId) || []), payment]);
  return refreshed.map((row) => applyLocalCashToInvoice({ ...row, paymentApprovals: cashByInvoice.get(row.id) || [] }));
}

export async function getCaseInvoicePdf(agencyId, { caseId, invoiceId }) {
  const row = await prisma.caseInvoice.findFirst({ where: { id: invoiceId, agencyId, caseId } });
  if (!row) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  const buffer = await getQuickBooksInvoicePdf(agencyId, row.qbInvoiceId);
  return { buffer, filename: `Invoice-${row.qbInvoiceNumber || row.id.slice(0, 8)}.pdf` };
}

// Client-portal reader: scoped by clientId (resolved server-side), never a
// client-supplied id, so a client can never fetch another client's invoice.
export async function getClientInvoicePdf(agencyId, { clientId, invoiceId }) {
  const row = await prisma.caseInvoice.findFirst({ where: { id: invoiceId, agencyId, clientId } });
  if (!row) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  const buffer = await getQuickBooksInvoicePdf(agencyId, row.qbInvoiceId);
  return { buffer, filename: `Invoice-${row.qbInvoiceNumber || row.id.slice(0, 8)}.pdf` };
}

export function validateManualPaymentInput({ amount, method = "Cash", transactionReference, paymentDate }) {
  const methodName = method === "ETransfer" ? "E-transfer" : method === "Cash" ? "Cash" : null;
  if (!methodName) throw createHttpError(400, "Choose Cash or E-transfer.", "VALIDATION_ERROR");
  const paymentReference = String(transactionReference || "").trim().slice(0, 100) || null;
  if (method === "ETransfer" && !paymentReference) {
    throw createHttpError(400, "Enter the e-transfer transaction number before recording the payment.", "VALIDATION_ERROR");
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw createHttpError(400, "Enter a payment amount greater than $0.", "VALIDATION_ERROR");
  }
  const transactionDate = normalizeCasePaymentDate(paymentDate);
  return { method, methodName, paymentReference, numericAmount, transactionDate };
}

export async function assertManualPaymentReferenceAvailable(agencyId, paymentReference) {
  if (!paymentReference) return;
  const [invoiceDuplicate, appointmentDuplicate] = await Promise.all([
    prisma.caseInvoice.findFirst({ where: { agencyId, lastPaymentReference: paymentReference }, select: { id: true } }),
    prisma.bookingPaymentHold.findFirst({ where: { agencyId, manualPaymentReference: paymentReference }, select: { id: true } }),
  ]);
  if (invoiceDuplicate || appointmentDuplicate) {
    throw createHttpError(409, "This transaction number is already attached to another payment.", "DUPLICATE_PAYMENT_REFERENCE");
  }
}

export async function recordManualPayment(agencyId, { caseId, invoiceId, amount, method = "Cash", transactionReference, paymentDate, note, idempotencyKey, actorUserId, actorRole = "admin", approvalId = null }) {
  const operationKey = normalizeIdempotencyKey(idempotencyKey);
  const row = await prisma.caseInvoice.findFirst({ where: { id: invoiceId, agencyId, caseId } });
  if (!row) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  if (operationKey && row.lastPaymentIdempotencyKey === operationKey) return row;

  const { methodName, paymentReference, numericAmount, transactionDate } = validateManualPaymentInput({
    amount,
    method,
    transactionReference,
    paymentDate,
  });
  const priorCash = await prisma.paymentApproval.aggregate({
    where: { agencyId, caseInvoiceId: row.id, status: "Approved", method: "Cash" },
    _sum: { amount: true },
  });
  const effectiveBalance = Math.max(0, Number(row.balance) - Number(priorCash._sum.amount || 0));
  if (numericAmount > effectiveBalance + 0.01) {
    throw createHttpError(400, `That's more than the outstanding balance of $${effectiveBalance.toFixed(2)}.`, "VALIDATION_ERROR");
  }
  await assertManualPaymentReferenceAvailable(agencyId, paymentReference);

  if (method === "Cash") {
    if (!approvalId) {
      await createApprovedCashLedgerRecord({
        agencyId,
        clientId: row.clientId,
        caseId,
        caseInvoiceId: row.id,
        entryType: "invoice_payment",
        amount: numericAmount,
        description: row.description,
        transactionReference: paymentReference,
        paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
        note,
        actorUserId,
        sourceRole: actorRole,
        idempotencyKey: operationKey || `invoice-cash:${row.id}:${Date.now()}`,
      });
    }
    const cashRows = await prisma.paymentApproval.findMany({
      where: { agencyId, caseInvoiceId: row.id, status: "Approved", method: "Cash" },
      orderBy: { paymentDate: "desc" },
    });
    const updated = applyLocalCashToInvoice({ ...row, paymentApprovals: cashRows });
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: row.clientId,
      caseId,
      action: "invoice.manual_payment_recorded",
      details: `Cash payment of $${numericAmount.toFixed(2)} recorded in CaseDesk only against ${row.description}${note ? ` — ${note}` : ""}`,
      entityType: "caseInvoice",
      entityId: row.id,
      metadata: { method: "Cash", quickBooksStored: false, approvalId, note: note || null },
    });
    return updated;
  }

  const client = await prisma.client.findUnique({ where: { id: row.clientId }, select: { qbCustomerId: true } });
  if (!client?.qbCustomerId) throw createHttpError(409, "This client is not linked to QuickBooks.", "QBO_CLIENT_NOT_LINKED");

  const qboMethod = await findOrCreateQuickBooksPaymentMethod(agencyId, methodName);
  const payment = await createQuickBooksReceivePayment(agencyId, {
    customerId: client.qbCustomerId,
    invoiceId: row.qbInvoiceId,
    amount: numericAmount,
    paymentMethodId: qboMethod.id,
    paymentReference: paymentReference || undefined,
    transactionDate: transactionDate?.qboDate,
    privateNote: `CaseDesk ${methodName} payment${paymentReference ? ` — transaction ${paymentReference}` : ""}${note ? ` — ${String(note).trim().slice(0, 300)}` : ""}`,
    requestId: `case-pay-${row.id.slice(0, 8)}-${String(operationKey || Date.now()).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24)}`,
  });

  const [refreshed] = await getQuickBooksInvoicesByIds(agencyId, [row.qbInvoiceId]);
  const newBalance = refreshed ? refreshed.balance : Math.max(0, Number(row.balance) - numericAmount);
  const updated = await prisma.caseInvoice.update({
    where: { id: row.id },
    data: {
      balance: newBalance,
      status: deriveCaseInvoiceStatus({ balance: newBalance, amount: row.amount, dueDate: refreshed?.dueDate || row.dueDate }),
      qbSyncToken: refreshed?.syncToken || row.qbSyncToken,
      lastPaymentMethod: method,
      lastPaymentReference: paymentReference,
      lastPaymentAt: transactionDate?.paidAt || new Date(),
      lastQbPaymentId: payment.id,
      lastPaymentIdempotencyKey: operationKey,
      lastSyncedAt: new Date(),
    },
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: row.clientId,
    caseId,
    action: "invoice.manual_payment_recorded",
    details: `${methodName} payment of $${numericAmount.toFixed(2)} recorded against ${row.description}${paymentReference ? ` — transaction ${paymentReference}` : ""}${note ? ` — ${note}` : ""}`,
    entityType: "caseInvoice",
    entityId: row.id,
    metadata: { method, transactionReference: paymentReference, paymentDate: transactionDate?.qboDate || null, qboPaymentId: payment.id, note: note || null },
  });

  return updated;
}

function normalizeCasePaymentDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw createHttpError(400, "Choose a valid payment date.", "VALIDATION_ERROR");
  const [, year, month, day] = match.map(Number);
  const paidAt = new Date(Date.UTC(year, month - 1, day, 12));
  if (paidAt.getUTCFullYear() !== year || paidAt.getUTCMonth() !== month - 1 || paidAt.getUTCDate() !== day) {
    throw createHttpError(400, "Choose a valid payment date.", "VALIDATION_ERROR");
  }
  if (text > new Date().toISOString().slice(0, 10)) {
    throw createHttpError(400, "The payment date cannot be in the future.", "VALIDATION_ERROR");
  }
  return { qboDate: text, paidAt };
}

export async function recordCashPayment(agencyId, values) {
  return recordManualPayment(agencyId, { ...values, method: "Cash" });
}
