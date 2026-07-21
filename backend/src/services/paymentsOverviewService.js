import prisma from "./prisma/client.js";

const MAX_ROWS_PER_SOURCE = 1000;

const CASE_INVOICE_TYPE_LABEL = { fees: "Professional fees", disbursement: "Government fee disbursement" };

// Every source has its own status vocabulary — normalize to one set so the
// admin table and filters don't need to know where a row came from.
function normalizeCaseInvoiceStatus(status) {
  if (status === "PartiallyPaid") return "PartiallyPaid";
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
  if (status === "Refunded") return "Voided";
  return status; // Paid
}

async function fetchCaseInvoiceRows(agencyId, { from, to }) {
  const rows = await prisma.caseInvoice.findMany({
    where: { agencyId, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: { client: { select: { fullName: true, email: true } }, case: { select: { caseType: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  });
  return rows.map((row) => ({
    id: `case_invoice:${row.id}`,
    source: "case_invoice",
    type: CASE_INVOICE_TYPE_LABEL[row.paymentType] || row.paymentType,
    description: row.description,
    clientName: row.client?.fullName || "Unknown client",
    clientId: row.clientId,
    caseId: row.caseId,
    caseType: row.case?.caseType || null,
    amount: Number(row.amount),
    balance: Number(row.balance),
    status: normalizeCaseInvoiceStatus(row.status),
    qbInvoiceNumber: row.qbInvoiceNumber,
    qbInvoiceLink: row.qbInvoiceLink,
    createdAt: row.createdAt,
    paidAt: Number(row.balance) <= 0 ? row.updatedAt : null,
    dueDate: row.dueDate,
  }));
}

async function fetchBookingPaymentRows(agencyId, { from, to }) {
  const rows = await prisma.bookingPaymentHold.findMany({
    where: { agencyId, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_SOURCE,
  });
  return rows.map((row) => ({
    id: `booking_payment:${row.id}`,
    source: "booking_payment",
    type: row.source === "WalkIn" ? "Consultation (walk-in)" : "Consultation booking",
    description: "Consultation fee",
    clientName: row.guestName,
    clientId: null,
    caseId: null,
    caseType: null,
    amount: Number(row.amount),
    balance: row.status === "Paid" ? 0 : Number(row.amount),
    status: normalizeBookingStatus(row.status),
    qbInvoiceNumber: null,
    qbInvoiceLink: row.qbInvoiceLink,
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
  const dateRange = { from: from ? new Date(from) : null, to: to ? new Date(to) : null };
  const [caseInvoices, bookingPayments, legacyPayments] = await Promise.all([
    fetchCaseInvoiceRows(agencyId, dateRange),
    fetchBookingPaymentRows(agencyId, dateRange),
    fetchLegacyPaymentRows(agencyId, dateRange),
  ]);

  let combined = [...caseInvoices, ...bookingPayments, ...legacyPayments];
  if (status) combined = combined.filter((row) => row.status === status);
  if (source) combined = combined.filter((row) => row.source === source);
  if (query) {
    const needle = query.trim().toLowerCase();
    combined = combined.filter((row) => row.clientName.toLowerCase().includes(needle) || (row.qbInvoiceNumber || "").toLowerCase().includes(needle));
  }
  combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = combined.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const rows = combined.slice(start, start + pageSize);
  return { rows, total, page: Math.max(1, page), pageSize };
}

export async function getPaymentsSummary(agencyId) {
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
  let overdueCount = 0;
  for (const row of all) {
    const paidAmount = row.amount - row.balance;
    totalCollected += paidAmount;
    if (row.status !== "Voided") outstandingBalance += row.balance;
    if (row.paidAt && new Date(row.paidAt) >= monthStart) paidThisMonth += paidAmount;
    if (row.status === "Overdue") overdueCount += 1;
  }

  return { totalCollected, outstandingBalance, paidThisMonth, overdueCount, totalTransactions: all.length };
}
