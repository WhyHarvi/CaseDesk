import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { CASE_STAGES } from "../constants/caseStages.js";
import { PAYMENT_TYPES, createInvoiceRecord } from "./caseInvoiceService.js";
import { notifyInstallmentInvoiced, notifyStaffInstallmentVoided } from "./paymentNotificationService.js";
import { voidQuickBooksInvoice } from "./quickbooksService.js";
import { logger } from "./logger.js";

const TRIGGER_TYPES = new Set(["Date", "Stage"]);

function validateInstallmentInput(item) {
  const label = String(item?.label || "").trim().slice(0, 200);
  if (!label) throw createHttpError(400, "Every installment needs a label.", "VALIDATION_ERROR");
  if (!PAYMENT_TYPES[item?.paymentType]) throw createHttpError(400, "Choose a valid payment type for every installment.", "VALIDATION_ERROR");
  const amount = Number(item?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw createHttpError(400, `Enter a valid amount for "${label}".`, "VALIDATION_ERROR");
  }
  const triggerType = item?.triggerType;
  if (!TRIGGER_TYPES.has(triggerType)) throw createHttpError(400, `Choose a trigger type for "${label}".`, "VALIDATION_ERROR");
  if (triggerType === "Stage" && !CASE_STAGES.includes(item?.triggerStage)) {
    throw createHttpError(400, `Choose a valid case stage trigger for "${label}".`, "VALIDATION_ERROR");
  }
  if (triggerType === "Date") {
    const days = Number(item?.triggerDaysAfterSigning);
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      throw createHttpError(400, `Enter days-after-signing (0–3650) for "${label}".`, "VALIDATION_ERROR");
    }
  }
  return {
    label,
    paymentType: item.paymentType,
    amount,
    triggerType,
    triggerStage: triggerType === "Stage" ? item.triggerStage : null,
    triggerDaysAfterSigning: triggerType === "Date" ? Number(item.triggerDaysAfterSigning) : null,
  };
}

// ---------- Templates ----------

