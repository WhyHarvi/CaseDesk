import prisma from "./prisma/client.js";
import { randomUUID } from "node:crypto";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { logger } from "./logger.js";
import { notifyInvoiceCreated } from "./paymentNotificationService.js";
import { syncClientToQuickBooks } from "./clientQuickBooksSyncService.js";
import {
  createQuickBooksInvoice,
  createQuickBooksReceivePayment,
  deleteQuickBooksPayment,
  findOrCreateQuickBooksPaymentMethod,
  getQuickBooksInvoice,
  getQuickBooksInvoicesByIds,
  quickBooksAppUrl,
  voidQuickBooksInvoice,
} from "./quickbooksService.js";
import { generateCaseInvoicePdf } from "./caseInvoicePdfService.js";
import { syncLeadInitialPaymentFromEvidence } from "../modules/leads/lead.financial.service.js";
import { requireFeeCategory, listFeeCategories } from "./feeCategoryService.js";
import { applyLocalCashToInvoice, createApprovedCashLedgerRecord, postApprovedCashTransaction } from "./paymentApprovalLedgerService.js";
import { resolveCustomPaymentLedger } from "./customPaymentLedgerService.js";
import { buildInvoiceIncentiveSnapshot, creditCaseInvoiceCollection, resetCreditCursor } from "./incentiveCreditingService.js";

