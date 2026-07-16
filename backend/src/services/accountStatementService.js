import { randomUUID } from "node:crypto";
import prisma from "./prisma/client.js";
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
      entries.push({ id: `${payment.id}-charge`, sourceId: payment.id, date, reference, type: "Invoice", description, caseReference, deltaCents: charge, chargeCents: charge, creditCents: 0 });
      calculatedBalance += charge;
    }
    if (paid) {
      entries.push({ id: `${payment.id}-payment`, sourceId: payment.id, date, reference, type: "Payment", description: `Payment received${payment.notes ? ` — ${payment.notes}` : ""}`, caseReference, deltaCents: -paid, chargeCents: 0, creditCents: paid });
      calculatedBalance -= paid;
    }
    if (payment.status === "Refunded" && paid) {
      entries.push({ id: `${payment.id}-refund`, sourceId: payment.id, date: payment.updatedAt || date, reference, type: "Refund", description: `Payment refund${payment.notes ? ` — ${payment.notes}` : ""}`, caseReference, deltaCents: paid, chargeCents: paid, creditCents: 0 });
      calculatedBalance += paid;
    }

    const adjustment = savedBalance - calculatedBalance;
    if (adjustment) {
      entries.push({ id: `${payment.id}-adjustment`, sourceId: payment.id, date: payment.updatedAt || date, reference, type: "Adjustment", description: "Adjustment recorded on billing record", caseReference, deltaCents: adjustment, chargeCents: Math.max(adjustment, 0), creditCents: Math.max(-adjustment, 0) });
    }
  }

  entries.sort((left, right) => {
    const dateDifference = new Date(left.date).getTime() - new Date(right.date).getTime();
    if (dateDifference) return dateDifference;
    const order = { Invoice: 0, Payment: 1, Refund: 2, Adjustment: 3 };
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
      runningBalance: amount(runningCents),
      deltaCents: undefined,
      chargeCents: undefined,
      creditCents: undefined,
    };
  });

  const total = (type) => periodEntries.filter((entry) => entry.type === type).reduce((sum, entry) => sum + Math.abs(entry.deltaCents), 0);
  const adjustmentCents = periodEntries.filter((entry) => entry.type === "Adjustment").reduce((sum, entry) => sum + entry.deltaCents, 0);

  return {
    transactions,
    summary: {
      openingBalance: amount(openingCents),
      totalCharges: amount(total("Invoice")),
      totalPayments: amount(total("Payment")),
      totalCredits: 0,
      totalRefunds: amount(total("Refund")),
      totalAdjustments: amount(adjustmentCents),
      closingBalance: amount(runningCents),
    },
  };
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

export async function buildAccountStatement({ agencyId, clientId, generation }) {
  const [agency, client, cases, payments, consultant] = await Promise.all([
    prisma.agency.findFirst({
      where: { id: agencyId },
      select: { id: true, name: true, legalName: true, phone: true, email: true, address: true, website: true, logoUrl: true, businessNumber: true, taxNumber: true, defaultCurrency: true, locale: true, timezone: true, paymentInstructions: true },
    }),
    prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true, fullName: true, address: true, email: true, phone: true } }),
    prisma.case.findMany({ where: { agencyId, clientId }, orderBy: [{ createdAt: "asc" }], select: { id: true, caseType: true, stage: true, status: true } }),
    prisma.payment.findMany({
      where: { agencyId, clientId, currency: generation.currency, ...(generation.caseId ? { caseId: generation.caseId } : {}), ...(generation.dateTo ? { createdAt: { lte: generation.dateTo } } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.user.findFirst({ where: { id: generation.generatedById, agencyId }, select: { fullName: true, licenseNumber: true } }),
  ]);
  if (!agency || !client) throw createHttpError(404, "Client account was not found");

  const selectedCase = generation.caseId ? cases.find((item) => item.id === generation.caseId) || null : null;
  const caseReferences = Object.fromEntries(cases.map((item) => [item.id, item.caseType]));
  const ledger = buildLedgerFromPayments(payments, { from: generation.dateFrom, to: generation.dateTo, caseReferences });

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
