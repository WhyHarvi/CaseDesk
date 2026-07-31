import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { reconcileAgencyBookingRefunds } from "./quickbooksWebhookService.js";
import { listFeeCategories } from "./feeCategoryService.js";

const MAX_ROWS_PER_SOURCE = 1000;

const CASE_INVOICE_TYPE_LABEL = { fees: "Professional fees", disbursement: "Government fee disbursement" };

// Every source has its own status vocabulary — normalize to one set so the
// admin table and filters don't need to know where a row came from.
export function normalizeCaseInvoiceStatus(status) {
  if (status === "PartiallyPaid") return "PartiallyPaid";
  if (status === "Void" || status === "Voided") return "Voided";
  return status; // Open | Paid | Overdue already match the unified set
}

function normalizeBookingStatus(status) {
  if (status === "AwaitingPayment") return "Open";
  if (status === "Expired" || status === "Cancelled") return "Voided";
  return status; // Paid | Voided already match
}

function normalizeLegacyStatus(status) {
  if (status === "Unpaid") return "Open";
  if (status === "Partial") return "PartiallyPaid";
  return status; // Paid | Refunded
}

export function netCollectedAmount(row) {
  if (row.status === "Voided" || row.status === "Refunded") return 0;
  return Math.max(0, Number(row.amount) - Number(row.balance));
}