export const PAYMENT_TYPES = { fees: "Professional fees", disbursement: "Government fee disbursement" };
export const ACCOUNTING_PROVIDERS = Object.freeze({ QUICKBOOKS: "QuickBooks", CASH: "CaseDeskCash" });
export const MANUAL_PAYMENT_METHODS = Object.freeze(["Cash", "ETransfer", "Cheque", "Wire", "Debit", "BankDraft"]);
const TAXABLE_FEE_KINDS = new Set(["Professional", "Consultation"]);

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Cash and QuickBooks invoices get visibly different prefixes (CSH- vs
// INV-) so staff scanning a list of invoice numbers — mixed with each other,
// and with historical QuickBooks-imported numbers and the LEGACY- fallback
// from the original migration backfill — can tell at a glance which ledger
// an invoice belongs to, without relying solely on the ledger badge.
function newInvoiceNumber(accountingProvider) {
  const prefix = accountingProvider === ACCOUNTING_PROVIDERS.CASH ? "CSH" : "INV";
  return `${prefix}-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function agencySnapshot(agency, billing) {
  return {
    name: agency.legalName || agency.name,
    tradingName: agency.name,
    email: agency.email,
    phone: agency.phone,
    address: agency.address,
    city: agency.city,
    province: agency.province,
    country: agency.country,
    postalCode: agency.postalCode,
    logoUrl: agency.logoUrl,
    businessNumber: agency.businessNumber,
    taxNumber: billing?.taxNumber || agency.taxNumber,
  };
}

function clientSnapshot(client) {
  return {
    clientNumber: client.clientNumber,
    fullName: client.fullName,
    email: client.email,
    phone: client.phone,
    address: client.address,
  };
}

function normalizeIdempotencyKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200) || null;
}

export function deriveCaseInvoiceStatus(row) {
  const balance = Number(row.balance);
  const amount = Number(row.amount);
  const completedRefundAmount = (row.refunds || [])
    .filter((refund) => refund.status === "Completed")
    .reduce((total, refund) => total + Number(refund.amount || 0), 0);
  const collected = Math.max(0, amount - balance);
  if (completedRefundAmount > 0) {
    return completedRefundAmount >= collected - 0.01 ? "Refunded" : "PartiallyRefunded";
  }
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
export async function createInvoiceRecord(agencyId, {
  caseId,
  clientId,
  paymentType,
  description,
  amount,
  dueDate,
  actorUserId,
  idempotencyKey = null,
  accountingProvider = ACCOUNTING_PROVIDERS.QUICKBOOKS,
  discountAmount = 0,
}) {
  const operationKey = normalizeIdempotencyKey(idempotencyKey);
  if (operationKey) {
    const existing = await prisma.caseInvoice.findUnique({
      where: { agencyId_creationIdempotencyKey: { agencyId, creationIdempotencyKey: operationKey } },
    });
    if (existing) return existing;
  }
  const category = await requireFeeCategory(agencyId, paymentType, { requireMapping: accountingProvider === ACCOUNTING_PROVIDERS.QUICKBOOKS });
  const [agency, clientRecord, billing, quickBooksSettings, caseItem] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId } }),
    prisma.client.findFirst({ where: { id: clientId, agencyId } }),
    prisma.agencyBillingSettings.findUnique({ where: { agencyId } }),
    accountingProvider === ACCOUNTING_PROVIDERS.QUICKBOOKS
      ? prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId } })
      : Promise.resolve(null),
    prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { caseType: true } }),
  ]);
  if (!agency || !clientRecord) throw createHttpError(404, "Agency or client not found.", "NOT_FOUND");
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  const subtotal = money(amount);
  const discount = money(discountAmount);
  const taxable = TAXABLE_FEE_KINDS.has(category.kind);
  const taxRatePercent = taxable ? Number(billing?.taxRatePercent ?? 13) : 0;
  const taxAmount = taxable ? money(subtotal * taxRatePercent / 100) : 0;
  const totalBeforeDiscount = money(subtotal + taxAmount);
  if (discount > totalBeforeDiscount) {
    throw createHttpError(400, "The discount cannot be greater than the invoice total.", "VALIDATION_ERROR");
  }
  const total = money(totalBeforeDiscount - discount);
  const invoiceNumber = newInvoiceNumber(accountingProvider);
  // Freeze the people and formula before the invoice exists, so a later
  // case transfer or plan edit only ever applies to later invoices.
  const incentiveSnapshot = await buildInvoiceIncentiveSnapshot(agencyId, caseId, caseItem.caseType);

  if (accountingProvider === ACCOUNTING_PROVIDERS.CASH) {
    return prisma.caseInvoice.create({
      data: {
        agencyId,
        caseId,
        clientId,
        paymentType,
        description,
        invoiceNumber,
        accountingProvider,
        currency: agency.defaultCurrency || "CAD",
        subtotalAmount: subtotal,
        discountAmount: discount,
        taxAmount,
        taxRatePercent,
        agencySnapshot: agencySnapshot(agency, billing),
        clientSnapshot: clientSnapshot(clientRecord),
        amount: total,
        balance: total,
        status: "Open",
        dueDate: dueDate ? new Date(dueDate) : null,
        createdById: actorUserId,
        creationIdempotencyKey: operationKey,
        lines: {
          create: [{ agencyId, feeCategory: paymentType, description, unitAmount: subtotal, discount, taxable, taxRate: taxRatePercent, taxAmount, lineTotal: total }],
        },
        ...(incentiveSnapshot ? {
          creditCursor: { create: { agencyId, lastCreditedBalance: total } },
          incentiveSnapshot: { create: incentiveSnapshot },
        } : {}),
      },
      include: { lines: true },
    });
  }
  if (!quickBooksSettings || quickBooksSettings.status !== "connected") {
    throw createHttpError(409, "Connect QuickBooks in Settings before creating invoices.", "QBO_NOT_CONNECTED");
  }
  if (taxable && !quickBooksSettings.taxableTaxCodeId) {
    throw createHttpError(409, "Choose the QuickBooks HST/GST code in Settings before creating a taxable invoice.", "QBO_TAX_MAPPING_REQUIRED");
  }

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
      itemId: category.qboItemId,
      description,
      amount: subtotal,
      dueDate: dueDate || undefined,
      invoiceNumber,
      taxableTaxCodeId: quickBooksSettings.taxableTaxCodeId,
      expectedTotal: total,
      discountAmount: discount,
      lines: [{ itemId: category.qboItemId, description, amount: subtotal, taxable }],
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
      itemId: category.qboItemId,
      description,
      amount: subtotal,
      dueDate: dueDate || undefined,
      invoiceNumber,
      taxableTaxCodeId: quickBooksSettings.taxableTaxCodeId,
      expectedTotal: total,
      discountAmount: discount,
      lines: [{ itemId: category.qboItemId, description, amount: subtotal, taxable }],
      requestId: operationKey ? `case-invoice-${operationKey}` : undefined,
    });
  }

  try {
    return await prisma.$transaction(async (tx) => tx.caseInvoice.create({
      data: {
        agencyId,
        caseId,
        clientId: client.id,
        paymentType,
        description,
        invoiceNumber,
        accountingProvider,
        currency: invoice.currency || agency.defaultCurrency || "CAD",
        subtotalAmount: subtotal,
        discountAmount: discount,
        taxAmount: money(invoice.totalTax),
        taxRatePercent,
        agencySnapshot: agencySnapshot(agency, billing),
        clientSnapshot: clientSnapshot(clientRecord),
        qbInvoiceId: invoice.id,
        qbInvoiceNumber: invoice.docNumber,
        qbInvoiceLink: invoice.invoiceLink,
        qbSyncToken: invoice.syncToken,
        amount: invoice.totalAmount,
        balance: invoice.balance,
        status: deriveCaseInvoiceStatus({ balance: invoice.balance, amount: invoice.totalAmount, dueDate: invoice.dueDate }),
        dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
        createdById: actorUserId,
        creationIdempotencyKey: operationKey,
        lastSyncedAt: new Date(),
        lines: {
          create: [{ agencyId, feeCategory: paymentType, description, unitAmount: subtotal, discount, taxable, taxRate: taxRatePercent, taxAmount: money(invoice.totalTax), lineTotal: invoice.totalAmount }],
        },
        ...(incentiveSnapshot ? {
          creditCursor: { create: { agencyId, lastCreditedBalance: invoice.balance } },
          incentiveSnapshot: { create: incentiveSnapshot },
        } : {}),
      },
      include: { lines: true },
    }));
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

export async function createCaseInvoice(agencyId, { caseId, paymentType, description, amount, discountAmount = 0, dueDate, actorUserId, idempotencyKey = null, notifyClient = true, accountingProvider = ACCOUNTING_PROVIDERS.QUICKBOOKS }) {
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
  const numericDiscount = Number(discountAmount || 0);
  if (!Number.isFinite(numericDiscount) || numericDiscount < 0 || numericDiscount > 1_000_000) {
    throw createHttpError(400, "Enter a discount between $0.00 and $1,000,000.", "VALIDATION_ERROR");
  }

  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId, deletedAt: null }, select: { id: true, clientId: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");

  const row = await createInvoiceRecord(agencyId, {
    caseId,
    clientId: caseItem.clientId,
    paymentType,
    description: trimmedDescription,
    amount: numericAmount,
    discountAmount: numericDiscount,
    dueDate,
    actorUserId,
    idempotencyKey: operationKey,
    accountingProvider,
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: row.clientId,
    caseId,
    action: "invoice.created",
    details: `${category.name} invoice ${row.invoiceNumber} for $${Number(row.amount).toFixed(2)} created in ${row.accountingProvider === ACCOUNTING_PROVIDERS.CASH ? "CaseDesk Cash" : "QuickBooks"} — ${trimmedDescription}`,
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
  const quickBooksRows = rows.filter((row) => row.accountingProvider === ACCOUNTING_PROVIDERS.QUICKBOOKS && row.qbInvoiceId);
  if (!quickBooksRows.length) return rows;
  let live = [];
  try {
    live = await getQuickBooksInvoicesByIds(agencyId, quickBooksRows.map((row) => row.qbInvoiceId));
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
        : deriveCaseInvoiceStatus({ balance: fresh.balance, amount: row.amount, dueDate: fresh.dueDate, refunds: row.refunds });
      const changed = Number(fresh.balance) !== Number(row.balance) || status !== row.status;
      const updated = changed
        ? await prisma.caseInvoice.update({
            where: { id: row.id },
            data: { balance: fresh.balance, status, qbSyncToken: fresh.syncToken, qbInvoiceNumber: fresh.docNumber, lastSyncedAt: new Date() },
          })
        : row;
      // A staff member opening the billing tab (or a client opening the
      // portal) is one of the ways a balance drop from a QuickBooks-side
      // payment first gets observed here — this read path has to credit
      // incentives too, not just the two write endpoints, or a payment
      // made directly in QuickBooks could go uncredited until something
      // else happens to resync it.
      const processBalance = fresh.isVoided
        ? resetCreditCursor(agencyId, updated.id, updated.balance)
        : creditCaseInvoiceCollection(agencyId, { caseId: updated.caseId, caseInvoiceId: updated.id, newBalance: updated.balance, trigger: "LAZY_RESYNC" });
      await processBalance.catch((error) => {
        logger.warn("incentive.credit_failed", { agencyId, caseInvoiceId: updated.id, trigger: "LAZY_RESYNC", reason: error.message });
      });
      return { ...row, ...updated };
    }),
  );
}

export async function listCaseInvoices(agencyId, caseId) {
  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { id: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  const rows = await prisma.caseInvoice.findMany({
    where: { agencyId, caseId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      installments: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });
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
  const rows = await prisma.caseInvoice.findMany({ where: { agencyId, clientId }, include: { lines: { orderBy: { sortOrder: "asc" } }, refunds: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } });
  const refreshed = await refreshInvoiceRows(agencyId, rows);
  const cashRows = await prisma.paymentApproval.findMany({ where: { agencyId, clientId, caseInvoiceId: { in: refreshed.map((row) => row.id) }, status: "Approved", method: "Cash" }, orderBy: { paymentDate: "desc" } });
  const cashByInvoice = new Map();
  for (const payment of cashRows) cashByInvoice.set(payment.caseInvoiceId, [...(cashByInvoice.get(payment.caseInvoiceId) || []), payment]);
  return refreshed.map((row) => applyLocalCashToInvoice({ ...row, paymentApprovals: cashByInvoice.get(row.id) || [] }));
}

export async function getCaseInvoicePdf(agencyId, { caseId, invoiceId }) {
  const row = await prisma.caseInvoice.findFirst({ where: { id: invoiceId, agencyId, caseId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!row) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  const buffer = await generateCaseInvoicePdf(row);
  return { buffer, filename: `Invoice-${row.invoiceNumber}.pdf` };
}

// Client-portal reader: scoped by clientId (resolved server-side), never a
// client-supplied id, so a client can never fetch another client's invoice.
export async function getClientInvoicePdf(agencyId, { clientId, invoiceId }) {
  const row = await prisma.caseInvoice.findFirst({ where: { id: invoiceId, agencyId, clientId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!row) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  const buffer = await generateCaseInvoicePdf(row);
  return { buffer, filename: `Invoice-${row.invoiceNumber}.pdf` };
}

export function validateManualPaymentInput({ amount, method = "Cash", transactionReference, paymentDate }) {
  const methodNames = { Cash: "Cash", ETransfer: "E-transfer", Cheque: "Cheque", Wire: "Wire transfer", Debit: "Debit", BankDraft: "Bank draft" };
  const methodName = methodNames[method] || null;
  if (!methodName) throw createHttpError(400, "Choose a supported payment method.", "VALIDATION_ERROR");
  const paymentReference = String(transactionReference || "").trim().slice(0, 100) || null;
  if (method !== "Cash" && !paymentReference) {
    throw createHttpError(400, method === "ETransfer" ? "Enter the e-transfer transaction number before recording the payment." : `Enter the ${methodName.toLowerCase()} reference before recording the payment.`, "VALIDATION_ERROR");
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
  // A voided invoice or payment hold keeps its old reference on record for
  // audit history, but the payment itself no longer exists (deleted or
  // voided in QuickBooks) — the reference isn't "in use" anymore and must
  // be free to reuse, otherwise correcting a mistaken entry permanently
  // locks out its own real transaction number from ever being recorded.
  const [invoiceDuplicate, appointmentDuplicate, cashDuplicate] = await Promise.all([
    prisma.caseInvoice.findFirst({ where: { agencyId, lastPaymentReference: paymentReference, status: { notIn: ["Void", "Voided"] } }, select: { id: true } }),
    prisma.bookingPaymentHold.findFirst({ where: { agencyId, manualPaymentReference: paymentReference, status: { notIn: ["Void", "Voided"] } }, select: { id: true } }),
    prisma.cashTransaction.findFirst({ where: { agencyId, reference: paymentReference }, select: { id: true } }),
  ]);
  if (invoiceDuplicate || appointmentDuplicate || cashDuplicate) {
    throw createHttpError(409, "This transaction number is already attached to another payment.", "DUPLICATE_PAYMENT_REFERENCE");
  }
}

export async function recordManualPayment(agencyId, { caseId, invoiceId, amount, method = "Cash", transactionReference, paymentDate, note, idempotencyKey, actorUserId, actorRole = "admin", approvalId = null, paymentProcessorUserId = actorUserId }) {
  const operationKey = normalizeIdempotencyKey(idempotencyKey);
  let row = await prisma.caseInvoice.findFirst({ where: { id: invoiceId, agencyId, caseId }, include: { refunds: { where: { status: "Completed" } } } });
  if (!row) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  if (operationKey && row.lastPaymentIdempotencyKey === operationKey) return row;

  const { methodName, paymentReference, numericAmount, transactionDate } = validateManualPaymentInput({
    amount,
    method,
    transactionReference,
    paymentDate,
  });
  const customLedger = await resolveCustomPaymentLedger(agencyId, caseId, method);
  const priorCash = row.accountingProvider === ACCOUNTING_PROVIDERS.QUICKBOOKS
    ? await prisma.paymentApproval.aggregate({
      where: { agencyId, caseInvoiceId: row.id, status: "Approved", method: "Cash" },
      _sum: { amount: true },
    })
    : { _sum: { amount: 0 } };
  const effectiveBalance = Math.max(0, Number(row.balance) - Number(priorCash._sum.amount || 0));
  if (numericAmount > effectiveBalance + 0.01) {
    throw createHttpError(400, `That's more than the outstanding balance of $${effectiveBalance.toFixed(2)}.`, "VALIDATION_ERROR");
  }
  if (method !== "Cash") await assertManualPaymentReferenceAvailable(agencyId, paymentReference);

  if (method === "Cash") {
    if (row.accountingProvider === ACCOUNTING_PROVIDERS.QUICKBOOKS) {
      if (!row.qbInvoiceId || !row.qbSyncToken || Math.abs(Number(row.balance) - Number(row.amount)) > 0.01) {
        throw createHttpError(409, "A partially paid QuickBooks invoice cannot be moved to the cash ledger. Finish or reverse its QuickBooks payments first.", "CASH_INVOICE_PROVIDER_MISMATCH");
      }
      await voidQuickBooksInvoice(agencyId, { id: row.qbInvoiceId, syncToken: row.qbSyncToken });
      row = await prisma.caseInvoice.update({
        where: { id: row.id },
        data: { accountingProvider: ACCOUNTING_PROVIDERS.CASH, status: "Open", balance: row.amount, lastSyncedAt: new Date() },
      });
      await recordActivity({
        agencyId,
        userId: actorUserId,
        clientId: row.clientId,
        caseId,
        action: "invoice.moved_to_cash_ledger",
        details: `${row.invoiceNumber} was voided in QuickBooks and moved to CaseDesk Cash before accepting cash.`,
        entityType: "caseInvoice",
        entityId: row.id,
      });
    }
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
    const newBalance = money(Math.max(0, Number(row.balance) - numericAmount));
    const updatedRow = await prisma.caseInvoice.update({
      where: { id: row.id },
      data: {
        balance: newBalance,
        status: deriveCaseInvoiceStatus({ balance: newBalance, amount: row.amount, dueDate: row.dueDate, refunds: row.refunds }),
        lastPaymentMethod: "Cash",
        lastPaymentReference: paymentReference,
        lastPaymentAt: transactionDate?.paidAt || new Date(),
        lastPaymentIdempotencyKey: operationKey,
        customLedgerId: customLedger?.id || null,
      },
    });
    const updated = { ...updatedRow, localCashPaid: numericAmount };
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
    await syncLeadInitialPaymentFromEvidence(agencyId, { clientId: row.clientId, caseId }).catch(() => {});
    await creditCaseInvoiceCollection(agencyId, { caseId, caseInvoiceId: updated.id, newBalance: updated.balance, trigger: "MANUAL_PAYMENT", paymentProcessorUserId }).catch((error) => {
      logger.warn("incentive.credit_failed", { agencyId, caseInvoiceId: updated.id, trigger: "MANUAL_PAYMENT", reason: error.message });
    });
    return updated;
  }

  if (row.accountingProvider !== ACCOUNTING_PROVIDERS.QUICKBOOKS || !row.qbInvoiceId) {
    throw createHttpError(409, "Non-cash payments must be applied to a QuickBooks invoice.", "QBO_INVOICE_REQUIRED");
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
      status: deriveCaseInvoiceStatus({ balance: newBalance, amount: row.amount, dueDate: refreshed?.dueDate || row.dueDate, refunds: row.refunds }),
      qbSyncToken: refreshed?.syncToken || row.qbSyncToken,
      lastPaymentMethod: method,
      lastPaymentReference: paymentReference,
      lastPaymentAt: transactionDate?.paidAt || new Date(),
      lastQbPaymentId: payment.id,
      lastPaymentIdempotencyKey: operationKey,
      lastSyncedAt: new Date(),
      customLedgerId: customLedger?.id || null,
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
  await syncLeadInitialPaymentFromEvidence(agencyId, { clientId: row.clientId, caseId }).catch(() => {});

  // Best-effort, same as the notification above — the payment already
  // succeeded in QuickBooks by this point, so a crediting failure must
  // never surface as a failure to record the payment itself.
  await creditCaseInvoiceCollection(agencyId, { caseId, caseInvoiceId: updated.id, newBalance: updated.balance, trigger: "MANUAL_PAYMENT", paymentProcessorUserId }).catch((error) => {
    logger.warn("incentive.credit_failed", { agencyId, caseInvoiceId: updated.id, trigger: "MANUAL_PAYMENT", reason: error.message });
  });

  return updated;
}

export async function voidUnpaidCaseInvoice(agencyId, { caseId, invoiceId, reason, actorUserId }) {
  const voidReason = String(reason || "").trim().slice(0, 500);
  if (!voidReason) throw createHttpError(400, "Enter why this invoice is being voided.", "VALIDATION_ERROR");

  const invoice = await prisma.caseInvoice.findFirst({
    where: { id: invoiceId, agencyId, caseId },
    include: {
      installments: { select: { id: true } },
      paymentApprovals: { where: { status: "Approved", method: "Cash" }, select: { amount: true } },
    },
  });
  if (!invoice) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  if (["Void", "Voided"].includes(invoice.status)) return invoice;
  if (invoice.installments.length) {
    throw createHttpError(409, "Void this invoice from its payment-schedule installment.", "SCHEDULE_INVOICE_REQUIRED");
  }
  const localCashPaid = invoice.paymentApprovals.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const collected = Math.max(0, Number(invoice.amount) - Number(invoice.balance)) + localCashPaid;
  if (collected > 0.01) {
    throw createHttpError(409, "This invoice already has a payment. Refund or reverse the payment before voiding it.", "INVOICE_HAS_PAYMENT");
  }

  if (invoice.accountingProvider === ACCOUNTING_PROVIDERS.QUICKBOOKS) {
    if (!invoice.qbInvoiceId || !invoice.qbSyncToken) {
      throw createHttpError(409, "This QuickBooks invoice must be synchronized before it can be voided.", "QBO_INVOICE_NOT_SYNCED");
    }
    await voidQuickBooksInvoice(agencyId, { id: invoice.qbInvoiceId, syncToken: invoice.qbSyncToken });
  }

  const updated = await prisma.caseInvoice.update({
    where: { id: invoice.id },
    data: { status: "Void", balance: 0, lastSyncedAt: new Date() },
  });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: invoice.clientId,
    caseId,
    action: "invoice.voided",
    details: `${invoice.invoiceNumber} (${invoice.description}) voided: ${voidReason}`,
    entityType: "caseInvoice",
    entityId: invoice.id,
    metadata: { reason: voidReason, priorBalance: Number(invoice.balance) },
  });
  return updated;
}

