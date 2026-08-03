import { randomUUID } from "node:crypto";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import {
  listQuickBooksInvoicesForCustomer,
  listQuickBooksPaymentsForCustomer,
  listQuickBooksRefundReceiptsForCustomer,
} from "./quickbooksService.js";
import { createHttpError } from "../utils/http.js";

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function amount(value) {
  return Number((value / 100).toFixed(2));
}

function paymentReference(payment) {
  return `PAY-${String(payment.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function buildLedgerFromPayments(payments, { from = null, to = null, caseReferences = {} } = {}) {
  const entries = [];

  for (const payment of payments) {
    const charge = cents(payment.totalFee);
    const paid = cents(payment.paidAmount);
    const savedBalance = cents(payment.balance);
    const reference = paymentReference(payment);
    const caseReference = payment.caseId ? caseReferences[payment.caseId] || null : null;
    const date = payment.createdAt;
    const description = payment.notes || caseReference || "Account transaction";
    let calculatedBalance = 0;

    if (charge) {
      entries.push({ id: `${payment.id}-charge`, sourceId: payment.id, source: "legacy", date, reference, type: "Invoice", description, caseReference, deltaCents: charge, chargeCents: charge, creditCents: 0, refundCents: 0 });
      calculatedBalance += charge;
    }
    if (paid) {
      entries.push({ id: `${payment.id}-payment`, sourceId: payment.id, source: "legacy", date, reference, type: "Payment", description: `Payment received${payment.notes ? ` — ${payment.notes}` : ""}`, caseReference, deltaCents: -paid, chargeCents: 0, creditCents: paid, refundCents: 0 });
      calculatedBalance -= paid;
    }
    if (payment.status === "Refunded" && paid) {
      entries.push({ id: `${payment.id}-refund`, sourceId: payment.id, source: "legacy", date: payment.updatedAt || date, reference, type: "Refund", description: `Payment refund${payment.notes ? ` — ${payment.notes}` : ""}`, caseReference, deltaCents: paid, chargeCents: 0, creditCents: 0, refundCents: paid });
      calculatedBalance += paid;
    }

    const adjustment = savedBalance - calculatedBalance;
    if (adjustment) {
      entries.push({ id: `${payment.id}-adjustment`, sourceId: payment.id, source: "legacy", date: payment.updatedAt || date, reference, type: "Adjustment", description: "Adjustment recorded on billing record", caseReference, deltaCents: adjustment, chargeCents: Math.max(adjustment, 0), creditCents: Math.max(-adjustment, 0), refundCents: 0 });
    }
  }

  return finalizeLedger(entries, { from, to });
}

function finalizeLedger(entries, { from = null, to = null } = {}) {

  entries.sort((left, right) => {
    const dateDifference = new Date(left.date).getTime() - new Date(right.date).getTime();
    if (dateDifference) return dateDifference;
    const order = { Invoice: 0, Payment: 1, Credit: 2, Refund: 3, Adjustment: 4 };
    return order[left.type] - order[right.type];
  });

  const fromTime = from ? new Date(from).getTime() : null;
  const toTime = to ? new Date(to).getTime() : null;
  const openingCents = entries
    .filter((entry) => fromTime !== null && new Date(entry.date).getTime() < fromTime)
    .reduce((sum, entry) => sum + entry.deltaCents, 0);
  const periodEntries = entries.filter((entry) => {
    const time = new Date(entry.date).getTime();
    return (fromTime === null || time >= fromTime) && (toTime === null || time <= toTime);
  });

  let runningCents = openingCents;
  const transactions = periodEntries.map((entry) => {
    runningCents += entry.deltaCents;
    return {
      ...entry,
      charge: amount(entry.chargeCents),
      paymentOrCredit: amount(entry.creditCents),
      refund: amount(entry.refundCents),
      runningBalance: amount(runningCents),
      deltaCents: undefined,
      chargeCents: undefined,
      creditCents: undefined,
      refundCents: undefined,
    };
  });

  const total = (type) => periodEntries.filter((entry) => entry.type === type).reduce((sum, entry) => sum + Math.abs(entry.deltaCents), 0);
  const adjustmentCents = periodEntries.filter((entry) => entry.type === "Adjustment").reduce((sum, entry) => sum + entry.deltaCents, 0);
  const creditCents = periodEntries.filter((entry) => entry.type === "Credit").reduce((sum, entry) => sum + entry.creditCents, 0);
  const refundCents = periodEntries.reduce((sum, entry) => sum + (entry.refundCents || 0), 0);

  return {
    transactions,
    summary: {
      openingBalance: amount(openingCents),
      totalCharges: amount(total("Invoice")),
      totalPayments: amount(total("Payment")),
      totalCredits: amount(creditCents),
      totalRefunds: amount(refundCents),
      netCollected: amount(total("Payment") - refundCents),
      totalAdjustments: amount(adjustmentCents),
      closingBalance: amount(runningCents),
    },
  };
}

function invoiceReference(number, fallback) {
  return number ? `INV-${number}` : `INV-${String(fallback).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function addInvoiceLifecycle(entries, item) {
  const charge = cents(item.amount);
  if (!charge) return;
  entries.push({
    id: `${item.key}-invoice`, sourceId: item.id, source: item.source,
    date: item.createdAt, reference: item.reference, type: "Invoice",
    description: item.description, caseReference: item.caseReference,
    deltaCents: charge, chargeCents: charge, creditCents: 0, refundCents: 0,
  });
  if (item.voided) {
    entries.push({
      id: `${item.key}-credit`, sourceId: item.id, source: item.source,
      date: item.updatedAt || item.createdAt, reference: item.reference, type: "Credit",
      description: `${item.description} — voided or no longer required`, caseReference: item.caseReference,
      deltaCents: -charge, chargeCents: 0, creditCents: charge, refundCents: 0,
    });
  }
}

/**
 * Builds one client ledger across modern case invoices, appointment
 * checkout invoices, live QuickBooks payments/refunds, and imported legacy
 * billing records. QBO payment allocations win when available; cached
 * balances are only used to fill a missing amount, so a payment is never
 * counted twice.
 */
export function buildUnifiedClientLedger({
  legacyPayments = [], caseInvoices = [], bookingPayments = [],
  quickBooksInvoices = [], quickBooksPayments = [], quickBooksRefunds = [],
}, { from = null, to = null, caseReferences = {}, includeUnmatchedQuickBooks = true } = {}) {
  const entries = [];
  const invoiceMeta = new Map();

  for (const row of caseInvoices) {
    const item = {
      key: `case:${row.id}`, id: row.id, source: "case_invoice",
      amount: row.amount, createdAt: row.createdAt, updatedAt: row.updatedAt,
      reference: invoiceReference(row.qbInvoiceNumber, row.id),
      description: row.description || "Case invoice",
      caseReference: caseReferences[row.caseId] || row.case?.caseType || null,
      voided: ["Void", "Voided"].includes(row.status),
      expectedPaidCents: ["Void", "Voided"].includes(row.status) ? 0 : Math.max(0, cents(row.amount) - cents(row.balance)),
    };
    addInvoiceLifecycle(entries, item);
    if (row.qbInvoiceId) invoiceMeta.set(String(row.qbInvoiceId), item);
  }

  for (const row of bookingPayments) {
    const voided = ["Expired", "Cancelled", "Voided", "Void"].includes(row.status);
    const appointmentLabel = row.appointment?.subject || row.sessionType?.name || "Consultation appointment";
    const item = {
      key: `booking:${row.id}`, id: row.id, source: "appointment",
      amount: row.amount, createdAt: row.createdAt, updatedAt: row.updatedAt,
      reference: invoiceReference(row.qbInvoiceNumber, row.id),
      description: `${appointmentLabel}${row.appointment?.startsAt ? ` — ${new Date(row.appointment.startsAt).toLocaleDateString("en-CA")}` : ""}`,
      caseReference: caseReferences[row.appointment?.caseId] || row.appointment?.case?.caseType || "Appointment",
      voided,
      expectedPaidCents: ["Paid", "Refunded"].includes(row.status) ? cents(row.amount) : 0,
      paidAt: row.paidAt,
      refundReceiptId: row.qbRefundReceiptId,
      refunded: row.status === "Refunded",
      paymentMethod: row.paymentMethod === "ETransfer" ? "E-transfer" : row.paymentMethod,
    };
    addInvoiceLifecycle(entries, item);
    if (row.qbInvoiceId) invoiceMeta.set(String(row.qbInvoiceId), item);
  }

  if (includeUnmatchedQuickBooks) {
    for (const row of quickBooksInvoices) {
      if (invoiceMeta.has(String(row.id))) continue;
      const item = {
        key: `qbo-invoice:${row.id}`, id: row.id, source: "quickbooks",
        amount: row.totalAmount, createdAt: row.createdAt || row.transactionDate, updatedAt: row.updatedAt,
        reference: invoiceReference(row.docNumber, row.id),
        description: `QuickBooks invoice${row.docNumber ? ` ${row.docNumber}` : ""}`,
        caseReference: "QuickBooks",
        voided: Boolean(row.isVoided),
        expectedPaidCents: row.isVoided ? 0 : Math.max(0, cents(row.totalAmount) - cents(row.balance)),
      };
      addInvoiceLifecycle(entries, item);
      invoiceMeta.set(String(row.id), item);
    }
  }

  const representedByInvoice = new Map();
  const paymentRepresented = new Map();
  for (const payment of quickBooksPayments) {
    if (!payment || cents(payment.totalAmount) <= 0) continue;
    for (const allocation of payment.allocations || []) {
      const meta = invoiceMeta.get(String(allocation.invoiceId));
      if (!meta) continue;
      const allocated = cents(allocation.amount);
      if (allocated <= 0) continue;
      entries.push({
        id: `qbo-payment:${payment.id}:${allocation.invoiceId}`, sourceId: payment.id, source: "quickbooks",
        date: payment.createdAt || payment.transactionDate, reference: `QBP-${payment.id}`, type: "Payment",
        description: `Payment received${payment.methodName ? ` by ${payment.methodName}` : meta.paymentMethod ? ` by ${meta.paymentMethod}` : ""} — ${meta.description}`, caseReference: meta.caseReference,
        deltaCents: -allocated, chargeCents: 0, creditCents: allocated, refundCents: 0,
      });
      representedByInvoice.set(String(allocation.invoiceId), (representedByInvoice.get(String(allocation.invoiceId)) || 0) + allocated);
      paymentRepresented.set(String(payment.id), (paymentRepresented.get(String(payment.id)) || 0) + allocated);
    }
  }

  for (const [invoiceId, meta] of invoiceMeta) {
    const represented = representedByInvoice.get(invoiceId) || 0;
    const missing = Math.max(0, meta.expectedPaidCents - represented);
    if (!missing) continue;
    entries.push({
      id: `${meta.key}-cached-payment`, sourceId: meta.id, source: meta.source,
      date: meta.paidAt || meta.updatedAt || meta.createdAt, reference: meta.reference, type: "Payment",
      description: `Payment received${meta.paymentMethod ? ` by ${meta.paymentMethod}` : ""} — ${meta.description}`, caseReference: meta.caseReference,
      deltaCents: -missing, chargeCents: 0, creditCents: missing, refundCents: 0,
    });
  }

  if (includeUnmatchedQuickBooks) {
    for (const payment of quickBooksPayments) {
      const unrepresented = Math.max(0, cents(payment.totalAmount) - (paymentRepresented.get(String(payment.id)) || 0));
      if (!unrepresented) continue;
      entries.push({
        id: `qbo-payment:${payment.id}:other`, sourceId: payment.id, source: "quickbooks",
        date: payment.createdAt || payment.transactionDate, reference: `QBP-${payment.id}`, type: "Payment",
        description: "QuickBooks payment not attached to a CaseDesk invoice", caseReference: null,
        deltaCents: -unrepresented, chargeCents: 0, creditCents: unrepresented, refundCents: 0,
      });
    }
  }

  const bookingByRefundId = new Map(
    bookingPayments.filter((row) => row.qbRefundReceiptId).map((row) => [String(row.qbRefundReceiptId), row]),
  );
  const representedRefundIds = new Set();
  for (const refund of quickBooksRefunds) {
    const refunded = cents(refund.totalAmount);
    if (!refunded) continue;
    const booking = bookingByRefundId.get(String(refund.id));
    if (!includeUnmatchedQuickBooks && !booking) continue;
    representedRefundIds.add(String(refund.id));
    entries.push({
      id: `qbo-refund:${refund.id}`, sourceId: refund.id, source: "quickbooks",
      date: refund.createdAt || refund.transactionDate, reference: `QBR-${refund.id}`, type: "Refund",
      description: booking ? `Consultation refund — ${booking.appointment?.subject || booking.guestName}` : "QuickBooks customer refund",
      caseReference: booking?.appointment?.case?.caseType || (booking ? "Appointment" : null),
      // A QBO RefundReceipt returns cash and reverses income; it does not
      // reopen the paid invoice's accounts-receivable balance. Report the
      // cash movement in its own column without inventing an amount due.
      deltaCents: 0, chargeCents: 0, creditCents: 0, refundCents: refunded,
    });
  }

  for (const row of bookingPayments) {
    if (row.status !== "Refunded" || (row.qbRefundReceiptId && representedRefundIds.has(String(row.qbRefundReceiptId)))) continue;
    const refunded = cents(row.amount);
    entries.push({
      id: `booking-refund:${row.id}`, sourceId: row.id, source: "appointment",
      date: row.updatedAt || row.paidAt || row.createdAt,
      reference: row.qbRefundReceiptId ? `QBR-${row.qbRefundReceiptId}` : invoiceReference(row.qbInvoiceNumber, row.id),
      type: "Refund", description: `Consultation refund — ${row.appointment?.subject || row.guestName}`,
      caseReference: row.appointment?.case?.caseType || "Appointment",
      deltaCents: 0, chargeCents: 0, creditCents: 0, refundCents: refunded,
    });
  }

  // Imported/legacy rows have no stable link to QBO, so retain their own
  // saved ledger semantics and merge their finalized raw entries back in.
  for (const payment of legacyPayments) {
    const legacy = buildLedgerFromPayments([payment], { caseReferences });
    for (const row of legacy.transactions) {
      const entry = {
        ...row,
        id: `legacy:${row.id}`,
        deltaCents: row.type === "Invoice" ? cents(row.charge)
          : row.type === "Payment" ? -cents(row.paymentOrCredit)
            : row.type === "Refund" ? cents(row.refund)
              : cents(row.charge) - cents(row.paymentOrCredit),
        chargeCents: cents(row.charge), creditCents: cents(row.paymentOrCredit), refundCents: cents(row.refund),
        source: "legacy",
      };
      delete entry.charge;
      delete entry.paymentOrCredit;
      delete entry.refund;
      delete entry.runningBalance;
      entries.push(entry);
    }
  }

  return finalizeLedger(entries, { from, to });
}

function parseDate(value, timezone, endOfDay = false) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw createHttpError(400, "Choose a valid statement date range");
  const [, year, month, day] = match.map(Number);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Toronto",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const observedParts = Object.fromEntries(formatter.formatToParts(new Date(targetAsUtc)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const observedAsUtc = Date.UTC(observedParts.year, observedParts.month - 1, observedParts.day, observedParts.hour, observedParts.minute, observedParts.second, millisecond);
  const date = new Date(targetAsUtc + (targetAsUtc - observedAsUtc));
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) throw createHttpError(400, "Choose a valid statement date range");
  return date;
}