export async function listScheduleTemplates(agencyId, caseType) {
  return prisma.paymentScheduleTemplate.findMany({
    where: { agencyId, isActive: true, ...(caseType ? { caseType } : {}) },
    include: { installments: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });
}

export async function createScheduleTemplate(agencyId, { caseType, name, installments }) {
  const trimmedName = String(name || "").trim().slice(0, 150);
  const trimmedCaseType = String(caseType || "").trim().slice(0, 120);
  if (!trimmedName) throw createHttpError(400, "Name the template.", "VALIDATION_ERROR");
  if (!trimmedCaseType) throw createHttpError(400, "Choose which case type this template applies to.", "VALIDATION_ERROR");
  if (!Array.isArray(installments) || !installments.length) throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");
  const validated = installments.map(validateInstallmentInput);

  return prisma.paymentScheduleTemplate.create({
    data: {
      agencyId,
      caseType: trimmedCaseType,
      name: trimmedName,
      installments: { create: validated.map((item, index) => ({ ...item, sortOrder: index })) },
    },
    include: { installments: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function updateScheduleTemplate(agencyId, templateId, { name, isActive, installments }) {
  const existing = await prisma.paymentScheduleTemplate.findFirst({ where: { id: templateId, agencyId } });
  if (!existing) throw createHttpError(404, "Template not found.", "NOT_FOUND");
  const data = {};
  if (name !== undefined) {
    const trimmedName = String(name || "").trim().slice(0, 150);
    if (!trimmedName) throw createHttpError(400, "Name the template.", "VALIDATION_ERROR");
    data.name = trimmedName;
  }
  if (typeof isActive === "boolean") data.isActive = isActive;

  if (installments !== undefined) {
    if (!Array.isArray(installments) || !installments.length) throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");
    const validated = installments.map(validateInstallmentInput);
    await prisma.$transaction([
      prisma.paymentScheduleTemplateInstallment.deleteMany({ where: { templateId } }),
      prisma.paymentScheduleTemplateInstallment.createMany({
        data: validated.map((item, index) => ({ ...item, templateId, sortOrder: index })),
      }),
    ]);
  }
  if (Object.keys(data).length) {
    await prisma.paymentScheduleTemplate.update({ where: { id: templateId }, data });
  }
  return prisma.paymentScheduleTemplate.findUnique({ where: { id: templateId }, include: { installments: { orderBy: { sortOrder: "asc" } } } });
}

export async function deleteScheduleTemplate(agencyId, templateId) {
  const existing = await prisma.paymentScheduleTemplate.findFirst({ where: { id: templateId, agencyId } });
  if (!existing) throw createHttpError(404, "Template not found.", "NOT_FOUND");
  await prisma.paymentScheduleTemplate.delete({ where: { id: templateId } });
}

// ---------- Case schedules ----------

function resolveTriggerDate(signingDate, days) {
  if (days === null || days === undefined) return null;
  return new Date(new Date(signingDate).getTime() + days * 24 * 60 * 60_000);
}

export async function getCaseSchedule(agencyId, caseId) {
  const schedule = await prisma.casePaymentSchedule.findFirst({
    where: { agencyId, caseId },
    include: {
      installments: {
        orderBy: { sortOrder: "asc" },
        include: { caseInvoice: { select: { id: true, status: true, balance: true, qbInvoiceNumber: true } } },
      },
    },
  });
  return schedule;
}

export async function createCaseSchedule(agencyId, { caseId, signingDate, installments, actorUserId }) {
  const existing = await prisma.casePaymentSchedule.findFirst({ where: { agencyId, caseId } });
  if (existing) throw createHttpError(409, "This case already has a payment schedule. Edit it instead.", "SCHEDULE_EXISTS");

  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId, deletedAt: null }, select: { id: true, clientId: true, stage: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");

  const resolvedSigningDate = signingDate ? new Date(signingDate) : new Date();
  if (Number.isNaN(resolvedSigningDate.getTime())) throw createHttpError(400, "Enter a valid signing date.", "VALIDATION_ERROR");
  if (!Array.isArray(installments) || !installments.length) throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");
  const validated = installments.map(validateInstallmentInput);

  const schedule = await prisma.casePaymentSchedule.create({
    data: {
      agencyId,
      caseId,
      clientId: caseItem.clientId,
      signingDate: resolvedSigningDate,
      createdById: actorUserId,
      installments: {
        create: validated.map((item, index) => ({
          agencyId,
          caseId,
          clientId: caseItem.clientId,
          sortOrder: index,
          createdById: actorUserId,
          ...item,
          triggerDate: item.triggerType === "Date" ? resolveTriggerDate(resolvedSigningDate, item.triggerDaysAfterSigning) : null,
        })),
      },
    },
    include: { installments: { orderBy: { sortOrder: "asc" } } },
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: caseItem.clientId,
    caseId,
    action: "payment_schedule.created",
    details: `Payment schedule created with ${validated.length} installment${validated.length === 1 ? "" : "s"}`,
    entityType: "casePaymentSchedule",
    entityId: schedule.id,
  });

  // A schedule built against a case that's already past some of its stage
  // triggers (e.g. added retroactively) should catch those up immediately
  // rather than waiting for the next stage change that may never come.
  await evaluateStageTriggers(agencyId, caseId, null, caseItem.stage, actorUserId).catch((error) => {
    logger.warn("payment_schedule.catchup_failed", { agencyId, caseId, reason: error.message });
  });

  return getCaseSchedule(agencyId, caseId);
}

const EDIT_REQUIRES_ADMIN_STATUSES = new Set(["Invoiced", "Void"]);

export async function updateCaseInstallments(agencyId, caseId, { installments, actorRole, actorUserId }) {
  const schedule = await prisma.casePaymentSchedule.findFirst({
    where: { agencyId, caseId },
    include: { installments: true },
  });
  if (!schedule) throw createHttpError(404, "This case has no payment schedule yet.", "NOT_FOUND");

  const hasFiredInstallments = schedule.installments.some((item) => EDIT_REQUIRES_ADMIN_STATUSES.has(item.status));
  if (hasFiredInstallments && actorRole !== "admin") {
    throw createHttpError(403, "Once the retainer has invoices on it, only an administrator can edit the payment schedule.", "FORBIDDEN");
  }

  if (!Array.isArray(installments) || !installments.length) throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");

  const firedIds = new Set(schedule.installments.filter((item) => EDIT_REQUIRES_ADMIN_STATUSES.has(item.status)).map((item) => item.id));
  const incomingIds = new Set(installments.filter((item) => item.id).map((item) => item.id));
  for (const firedId of firedIds) {
    if (!incomingIds.has(firedId)) throw createHttpError(400, "Invoiced or voided installments cannot be removed from the schedule.", "VALIDATION_ERROR");
  }

  const validated = installments.map((item) => ({ id: item.id || null, ...validateInstallmentInput(item) }));

  await prisma.$transaction(async (tx) => {
    await tx.casePaymentInstallment.deleteMany({ where: { scheduleId: schedule.id, id: { notIn: [...incomingIds] }, status: "Scheduled" } });
    for (const [index, item] of validated.entries()) {
      if (item.id && firedIds.has(item.id)) {
        await tx.casePaymentInstallment.update({ where: { id: item.id }, data: { sortOrder: index } });
        continue;
      }
      const triggerDate = item.triggerType === "Date" ? resolveTriggerDate(schedule.signingDate, item.triggerDaysAfterSigning) : null;
      const { id, ...fields } = item;
      if (id) {
        await tx.casePaymentInstallment.update({
          where: { id },
          data: { ...fields, sortOrder: index, triggerDate },
        });
      } else {
        await tx.casePaymentInstallment.create({
          data: {
            agencyId,
            scheduleId: schedule.id,
            caseId,
            clientId: schedule.clientId,
            sortOrder: index,
            createdById: actorUserId,
            ...fields,
            triggerDate,
          },
        });
      }
    }
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: schedule.clientId,
    caseId,
    action: "payment_schedule.updated",
    details: "Payment schedule installments updated",
    entityType: "casePaymentSchedule",
    entityId: schedule.id,
  });

  return getCaseSchedule(agencyId, caseId);
}

export async function voidRemainingInstallments(agencyId, caseId, { reason, actorUserId }) {
  const trimmedReason = String(reason || "").trim().slice(0, 500);
  const targets = await prisma.casePaymentInstallment.findMany({ where: { agencyId, caseId, status: "Scheduled" } });
  if (!targets.length) return [];

  const now = new Date();
  await prisma.casePaymentInstallment.updateMany({
    where: { id: { in: targets.map((item) => item.id) } },
    data: { status: "Void", voidedAt: now, voidedById: actorUserId, voidReason: trimmedReason || null },
  });

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: targets[0].clientId,
    caseId,
    action: "payment_schedule.voided",
    details: `${targets.length} remaining installment${targets.length === 1 ? "" : "s"} voided${trimmedReason ? `: ${trimmedReason}` : ""}`,
    entityType: "casePaymentSchedule",
    entityId: targets[0].scheduleId,
  });

  for (const installment of targets) {
    notifyStaffInstallmentVoided({ agencyId, installment: { ...installment, voidReason: trimmedReason }, actorUserId }).catch(() => {});
  }

  return getCaseSchedule(agencyId, caseId);
}

// ---------- Payment summaries ----------

// The legacy `Payment` model (paymentController.js) is never written to by
// any live UI path — invoicing now happens entirely through
// CasePaymentInstallment -> CaseInvoice (fireInstallment, above). A "Total
// Fee" display that reads Payment rows is stuck at $0 on every case no
// matter how a schedule is built. This computes the real numbers from the
// data staff actually create: total fee = sum of non-voided installment
// amounts (what was agreed to be charged, invoiced or not yet); paid =
// sum of (invoice.amount - invoice.balance) across the installments that
// have actually been invoiced; balance = the rest still owed.
function summarizeInstallments(installments, invoiceById) {
  let totalFee = 0;
  let paidAmount = 0;
  for (const installment of installments) {
    totalFee += Number(installment.amount);
    if (installment.caseInvoiceId) {
      const invoice = invoiceById.get(installment.caseInvoiceId);
      if (invoice) paidAmount += Number(invoice.amount) - Number(invoice.balance);
    }
  }
  const balance = Math.max(totalFee - paidAmount, 0);
  const status = totalFee === 0 ? "Unpaid" : balance <= 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid";
  return { totalFee, paidAmount, balance, status };
}

async function loadInvoicesById(invoiceIds) {
  if (!invoiceIds.length) return new Map();
  const invoices = await prisma.caseInvoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, amount: true, balance: true },
  });
  return new Map(invoices.map((invoice) => [invoice.id, invoice]));
}