async function fetchCaseInvoiceRows(agencyId, { from, to }) {
  const [rows, categories] = await Promise.all([prisma.caseInvoice.findMany({
    where: { agencyId, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: { client: { select: { fullName: true, email: true } }, case: { select: { caseType: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  }), listFeeCategories(agencyId, { includeInactive: true })]);
  const labels = new Map(categories.map((category) => [category.code, category.name]));
  return rows.map((row) => {
    const status = normalizeCaseInvoiceStatus(row.status);
    return {
      id: `case_invoice:${row.id}`,
      source: "case_invoice",
      type: labels.get(row.paymentType) || CASE_INVOICE_TYPE_LABEL[row.paymentType] || row.paymentType,
      description: row.description,
      clientName: row.client?.fullName || "Unknown client",
      clientId: row.clientId,
      caseId: row.caseId,
      caseType: row.case?.caseType || null,
      amount: Number(row.amount),
      balance: Number(row.balance),
      status,
      qbInvoiceNumber: row.qbInvoiceNumber,
      qbInvoiceLink: row.qbInvoiceLink,
      createdAt: row.createdAt,
      paidAt: status === "Paid" ? row.updatedAt : null,
      dueDate: row.dueDate,
    };
  });
}

async function fetchBookingPaymentRows(agencyId, { from, to }) {
  const rows = await prisma.bookingPaymentHold.findMany({
    where: { agencyId, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: {
      client: { select: { fullName: true } },
      appointment: { select: { status: true, clientId: true, client: { select: { fullName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  });
  return rows.map((row) => ({
    id: `booking_payment:${row.id}`,
    source: "booking_payment",
    type: row.source === "WalkIn" ? "Consultation (walk-in)" : "Consultation booking",
    description: `Consultation fee${row.paymentMethod ? ` · ${row.paymentMethod === "ETransfer" ? "E-transfer" : row.paymentMethod}` : ""}`,
    clientName: row.client?.fullName || row.appointment?.client?.fullName || row.guestName,
    clientId: row.clientId || row.appointment?.clientId || null,
    caseId: null,
    caseType: null,
    amount: Number(row.amount),
    balance: ["Paid", "Refunded"].includes(row.status) ? 0 : Number(row.amount),
    status: normalizeBookingStatus(row.status),
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
    paymentMethod: row.paymentMethod === "ETransfer" ? "E-transfer" : row.paymentMethod,
    paymentNote: row.manualPaymentNote,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    dueDate: null,
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
export async function listAgencyPayments(agencyId, { status, source, query, from, to, page = 1, pageSize = 25 } = {}) {
  await reconcileAgencyBookingRefunds(agencyId).catch((error) => {
    logger.warn("payments_overview.refund_reconcile_failed", { agencyId, reason: error.message });
  });
  const dateRange = { from: from ? new Date(from) : null, to: to ? new Date(to) : null };
  const [caseInvoices, bookingPayments, legacyPayments] = await Promise.all([
    fetchCaseInvoiceRows(agencyId, dateRange),
    fetchBookingPaymentRows(agencyId, dateRange),
    fetchLegacyPaymentRows(agencyId, dateRange),
  ]);

  let combined = [...caseInvoices, ...bookingPayments, ...legacyPayments];
  // Voided rows are clutter in the default view (an abandoned checkout, a
  // cancelled invoice draft) — real information, but not something staff
  // need to see mixed into "all payments" by default. Still fully visible
  // by explicitly filtering to it.
  combined = status ? combined.filter((row) => row.status === status) : combined.filter((row) => row.status !== "Voided");
  if (source) combined = combined.filter((row) => row.source === source);
  if (query) {
    const needle = query.trim().toLowerCase();
    combined = combined.filter((row) => row.clientName.toLowerCase().includes(needle)
      || (row.qbInvoiceNumber || "").toLowerCase().includes(needle)
      || (row.paymentMethod || "").toLowerCase().includes(needle));
  }
  combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = combined.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const rows = combined.slice(start, start + pageSize);
  return { rows, total, page: Math.max(1, page), pageSize };
}

export async function getPaymentsSummary(agencyId) {
  await reconcileAgencyBookingRefunds(agencyId).catch((error) => {
    logger.warn("payments_summary.refund_reconcile_failed", { agencyId, reason: error.message });
  });
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [caseInvoices, bookingPayments, legacyPayments] = await Promise.all([
    fetchCaseInvoiceRows(agencyId, {}),
    fetchBookingPaymentRows(agencyId, {}),
    fetchLegacyPaymentRows(agencyId, {}),
  ]);
  const all = [...caseInvoices, ...bookingPayments, ...legacyPayments];

  let totalCollected = 0;
  let outstandingBalance = 0;
  let paidThisMonth = 0;
  let paidLastMonth = 0;
  let overdueCount = 0;
  const statusBreakdown = {};
  const typeBreakdown = {};

  // Last 8 calendar months, oldest first, keyed YYYY-MM.
  const trendMonths = [];
  for (let index = 7; index >= 0; index -= 1) {
    const monthDate = new Date(monthStart.getFullYear(), monthStart.getMonth() - index, 1);
    trendMonths.push({
      key: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`,
      label: monthDate.toLocaleDateString("en-CA", { month: "short" }),
      collected: 0,
      invoiced: 0,
    });
  }
  const trendByKey = new Map(trendMonths.map((item) => [item.key, item]));
  const monthKeyOf = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  const lastMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);

  for (const row of all) {
    const paidAmount = netCollectedAmount(row);
    totalCollected += paidAmount;
    if (row.status !== "Voided") outstandingBalance += row.balance;
    if (row.paidAt) {
      const paidDate = new Date(row.paidAt);
      if (paidDate >= monthStart) paidThisMonth += paidAmount;
      else if (paidDate >= lastMonthStart) paidLastMonth += paidAmount;
      const bucket = trendByKey.get(monthKeyOf(paidDate));
      if (bucket) bucket.collected += paidAmount;
    }
    if (row.status === "Overdue") overdueCount += 1;

    const invoicedBucket = trendByKey.get(monthKeyOf(row.createdAt));
    if (invoicedBucket && row.status !== "Voided") invoicedBucket.invoiced += row.amount;

    const statusEntry = statusBreakdown[row.status] || { count: 0, amount: 0 };
    statusEntry.count += 1;
    statusEntry.amount += row.amount;
    statusBreakdown[row.status] = statusEntry;

    const typeEntry = typeBreakdown[row.source] || { count: 0, collected: 0, outstanding: 0 };
    typeEntry.count += 1;
    typeEntry.collected += paidAmount;
    if (row.status !== "Voided") typeEntry.outstanding += row.balance;
    typeBreakdown[row.source] = typeEntry;
  }

  return {
    totalCollected,
    outstandingBalance,
    paidThisMonth,
    paidLastMonth,
    overdueCount,
    manualBookingCount: bookingPayments.filter((row) => row.needsManualBooking).length,
    totalTransactions: all.length,
    monthlyTrend: trendMonths.map(({ key, ...rest }) => rest),
    statusBreakdown,
    typeBreakdown,
  };
}
