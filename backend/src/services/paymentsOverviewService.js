import prisma from "./prisma/client.js";
import { applyLocalCashToInvoice } from "./paymentApprovalLedgerService.js";
import { logger } from "./logger.js";
import { reconcileAgencyBookingRefunds } from "./quickbooksWebhookService.js";
import { listFeeCategories } from "./feeCategoryService.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  getQuickBooksCustomer,
  getQuickBooksRefundReceipt,
  listQuickBooksInvoicesForCustomer,
  listQuickBooksPaymentsForCustomer,
  quickBooksAppUrl,
} from "./quickbooksService.js";

const MAX_ROWS_PER_SOURCE = 1000;

const CASE_INVOICE_TYPE_LABEL = { fees: "Professional fees", disbursement: "Government fee disbursement" };

function cashDayBounds(day) {
  const text = String(day || new Date().toISOString().slice(0, 10)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Object.assign(new Error("Choose a valid cash-closing date."), { statusCode: 400, code: "VALIDATION_ERROR" });
  const start = new Date(`${text}T00:00:00.000Z`);
  const end = new Date(`${text}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime())) throw Object.assign(new Error("Choose a valid cash-closing date."), { statusCode: 400, code: "VALIDATION_ERROR" });
  return { text, start, end };
}

// A cash closing is a running balance, not a same-day-only total — the
// point is to check "does what's physically in the drawer match what the
// system thinks is there," and the drawer doesn't reset to zero every
// midnight. So "expected" for a given closing date = the opening balance
// carried forward from the last closed reconciliation (0 if this agency has
// never closed cash before) + every Posted cash movement between that prior
// close and the end of the selected day. receiptCount/refundCount cover
// that same cumulative window, not just the selected calendar day.
async function cashDayTotals(agencyId, day) {
  const bounds = cashDayBounds(day);
  const priorClosing = await prisma.cashReconciliation.findFirst({
    where: { agencyId, periodEnd: { lt: bounds.start } },
    orderBy: { periodEnd: "desc" },
    select: { countedAmount: true, periodEnd: true },
  });
  const openingBalance = Math.round(Number(priorClosing?.countedAmount || 0) * 100) / 100;
  const sinceExclusive = priorClosing?.periodEnd || null;
  const rows = await prisma.cashTransaction.findMany({
    where: {
      agencyId,
      status: "Posted",
      occurredAt: { ...(sinceExclusive ? { gt: sinceExclusive } : {}), lte: bounds.end },
    },
    select: { type: true, amount: true },
  });
  const movement = Math.round(rows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100;
  return {
    ...bounds,
    openingBalance,
    movement,
    expectedAmount: Math.round((openingBalance + movement) * 100) / 100,
    receiptCount: rows.filter((row) => row.type !== "Refund").length,
    refundCount: rows.filter((row) => row.type === "Refund").length,
  };
}

// "Cash on hand" the way an office would actually track a cash drawer: start
// from the last physically-counted balance (the most recent closed
// CashReconciliation), then add net Posted cash movement since that count.
// If cash has never been reconciled yet, this is just the all-time net
// Posted CashTransaction total.
export async function getCashOnHand(agencyId) {
  const lastClosing = await prisma.cashReconciliation.findFirst({
    where: { agencyId },
    orderBy: { periodEnd: "desc" },
    select: { countedAmount: true, periodEnd: true },
  });
  const baseline = Number(lastClosing?.countedAmount || 0);
  const since = lastClosing?.periodEnd || null;
  const movement = await prisma.cashTransaction.aggregate({
    where: { agencyId, status: "Posted", ...(since ? { occurredAt: { gt: since } } : {}) },
    _sum: { amount: true },
  });
  return Math.round((baseline + Number(movement._sum.amount || 0)) * 100) / 100;
}

// Detail behind the Cash On Hand KPI: the baseline it's carrying forward
// from (the last closing, if any) plus every Posted cash movement counted
// since then — exactly the two numbers getCashOnHand() adds together.
export async function listCashLedgerActivity(agencyId, { limit = 100 } = {}) {
  const lastClosing = await prisma.cashReconciliation.findFirst({
    where: { agencyId },
    orderBy: { periodEnd: "desc" },
    select: { countedAmount: true, periodEnd: true, closedAt: true },
  });
  const baseline = Math.round(Number(lastClosing?.countedAmount || 0) * 100) / 100;
  const since = lastClosing?.periodEnd || null;
  const rows = await prisma.cashTransaction.findMany({
    where: { agencyId, status: "Posted", ...(since ? { occurredAt: { gt: since } } : {}) },
    include: {
      client: { select: { fullName: true } },
      case: { select: { caseType: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  const movement = Math.round(rows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100;
  return {
    baseline,
    baselineAsOf: lastClosing?.periodEnd || null,
    baselineClosedAt: lastClosing?.closedAt || null,
    currentBalance: Math.round((baseline + movement) * 100) / 100,
    activity: rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      occurredAt: row.occurredAt,
      clientName: row.client?.fullName || null,
      caseType: row.case?.caseType || null,
      reference: row.reference,
      note: row.note,
    })),
  };
}

// Detail behind the QuickBooks Sync Failures KPI — the actual webhook
// events stuck in status FAILED, with whatever QuickBooks/our worker last
// reported as the error, so an admin can see what's failing without
// digging through logs.
export async function listQuickBooksSyncFailures(agencyId, { limit = 100 } = {}) {
  const rows = await prisma.quickBooksWebhookEvent.findMany({
    where: { agencyId, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    entityName: row.entityName,
    entityId: row.entityId,
    operation: row.operation,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
  }));
}

export async function getCashReconciliation(agencyId, day) {
  const totals = await cashDayTotals(agencyId, day);
  const closing = await prisma.cashReconciliation.findUnique({
    where: { agencyId_periodStart: { agencyId, periodStart: totals.start } },
    include: { closedBy: { select: { id: true, fullName: true } } },
  });
  return { day: totals.text, openingBalance: totals.openingBalance, movement: totals.movement, expectedAmount: totals.expectedAmount, receiptCount: totals.receiptCount, refundCount: totals.refundCount, closing };
}

export async function closeCashReconciliation(agencyId, { day, countedAmount, note, actorUserId }) {
  const totals = await cashDayTotals(agencyId, day);
  const counted = Math.round(Number(countedAmount) * 100) / 100;
  if (!Number.isFinite(counted) || counted < 0 || counted > 10_000_000) throw Object.assign(new Error("Enter the physical cash amount counted."), { statusCode: 400, code: "VALIDATION_ERROR" });
  const closing = await prisma.cashReconciliation.upsert({
    where: { agencyId_periodStart: { agencyId, periodStart: totals.start } },
    create: {
      agencyId, periodStart: totals.start, periodEnd: totals.end,
      expectedAmount: totals.expectedAmount, countedAmount: counted,
      varianceAmount: Math.round((counted - totals.expectedAmount) * 100) / 100,
      receiptCount: totals.receiptCount, refundCount: totals.refundCount,
      note: String(note || "").trim().slice(0, 500) || null,
      closedById: actorUserId,
    },
    update: {
      periodEnd: totals.end, expectedAmount: totals.expectedAmount,
      countedAmount: counted, varianceAmount: Math.round((counted - totals.expectedAmount) * 100) / 100,
      receiptCount: totals.receiptCount, refundCount: totals.refundCount,
      note: String(note || "").trim().slice(0, 500) || null,
      closedById: actorUserId, closedAt: new Date(), status: "Closed",
    },
    include: { closedBy: { select: { id: true, fullName: true } } },
  });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    action: "cash.reconciliation_closed",
    details: `Cash closing for ${totals.text}: system $${totals.expectedAmount.toFixed(2)}, counted $${counted.toFixed(2)}, variance $${Number(closing.varianceAmount).toFixed(2)}`,
    entityType: "cashReconciliation",
    entityId: closing.id,
  }).catch(() => {});
  return { day: totals.text, openingBalance: totals.openingBalance, movement: totals.movement, expectedAmount: totals.expectedAmount, receiptCount: totals.receiptCount, refundCount: totals.refundCount, closing };
}

// Surfaces case-invoice refunds still waiting on QuickBooks so an admin can
// see and, if it's genuinely stuck (nobody ever finished it in QuickBooks,
// or the automatic matcher found more than one same-amount candidate and
// refused to guess — see quickbooksWebhookService.applyCaseInvoiceRefundReceipt),
// mark it Failed instead of it silently sitting unresolved forever. Cash
// refunds never appear here — they complete synchronously and never enter
// the AwaitingQuickBooks state.
export async function listStuckInvoiceRefunds(agencyId) {
  const rows = await prisma.invoiceRefund.findMany({
    where: { agencyId, accountingProvider: "QuickBooks", status: "AwaitingQuickBooks" },
    include: {
      invoice: { select: { id: true, invoiceNumber: true, qbInvoiceNumber: true, caseId: true, clientId: true, client: { select: { id: true, fullName: true } } } },
      requestedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    reason: row.reason,
    createdAt: row.createdAt,
    ageDays: Math.floor((now - new Date(row.createdAt).getTime()) / 86_400_000),
    invoice: row.invoice ? { id: row.invoice.id, invoiceNumber: row.invoice.invoiceNumber, qbInvoiceNumber: row.invoice.qbInvoiceNumber, caseId: row.invoice.caseId } : null,
    client: row.invoice?.client || null,
    requestedBy: row.requestedBy,
  }));
}

export async function getConsultationRefundReview(agencyId, refundReceiptId) {
  const refund = await getQuickBooksRefundReceipt(agencyId, refundReceiptId);
  const refundAt = new Date(refund.createdAt || refund.transactionDate || Date.now());
  const validRefundAt = Number.isNaN(refundAt.getTime()) ? new Date() : refundAt;

  const [
    matchedHold,
    relatedHolds,
    quickBooksCustomer,
    quickBooksInvoices,
    quickBooksPayments,
    caseDeskClient,
  ] = await Promise.all([
    prisma.bookingPaymentHold.findFirst({
      where: { agencyId, qbRefundReceiptId: refund.id },
      include: {
        client: { select: { id: true, fullName: true } },
        appointment: {
          select: {
            id: true,
            subject: true,
            status: true,
            startsAt: true,
            clientId: true,
            client: { select: { id: true, fullName: true } },
          },
        },
      },
    }),
    refund.customerId
      ? prisma.bookingPaymentHold.findMany({
          where: {
            agencyId,
            qbCustomerId: refund.customerId,
            createdAt: {
              gte: new Date(validRefundAt.getTime() - 90 * 86_400_000),
              lte: validRefundAt,
            },
          },
          include: {
            client: { select: { id: true, fullName: true } },
            appointment: {
              select: {
                id: true,
                subject: true,
                status: true,
                startsAt: true,
                clientId: true,
                client: { select: { id: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [],
    refund.customerId
      ? getQuickBooksCustomer(agencyId, refund.customerId)
      : null,
    refund.customerId
      ? listQuickBooksInvoicesForCustomer(agencyId, refund.customerId)
      : [],
    refund.customerId
      ? listQuickBooksPaymentsForCustomer(agencyId, refund.customerId)
      : [],
    refund.customerId
      ? prisma.client.findFirst({
          where: { agencyId, qbCustomerId: refund.customerId },
          select: {
            id: true,
            clientNumber: true,
            fullName: true,
            email: true,
            status: true,
          },
        })
      : null,
  ]);

  const holds = matchedHold
    ? [matchedHold, ...relatedHolds.filter((item) => item.id !== matchedHold.id)]
    : relatedHolds;
  const refundTime = validRefundAt.getTime();
  const likelyPayments = quickBooksPayments
    .filter((payment) => Number(payment.totalAmount) === Number(refund.totalAmount))
    .map((payment) => ({
      ...payment,
      distanceMs: Math.abs(
        refundTime -
          new Date(payment.createdAt || payment.transactionDate || 0).getTime(),
      ),
    }))
    .filter(
      (payment) =>
        Number.isFinite(payment.distanceMs) &&
        payment.distanceMs <= 7 * 86_400_000,
    )
    .sort((left, right) => left.distanceMs - right.distanceMs)
    .slice(0, 5);
  const invoiceById = new Map(
    quickBooksInvoices.map((invoice) => [String(invoice.id), invoice]),
  );

  return {
    refund: {
      ...refund,
      quickBooksUrl: quickBooksAppUrl("refundreceipt", refund.id),
    },
    customer: quickBooksCustomer
      ? {
          ...quickBooksCustomer,
          caseDeskClient,
        }
      : refund.customerId
        ? {
            id: refund.customerId,
            displayName: refund.customerName,
            email: null,
            caseDeskClient,
          }
        : null,
    quickBooksPayments: likelyPayments.map((payment, index) => ({
      id: payment.id,
      totalAmount: payment.totalAmount,
      unappliedAmount: payment.unappliedAmount,
      transactionDate: payment.transactionDate,
      createdAt: payment.createdAt,
      paymentReference: payment.paymentReference,
      methodName: payment.methodName,
      cardStatus: payment.cardStatus,
      currency: payment.currency,
      quickBooksUrl: quickBooksAppUrl("recvpayment", payment.id),
      likelyOrigin: index === 0,
      linkedInvoices: payment.allocations.map((allocation) => {
        const invoice = invoiceById.get(String(allocation.invoiceId));
        return {
          id: allocation.invoiceId,
          amount: allocation.amount,
          docNumber: invoice?.docNumber || null,
          totalAmount: invoice?.totalAmount ?? null,
          balance: invoice?.balance ?? null,
          quickBooksUrl: quickBooksAppUrl("invoice", allocation.invoiceId),
        };
      }),
    })),
    state: matchedHold
      ? "matched"
      : holds.some((item) => Number(item.amount) === Number(refund.totalAmount))
        ? "possible_match"
        : "unmatched",
    matchedHoldId: matchedHold?.id || null,
    candidates: holds.map((hold) => ({
      id: hold.id,
      guestName:
        hold.client?.fullName ||
        hold.appointment?.client?.fullName ||
        hold.guestName,
      amount: Number(hold.amount),
      status: hold.status,
      createdAt: hold.createdAt,
      paidAt: hold.paidAt,
      appointment: hold.appointment,
      clientId:
        hold.client?.id ||
        hold.appointment?.client?.id ||
        hold.appointment?.clientId ||
        null,
      amountMatches: Number(hold.amount) === Number(refund.totalAmount),
      isMatched: hold.id === matchedHold?.id,
    })),
  };
}

// Every source has its own status vocabulary — normalize to one set so the
// admin table and filters don't need to know where a row came from.
export function normalizeCaseInvoiceStatus(status) {
  if (status === "PartiallyPaid") return "PartiallyPaid";
  if (status === "Void" || status === "Voided") return "Voided";
  return status; // Open | Paid | Overdue already match the unified set
}

function normalizeBookingStatus(status) {
  if (["AwaitingPayment", "Confirming", "RecordingPayment", "PaymentFailed"].includes(status)) return "Open";
  if (["Expired", "Cancelled", "Failed"].includes(status)) return "Voided";
  return status; // Paid | Voided already match
}

function normalizeLegacyStatus(status) {
  if (status === "Unpaid") return "Open";
  if (status === "Partial") return "PartiallyPaid";
  return status; // Paid | Refunded
}

export function netCollectedAmount(row) {
  if (row.status === "Voided" || row.status === "Refunded") return 0;
  return Math.max(0, Number(row.amount) - Number(row.balance) - Number(row.completedRefundAmount || 0));
}

function isCashLedgerRow(row) {
  return row.ledger === "CaseDesk Cash" || (row.source === "booking_payment" && row.paymentMethod === "Cash");
}

// Every "info box" on the Payments dashboard is a sum/count over some
// predicate on this same combined row set — a bucket here is just that same
// predicate, so clicking a box shows exactly the transactions behind its
// number instead of a filter that only coincidentally lines up.
const BUCKET_FILTERS = {
  collected: (row) => !row.transactionOnly && !row.excludedFromTotals && netCollectedAmount(row) > 0,
  cash_collected: (row) => !row.transactionOnly && !row.excludedFromTotals && netCollectedAmount(row) > 0 && isCashLedgerRow(row),
  noncash_collected: (row) => !row.transactionOnly && !row.excludedFromTotals && netCollectedAmount(row) > 0 && !isCashLedgerRow(row),
  outstanding: (row) => row.status !== "Voided" && Number(row.balance) > 0,
  overdue: (row) => row.status === "Overdue",
  refunded: (row) => Number(row.completedRefundAmount || 0) > 0 || row.status === "Refunded",
};

async function fetchCaseInvoiceRows(agencyId, { from, to }) {
  const [rows, categories] = await Promise.all([prisma.caseInvoice.findMany({
    where: { agencyId, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: {
      client: { select: { fullName: true, email: true } },
      case: { select: { caseType: true } },
      paymentApprovals: { where: { status: "Approved", method: "Cash" }, orderBy: { paymentDate: "desc" } },
      refunds: { where: { status: { in: ["Requested", "AwaitingQuickBooks", "Completed"] } }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  }), listFeeCategories(agencyId, { includeInactive: true })]);
  const labels = new Map(categories.map((category) => [category.code, category.name]));
  return rows.map((rawRow) => {
    const row = applyLocalCashToInvoice(rawRow);
    const status = normalizeCaseInvoiceStatus(row.status);
    const completedRefundAmount = (row.refunds || [])
      .filter((refund) => refund.status === "Completed")
      .reduce((total, refund) => total + Number(refund.amount || 0), 0);
    return {
      id: `case_invoice:${row.id}`,
      recordId: row.id,
      source: "case_invoice",
      ledger: row.accountingProvider === "CaseDeskCash" ? "CaseDesk Cash" : "QuickBooks",
      type: labels.get(row.paymentType) || CASE_INVOICE_TYPE_LABEL[row.paymentType] || row.paymentType,
      description: row.description,
      clientName: row.client?.fullName || "Unknown client",
      clientId: row.clientId,
      caseId: row.caseId,
      caseType: row.case?.caseType || null,
      amount: Number(row.amount),
      balance: Number(row.balance),
      status,
      invoiceNumber: row.invoiceNumber,
      qbInvoiceNumber: row.qbInvoiceNumber,
      qbInvoiceLink: row.qbInvoiceLink,
      qbRefundUrl: quickBooksAppUrl("invoice", row.qbInvoiceId),
      paymentMethod: row.lastPaymentMethod === "ETransfer" ? "E-transfer" : row.lastPaymentMethod,
      paymentReference: row.lastPaymentReference,
      qbPaymentId: row.lastQbPaymentId,
      createdAt: row.createdAt,
      paidAt: status === "Paid" ? row.updatedAt : null,
      dueDate: row.dueDate,
      refunds: row.refunds,
      completedRefundAmount,
    };
  });
}

async function fetchCashTransactionRows(agencyId, { from, to }) {
  const rows = await prisma.cashTransaction.findMany({
    where: { agencyId, ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: {
      client: { select: { fullName: true } },
      case: { select: { caseType: true } },
      allocations: { include: { invoice: { select: { invoiceNumber: true, description: true } } } },
    },
    orderBy: { occurredAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  });
  // A cash payment allocated to a case invoice already shows up as that
  // invoice's row (its balance/status/lastPaymentMethod already reflect the
  // payment) — listing the underlying CashTransaction too would show the
  // same payment twice. Refunds and unallocated cash (client credit, or a
  // payment not tied to any invoice) have no other row representing them,
  // so those stay.
  return rows
    .filter((row) => !(row.type === "Payment" && row.allocations.length > 0))
    .map((row) => ({
    id: `cash_transaction:${row.id}`,
    recordId: row.id,
    source: "cash_transaction",
    ledger: "CaseDesk Cash",
    type: row.type === "Refund" ? "Cash refund" : "Cash receipt",
    description: row.allocations[0]?.invoice?.description || row.note || "Cash transaction",
    clientName: row.client?.fullName || "Unknown client",
    clientId: row.clientId,
    caseId: row.caseId,
    caseType: row.case?.caseType || null,
    amount: Math.abs(Number(row.amount)),
    balance: 0,
    status: row.status === "Posted" ? (row.type === "Refund" ? "Refunded" : "Paid") : row.status,
    invoiceNumber: row.allocations[0]?.invoice?.invoiceNumber || null,
    qbInvoiceNumber: null,
    qbInvoiceLink: null,
    qbRefundUrl: null,
    paymentMethod: "Cash",
    paymentReference: row.reference,
    createdAt: row.occurredAt,
    paidAt: row.occurredAt,
    dueDate: null,
    transactionOnly: true,
  }));
}

async function fetchLegacyManualLedgerRows(agencyId) {
  const rows = await prisma.caseManualLedgerEntry.findMany({
    where: { agencyId, migratedAt: null },
    include: { client: { select: { fullName: true } }, case: { select: { caseType: true } }, lead: { select: { firstName: true, lastName: true, leadNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  });
  return rows.map((row) => ({
    id: `manual_ledger_review:${row.id}`,
    recordId: row.id,
    source: "manual_ledger_review",
    ledger: "Needs classification",
    type: "Legacy entry · review required",
    description: row.label,
    clientName: row.client?.fullName || [row.lead?.firstName, row.lead?.lastName].filter(Boolean).join(" ") || row.lead?.leadNumber || "Unknown",
    clientId: row.clientId,
    caseId: row.caseId,
    caseType: row.case?.caseType || null,
    amount: Number(row.amountOwed),
    balance: Math.max(0, Number(row.amountOwed) - Number(row.amountPaid)),
    status: "NeedsClassification",
    paymentMethod: null,
    createdAt: row.createdAt,
    paidAt: null,
    dueDate: null,
    excludedFromTotals: true,
  }));
}

async function fetchBookingPaymentRows(agencyId, { from, to }) {
  const rows = await prisma.bookingPaymentHold.findMany({
    where: { agencyId, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: {
      client: { select: { fullName: true } },
      appointment: { select: { id: true, status: true, clientId: true, startsAt: true, client: { select: { fullName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  });
  return rows.map((row) => ({
    id: `booking_payment:${row.id}`,
    recordId: row.id,
    source: "booking_payment",
    type: row.source === "WalkIn" ? "Consultation (walk-in)" : "Consultation booking",
    description: `Consultation fee${row.paymentMethod ? ` · ${row.paymentMethod === "ETransfer" ? "E-transfer" : row.paymentMethod}` : ""}`,
    clientName: row.client?.fullName || row.appointment?.client?.fullName || row.guestName,
    clientId: row.clientId || row.appointment?.clientId || null,
    // A hold only gets a linked appointment once payment is confirmed —
    // an AwaitingPayment hold has neither, so "what this payment is about"
    // falls back to the client (or is simply not clickable, on the
    // frontend, if there's no client either).
    appointmentId: row.appointmentId,
    appointmentStartsAt: row.appointment?.startsAt || null,
    caseId: null,
    caseType: null,
    amount: Number(row.amount),
    balance: ["Paid", "Refunded"].includes(row.status) ? 0 : Number(row.amount),
    status: normalizeBookingStatus(row.status),
    bookingStatus: row.status,
    // The hold's own status only tracks money collected/refunded — it has
    // no idea the linked appointment was later cancelled. Cancelling never
    // touches this row (refunding is a manual QuickBooks action, see
    // appointmentController.js), so without this flag a cancelled-but-paid
    // consult shows as a plain "Paid" row forever with no signal a refund
    // may be owed.
    refundOwed: row.status === "Paid" && row.appointment?.status === "Cancelled",
    // The reverse of refundOwed: a refund landed in QuickBooks (via the
    // RefundReceipt webhook/sweep) but nothing here ever cancels the
    // appointment automatically — deliberately, since auto-cancelling a
    // client's real meeting off a QuickBooks event with no other context
    // could surprise them if the refund was partial or for an unrelated
    // reason. This just makes the mismatch visible so staff decide.
    appointmentNotCancelled: row.status === "Refunded" && row.appointment?.status === "Scheduled",
    // A slot-conflict at payment confirmation (the hold expired and
    // someone else took the slot right as this payment landed) leaves a
    // hold "Paid" with no appointment ever created — walk-in holds always
    // have one from the moment they're created, so its absence here is the
    // actual signal, not just checking appointmentId in general.
    needsManualBooking: row.status === "Paid" && row.source !== "WalkIn" && !row.appointmentId,
    // Set by the periodic balance-mismatch sweep (bookingPaymentHoldService.js)
    // when a "Paid" hold's real QuickBooks invoice no longer shows a zero
    // balance — usually a Payment deleted directly in QuickBooks rather
    // than properly refunded, which produces no RefundReceipt for the
    // normal refund-matching path to ever pick up.
    balanceMismatch: Boolean(row.balanceMismatchAt),
    qbInvoiceNumber: row.qbInvoiceNumber,
    qbInvoiceLink: row.qbInvoiceLink,
    qbPaymentId: row.qbPaymentId,
    qbRefundUrl: quickBooksAppUrl("recvpayment", row.qbPaymentId) || quickBooksAppUrl("invoice", row.qbInvoiceId),
    paymentMethod: row.paymentMethod === "ETransfer" ? "E-transfer" : row.paymentMethod,
    paymentNote: row.manualPaymentNote,
    paymentReference: row.manualPaymentReference,
    paymentError: row.paymentError,
    paymentFailed: row.status === "PaymentFailed",
    eTransferPaymentPending: row.paymentMethod === "ETransfer"
      && ["AwaitingPayment", "Confirming", "RecordingPayment", "PaymentFailed"].includes(row.status)
      && (!row.manualPaymentReference || row.status === "PaymentFailed"),
    transactionReferenceMissing: row.paymentMethod === "ETransfer"
      && row.status === "Paid"
      && !row.manualPaymentReference,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    dueDate: null,
  }));
}

async function fetchMissingAppointmentPaymentRows(agencyId, { from, to }) {
  const [appointments, settings] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        agencyId,
        status: "Scheduled",
        isFreeConsultation: false,
        paymentHold: { is: null },
        OR: [{ seriesKey: null }, { recurrenceIndex: null }, { recurrenceIndex: 1 }],
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      select: {
        id: true,
        clientId: true,
        caseId: true,
        subject: true,
        guestName: true,
        startsAt: true,
        createdAt: true,
        client: { select: { fullName: true } },
        case: { select: { caseType: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS_PER_SOURCE,
    }),
    prisma.bookingSettings.findUnique({
      where: { agencyId },
      select: { consultFeeAmount: true },
    }),
  ]);
  const amount = Number(settings?.consultFeeAmount || 0);
  if (amount <= 0) return [];
  return appointments.map((appointment) => ({
    id: `appointment_payment_missing:${appointment.id}`,
    recordId: appointment.id,
    source: "booking_payment",
    type: "Consultation booking",
    description: "Consultation fee · payment not recorded",
    clientName: appointment.client?.fullName || appointment.guestName || "Unknown client",
    clientId: appointment.clientId,
    appointmentId: appointment.id,
    appointmentStartsAt: appointment.startsAt,
    caseId: appointment.caseId,
    caseType: appointment.case?.caseType || null,
    amount,
    balance: amount,
    status: "Open",
    bookingStatus: "MissingPayment",
    missingAppointmentPayment: true,
    qbInvoiceNumber: null,
    qbInvoiceLink: null,
    qbPaymentId: null,
    qbRefundUrl: null,
    paymentMethod: null,
    paymentReference: null,
    createdAt: appointment.createdAt,
    paidAt: null,
    dueDate: appointment.startsAt,
  }));
}

async function fetchLegacyPaymentRows(agencyId, { from, to }) {
  const rows = await prisma.payment.findMany({
    where: { agencyId, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: { client: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  });
  return rows.map((row) => ({
    id: `legacy_payment:${row.id}`,
    recordId: row.id,
    source: "legacy_payment",
    type: "Retainer (legacy)",
    description: row.notes || "Retainer payment",
    clientName: row.client?.fullName || "Unknown client",
    clientId: row.clientId,
    caseId: row.caseId,
    caseType: null,
    amount: Number(row.totalFee),
    balance: Number(row.balance),
    status: normalizeLegacyStatus(row.status),
    qbInvoiceNumber: null,
    qbInvoiceLink: null,
    // Legacy retainer payments predate the QuickBooks integration — there's
    // no QuickBooks transaction to navigate to for these.
    qbRefundUrl: null,
    createdAt: row.createdAt,
    paidAt: Number(row.balance) <= 0 ? row.updatedAt : null,
    dueDate: null,
  }));
}

/**
 * Merges CaseInvoice (case billing), BookingPaymentHold (consultation
 * bookings), and the legacy Payment model into one agency-wide list.
 * Fetched and normalized separately (Prisma has no cross-model UNION) then
 * merged/filtered/sorted/paginated in application code — simple and fast
 * enough at single-agency scale, capped per source as a safety valve.
 */
export async function listAgencyPayments(agencyId, { status, source, query, from, to, bucket, page = 1, pageSize = 25 } = {}) {
  await reconcileAgencyBookingRefunds(agencyId).catch((error) => {
    logger.warn("payments_overview.refund_reconcile_failed", { agencyId, reason: error.message });
  });
  // "to" is a date-only string ("YYYY-MM-DD") from the UI's date/month
  // pickers. Parsing it bare (`new Date(to)`) lands on UTC midnight, which
  // would silently exclude every transaction that happened later that same
  // day — pin it to the end of that day instead so "to" is inclusive.
  const dateRange = { from: from ? new Date(from) : null, to: to ? new Date(`${to}T23:59:59.999Z`) : null };
  const [caseInvoices, bookingPayments, missingAppointmentPayments, legacyPayments, cashTransactions, legacyManualRows] = await Promise.all([
    fetchCaseInvoiceRows(agencyId, dateRange),
    fetchBookingPaymentRows(agencyId, dateRange),
    fetchMissingAppointmentPaymentRows(agencyId, dateRange),
    fetchLegacyPaymentRows(agencyId, dateRange),
    fetchCashTransactionRows(agencyId, dateRange),
    fetchLegacyManualLedgerRows(agencyId),
  ]);

  let combined = [...caseInvoices, ...bookingPayments, ...missingAppointmentPayments, ...legacyPayments, ...cashTransactions, ...legacyManualRows];
  // Voided rows are clutter in the default view (an abandoned checkout, a
  // cancelled invoice draft) — real information, but not something staff
  // need to see mixed into "all payments" by default. Still fully visible
  // by explicitly filtering to it.
  combined = status ? combined.filter((row) => row.status === status) : combined.filter((row) => row.status !== "Voided");
  if (source) combined = combined.filter((row) => row.source === source);
  if (bucket && BUCKET_FILTERS[bucket]) combined = combined.filter(BUCKET_FILTERS[bucket]);
  if (query) {
    const needle = query.trim().toLowerCase();
    combined = combined.filter((row) => row.clientName.toLowerCase().includes(needle)
      || (row.invoiceNumber || "").toLowerCase().includes(needle)
      || (row.qbInvoiceNumber || "").toLowerCase().includes(needle)
      || (row.paymentMethod || "").toLowerCase().includes(needle));
  }
  combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = combined.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const rows = combined.slice(start, start + pageSize);
  return { rows, total, page: Math.max(1, page), pageSize };
}

// Bounds for a calendar month. `monthKey` is "YYYY-MM"; falls back to the
// current month when missing/invalid so the summary always has something
// sane to compute against.
function monthBounds(monthKey) {
  let year;
  let monthIndex;
  if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
    const [yearText, monthText] = monthKey.split("-");
    year = Number(yearText);
    monthIndex = Number(monthText) - 1;
  } else {
    const now = new Date();
    year = now.getFullYear();
    monthIndex = now.getMonth();
  }
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0); // exclusive
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
  const label = start.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  return { start, end, key, label };
}

// Trend-chart buckets at three granularities — day (last 30 days), month
// (last 8 months), year (last 5 years) — built from the same anchor date so
// switching granularity in the UI is just picking which of the three
// pre-computed series to render, not a new query.
function buildTrendSeries(kind, anchor) {
  const buckets = [];
  if (kind === "day") {
    for (let index = 29; index >= 0; index -= 1) {
      const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - index);
      buckets.push({ key: date.toISOString().slice(0, 10), label: date.toLocaleDateString("en-CA", { month: "short", day: "numeric" }), collected: 0, invoiced: 0 });
    }
  } else if (kind === "year") {
    for (let index = 4; index >= 0; index -= 1) {
      const date = new Date(anchor.getFullYear() - index, 0, 1);
      buckets.push({ key: String(date.getFullYear()), label: String(date.getFullYear()), collected: 0, invoiced: 0 });
    }
  } else {
    for (let index = 7; index >= 0; index -= 1) {
      const date = new Date(anchor.getFullYear(), anchor.getMonth() - index, 1);
      buckets.push({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, label: date.toLocaleDateString("en-CA", { month: "short" }), collected: 0, invoiced: 0 });
    }
  }
  return buckets;
}
function trendKeyOf(kind, value) {
  const date = new Date(value);
  if (kind === "day") return date.toISOString().slice(0, 10);
  if (kind === "year") return String(date.getFullYear());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
const TREND_KINDS = ["day", "month", "year"];

// Sums "flow" figures (money that moved) for a single calendar-month window
// — collected/cash/non-cash/refunded/net all "start from zero" every month
// by definition, unlike a balance such as Cash On Hand. `all` is the same
// merged row set getPaymentsSummary already builds; this just re-scans it
// against a different window, so selected-month and comparison-month totals
// stay perfectly consistent with each other and with the all-time totals.
function summarizeMonthWindow(all, bounds) {
  let collected = 0;
  let cashCollected = 0;
  let nonCashCollected = 0;
  let refunded = 0;
  let transactionCount = 0;
  for (const row of all) {
    if (row.transactionOnly || row.excludedFromTotals) continue;
    if (row.paidAt) {
      const paidDate = new Date(row.paidAt);
      if (paidDate >= bounds.start && paidDate < bounds.end) {
        const paidAmount = netCollectedAmount(row);
        collected += paidAmount;
        transactionCount += 1;
        if (isCashLedgerRow(row)) cashCollected += paidAmount;
        else nonCashCollected += paidAmount;
      }
    }
    for (const refund of row.refunds || []) {
      if (refund.status !== "Completed") continue;
      const refundDate = new Date(refund.createdAt);
      if (refundDate >= bounds.start && refundDate < bounds.end) refunded += Number(refund.amount || 0);
    }
  }
  return {
    key: bounds.key,
    label: bounds.label,
    collected: Math.round(collected * 100) / 100,
    cashCollected: Math.round(cashCollected * 100) / 100,
    nonCashCollected: Math.round(nonCashCollected * 100) / 100,
    refunded: Math.round(refunded * 100) / 100,
    net: Math.round((collected - refunded) * 100) / 100,
    transactionCount,
  };
}

export async function getPaymentsSummary(agencyId, { month } = {}) {
  await reconcileAgencyBookingRefunds(agencyId).catch((error) => {
    logger.warn("payments_summary.refund_reconcile_failed", { agencyId, reason: error.message });
  });
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [caseInvoices, bookingPayments, missingAppointmentPayments, legacyPayments, legacyManualRows, cashOnHand, pendingApprovalCount, quickBooksSyncFailures] = await Promise.all([
    fetchCaseInvoiceRows(agencyId, {}),
    fetchBookingPaymentRows(agencyId, {}),
    fetchMissingAppointmentPaymentRows(agencyId, {}),
    fetchLegacyPaymentRows(agencyId, {}),
    fetchLegacyManualLedgerRows(agencyId),
    getCashOnHand(agencyId),
    prisma.paymentApproval.count({ where: { agencyId, status: { in: ["Pending", "Failed"] } } }),
    prisma.quickBooksWebhookEvent.count({ where: { agencyId, status: "FAILED" } }),
  ]);
  const all = [...caseInvoices, ...bookingPayments, ...missingAppointmentPayments, ...legacyPayments, ...legacyManualRows];

  let totalCollected = 0;
  let outstandingBalance = 0;
  let paidThisMonth = 0;
  let paidLastMonth = 0;
  let overdueCount = 0;
  let totalRefunded = 0;
  const statusBreakdown = {};
  const typeBreakdown = {};

  // Three trend series (day/month/year), all anchored to today, built in
  // one pass over `all` below alongside the rest of the totals.
  const trendAnchor = new Date();
  const trendSeries = {};
  const trendByKeyByKind = {};
  for (const kind of TREND_KINDS) {
    trendSeries[kind] = buildTrendSeries(kind, trendAnchor);
    trendByKeyByKind[kind] = new Map(trendSeries[kind].map((item) => [item.key, item]));
  }
  const lastMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);

  for (const row of all) {
    if (row.transactionOnly || row.excludedFromTotals) continue;
    const paidAmount = netCollectedAmount(row);
    totalCollected += paidAmount;
    if (row.status !== "Voided") outstandingBalance += row.balance;
    if (row.paidAt) {
      const paidDate = new Date(row.paidAt);
      if (paidDate >= monthStart) paidThisMonth += paidAmount;
      else if (paidDate >= lastMonthStart) paidLastMonth += paidAmount;
      for (const kind of TREND_KINDS) {
        const bucket = trendByKeyByKind[kind].get(trendKeyOf(kind, paidDate));
        if (bucket) bucket.collected += paidAmount;
      }
    }
    if (row.status === "Overdue") overdueCount += 1;
    totalRefunded += Number(row.completedRefundAmount || 0);

    if (row.status !== "Voided" && !row.missingAppointmentPayment) {
      for (const kind of TREND_KINDS) {
        const invoicedBucket = trendByKeyByKind[kind].get(trendKeyOf(kind, row.createdAt));
        if (invoicedBucket) invoicedBucket.invoiced += row.amount;
      }
    }

    const statusEntry = statusBreakdown[row.status] || { count: 0, amount: 0 };
    statusEntry.count += 1;
    statusEntry.amount += row.amount;
    statusBreakdown[row.status] = statusEntry;

    const ledgerKey = row.ledger === "CaseDesk Cash"
      || (row.source === "booking_payment" && row.paymentMethod === "Cash")
      ? "casedesk_cash"
      : row.ledger === "QuickBooks" || row.source === "booking_payment"
        ? "quickbooks"
        : row.source;
    const typeEntry = typeBreakdown[ledgerKey] || { count: 0, collected: 0, outstanding: 0 };
    typeEntry.count += 1;
    typeEntry.collected += paidAmount;
    if (row.status !== "Voided") typeEntry.outstanding += row.balance;
    typeBreakdown[ledgerKey] = typeEntry;
  }

  // Selected-month view: defaults to the current month when no filter is
  // passed, plus the prior calendar month for a like-for-like comparison.
  // These are independent of the all-time totals above (totalCollected,
  // cashOnHand, etc. deliberately keep tracking everything since day one).
  const selectedBounds = monthBounds(month);
  const priorMonthAnchor = new Date(selectedBounds.start.getFullYear(), selectedBounds.start.getMonth() - 1, 1);
  const previousBounds = monthBounds(`${priorMonthAnchor.getFullYear()}-${String(priorMonthAnchor.getMonth() + 1).padStart(2, "0")}`);
  const selectedMonth = summarizeMonthWindow(all, selectedBounds);
  const previousMonth = summarizeMonthWindow(all, previousBounds);

  return {
    totalCollected,
    cashCollected: typeBreakdown.casedesk_cash?.collected || 0,
    nonCashCollected: typeBreakdown.quickbooks?.collected || 0,
    totalRefunded,
    outstandingBalance,
    paidThisMonth,
    paidLastMonth,
    overdueCount,
    cashOnHand,
    pendingApprovalCount,
    quickBooksSyncFailures,
    manualBookingCount: bookingPayments.filter((row) => row.needsManualBooking).length,
    legacyReviewCount: legacyManualRows.length,
    totalTransactions: all.filter((row) => !row.missingAppointmentPayment).length,
    trend: {
      day: trendSeries.day.map(({ key, ...rest }) => rest),
      month: trendSeries.month.map(({ key, ...rest }) => rest),
      year: trendSeries.year.map(({ key, ...rest }) => rest),
    },
    statusBreakdown,
    typeBreakdown,
    selectedMonth,
    previousMonth,
  };
}