const EMPTY_SUMMARY = { totalFee: 0, paidAmount: 0, balance: 0, status: "Unpaid" };

export async function getCasePaymentSummary(agencyId, caseId) {
  const installments = await prisma.casePaymentInstallment.findMany({
    where: { agencyId, caseId, status: { not: "Void" } },
    select: { amount: true, caseInvoiceId: true },
  });
  if (!installments.length) return { ...EMPTY_SUMMARY };
  const invoiceById = await loadInvoicesById(installments.map((item) => item.caseInvoiceId).filter(Boolean));
  return summarizeInstallments(installments, invoiceById);
}

/**
 * Same computation as getCasePaymentSummary, batched across every case in
 * the agency in two grouped queries instead of one round-trip per case —
 * for list views like the case dashboard.
 */
export async function getCasePaymentSummariesByCase(agencyId) {
  const installments = await prisma.casePaymentInstallment.findMany({
    where: { agencyId, status: { not: "Void" } },
    select: { caseId: true, amount: true, caseInvoiceId: true },
  });
  const invoiceById = await loadInvoicesById(installments.map((item) => item.caseInvoiceId).filter(Boolean));

  const byCaseId = new Map();
  for (const installment of installments) {
    const list = byCaseId.get(installment.caseId) || [];
    list.push(installment);
    byCaseId.set(installment.caseId, list);
  }

  const summaries = new Map();
  for (const [caseId, items] of byCaseId) {
    summaries.set(caseId, summarizeInstallments(items, invoiceById));
  }
  return summaries;
}

