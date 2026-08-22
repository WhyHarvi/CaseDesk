import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";

export const CUSTOM_LEDGER_PAYMENT_METHODS = ["Cash", "ETransfer", "Card", "Cheque", "Wire", "Debit", "BankDraft"];
const COLORS = new Set(["#6366F1", "#0A84FF", "#34C759", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6", "#64748B"]);

function cleanValues(body = {}) {
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) throw createHttpError(400, "Enter a ledger name.", "VALIDATION_ERROR");
  const caseTypes = [...new Set((Array.isArray(body.caseTypes) ? body.caseTypes : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 50);
  if (!caseTypes.length) throw createHttpError(400, "Choose at least one case type.", "VALIDATION_ERROR");
  const paymentMethods = [...new Set((Array.isArray(body.paymentMethods) ? body.paymentMethods : []).filter((value) => CUSTOM_LEDGER_PAYMENT_METHODS.includes(value)))];
  if (!paymentMethods.length) throw createHttpError(400, "Choose at least one payment method.", "VALIDATION_ERROR");
  return { name, description: String(body.description || "").trim().slice(0, 300) || null, caseTypes, paymentMethods, color: COLORS.has(body.color) ? body.color : "#6366F1", isActive: body.isActive !== false };
}

export async function listCustomPaymentLedgers(agencyId) {
  const [ledgers, cases, movements] = await Promise.all([
    prisma.agencyCustomPaymentLedger.findMany({ where: { agencyId }, include: { _count: { select: { invoices: true, cashTransactions: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.case.findMany({ where: { agencyId }, distinct: ["caseType"], select: { caseType: true }, orderBy: { caseType: "asc" } }),
    prisma.cashTransaction.groupBy({ where: { agencyId, customLedgerId: { not: null }, status: "Posted" }, by: ["customLedgerId"], _sum: { amount: true } }),
  ]);
  const balanceById = new Map(movements.map((row) => [row.customLedgerId, Number(row._sum.amount || 0)]));
  return {
    ledgers: ledgers.map((ledger) => ({ ...ledger, balance: balanceById.get(ledger.id) || 0 })),
    caseTypes: cases.map((row) => row.caseType).filter(Boolean),
    paymentMethods: CUSTOM_LEDGER_PAYMENT_METHODS,
  };
}

export async function createCustomPaymentLedger(agencyId, actorUserId, body) {
  const values = cleanValues(body);
  const overlap = await prisma.agencyCustomPaymentLedger.findFirst({ where: { agencyId, isActive: true, caseTypes: { hasSome: values.caseTypes }, paymentMethods: { hasSome: values.paymentMethods } }, select: { name: true } });
  if (overlap) throw createHttpError(409, `These case-type and payment-method rules overlap with ${overlap.name}.`, "LEDGER_RULE_OVERLAP");
  const ledger = await prisma.agencyCustomPaymentLedger.create({ data: { agencyId, createdById: actorUserId, ...values }, include: { _count: { select: { invoices: true, cashTransactions: true } } } });
  return { ...ledger, balance: 0 };
}

export async function updateCustomPaymentLedger(agencyId, id, body) {
  const current = await prisma.agencyCustomPaymentLedger.findFirst({ where: { id, agencyId } });
  if (!current) throw createHttpError(404, "Custom ledger not found.", "NOT_FOUND");
  const values = cleanValues({ ...current, ...body });
  const overlap = values.isActive ? await prisma.agencyCustomPaymentLedger.findFirst({ where: { agencyId, id: { not: id }, isActive: true, caseTypes: { hasSome: values.caseTypes }, paymentMethods: { hasSome: values.paymentMethods } }, select: { name: true } }) : null;
  if (overlap) throw createHttpError(409, `These case-type and payment-method rules overlap with ${overlap.name}.`, "LEDGER_RULE_OVERLAP");
  const ledger = await prisma.agencyCustomPaymentLedger.update({ where: { id }, data: values, include: { _count: { select: { invoices: true, cashTransactions: true } } } });
  const balance = await prisma.cashTransaction.aggregate({ where: { agencyId, customLedgerId: id, status: "Posted" }, _sum: { amount: true } });
  return { ...ledger, balance: Number(balance._sum.amount || 0) };
}

export async function resolveCustomPaymentLedger(agencyId, caseId, paymentMethod) {
  if (!caseId || !paymentMethod) return null;
  const caseRow = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { caseType: true } });
  if (!caseRow?.caseType) return null;
  return prisma.agencyCustomPaymentLedger.findFirst({ where: { agencyId, isActive: true, caseTypes: { has: caseRow.caseType }, paymentMethods: { has: paymentMethod } }, orderBy: { createdAt: "asc" } });
}
