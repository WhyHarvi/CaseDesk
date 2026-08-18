import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { CASE_STAGES } from "../constants/caseStages.js";
import { createInvoiceRecord } from "./caseInvoiceService.js";
import { ensureFeeCategories, requireFeeCategory } from "./feeCategoryService.js";
import { notifyInstallmentInvoiced, notifyStaffInstallmentVoided } from "./paymentNotificationService.js";
import { deleteQuickBooksPayment, getQuickBooksInvoice, voidQuickBooksInvoice } from "./quickbooksService.js";
import { logger } from "./logger.js";
import { templateMatchesCase } from "./correspondenceTemplateService.js";
import { ensureDefaultBillingTemplates } from "./billingTemplateDefaults.js";
import { applyLocalCashToInvoice } from "./paymentApprovalLedgerService.js";

const TRIGGER_TYPES = new Set(["Date", "Stage"]);

function moneyCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function installmentNetAmount(item) {
  return Math.max(0, (moneyCents(item.amount) - moneyCents(item.discountAmount)) / 100);
}

function validateDiscountAmount(value) {
  const amount = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
    throw createHttpError(400, "Enter a discount between $0 and $1,000,000.", "VALIDATION_ERROR");
  }
  return moneyCents(amount) / 100;
}

function validateInstallmentInput(item) {
  const label = String(item?.label || "").trim().slice(0, 200);
  if (!label) throw createHttpError(400, "Every installment needs a label.", "VALIDATION_ERROR");
  const paymentType = String(item?.paymentType || "").trim();
  if (!paymentType) throw createHttpError(400, "Choose a valid payment type for every installment.", "VALIDATION_ERROR");
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
    paymentType,
    amount,
    triggerType,
    triggerStage: triggerType === "Stage" ? item.triggerStage : null,
    triggerDaysAfterSigning: triggerType === "Date" ? Number(item.triggerDaysAfterSigning) : null,
  };
}

async function validateInstallmentsInput(agencyId, installments) {
  const validated = installments.map(validateInstallmentInput);
  await Promise.all([...new Set(validated.map((item) => item.paymentType))].map((code) => requireFeeCategory(agencyId, code)));
  return validated;
}

// A schedule discount is applied only to professional/consultation work,
// never government fees or pass-through disbursements. Each installment
// keeps its quoted (gross) amount and its own allocated discount so the
// retainer can show the original fee while QuickBooks receives only the
// agreed net installment amount. Allocation starts at the last professional
// installment, preserving the initial deposit wherever possible.
async function allocateScheduleDiscount(agencyId, installments, discountValue, preservedById = new Map()) {
  const discountAmount = validateDiscountAmount(discountValue);
  const kindByCode = await getFeeCategoryKindMap(agencyId);
  const rows = installments.map((item) => ({ ...item, discountAmount: Number(preservedById.get(item.id) || 0) }));
  const targetCents = moneyCents(discountAmount);
  const preservedCents = rows.reduce((sum, item) => sum + moneyCents(item.discountAmount), 0);
  if (preservedCents > targetCents) {
    throw createHttpError(400, "The discount cannot be lower than the amount already applied to invoiced installments.", "VALIDATION_ERROR");
  }

  let remaining = targetCents - preservedCents;
  const eligible = rows
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !preservedById.has(item.id) && TAXABLE_FEE_KINDS.has(kindByCode.get(item.paymentType) || "Other"))
    .reverse();
  const capacity = eligible.reduce((sum, { item }) => sum + Math.max(0, moneyCents(item.amount) - 1), 0);
  if (remaining > capacity) {
    throw createHttpError(400, "The discount must be less than the professional and consultation fees.", "VALIDATION_ERROR");
  }
  for (const { index, item } of eligible) {
    if (!remaining) break;
    const applied = Math.min(remaining, Math.max(0, moneyCents(item.amount) - 1));
    rows[index].discountAmount = applied / 100;
    remaining -= applied;
  }
  return { discountAmount, installments: rows };
}

// ---------- Templates ----------