// ---------- Trigger firing ----------

async function claimInstallment(installmentId) {
  const result = await prisma.casePaymentInstallment.updateMany({
    where: { id: installmentId, status: "Scheduled" },
    data: { status: "Invoicing" },
  });
  return result.count === 1;
}

async function fireInstallment(agencyId, installment, actorUserId) {
  const claimed = await claimInstallment(installment.id);
  if (!claimed) return null;

  try {
    const invoiceRow = await createInvoiceRecord(agencyId, {
      caseId: installment.caseId,
      clientId: installment.clientId,
      paymentType: installment.paymentType,
      description: installment.label,
      amount: Number(installment.amount),
      dueDate: undefined,
      actorUserId,
    });
    const updated = await prisma.casePaymentInstallment.update({
      where: { id: installment.id },
      data: { status: "Invoiced", caseInvoiceId: invoiceRow.id, invoicedAt: new Date() },
    });

    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: installment.clientId,
      caseId: installment.caseId,
      action: "payment_schedule.installment_invoiced",
      details: `${installment.label} — $${Number(installment.amount).toFixed(2)} invoiced (${installment.triggerType === "Stage" ? `stage: ${installment.triggerStage}` : "scheduled date"})`,
      entityType: "casePaymentInstallment",
      entityId: installment.id,
    });

    notifyInstallmentInvoiced({ agencyId, installment: { ...installment, caseInvoiceId: invoiceRow.id }, actorUserId }).catch(() => {});
    return updated;
  } catch (error) {
    // Release the claim so this installment is retried on the next trigger
    // check rather than getting stuck in limbo because of a transient
    // QuickBooks failure.
    await prisma.casePaymentInstallment.update({ where: { id: installment.id }, data: { status: "Scheduled" } }).catch(() => {});
    logger.warn("payment_schedule.fire_failed", { agencyId, installmentId: installment.id, reason: error.message });
    throw error;
  }
}

async function claimInstallmentForVoid(installmentId) {
  const result = await prisma.casePaymentInstallment.updateMany({
    where: { id: installmentId, status: "Invoiced" },
    data: { status: "Voiding" },
  });
  return result.count === 1;
}

/**
 * Voids an already-invoiced installment's QuickBooks invoice and resets the
 * installment back to Scheduled so it can be corrected (label, payment
 * type, amount, trigger) and re-fired — the only existing void path
 * (voidRemainingInstallments) explicitly never touches invoiced
 * installments, so a mistake caught after firing had no recovery short of
 * editing QuickBooks directly and leaving CaseDesk permanently out of sync.
 * Refuses to void an invoice that already has a payment applied — that
 * needs a refund handled in QuickBooks first, not a silent void here.
 */