// Reverses a mistakenly-recorded payment — a duplicate entry, wrong
// invoice, split-by-mistake, etc. — where no real money is actually
// changing hands. Distinct from a refund: a refund means the invoice was
// legitimately paid and the client is genuinely getting money back; this
// means the payment record itself should never have posted. Voids the
// QuickBooks Receive Payment transaction directly (never a refund — no
// money movement is implied), which reopens the invoice's real QuickBooks
// balance, then voids the now-unpaid invoice so it drops out of the
// case's Billing tab the same way any other voided invoice does.
export async function voidPaidCaseInvoicePayment(agencyId, { caseId, invoiceId, reason, actorUserId }) {
  const voidReason = String(reason || "").trim().slice(0, 500);
  if (!voidReason) throw createHttpError(400, "Enter why this payment is being voided.", "VALIDATION_ERROR");

  const invoice = await prisma.caseInvoice.findFirst({
    where: { id: invoiceId, agencyId, caseId },
    include: {
      installments: { select: { id: true } },
      refunds: { where: { status: { in: ["Requested", "AwaitingQuickBooks", "Completed"] } }, select: { id: true } },
    },
  });
  if (!invoice) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  if (["Void", "Voided"].includes(invoice.status)) return invoice;
  if (invoice.installments.length) {
    throw createHttpError(409, "Void this invoice from its payment-schedule installment.", "SCHEDULE_INVOICE_REQUIRED");
  }
  if (invoice.refunds.length) {
    throw createHttpError(409, "A refund already exists for this invoice — resolve or cancel it before voiding the payment instead.", "REFUND_ALREADY_EXISTS");
  }
  if (invoice.accountingProvider !== ACCOUNTING_PROVIDERS.QUICKBOOKS) {
    throw createHttpError(409, "This invoice has no QuickBooks payment to void.", "NOT_A_QUICKBOOKS_PAYMENT");
  }
  if (!invoice.lastQbPaymentId) {
    throw createHttpError(409, "No QuickBooks payment is linked to this invoice.", "QBO_PAYMENT_MISSING");
  }

  await deleteQuickBooksPayment(agencyId, { id: invoice.lastQbPaymentId });
  // Voiding the payment changes the invoice's own SyncToken in QuickBooks —
  // the value CaseDesk stored at creation/last-sync time is now stale, so
  // it has to be re-read before the invoice itself can be voided.
  const freshInvoice = await getQuickBooksInvoice(agencyId, invoice.qbInvoiceId);
  if (freshInvoice) {
    await voidQuickBooksInvoice(agencyId, { id: freshInvoice.id, syncToken: freshInvoice.syncToken });
  }

  const updated = await prisma.caseInvoice.update({
    where: { id: invoice.id },
    data: { status: "Void", balance: 0, lastSyncedAt: new Date() },
  });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: invoice.clientId,
    caseId,
    action: "invoice.payment_voided",
    details: `${invoice.invoiceNumber} (${invoice.description}) payment voided in QuickBooks (not a refund — no money moved) and invoice closed: ${voidReason}`,
    entityType: "caseInvoice",
    entityId: invoice.id,
    metadata: { reason: voidReason, priorAmount: Number(invoice.amount), qbPaymentId: invoice.lastQbPaymentId },
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

async function loadRefundableInvoice(agencyId, { caseId, invoiceId }) {
  const invoice = await prisma.caseInvoice.findFirst({
    where: { id: invoiceId, agencyId, ...(caseId ? { caseId } : {}) },
    include: { refunds: { where: { status: { in: ["Requested", "AwaitingQuickBooks", "Completed"] } } } },
  });
  if (!invoice) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  if (["Void", "Voided"].includes(invoice.status)) throw createHttpError(409, "A void invoice cannot be refunded.", "INVALID_STATE");
  const collected = Math.max(0, money(Number(invoice.amount) - Number(invoice.balance)));
  const committedRefunds = money(invoice.refunds.reduce((sum, item) => sum + Number(item.amount), 0));
  const refundable = money(collected - committedRefunds);
  return { invoice, collected, committedRefunds, refundable };
}

function validateRefundAmountReason(amount, reason, refundable, currency) {
  const numericAmount = money(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > refundable + 0.01) {
    throw createHttpError(400, `Enter a refund no greater than the available ${new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(refundable)}.`, "VALIDATION_ERROR");
  }
  const refundReason = String(reason || "").trim().slice(0, 500);
  if (!refundReason) throw createHttpError(400, "Add a reason for the refund.", "VALIDATION_ERROR");
  return { numericAmount, refundReason };
}

// Pure validation used by the case-invoice-refund route before it decides how
// to route the request: cash invoices go through the payment-approval queue
// (see completeCashInvoiceRefund, invoked only after admin approval);
// QuickBooks invoices keep the direct "tracked request, finish in QuickBooks"
// path below, since a human completing the refund inside QuickBooks is
// already the control — no second CaseDesk approval gate is layered on top.
export async function describeInvoiceRefundRequest(agencyId, { caseId, invoiceId, amount, reason }) {
  const { invoice, refundable } = await loadRefundableInvoice(agencyId, { caseId, invoiceId });
  const { numericAmount, refundReason } = validateRefundAmountReason(amount, reason, refundable, invoice.currency);
  return { invoice, numericAmount, refundReason, refundable };
}

export async function requestCaseInvoiceRefund(agencyId, { caseId, invoiceId, amount, reason, actorUserId }) {
  const { invoice, refundable } = await loadRefundableInvoice(agencyId, { caseId, invoiceId });
  if (invoice.accountingProvider === ACCOUNTING_PROVIDERS.CASH) {
    throw createHttpError(409, "Cash refunds go through the payment approval queue.", "CASH_REFUND_NEEDS_APPROVAL");
  }
  const { numericAmount, refundReason } = validateRefundAmountReason(amount, reason, refundable, invoice.currency);
  if (!invoice.qbInvoiceId) throw createHttpError(409, "The QuickBooks invoice link is missing.", "QBO_INVOICE_REQUIRED");
  const refund = await prisma.invoiceRefund.create({
    data: {
      agencyId,
      invoiceId: invoice.id,
      amount: numericAmount,
      currency: invoice.currency,
      accountingProvider: ACCOUNTING_PROVIDERS.QUICKBOOKS,
      status: "AwaitingQuickBooks",
      reason: refundReason,
      requestedById: actorUserId,
    },
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: invoice.clientId,
    caseId: invoice.caseId,
    action: "invoice.refund_requested",
    details: `${invoice.invoiceNumber} refund of $${numericAmount.toFixed(2)} awaits completion in QuickBooks — ${refundReason}`,
    entityType: "invoiceRefund",
    entityId: refund.id,
  });

  return { ...refund, quickBooksUrl: quickBooksAppUrl("invoice", invoice.qbInvoiceId) };
}

// Executes a cash refund — called only from paymentApprovalService's
// processApprovedPayment, after an admin has approved the "invoice_refund"
// PaymentApproval entry (or immediately, when an admin submitted it
// themselves — see caseInvoiceController.createInvoiceRefund). Idempotent on
// approvalId so a retried approval never double-posts the ledger.
export async function completeCashInvoiceRefund(agencyId, { invoiceId, caseId, amount, reason, actorUserId, approvalId }) {
  if (approvalId) {
    const existingTransaction = await prisma.cashTransaction.findUnique({
      where: { paymentApprovalId: approvalId },
      include: { invoiceRefund: true },
    });
    if (existingTransaction?.invoiceRefund) return existingTransaction.invoiceRefund;
  }

  const { invoice, collected, committedRefunds, refundable } = await loadRefundableInvoice(agencyId, { caseId, invoiceId });
  if (invoice.accountingProvider !== ACCOUNTING_PROVIDERS.CASH) {
    throw createHttpError(409, "This invoice is not a CaseDesk Cash invoice.", "INVALID_STATE");
  }
  const { numericAmount, refundReason } = validateRefundAmountReason(amount, reason, refundable, invoice.currency);

  const transaction = await postApprovedCashTransaction({
    agencyId,
    paymentApprovalId: approvalId,
    clientId: invoice.clientId,
    caseId: invoice.caseId,
    caseInvoiceId: invoice.id,
    amount: -numericAmount,
    paymentDate: new Date().toISOString().slice(0, 10),
    note: refundReason,
    actorUserId,
    type: "Refund",
    customLedgerId: invoice.customLedgerId || null,
  });
  const refund = await prisma.invoiceRefund.upsert({
    where: { cashTransactionId: transaction.id },
    create: {
      agencyId,
      invoiceId: invoice.id,
      amount: numericAmount,
      currency: invoice.currency,
      accountingProvider: ACCOUNTING_PROVIDERS.CASH,
      status: "Completed",
      reason: refundReason,
      cashTransactionId: transaction.id,
      requestedById: actorUserId,
      completedAt: new Date(),
    },
    update: {},
  });
  const totalRefunded = money(committedRefunds + numericAmount);
  await prisma.caseInvoice.update({
    where: { id: invoice.id },
    data: { status: totalRefunded >= collected - 0.01 ? "Refunded" : "PartiallyRefunded" },
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: invoice.clientId,
    caseId: invoice.caseId,
    action: "invoice.cash_refunded",
    details: `${invoice.invoiceNumber} refund of $${numericAmount.toFixed(2)} recorded in CaseDesk Cash — ${refundReason}`,
    entityType: "invoiceRefund",
    entityId: refund.id,
  });
  await syncLeadInitialPaymentFromEvidence(agencyId, { clientId: invoice.clientId, caseId: invoice.caseId }).catch(() => {});

  return refund;
}

// Manual override for a QuickBooks refund request that never completed —
// staff either never finished it in QuickBooks, or the automated matcher
// found more than one same-amount pending refund for the client and refused
// to guess (see quickbooksWebhookService.applyCaseInvoiceRefundReceipt).
// Cash refunds never reach this state (they complete synchronously), so this
// only ever applies to QuickBooks-provider refunds.
export async function markInvoiceRefundFailed(agencyId, { refundId, actorUserId, note }) {
  const refund = await prisma.invoiceRefund.findFirst({ where: { id: refundId, agencyId }, include: { invoice: true } });
  if (!refund) throw createHttpError(404, "Refund not found.", "NOT_FOUND");
  if (!["Requested", "AwaitingQuickBooks"].includes(refund.status)) {
    throw createHttpError(409, "Only a refund still awaiting QuickBooks can be marked failed.", "INVALID_STATE");
  }
  const updated = await prisma.invoiceRefund.update({
    where: { id: refund.id },
    data: { status: "Failed", reason: [refund.reason, note ? `Marked failed: ${note}` : "Marked failed by staff"].filter(Boolean).join(" — ").slice(0, 500) },
  });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: refund.invoice?.clientId,
    caseId: refund.invoice?.caseId,
    action: "invoice.refund_failed",
    details: `${refund.invoice?.invoiceNumber || "Invoice"} refund of $${Number(refund.amount).toFixed(2)} marked failed${note ? ` — ${note}` : ""}`,
    entityType: "invoiceRefund",
    entityId: refund.id,
  });
  return updated;
}