function tags(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item ?? "").trim().slice(0, 80).toLowerCase()).filter(Boolean))].slice(0, 20);
}

// Case.caseType is free text (no enum — agencies can type anything), so an
// exact-string match against a template's caseType would miss most real
// cases. This mirrors templateMatchesCase's forgiving substring/alias
// resolution already used for CorrespondenceTemplate (retainer content),
// so a payment template tagged "sowp extension" still matches a case typed
// "SOWP Extension" or "Spousal Open WP Extension". System-default templates
// sort first so the agency's own fee schedule is always the one a case
// opens to.
export async function listScheduleTemplates(agencyId, caseType) {
  await ensureDefaultBillingTemplates(agencyId);
  const all = await prisma.paymentScheduleTemplate.findMany({
    where: { agencyId, isActive: true },
    include: { installments: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });
  const filtered = caseType ? all.filter((template) => templateMatchesCase(template, caseType)) : all;
  return filtered.sort((a, b) => (b.isSystemDefault ? 1 : 0) - (a.isSystemDefault ? 1 : 0) || a.name.localeCompare(b.name));
}

export async function createScheduleTemplate(agencyId, { caseType, name, caseTags, isSystemDefault, installments }) {
  const trimmedName = String(name || "").trim().slice(0, 150);
  const trimmedCaseType = String(caseType || "").trim().slice(0, 120);
  if (!trimmedName) throw createHttpError(400, "Name the template.", "VALIDATION_ERROR");
  if (!trimmedCaseType) throw createHttpError(400, "Choose which case type this template applies to.", "VALIDATION_ERROR");
  if (!Array.isArray(installments) || !installments.length) throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");
  const validated = await validateInstallmentsInput(agencyId, installments);

  return prisma.paymentScheduleTemplate.create({
    data: {
      agencyId,
      caseType: trimmedCaseType,
      name: trimmedName,
      caseTags: tags(caseTags),
      isSystemDefault: Boolean(isSystemDefault),
      installments: { create: validated.map((item, index) => ({ ...item, sortOrder: index })) },
    },
    include: { installments: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function updateScheduleTemplate(agencyId, templateId, { name, caseTags, isSystemDefault, isActive, installments }) {
  const existing = await prisma.paymentScheduleTemplate.findFirst({ where: { id: templateId, agencyId } });
  if (!existing) throw createHttpError(404, "Template not found.", "NOT_FOUND");
  const data = {};
  if (name !== undefined) {
    const trimmedName = String(name || "").trim().slice(0, 150);
    if (!trimmedName) throw createHttpError(400, "Name the template.", "VALIDATION_ERROR");
    data.name = trimmedName;
  }
  if (caseTags !== undefined) data.caseTags = tags(caseTags);
  if (typeof isSystemDefault === "boolean") data.isSystemDefault = isSystemDefault;
  if (typeof isActive === "boolean") data.isActive = isActive;

  if (installments !== undefined) {
    if (!Array.isArray(installments) || !installments.length) throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");
    const validated = await validateInstallmentsInput(agencyId, installments);
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

// Live tax preview for the schedule editor — computed straight off the
// schedule's own installments (not the invoiced/paid totals
// getCasePaymentSummary tracks), so staff see "+ HST" update as they build
// or edit a schedule, before anything is invoiced.
async function attachTaxBreakdown(schedule, agencyId) {
  if (!schedule) return schedule;
  const [kindByCode, taxRatePercent] = await Promise.all([getFeeCategoryKindMap(agencyId), getAgencyTaxRatePercent(agencyId)]);
  let professionalFeesBeforeDiscount = 0;
  let taxableSubtotal = 0;
  let nonTaxableSubtotal = 0;
  for (const installment of schedule.installments) {
    if (installment.status === "Void") continue;
    const kind = kindByCode.get(installment.paymentType) || "Other";
    if (TAXABLE_FEE_KINDS.has(kind)) {
      professionalFeesBeforeDiscount += Number(installment.amount);
      taxableSubtotal += installmentNetAmount(installment);
    }
    else nonTaxableSubtotal += Number(installment.amount);
  }
  const tax = Math.round(taxableSubtotal * taxRatePercent) / 100;
  const discountAmount = Math.max(0, professionalFeesBeforeDiscount - taxableSubtotal);
  return {
    ...schedule,
    discountAmount,
    installments: schedule.installments.map((item) => ({ ...item, netAmount: installmentNetAmount(item) })),
    taxSummary: { professionalFeesBeforeDiscount, discountAmount, taxableSubtotal, nonTaxableSubtotal, tax, taxRatePercent, totalFee: taxableSubtotal + tax + nonTaxableSubtotal },
  };
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
  return attachTaxBreakdown(schedule, agencyId);
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function installmentDueLabel(installment) {
  if (installment.triggerType === "Date" && installment.triggerDate) {
    return new Date(installment.triggerDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  }
  if (installment.triggerType === "Stage") return `Upon reaching the "${installment.triggerStage}" stage`;
  return "—";
}

// What a retainer document should show for its payment terms/schedule
// sections, computed from the case's real, approved payment schedule —
// used both when a schedule already exists at retainer-creation time and
// by the "sync from schedule" action on an already-created retainer.
//
// Professional/Government fee totals reuse the exact taxable/non-taxable
// split that already drives the Billing tab's own Total Fee summary —
// administrative and courier fees have no corresponding fee category in
// the schedule at all (this agency only has Professional/Government/
// Consultation/Other), so they're deliberately left out here; the
// retainer keeps them as plain editable placeholder text for a consultant
// to fill in or delete by hand.
function buildRetainerScheduleMergeContext(schedule) {
  const activeInstallments = schedule.installments.filter((item) => item.status !== "Void");
  return {
    values: {
      "agreement.professionalFees": formatMoney(schedule.taxSummary.professionalFeesBeforeDiscount),
      "agreement.discount": formatMoney(schedule.taxSummary.discountAmount),
      "agreement.governmentFees": formatMoney(schedule.taxSummary.nonTaxableSubtotal),
      "agreement.taxes": formatMoney(schedule.taxSummary.tax),
      "agreement.totalFees": formatMoney(schedule.taxSummary.totalFee),
    },
    installmentRows: activeInstallments.map((item) => ({
      label: item.label,
      amount: formatMoney(item.netAmount),
      due: installmentDueLabel(item),
    })),
    totalLabel: formatMoney(schedule.taxSummary.totalFee),
    discountLabel: formatMoney(schedule.taxSummary.discountAmount),
    hasDiscount: schedule.taxSummary.discountAmount > 0,
  };
}

export async function getRetainerScheduleMergeContext(agencyId, caseId) {
  const schedule = await getCaseSchedule(agencyId, caseId);
  return schedule ? buildRetainerScheduleMergeContext(schedule) : null;
}

// Builds the exact fee/installment merge data a retainer would receive from
// a proposed schedule, but deliberately does not persist a schedule or fire
// any invoice triggers. The Billing retainer flow uses this for its mandatory
// read-only preview before a consultant can approve creation.
export async function previewRetainerScheduleMergeContext(
  agencyId,
  { signingDate, installments, discountAmount = 0 },
) {
  const resolvedSigningDate = signingDate ? new Date(signingDate) : new Date();
  if (Number.isNaN(resolvedSigningDate.getTime())) {
    throw createHttpError(400, "Enter a valid signing date.", "VALIDATION_ERROR");
  }
  if (!Array.isArray(installments) || !installments.length) {
    throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");
  }
  const validated = await validateInstallmentsInput(agencyId, installments);
  const discounted = await allocateScheduleDiscount(
    agencyId,
    validated,
    discountAmount,
  );
  const previewSchedule = await attachTaxBreakdown(
    {
      signingDate: resolvedSigningDate,
      discountAmount: discounted.discountAmount,
      installments: discounted.installments.map((item, index) => ({
        ...item,
        sortOrder: index,
        status: "Scheduled",
        triggerDate:
          item.triggerType === "Date"
            ? resolveTriggerDate(
                resolvedSigningDate,
                item.triggerDaysAfterSigning,
              )
            : null,
      })),
    },
    agencyId,
  );
  return buildRetainerScheduleMergeContext(previewSchedule);
}

export async function createCaseSchedule(agencyId, { caseId, signingDate, installments, discountAmount = 0, actorUserId }) {
  const existing = await prisma.casePaymentSchedule.findFirst({ where: { agencyId, caseId } });
  if (existing) throw createHttpError(409, "This case already has a payment schedule. Edit it instead.", "SCHEDULE_EXISTS");

  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId, deletedAt: null }, select: { id: true, clientId: true, stage: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");

  const resolvedSigningDate = signingDate ? new Date(signingDate) : new Date();
  if (Number.isNaN(resolvedSigningDate.getTime())) throw createHttpError(400, "Enter a valid signing date.", "VALIDATION_ERROR");
  if (!Array.isArray(installments) || !installments.length) throw createHttpError(400, "Add at least one installment.", "VALIDATION_ERROR");
  const validated = await validateInstallmentsInput(agencyId, installments);
  const discounted = await allocateScheduleDiscount(agencyId, validated, discountAmount);

  const schedule = await prisma.casePaymentSchedule.create({
    data: {
      agencyId,
      caseId,
      clientId: caseItem.clientId,
      signingDate: resolvedSigningDate,
      discountAmount: discounted.discountAmount,
      createdById: actorUserId,
      installments: {
        create: discounted.installments.map((item, index) => ({
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
  // or date triggers (e.g. added retroactively, or a date-triggered
  // installment whose days-after-signing already elapsed) should catch
  // those up immediately rather than waiting for the next stage change or
  // the next 15-minute date-trigger poll that may be a while away.
  await catchUpDueInstallments(agencyId, caseId, actorUserId).catch((error) => {
    logger.warn("payment_schedule.catchup_failed", { agencyId, caseId, reason: error.message });
  });

  return getCaseSchedule(agencyId, caseId);
}

const EDIT_REQUIRES_ADMIN_STATUSES = new Set(["Invoiced", "Void"]);

export async function updateCaseInstallments(agencyId, caseId, { installments, discountAmount, actorRole, actorUserId }) {
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

  const resolvedDiscount = discountAmount === undefined ? Number(schedule.discountAmount || 0) : validateDiscountAmount(discountAmount);
  if (hasFiredInstallments && moneyCents(resolvedDiscount) !== moneyCents(schedule.discountAmount)) {
    throw createHttpError(409, "The discount is locked after an installment has been invoiced or voided.", "DISCOUNT_LOCKED");
  }

  const firedIds = new Set(schedule.installments.filter((item) => EDIT_REQUIRES_ADMIN_STATUSES.has(item.status)).map((item) => item.id));
  const incomingIds = new Set(installments.filter((item) => item.id).map((item) => item.id));
  for (const firedId of firedIds) {
    if (!incomingIds.has(firedId)) throw createHttpError(400, "Invoiced or voided installments cannot be removed from the schedule.", "VALIDATION_ERROR");
  }

  const validated = (await validateInstallmentsInput(agencyId, installments)).map((item, index) => ({ id: installments[index].id || null, ...item }));
  const preservedDiscounts = new Map(
    schedule.installments
      .filter((item) => firedIds.has(item.id))
      .map((item) => [item.id, Number(item.discountAmount || 0)]),
  );
  const discounted = await allocateScheduleDiscount(agencyId, validated, resolvedDiscount, preservedDiscounts);

  await prisma.$transaction(async (tx) => {
    await tx.casePaymentSchedule.update({ where: { id: schedule.id }, data: { discountAmount: discounted.discountAmount } });
    await tx.casePaymentInstallment.deleteMany({ where: { scheduleId: schedule.id, id: { notIn: [...incomingIds] }, status: "Scheduled" } });
    for (const [index, item] of discounted.installments.entries()) {
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

  // A correction that fixes a due-but-stuck installment (wrong amount,
  // wrong trigger, or just a payment type fixed after voiding a bad
  // invoice) should invoice immediately if it's already due, not wait for
  // the next 15-minute date-trigger poll.
  await catchUpDueInstallments(agencyId, caseId, actorUserId).catch((error) => {
    logger.warn("payment_schedule.catchup_failed", { agencyId, caseId, reason: error.message });
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
//
// Tax (Ontario HST, agency-configurable via AgencyBillingSettings) applies
// only to Professional and Consultation fee-category kinds — never to
// Government disbursements or Other pass-through costs (biometrics,
// third-party fees). kindByCode maps a paymentType code ("fees",
// "disbursement", ...) to its AgencyFeeCategory.kind. Legacy Payment rows
// have no fee-category association (dead code path, see above) and are
// folded into the non-taxable bucket so totalFee still equals
// taxableSubtotal + tax + nonTaxableSubtotal.
const TAXABLE_FEE_KINDS = new Set(["Professional", "Consultation"]);

function summarizeCaseBilling(installments, invoices, legacyPayments = [], kindByCode = new Map(), taxRatePercent = 13) {
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const linkedInvoiceIds = new Set(installments.map((item) => item.caseInvoiceId).filter(Boolean));
  let paidAmount = 0;
  let taxableSubtotal = 0;
  let nonTaxableSubtotal = 0;
  let tax = 0;
  let outstandingAmount = 0;
  for (const installment of installments) {
    const kind = kindByCode.get(installment.paymentType) || "Other";
    const invoice = installment.caseInvoiceId ? invoiceById.get(installment.caseInvoiceId) : null;
    const subtotal = invoice ? Number(invoice.subtotalAmount ?? invoice.amount) : installmentNetAmount(installment);
    if (TAXABLE_FEE_KINDS.has(kind)) taxableSubtotal += subtotal;
    else nonTaxableSubtotal += subtotal;
    if (invoice) {
      const refunded = (invoice.refunds || []).reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
      paidAmount += Math.max(0, Number(invoice.amount) - Number(invoice.balance) - refunded);
      tax += Number(invoice.taxAmount ?? (TAXABLE_FEE_KINDS.has(kind) ? Math.round(subtotal * taxRatePercent) / 100 : 0));
      outstandingAmount += Math.max(0, Number(invoice.balance));
    } else if (TAXABLE_FEE_KINDS.has(kind)) {
      const estimatedTax = Math.round(subtotal * taxRatePercent) / 100;
      tax += estimatedTax;
      outstandingAmount += subtotal + estimatedTax;
    } else {
      outstandingAmount += subtotal;
    }
  }
  for (const invoice of invoices) {
    if (linkedInvoiceIds.has(invoice.id) || ["Void", "Voided"].includes(invoice.status)) continue;
    const kind = kindByCode.get(invoice.paymentType) || "Other";
    const invoiceSubtotal = Number(invoice.subtotalAmount ?? invoice.amount);
    if (TAXABLE_FEE_KINDS.has(kind)) taxableSubtotal += invoiceSubtotal;
    else nonTaxableSubtotal += invoiceSubtotal;
    tax += Number(invoice.taxAmount ?? (TAXABLE_FEE_KINDS.has(kind) ? Math.round(invoiceSubtotal * taxRatePercent) / 100 : 0));
    const refunded = (invoice.refunds || []).reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
    paidAmount += Math.max(0, Number(invoice.amount) - Number(invoice.balance) - refunded);
    outstandingAmount += Math.max(0, Number(invoice.balance));
  }
  for (const payment of legacyPayments) {
    nonTaxableSubtotal += Number(payment.totalFee);
    paidAmount += Number(payment.paidAmount);
    outstandingAmount += Math.max(0, Number(payment.balance));
  }
  tax = Math.round(tax * 100) / 100;
  const totalFee = taxableSubtotal + tax + nonTaxableSubtotal;
  // Refunds reduce net collections, but do not reopen a settled invoice.
  // Outstanding money is therefore the explicit balance carried by each
  // invoice plus the estimated total of installments not issued yet—not
  // simply charges minus net collections.
  const balance = Math.round(Math.max(outstandingAmount, 0) * 100) / 100;
  const status = totalFee === 0 ? "Unpaid" : balance <= 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid";
  return { totalFee, paidAmount, balance, status, taxableSubtotal, nonTaxableSubtotal, tax, taxRatePercent };
}

const EMPTY_SUMMARY = { totalFee: 0, paidAmount: 0, balance: 0, status: "Unpaid", taxableSubtotal: 0, nonTaxableSubtotal: 0, tax: 0, taxRatePercent: 13 };

export async function getAgencyTaxRatePercent(agencyId) {
  const settings = await prisma.agencyBillingSettings.findUnique({ where: { agencyId }, select: { taxRatePercent: true } });
  return settings ? Number(settings.taxRatePercent) : 13;
}

async function getFeeCategoryKindMap(agencyId) {
  // Ensure the 4 default categories (fees/disbursement/consultation/other)
  // exist before reading kinds — a brand-new agency that hasn't yet opened
  // any billing screen has no AgencyFeeCategory rows at all, and an empty
  // map here would silently make every "fees" installment fall back to
  // "Other" (non-taxable), which is wrong: Professional fees must always be
  // taxable regardless of whether this is the first billing action an
  // agency has ever taken.
  await ensureFeeCategories(agencyId);
  const categories = await prisma.agencyFeeCategory.findMany({ where: { agencyId }, select: { code: true, kind: true } });
  return new Map(categories.map((category) => [category.code, category.kind]));
}

export async function getCasePaymentSummary(agencyId, caseId) {
  const [installments, invoices, legacyPayments, kindByCode, taxRatePercent] = await Promise.all([
    prisma.casePaymentInstallment.findMany({
      where: { agencyId, caseId, status: { not: "Void" } },
      select: { amount: true, discountAmount: true, caseInvoiceId: true, paymentType: true },
    }),
    prisma.caseInvoice.findMany({
      where: { agencyId, caseId },
      select: {
        id: true, caseId: true, amount: true, subtotalAmount: true, taxAmount: true, balance: true, status: true, paymentType: true,
        paymentApprovals: { where: { status: "Approved", method: "Cash" }, select: { amount: true, status: true, method: true, paymentDate: true } },
        refunds: { where: { status: "Completed" }, select: { amount: true } },
      },
    }).then((rows) => rows.map(applyLocalCashToInvoice)),
    prisma.payment.findMany({ where: { agencyId, caseId }, select: { totalFee: true, paidAmount: true, balance: true } }),
    getFeeCategoryKindMap(agencyId),
    getAgencyTaxRatePercent(agencyId),
  ]);
  if (!installments.length && !invoices.length && !legacyPayments.length) return { ...EMPTY_SUMMARY, taxRatePercent };
  return summarizeCaseBilling(installments, invoices, legacyPayments, kindByCode, taxRatePercent);
}

/**
 * Same computation as getCasePaymentSummary, batched across every case in
 * the agency in two grouped queries instead of one round-trip per case —
 * for list views like the case dashboard.
 */
export async function getCasePaymentSummariesByCase(agencyId) {
  const [installments, invoices, legacyPayments, kindByCode, taxRatePercent] = await Promise.all([prisma.casePaymentInstallment.findMany({
    where: { agencyId, status: { not: "Void" } },
    select: { caseId: true, amount: true, discountAmount: true, caseInvoiceId: true, paymentType: true },
  }), prisma.caseInvoice.findMany({
    where: { agencyId },
    select: {
      id: true, caseId: true, amount: true, subtotalAmount: true, taxAmount: true, balance: true, status: true, paymentType: true,
      paymentApprovals: { where: { status: "Approved", method: "Cash" }, select: { amount: true, status: true, method: true, paymentDate: true } },
      refunds: { where: { status: "Completed" }, select: { amount: true } },
    },
  }).then((rows) => rows.map(applyLocalCashToInvoice)), prisma.payment.findMany({
    where: { agencyId }, select: { caseId: true, totalFee: true, paidAmount: true, balance: true },
  }), getFeeCategoryKindMap(agencyId), getAgencyTaxRatePercent(agencyId)]);

  const byCaseId = new Map();
  for (const installment of installments) {
    const list = byCaseId.get(installment.caseId) || [];
    list.push(installment);
    byCaseId.set(installment.caseId, list);
  }

  const invoicesByCase = new Map();
  for (const invoice of invoices) invoicesByCase.set(invoice.caseId, [...(invoicesByCase.get(invoice.caseId) || []), invoice]);
  const legacyByCase = new Map();
  for (const payment of legacyPayments) legacyByCase.set(payment.caseId, [...(legacyByCase.get(payment.caseId) || []), payment]);
  const summaries = new Map();
  const caseIds = new Set([...byCaseId.keys(), ...invoicesByCase.keys(), ...legacyByCase.keys()]);
  for (const caseId of caseIds) {
    summaries.set(caseId, summarizeCaseBilling(byCaseId.get(caseId) || [], invoicesByCase.get(caseId) || [], legacyByCase.get(caseId) || [], kindByCode, taxRatePercent));
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

// A case's retainer (its most-recently-updated Agreement-kind
// WrittenDocument, same definition the Billing tab itself uses) holds real
// invoicing back until it's Finalized — signed by the client and
// countersigned by the agency. Building a schedule no longer bills anyone
// for a retainer they haven't agreed to yet; this is what used to fire real
// QuickBooks invoices the moment a schedule was created, before the client
// had even seen the retainer.
//
// A case with no retainer at all (never used the feature) is unaffected —
// only a case that actually has one, and it isn't Finalized yet, is held.
async function retainerBlocksInvoicing(agencyId, caseId) {
  const retainer = await prisma.writtenDocument.findFirst({
    where: { agencyId, caseId, correspondenceKind: "Agreement" },
    orderBy: { updatedAt: "desc" },
    select: { correspondenceStatus: true },
  });
  return Boolean(retainer) && retainer.correspondenceStatus !== "Finalized";
}

async function fireInstallment(agencyId, installment, actorUserId) {
  if (await retainerBlocksInvoicing(agencyId, installment.caseId)) return null;
  const claimed = await claimInstallment(installment.id);
  if (!claimed) return null;

  try {
    const invoiceAmount = installmentNetAmount(installment);
    const invoiceRow = await createInvoiceRecord(agencyId, {
      caseId: installment.caseId,
      clientId: installment.clientId,
      paymentType: installment.paymentType,
      description: installment.label,
      amount: invoiceAmount,
      discountAmount: Number(installment.discountAmount || 0),
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
      details: `${installment.label} — $${invoiceAmount.toFixed(2)} invoiced${Number(installment.discountAmount || 0) > 0 ? ` after a $${Number(installment.discountAmount).toFixed(2)} discount` : ""} (${installment.triggerType === "Stage" ? `stage: ${installment.triggerStage}` : "scheduled date"})`,
      entityType: "casePaymentInstallment",
      entityId: installment.id,
    });

    notifyInstallmentInvoiced({ agencyId, installment: { ...installment, amount: invoiceAmount, caseInvoiceId: invoiceRow.id }, actorUserId }).catch(() => {});
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
    include: {
      caseInvoice: {
        include: { refunds: { where: { status: { in: ["Requested", "AwaitingQuickBooks", "Completed"] } }, select: { id: true } } },
      },
    },
  });
  if (!installment) throw createHttpError(404, "Installment not found.", "NOT_FOUND");
  if (installment.status !== "Invoiced" || !installment.caseInvoice) {
    throw createHttpError(400, "Only an invoiced installment can be voided this way.", "VALIDATION_ERROR");
  }
  const invoice = installment.caseInvoice;
  const hasPayment = Number(invoice.balance) !== Number(invoice.amount);
  // A paid installment invoice can still be voided, but only by voiding the
  // mistaken payment itself first (see voidPaidCaseInvoicePayment for the
  // same logic on a standalone invoice) — never silently, and never when a
  // refund already exists for it.
  if (hasPayment) {
    if (invoice.refunds.length) {
      throw createHttpError(409, "A refund already exists for this invoice — resolve or cancel it before voiding the payment instead.", "REFUND_ALREADY_EXISTS");
    }
    if (invoice.accountingProvider !== "QuickBooks" || !invoice.lastQbPaymentId) {
      throw createHttpError(409, "This invoice already has a payment applied — void or refund it in QuickBooks first.", "INVOICE_HAS_PAYMENT");
    }
  }
  const trimmedReason = String(reason || "").trim().slice(0, 500);
  if (hasPayment && !trimmedReason) {
    throw createHttpError(400, "Enter why this payment is being voided.", "VALIDATION_ERROR");
  }

  const claimed = await claimInstallmentForVoid(installment.id);
  if (!claimed) throw createHttpError(409, "This installment changed — reload and try again.", "CONFLICT");

  try {
    if (hasPayment) {
      await deleteQuickBooksPayment(agencyId, { id: invoice.lastQbPaymentId });
      const freshInvoice = await getQuickBooksInvoice(agencyId, invoice.qbInvoiceId);
      if (freshInvoice) await voidQuickBooksInvoice(agencyId, { id: freshInvoice.id, syncToken: freshInvoice.syncToken });
    } else {
      await voidQuickBooksInvoice(agencyId, { id: invoice.qbInvoiceId, syncToken: invoice.qbSyncToken });
    }

    await prisma.$transaction([
      // balance: 0 alongside status: "Void" — a voided invoice isn't owed
      // by anyone anymore. Leaving the old balance in place is what made
      // the client portal keep showing a live "Pay now" link for an
      // invoice that no longer exists in QuickBooks.
      prisma.caseInvoice.update({ where: { id: invoice.id }, data: { status: "Void", balance: 0 } }),
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
      details: `${installment.label} — $${Number(installment.amount).toFixed(2)} invoice${hasPayment ? " and its QuickBooks payment (not a refund — no money moved)" : ""} voided${trimmedReason ? `: ${trimmedReason}` : ""}; reset to Scheduled`,
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
 * Fires every Scheduled installment that's already due right now,
 * regardless of how it got that way — a stage trigger the case has
 * already reached, or a date trigger whose date has already passed. Used
 * after creating or correcting a schedule so a fix doesn't have to wait
 * for the next stage change (which may never come) or the next
 * 15-minute date-trigger poll.
 */
async function catchUpDueInstallments(agencyId, caseId, actorUserId) {
  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { stage: true } });
  if (!caseItem) return [];
  const currentIndex = CASE_STAGES.indexOf(caseItem.stage);
  const now = new Date();

  const candidates = await prisma.casePaymentInstallment.findMany({ where: { agencyId, caseId, status: "Scheduled" } });
  const due = candidates.filter((item) => {
    if (item.triggerType === "Date") return Boolean(item.triggerDate) && item.triggerDate <= now;
    const stageIndex = CASE_STAGES.indexOf(item.triggerStage);
    return stageIndex !== -1 && currentIndex !== -1 && stageIndex <= currentIndex;
  });

  const results = [];
  for (const installment of due) {
    try {
      const fired = await fireInstallment(agencyId, installment, actorUserId);
      if (fired) results.push(fired);
    } catch {
      // Already logged inside fireInstallment; one failing installment must
      // not block the others due right now.
    }
  }
  return results;
}

// Called once a retainer reaches Finalized — releases whatever
// retainerBlocksInvoicing was holding back on this case and fires anything
// that's already due, exactly like correcting a schedule does today.
export async function releaseInstallmentsHeldByRetainer(agencyId, caseId, actorUserId) {
  return catchUpDueInstallments(agencyId, caseId, actorUserId);
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