export async function voidInvoicedInstallment(agencyId, caseId, installmentId, { reason, actorUserId }) {
  const installment = await prisma.casePaymentInstallment.findFirst({
    where: { id: installmentId, agencyId, caseId },
    include: { caseInvoice: true },
  });
  if (!installment) throw createHttpError(404, "Installment not found.", "NOT_FOUND");
  if (installment.status !== "Invoiced" || !installment.caseInvoice) {
    throw createHttpError(400, "Only an invoiced installment can be voided this way.", "VALIDATION_ERROR");
  }
  const invoice = installment.caseInvoice;
  if (Number(invoice.balance) !== Number(invoice.amount)) {
    throw createHttpError(409, "This invoice already has a payment applied — void or refund it in QuickBooks first.", "INVOICE_HAS_PAYMENT");
  }

  const claimed = await claimInstallmentForVoid(installment.id);
  if (!claimed) throw createHttpError(409, "This installment changed — reload and try again.", "CONFLICT");

  const trimmedReason = String(reason || "").trim().slice(0, 500);
  try {
    await voidQuickBooksInvoice(agencyId, { id: invoice.qbInvoiceId, syncToken: invoice.qbSyncToken });

    await prisma.$transaction([
      prisma.caseInvoice.update({ where: { id: invoice.id }, data: { status: "Void" } }),
      prisma.casePaymentInstallment.update({
        where: { id: installment.id },
        data: { status: "Scheduled", caseInvoiceId: null, invoicedAt: null },
      }),
    ]);

    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: installment.clientId,
      caseId,
      action: "payment_schedule.installment_invoice_voided",
      details: `${installment.label} — $${Number(installment.amount).toFixed(2)} invoice voided${trimmedReason ? `: ${trimmedReason}` : ""}; reset to Scheduled`,
      entityType: "casePaymentInstallment",
      entityId: installment.id,
    });
  } catch (error) {
    // Release the claim so the row doesn't get stuck on "Voiding" if the
    // QuickBooks call or the follow-up transaction failed.
    await prisma.casePaymentInstallment.update({ where: { id: installment.id }, data: { status: "Invoiced" } }).catch(() => {});
    logger.warn("payment_schedule.void_invoice_failed", { agencyId, installmentId: installment.id, reason: error.message });
    throw error;
  }

  return getCaseSchedule(agencyId, caseId);
}

/**
 * Fires every Scheduled stage-triggered installment whose trigger stage was
 * passed through by this stage change — including stages the case skipped
 * over, since CASE_STAGES is a fixed, ordered pipeline.
 */
export async function evaluateStageTriggers(agencyId, caseId, oldStage, newStage, actorUserId) {
  const newIndex = CASE_STAGES.indexOf(newStage);
  const oldIndex = oldStage ? CASE_STAGES.indexOf(oldStage) : -1;
  if (newIndex === -1 || newIndex <= oldIndex) return [];

  const candidates = await prisma.casePaymentInstallment.findMany({
    where: { agencyId, caseId, status: "Scheduled", triggerType: "Stage" },
  });
  const due = candidates.filter((item) => {
    const stageIndex = CASE_STAGES.indexOf(item.triggerStage);
    return stageIndex > oldIndex && stageIndex <= newIndex;
  });

  const results = [];
  for (const installment of due) {
    try {
      const fired = await fireInstallment(agencyId, installment, actorUserId);
      if (fired) results.push(fired);
    } catch {
      // Already logged inside fireInstallment; one failing installment must
      // not block the others due at this same stage change.
    }
  }
  return results;
}

const DATE_TRIGGER_POLL_MS = 15 * 60_000;
let dateTriggerTimer = null;

export async function runDateTriggerPass() {
  const due = await prisma.casePaymentInstallment.findMany({
    where: { status: "Scheduled", triggerType: "Date", triggerDate: { lte: new Date() } },
    take: 200,
  });
  for (const installment of due) {
    await fireInstallment(installment.agencyId, installment, null).catch(() => {});
  }
}

export function startPaymentScheduleWorker() {
  if (dateTriggerTimer) return;
  dateTriggerTimer = setInterval(() => {
    runDateTriggerPass().catch((error) => logger.warn("payment_schedule.date_pass_failed", { reason: error.message }));
  }, DATE_TRIGGER_POLL_MS);
  if (dateTriggerTimer.unref) dateTriggerTimer.unref();
}

export function stopPaymentScheduleWorker() {
  if (dateTriggerTimer) clearInterval(dateTriggerTimer);
  dateTriggerTimer = null;
}
