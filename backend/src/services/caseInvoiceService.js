import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { logger } from "./logger.js";
import { notifyInvoiceCreated } from "./paymentNotificationService.js";
import { syncClientToQuickBooks } from "./clientQuickBooksSyncService.js";
import {
  createQuickBooksInvoice,
  createQuickBooksReceivePayment,
  getQuickBooksInvoicePdf,
  getQuickBooksInvoicesByIds,
} from "./quickbooksService.js";

export const PAYMENT_TYPES = { fees: "Professional fees", disbursement: "Government fee disbursement" };

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
  const itemId = paymentType === "fees" ? settings.feeItemId : settings.disbursementItemId;
  if (!itemId) {
    throw createHttpError(409, `Map a QuickBooks item for ${PAYMENT_TYPES[paymentType]} in Settings before invoicing.`, "QBO_MAPPING_REQUIRED");
  }
  return itemId;
}

/**
 * Resolves the mapped QuickBooks item, links the client if needed, creates
 * the QuickBooks invoice, and persists the CaseInvoice row. No validation,
 * activity logging, or notification — callers (manual creation, schedule
 * triggers) each layer those on since the details differ between them.
 */
export async function createInvoiceRecord(agencyId, { caseId, clientId, paymentType, description, amount, dueDate, actorUserId }) {
  const itemId = await requireMappedItem(agencyId, paymentType);

  let client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client.qbCustomerId) {
    client = await syncClientToQuickBooks(agencyId, client.id);
    if (!client?.qbCustomerId) {
      throw createHttpError(409, client?.qbSyncError || "This client could not be linked to QuickBooks yet.", "QBO_CLIENT_NOT_LINKED");
    }
  }

  let invoice;
  try {
    invoice = await createQuickBooksInvoice(agencyId, {
      customerId: client.qbCustomerId,
      itemId,
      description,
      amount,
      dueDate: dueDate || undefined,
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
    });
  }

  const row = await prisma.caseInvoice.create({
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
      lastSyncedAt: new Date(),
    },
  });
  return row;
}

export async function createCaseInvoice(agencyId, { caseId, paymentType, description, amount, dueDate, actorUserId }) {
  if (!PAYMENT_TYPES[paymentType]) throw createHttpError(400, "Choose a valid payment type.", "VALIDATION_ERROR");
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
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: row.clientId,
    caseId,
    action: "invoice.created",
    details: `${PAYMENT_TYPES[paymentType]} invoice for $${numericAmount.toFixed(2)} created — ${trimmedDescription}`,
    entityType: "caseInvoice",
    entityId: row.id,
  });

  // Best-effort on every channel — a notification hiccup here must never
  // surface as a failure to the staff member who just billed.
  await notifyInvoiceCreated({ agencyId, invoice: row, actorUserId }).catch((error) => {
    logger.warn("invoice.notify_failed", { agencyId, invoiceId: row.id, reason: error.message });
  });

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
  return refreshInvoiceRows(agencyId, rows);
}

// Client-portal reader: scoped by clientId (resolved server-side from the
// caller's ClientUser link, never from a client-supplied id) so it covers
// every case that client has, not just one.
export async function listClientInvoices(agencyId, clientId) {
  const rows = await prisma.caseInvoice.findMany({ where: { agencyId, clientId }, orderBy: { createdAt: "desc" } });
  return refreshInvoiceRows(agencyId, rows);
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

export async function recordCashPayment(agencyId, { caseId, invoiceId, amount, note, actorUserId }) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw createHttpError(400, "Enter a payment amount greater than $0.", "VALIDATION_ERROR");
  }
  const row = await prisma.caseInvoice.findFirst({ where: { id: invoiceId, agencyId, caseId } });
  if (!row) throw createHttpError(404, "Invoice not found.", "NOT_FOUND");
  if (numericAmount > Number(row.balance) + 0.01) {
    throw createHttpError(400, `That's more than the outstanding balance of $${Number(row.balance).toFixed(2)}.`, "VALIDATION_ERROR");
  }
  const client = await prisma.client.findUnique({ where: { id: row.clientId }, select: { qbCustomerId: true } });
  if (!client?.qbCustomerId) throw createHttpError(409, "This client is not linked to QuickBooks.", "QBO_CLIENT_NOT_LINKED");

  await createQuickBooksReceivePayment(agencyId, { customerId: client.qbCustomerId, invoiceId: row.qbInvoiceId, amount: numericAmount });

  const [refreshed] = await getQuickBooksInvoicesByIds(agencyId, [row.qbInvoiceId]);
  const newBalance = refreshed ? refreshed.balance : Math.max(0, Number(row.balance) - numericAmount);
  const updated = await prisma.caseInvoice.update({
    where: { id: row.id },
    data: {
      balance: newBalance,
      status: deriveCaseInvoiceStatus({ balance: newBalance, amount: row.amount, dueDate: refreshed?.dueDate || row.dueDate }),
      qbSyncToken: refreshed?.syncToken || row.qbSyncToken,
      lastSyncedAt: new Date(),
    },
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: row.clientId,
    caseId,
    action: "invoice.cash_payment_recorded",
    details: `Cash payment of $${numericAmount.toFixed(2)} recorded against ${row.description}${note ? ` — ${note}` : ""}`,
    entityType: "caseInvoice",
    entityId: row.id,
  });

  return updated;
}
