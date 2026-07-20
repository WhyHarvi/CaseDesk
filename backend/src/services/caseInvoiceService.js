import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { notifyUsers } from "./notificationService.js";
import { syncClientToQuickBooks } from "./clientQuickBooksSyncService.js";
import {
  createQuickBooksInvoice,
  createQuickBooksReceivePayment,
  getQuickBooksInvoicesByIds,
} from "./quickbooksService.js";

const PAYMENT_TYPES = { fees: "Professional fees", disbursement: "Government fee disbursement" };

function deriveStatus(row) {
  const balance = Number(row.balance);
  const amount = Number(row.amount);
  if (balance <= 0) return "Paid";
  if (balance < amount) return "PartiallyPaid";
  if (row.dueDate && new Date(row.dueDate) < new Date()) return "Overdue";
  return "Open";
}

async function requireMappedItem(agencyId, paymentType) {
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

  const itemId = await requireMappedItem(agencyId, paymentType);

  let client = await prisma.client.findUnique({ where: { id: caseItem.clientId } });
  if (!client.qbCustomerId) {
    client = await syncClientToQuickBooks(agencyId, client.id);
    if (!client?.qbCustomerId) {
      throw createHttpError(409, client?.qbSyncError || "This client could not be linked to QuickBooks yet.", "QBO_CLIENT_NOT_LINKED");
    }
  }

  const invoice = await createQuickBooksInvoice(agencyId, {
    customerId: client.qbCustomerId,
    itemId,
    description: trimmedDescription,
    amount: numericAmount,
    dueDate: dueDate || undefined,
  });

  const now = new Date();
  const row = await prisma.caseInvoice.create({
    data: {
      agencyId,
      caseId,
      clientId: client.id,
      paymentType,
      description: trimmedDescription,
      qbInvoiceId: invoice.id,
      qbInvoiceNumber: invoice.docNumber,
      qbSyncToken: invoice.syncToken,
      amount: numericAmount,
      balance: invoice.balance,
      status: deriveStatus({ balance: invoice.balance, amount: numericAmount, dueDate: invoice.dueDate }),
      dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
      createdById: actorUserId,
      lastSyncedAt: now,
    },
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: client.id,
    caseId,
    action: "invoice.created",
    details: `${PAYMENT_TYPES[paymentType]} invoice for $${numericAmount.toFixed(2)} created — ${trimmedDescription}`,
    entityType: "caseInvoice",
    entityId: row.id,
  });

  try {
    const recipientIds = await clientPortalRecipientIds(client.id);
    if (recipientIds.length) {
      await notifyUsers({
        agencyId,
        recipientIds,
        actorUserId,
        type: "invoice.created",
        category: "cases",
        title: "New invoice",
        body: `${trimmedDescription} — $${numericAmount.toFixed(2)}`,
        severity: "info",
        entityType: "caseInvoice",
        entityId: row.id,
        actionUrl: "/client-portal/payments",
        dedupeKey: `invoice-created:${row.id}`,
      });
    }
  } catch {
    // Notifying the client is best-effort — the invoice itself already
    // exists in QuickBooks and CaseDesk, so a notification hiccup here
    // must never surface as a failure to the staff member who just billed.
  }

  return row;
}

async function clientPortalRecipientIds(clientId) {
  const links = await prisma.clientUser.findMany({ where: { clientId }, select: { userId: true } });
  return links.map((link) => link.userId);
}

export async function listCaseInvoices(agencyId, caseId) {
  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { id: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");

  const rows = await prisma.caseInvoice.findMany({ where: { agencyId, caseId }, orderBy: { createdAt: "desc" } });
  if (!rows.length) return [];

  let live = [];
  try {
    live = await getQuickBooksInvoicesByIds(agencyId, rows.map((row) => row.qbInvoiceId));
  } catch {
    // Live refresh is best-effort — fall back to the last-known cached
    // values rather than failing the whole billing tab over a QBO blip.
    return rows;
  }
  const liveById = new Map(live.map((invoice) => [invoice.id, invoice]));

  return Promise.all(
    rows.map(async (row) => {
      const fresh = liveById.get(row.qbInvoiceId);
      if (!fresh) return row;
      const status = deriveStatus({ balance: fresh.balance, amount: row.amount, dueDate: fresh.dueDate });
      if (Number(fresh.balance) === Number(row.balance) && status === row.status) return row;
      return prisma.caseInvoice.update({
        where: { id: row.id },
        data: { balance: fresh.balance, status, qbSyncToken: fresh.syncToken, qbInvoiceNumber: fresh.docNumber, lastSyncedAt: new Date() },
      });
    }),
  );
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
      status: deriveStatus({ balance: newBalance, amount: row.amount, dueDate: refreshed?.dueDate || row.dueDate }),
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