function formatYear(date, timezone) {
  return new Intl.DateTimeFormat("en", { year: "numeric", timeZone: timezone || "America/Toronto" }).format(date);
}

export async function createStatementGeneration({ agencyId, clientId, generatedById, caseId = null, from = null, to = null, currency = "CAD", timezone }) {
  const dateFrom = parseDate(from, timezone);
  const dateTo = parseDate(to, timezone, true);
  if (dateFrom && dateTo && dateFrom > dateTo) throw createHttpError(400, "The start date must be before the end date");

  return prisma.$transaction(async (tx) => {
    const created = await tx.accountStatementGeneration.create({
      data: {
        statementNumber: `PENDING-${randomUUID()}`,
        agencyId,
        clientId,
        caseId,
        generatedById,
        dateFrom,
        dateTo,
        currency,
      },
    });
    const statementNumber = `SOA-${formatYear(created.generatedAt, timezone)}-${String(created.sequence).padStart(6, "0")}`;
    return tx.accountStatementGeneration.update({ where: { id: created.id }, data: { statementNumber } });
  });
}

export async function buildClientBillingLedger({
  agencyId, client, currency = "CAD", defaultCurrency = "CAD",
  caseId = null, from = null, to = null, caseReferences = {}, refreshQuickBooks = true,
}) {
  const includeModernSources = currency === defaultCurrency;
  const bookingIdentity = [
    { clientId: client.id },
    { appointment: { clientId: client.id } },
    ...(client.emailNormalized ? [{ guestEmailNormalized: client.emailNormalized }] : []),
    ...(client.qbCustomerId ? [{ qbCustomerId: client.qbCustomerId }] : []),
  ];
  const [legacyPayments, caseInvoices, bookingPayments] = await Promise.all([
    prisma.payment.findMany({
      where: {
        agencyId, clientId: client.id, currency,
        ...(caseId ? { caseId } : {}),
        ...(to ? { createdAt: { lte: to } } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    includeModernSources ? prisma.caseInvoice.findMany({
      where: { agencyId, clientId: client.id, ...(caseId ? { caseId } : {}), ...(to ? { createdAt: { lte: to } } : {}) },
      include: { case: { select: { caseType: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }) : [],
    includeModernSources ? prisma.bookingPaymentHold.findMany({
      where: {
        agencyId,
        OR: bookingIdentity,
        ...(caseId ? { appointment: { clientId: client.id, caseId } } : {}),
        ...(to ? { createdAt: { lte: to } } : {}),
      },
      include: {
        appointment: { select: { id: true, clientId: true, caseId: true, subject: true, startsAt: true, status: true, case: { select: { caseType: true } } } },
        sessionType: { select: { name: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }) : [],
  ]);

  let quickBooksInvoices = [];
  let quickBooksPayments = [];
  let quickBooksRefunds = [];
  let syncWarning = null;
  if (refreshQuickBooks && includeModernSources && client.qbCustomerId) {
    try {
      [quickBooksInvoices, quickBooksPayments, quickBooksRefunds] = await Promise.all([
        listQuickBooksInvoicesForCustomer(agencyId, client.qbCustomerId),
        listQuickBooksPaymentsForCustomer(agencyId, client.qbCustomerId),
        listQuickBooksRefundReceiptsForCustomer(agencyId, client.qbCustomerId),
      ]);
      quickBooksInvoices = quickBooksInvoices.filter((item) => item.currency === currency);
      quickBooksPayments = quickBooksPayments.filter((item) => item.currency === currency);
      quickBooksRefunds = quickBooksRefunds.filter((item) => item.currency === currency);
    } catch (error) {
      syncWarning = "QuickBooks could not be reached. Cached CaseDesk billing is shown; recent external payments or refunds may be missing.";
      logger.warn("client_billing.quickbooks_read_failed", { agencyId, clientId: client.id, reason: error.message });
    }
  }

  const ledger = buildUnifiedClientLedger(
    { legacyPayments, caseInvoices, bookingPayments, quickBooksInvoices, quickBooksPayments, quickBooksRefunds },
    { from, to, caseReferences, includeUnmatchedQuickBooks: !caseId && refreshQuickBooks },
  );
  return {
    ...ledger,
    syncWarning,
    sourceCounts: {
      caseInvoices: caseInvoices.length,
      appointments: bookingPayments.length,
      legacyRecords: legacyPayments.length,
      quickBooksInvoices: quickBooksInvoices.length,
      quickBooksPayments: quickBooksPayments.length,
      quickBooksRefunds: quickBooksRefunds.length,
    },
  };
}

export async function buildAccountStatement({ agencyId, clientId, generation }) {
  const [agency, client, cases, consultant] = await Promise.all([
    prisma.agency.findFirst({
      where: { id: agencyId },
      select: { id: true, name: true, legalName: true, phone: true, email: true, address: true, website: true, logoUrl: true, businessNumber: true, taxNumber: true, defaultCurrency: true, locale: true, timezone: true, paymentInstructions: true },
    }),
    prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, fullName: true, address: true, email: true, emailNormalized: true, phone: true, qbCustomerId: true } }),
    prisma.case.findMany({ where: { agencyId, clientId }, orderBy: [{ createdAt: "asc" }], select: { id: true, caseType: true, stage: true, status: true } }),
    prisma.user.findFirst({ where: { id: generation.generatedById, agencyId }, select: { fullName: true, licenseNumber: true } }),
  ]);
  if (!agency || !client) throw createHttpError(404, "Client account was not found");

  const selectedCase = generation.caseId ? cases.find((item) => item.id === generation.caseId) || null : null;
  const caseReferences = Object.fromEntries(cases.map((item) => [item.id, item.caseType]));
  const ledger = await buildClientBillingLedger({
    agencyId,
    client,
    currency: generation.currency,
    defaultCurrency: agency.defaultCurrency || "CAD",
    caseId: generation.caseId,
    from: generation.dateFrom,
    to: generation.dateTo,
    caseReferences,
  });

  return {
    id: generation.id,
    statementNumber: generation.statementNumber,
    generatedAt: generation.generatedAt,
    period: { from: generation.dateFrom, to: generation.dateTo },
    currency: generation.currency,
    agency: { ...agency, consultantLicenseNumber: consultant?.licenseNumber || null },
    client,
    case: selectedCase,
    cases: cases.map((item) => ({ ...item, reference: item.caseType })),
    ...ledger,
  };
}
