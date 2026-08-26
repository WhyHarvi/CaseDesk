import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyScheduleToRetainerHtml } from "../src/controllers/caseBillingRetainerController.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

// Covers the fix for two real problems found on a live case (Hemlata,
// study permit with spouse): (1) a retainer's fee/payment-schedule
// sections stayed permanently blank — nothing ever fed the case's actual
// payment schedule into the document; (2) building a payment schedule
// fired real QuickBooks invoices immediately, even while the retainer was
// still an unsent draft, producing invoices that duplicated money already
// collected through the case's Manual Ledger before the schedule existed.

test("building a payment schedule no longer invoices anything until its retainer is Finalized", async () => {
  const service = await source("../src/services/paymentScheduleService.js");

  assert.match(service, /async function retainerBlocksInvoicing\(agencyId, caseId\)/);
  assert.match(service, /correspondenceKind: "Agreement"/);
  assert.match(service, /orderBy: \{ updatedAt: "desc" \}/);
  assert.match(service, /retainer\.correspondenceStatus !== "Finalized"/);

  // The gate has to run before fireInstallment claims/invoices the
  // installment, not after — otherwise it's too late to hold anything back.
  const fireInstallmentBody = service.slice(
    service.indexOf("async function fireInstallment"),
    service.indexOf("async function claimInstallmentForVoid"),
  );
  assert.match(fireInstallmentBody, /if \(await retainerBlocksInvoicing\(agencyId, installment\.caseId\)\) return null;/);
  const gateIndex = fireInstallmentBody.indexOf("retainerBlocksInvoicing(");
  const claimIndex = fireInstallmentBody.indexOf("claimInstallment(installment.id)");
  assert.ok(gateIndex >= 0 && claimIndex >= 0 && gateIndex < claimIndex, "the gate must run before the installment is claimed/invoiced");

  // Every real invoicing entry point (manual catch-up, stage-change
  // triggers, the 15-minute date poll) funnels through fireInstallment, so
  // gating it there is enough — no separate gate needed at each call site.
  assert.match(service, /export async function releaseInstallmentsHeldByRetainer\(agencyId, caseId, actorUserId\)/);
  assert.match(service, /return catchUpDueInstallments\(agencyId, caseId, actorUserId\);/);
});

test("a retainer reaching Finalized releases whatever invoicing it was holding back", async () => {
  const [correspondenceController, clientPortalController] = await Promise.all([
    source("../src/controllers/correspondenceController.js"),
    source("../src/controllers/clientPortalController.js"),
  ]);

  assert.match(correspondenceController, /import \{ releaseInstallmentsHeldByRetainer \} from "\.\.\/services\/paymentScheduleService\.js"/);
  assert.match(correspondenceController, /existing\.correspondenceKind === "Agreement" && status === "Finalized" && existing\.caseId/);
  assert.match(correspondenceController, /releaseInstallmentsHeldByRetainer\(agencyId, existing\.caseId, actorUserId\)/);

  // The other real path to Finalized: the client-portal auto-countersign
  // that stamps the agency's signature the instant the client signs.
  assert.match(clientPortalController, /releaseInstallmentsHeldByRetainer/);
  assert.match(clientPortalController, /correspondenceStatus: "Finalized", contentHtml: countersignedContentHtml/);
  const countersignBlock = clientPortalController.slice(
    clientPortalController.indexOf("Fix 6.2 — auto-countersign"),
    clientPortalController.indexOf("Fix 6.2 — auto-countersign") + 5000,
  );
  assert.match(countersignBlock, /if \(finalizeCommitted\) \{[\s\S]*releaseInstallmentsHeldByRetainer\(agencyId, agreement\.caseId, userId\)/);
});

test("starting a retainer fills in its payment schedule instead of leaving it blank", async () => {
  const controller = await source("../src/controllers/caseBillingRetainerController.js");

  // The document must exist before the schedule is created — the
  // invoicing gate above only holds installments back if it finds a
  // not-yet-Finalized retainer already on the case at the moment they'd
  // otherwise fire.
  const createIndex = controller.indexOf("prisma.writtenDocument.create(");
  const scheduleIndex = controller.indexOf("createCaseSchedule(req.user.agencyId");
  assert.ok(createIndex >= 0 && scheduleIndex >= 0 && createIndex < scheduleIndex, "the retainer document must be created before the schedule");

  assert.match(controller, /getRetainerScheduleMergeContext\(req\.user\.agencyId, caseItem\.id\)/);
  assert.match(controller, /Array\.isArray\(req\.body\?\.installments\) && req\.body\.installments\.length/);
  // A schedule that fails validation shouldn't leave an orphaned blank
  // retainer behind — the two are one user-facing action.
  assert.match(controller, /await prisma\.writtenDocument\.delete\(\{ where: \{ id: data\.id \} \}\)\.catch\(\(\) => \{\}\);\s*\n\s*throw error;/);
  assert.match(controller, /applyScheduleToRetainerHtml\(data\.contentHtml, scheduleContext\)/);

  // "Sync from payment schedule" — the same application logic, callable
  // again later once a schedule exists or has changed.
  assert.match(controller, /export async function syncCaseBillingRetainerWithSchedule/);
  assert.match(controller, /\["Issued", "Signed", "Finalized"\]\.includes\(existing\.correspondenceStatus\)/);
  assert.match(controller, /has no payment schedule yet/);
});

test("schedule-to-retainer merge fills only what has real schedule data and never clobbers manual edits", async () => {
  const [correspondenceService, retainerController] = await Promise.all([
    source("../src/services/correspondenceTemplateService.js"),
    source("../src/controllers/caseBillingRetainerController.js"),
  ]);

  assert.match(correspondenceService, /export function applyResolvedMergeValues\(html, values\)/);
  // Matches on the placeholder's literal bracket text, not just the <mark>
  // wrapper — the Writer's TipTap schema has no mark/highlight extension,
  // so <mark> is stripped the moment a document is opened there.
  assert.match(correspondenceService, /missingPlaceholderText/);
  assert.match(correspondenceService, /if \(markPattern\.test\(result\)\) \{/);
  assert.match(correspondenceService, /else if \(textPattern\.test\(result\)\) \{/);

  const paymentScheduleService = await source("../src/services/paymentScheduleService.js");
  assert.match(paymentScheduleService, /export async function getRetainerScheduleMergeContext\(agencyId, caseId\)/);
  assert.match(paymentScheduleService, /"agreement\.professionalFees": formatMoney\(schedule\.taxSummary\.professionalFeesBeforeDiscount\)/);
  assert.match(paymentScheduleService, /"agreement\.discount": formatMoney\(schedule\.taxSummary\.discountAmount\)/);
  assert.match(paymentScheduleService, /"agreement\.governmentFees": formatMoney\(schedule\.taxSummary\.nonTaxableSubtotal\)/);
  // No fee category in this agency's schedule maps to administrative/
  // courier fees — those stay manual placeholders the consultant fills in
  // or deletes by hand, deliberately never auto-computed.
  assert.doesNotMatch(paymentScheduleService, /administrativeFees/);
  assert.doesNotMatch(paymentScheduleService, /courierFees/);

  // The installment table's row count has to change with the schedule, so
  // it's rebuilt wholesale (anchored on the section heading + its
  // following <tbody>) rather than filled cell-by-cell like the scalar
  // fee fields.
  assert.match(retainerController, /function replaceInstallmentScheduleRows\(html, installmentRows, totalLabel\)/);
  assert.match(retainerController, /html\.indexOf\("Payment Schedule<\/h2>"\)/);
  assert.match(retainerController, /html\.indexOf\("<tbody", headingIndex\)/);
  assert.match(retainerController, /<tr><td>Discount<\/td><td>-\$\{escapeHtml\(scheduleContext\.discountLabel\)\}<\/td><\/tr>/);
});

test("case discounts reduce only professional installments and flow through invoices, tax, and UI", async () => {
  const [service, controller, workspace, retainerCard, migration] = await Promise.all([
    source("../src/services/paymentScheduleService.js"),
    source("../src/controllers/paymentScheduleController.js"),
    source("../../frontend/src/components/case-profile/CasePaymentScheduleWorkspace.jsx"),
    source("../../frontend/src/components/case-profile/RetainerStatusCard.jsx"),
    source("../prisma/migrations/20260811203000_case_payment_schedule_discounts/migration.sql"),
  ]);

  assert.match(migration, /case_payment_schedules[\s\S]*discount_amount/);
  assert.match(migration, /case_payment_installments[\s\S]*discount_amount/);
  assert.match(service, /TAXABLE_FEE_KINDS\.has\(kindByCode\.get\(item\.paymentType\)/);
  assert.match(service, /\.reverse\(\)/);
  assert.match(service, /const invoiceAmount = installmentNetAmount\(installment\)/);
  assert.match(service, /amount: invoiceAmount/);
  assert.match(service, /taxableSubtotal \+= installmentNetAmount\(installment\)/);
  assert.match(controller, /discountAmount: req\.body\?\.discountAmount/);
  assert.match(workspace, /function DiscountField/);
  assert.match(workspace, /Government fees are never discounted/);
  assert.match(retainerCard, /DiscountField value=\{discountAmount\}/);
  assert.match(retainerCard, /\{ installments, signingDate, discountAmount, reviewToken \}/);
});

// Real staff confusion this fixes: entering a $39 "discount" for a $300 fee
// (13% of $300, the intuitive-but-wrong number) landed the client at
// $294.93, not $300 — the discount reduces the pre-tax fee, so tax is then
// computed on a smaller base. Getting to an exact $300 final total requires
// a $34.51 discount, math staff shouldn't have to do by hand. DiscountField
// now offers a second entry mode that takes the target total directly.
test("DiscountField can derive the professional-fee discount from a target final total instead of requiring staff to do the tax math themselves", async () => {
  const workspace = await source("../../frontend/src/components/case-profile/CasePaymentScheduleWorkspace.jsx");
  const fieldFn = workspace.slice(workspace.indexOf("export function DiscountField"), workspace.indexOf("function InstallmentRow"));

  // Two entry modes, not a replacement of the raw discount input — some
  // discounts (a flat promo, a goodwill credit) aren't tied to a round
  // final total and still need direct entry.
  assert.match(fieldFn, /DISCOUNT_ENTRY_MODES\.AMOUNT/);
  assert.match(fieldFn, /DISCOUNT_ENTRY_MODES\.FINAL_TOTAL/);
  assert.match(fieldFn, /Final agreed total, including HST/);

  // The actual formula: government fees are excluded from the taxable
  // portion before dividing out the tax rate, matching
  // allocateScheduleDiscount's "government fees are never discounted" rule
  // and attachTaxBreakdown's tax = round(taxableSubtotal * rate) / 100.
  assert.match(fieldFn, /const targetTaxablePortion = Math\.max\(0, finalTotal - nonTaxableSubtotal\)/);
  assert.match(fieldFn, /const targetNetTaxable = targetTaxablePortion \/ \(1 \+ taxRatePercent \/ 100\)/);
  assert.match(fieldFn, /Math\.max\(0, Math\.round\(\(taxableSubtotal - targetNetTaxable\) \* 100\) \/ 100\)/);

  // The target can be entered before the installment amount. Changes to the
  // fee rows must recalculate the discount without forcing staff to retype it.
  assert.match(fieldFn, /useMemo\(\(\) => \{[\s\S]*\[finalTotalInput, nonTaxableSubtotal, taxableSubtotal, taxRatePercent\]\)/);
  assert.match(fieldFn, /if \(mode !== DISCOUNT_ENTRY_MODES\.FINAL_TOTAL\) return;/);
  assert.match(fieldFn, /A professional-fee discount of/);

  // Whichever mode is active, staff see the resulting breakdown before
  // saving — reusing TaxSummaryBar (previously only shown after a schedule
  // was already saved) rather than a second, divergent summary widget.
  assert.match(fieldFn, /<TaxSummaryBar/);

  // Wired into every place a discount gets entered: the Billing tab's
  // create/edit schedule forms, and the retainer flow's inline builder.
  const retainerCard = await source("../../frontend/src/components/case-profile/RetainerStatusCard.jsx");
  assert.match(workspace, /<DiscountField value=\{discountAmount\} onChange=\{setDiscountAmount\} installments=\{installments\} feeKindByType=\{feeKindByType\} taxRatePercent=\{taxRatePercent\} \/>/);
  assert.match(workspace, /<DiscountField value=\{discountAmount\} onChange=\{setDiscountAmount\} disabled=\{lockedIds\.size > 0\} installments=\{installments\} feeKindByType=\{feeKindByType\} taxRatePercent=\{taxRatePercent\} \/>/);
  assert.match(retainerCard, /installments=\{installments\} feeKindByType=\{feeKindByType\} taxRatePercent=\{taxRatePercent\}/);
});

test("retainer sync renders and removes a real dollar discount without corrupting currency", () => {
  const html = `<h2>5. Payment Terms and Conditions</h2><table><tbody><tr><td>Professional Fees</td><td>$1,500.00</td></tr><tr><td>Government Fees (Biometrics, Permits, etc.)</td><td>$235.00</td></tr><tr><td>Applicable Taxes (professional fees)</td><td>$195.00</td></tr><tr><td><strong>Total</strong></td><td><strong>$1,930.00</strong></td></tr></tbody></table><h2>6. Payment Schedule</h2><table><tbody><tr><td>Old</td><td>$1.00</td><td>Old date</td></tr></tbody></table>`;
  const discounted = applyScheduleToRetainerHtml(html, {
    values: {
      "agreement.professionalFees": "$1,500.00",
      "agreement.discount": "$200.00",
      "agreement.governmentFees": "$235.00",
      "agreement.taxes": "$169.00",
      "agreement.totalFees": "$1,704.00",
    },
    installmentRows: [{ label: "On submission", amount: "$1,300.00", due: "September 1, 2026" }],
    totalLabel: "$1,704.00",
    discountLabel: "$200.00",
    hasDiscount: true,
  });
  assert.match(discounted, /<tr><td>Discount<\/td><td>-\$200\.00<\/td><\/tr>/);
  assert.match(discounted, /Applicable Taxes \(professional fees\)<\/td><td>\$169\.00/);
  assert.match(discounted, /<strong>\$1,704\.00<\/strong>/);
  assert.match(discounted, /On submission<\/td><td>\$1,300\.00/);
  assert.doesNotMatch(discounted, /\$1<tr>/);

  const withoutDiscount = applyScheduleToRetainerHtml(discounted, {
    values: {
      "agreement.professionalFees": "$1,500.00",
      "agreement.discount": "$0.00",
      "agreement.governmentFees": "$235.00",
      "agreement.taxes": "$195.00",
      "agreement.totalFees": "$1,930.00",
    },
    installmentRows: [{ label: "On submission", amount: "$1,500.00", due: "September 1, 2026" }],
    totalLabel: "$1,930.00",
    discountLabel: "$0.00",
    hasDiscount: false,
  });
  assert.doesNotMatch(withoutDiscount, /<td>Discount<\/td>/);
  assert.match(withoutDiscount, /<strong>\$1,930\.00<\/strong>/);
});

test("the sync-schedule route is registered and a retainer must be viewed before it can be created", async () => {
  const [routes, controller, scheduleService, api, statusCard] = await Promise.all([
    source("../src/routes/caseBillingRetainerRoutes.js"),
    source("../src/controllers/caseBillingRetainerController.js"),
    source("../src/services/paymentScheduleService.js"),
    source("../../frontend/src/api/caseBillingRetainerApi.js"),
    source("../../frontend/src/components/case-profile/RetainerStatusCard.jsx"),
  ]);

  assert.match(routes, /router\.post\("\/:caseId\/sync-schedule", asyncHandler\(syncCaseBillingRetainerWithSchedule\)\)/);
  assert.match(routes, /router\.post\("\/:caseId\/preview", asyncHandler\(previewCaseBillingRetainer\)\)/);
  assert.match(controller, /export async function previewCaseBillingRetainer/);
  assert.match(controller, /previewRetainerScheduleMergeContext/);
  assert.match(controller, /createRetainerReviewToken/);
  assert.match(controller, /requireMatchingRetainerReview/);
  assert.match(controller, /View the retainer before approving it/);
  const previewBody = controller.slice(
    controller.indexOf("export async function previewCaseBillingRetainer"),
    controller.indexOf("export async function createCaseBillingRetainerDraft"),
  );
  assert.doesNotMatch(previewBody, /writtenDocument\.(create|update|delete)/);
  assert.doesNotMatch(previewBody, /createCaseSchedule\(/);
  assert.match(scheduleService, /export async function previewRetainerScheduleMergeContext/);
  assert.match(api, /export async function previewCaseBillingRetainer\(caseId, schedule\)/);

  // Starting a retainer on a case with no schedule yet shows the same
  // template-pick-then-edit builder as the Payment Schedule tab in a
  // contained overlay, before the retainer is created — not a silent blank
  // draft or a permanently expanded block above case payments.
  assert.match(statusCard, /function ScheduleReviewStep/);
  assert.match(statusCard, /> Add template/);
  assert.match(statusCard, /createPortal\(/);
  assert.match(statusCard, /typeof globalThis\.document !== "undefined"/);
  assert.match(statusCard, /globalThis\.document\.body/);
  assert.doesNotMatch(statusCard, /templateOpen && typeof document !== "undefined"/);
  assert.match(statusCard, /max-h-\[92dvh\][\s\S]*overflow-hidden/);
  assert.match(statusCard, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(statusCard, /TemplatePicker caseType=\{caseItem\.caseType\}/);
  assert.match(statusCard, /View retainer again/);
  assert.match(statusCard, /View retainer/);
  assert.match(statusCard, /reviewedMode === "schedule" \? "Approve schedule & create retainer"/);
  assert.match(statusCard, /reviewed \? \(/);
  assert.match(statusCard, /Nothing is created until you return and approve it/);
  assert.match(statusCard, /DOMPurify\.sanitize\(preview\.contentHtml/);
  assert.match(statusCard, /function invalidateReview\(\)/);
  assert.match(statusCard, /setReviewToken\(data\.reviewToken\)/);
  assert.match(statusCard, /const offerScheduleReview = schedule === null/);

  // Sync is only offered while the document is still editable and a
  // schedule actually exists to sync from.
  assert.match(statusCard, /const canSync = canApprove && isEditable && Boolean\(schedule\)/);
  assert.match(statusCard, /syncCaseBillingRetainerWithSchedule/);
});

test("an editable retainer can be reset to the template state without touching billing", async () => {
  const [routes, controller, api, statusCard] = await Promise.all([
    source("../src/routes/caseBillingRetainerRoutes.js"),
    source("../src/controllers/caseBillingRetainerController.js"),
    source("../../frontend/src/api/caseBillingRetainerApi.js"),
    source("../../frontend/src/components/case-profile/RetainerStatusCard.jsx"),
  ]);

  assert.match(routes, /router\.post\("\/:caseId\/reset", asyncHandler\(resetCaseBillingRetainer\)\)/);
  assert.match(controller, /export async function resetCaseBillingRetainer/);
  assert.match(controller, /\["Draft", "Saved", "ReadyToIssue"\]\.includes/);
  assert.match(controller, /writtenDocument\.deleteMany/);
  assert.match(controller, /clientDocument\.deleteMany/);
  assert.match(controller, /removeDocumentFile\(storageKey\)/);
  assert.doesNotMatch(
    controller.slice(
      controller.indexOf("export async function resetCaseBillingRetainer"),
      controller.indexOf('// Fix 4.1 — the "Approve and send" action'),
    ),
    /casePaymentSchedule\.(delete|deleteMany)/,
  );
  assert.match(api, /export async function resetCaseBillingRetainer\(caseId, documentId\)/);
  assert.match(statusCard, /> Reset retainer/);
  assert.match(statusCard, /Reset & choose again/);
  assert.match(statusCard, /payment schedule, invoices,[\s\S]*payments on this case will stay unchanged/);
});

test("a voided installment invoice never fires again, and voided invoices drop out of the case's Billing tab", async () => {
  const service = await source("../src/services/paymentScheduleService.js");
  const invoiceService = await source("../src/services/caseInvoiceService.js");
  const workspace = await source("../../frontend/src/components/case-profile/CaseBillingWorkspace.jsx");

  // voidInvoicedInstallment resets the installment to Scheduled so a real
  // mistake can be corrected and re-fired — but a duplicate that should
  // never be billed again needs voidRemainingInstallments run right after
  // to permanently retire it, which is why both are used together for a
  // duplicate rather than voidInvoicedInstallment alone.
  assert.match(service, /export async function voidInvoicedInstallment\(agencyId, caseId, installmentId, \{ reason, actorUserId \}\)/);
  assert.match(service, /export async function voidRemainingInstallments\(agencyId, caseId, \{ reason, actorUserId \}\)/);
  assert.match(service, /data: \{ status: "Void", balance: 0 \}/);

  // The agency-wide Payments page already excludes Void from its default
  // view; the per-case Billing tab's invoice list didn't do the same until
  // now — a voided duplicate invoice would otherwise still show there,
  // just with a grey badge, instead of actually disappearing.
  assert.match(workspace, /const visibleInvoices = invoices\?\.filter\(\(invoice\) => invoice\.status !== "Void"\) \?\? invoices;/);
  assert.match(workspace, /visibleInvoices\.length === 0/);
  assert.match(workspace, /visibleInvoices\.map\(\(invoice\)/);

  // Staff see invoices and schedules in the same Billing tab. Include the
  // source installment on each invoice so the card can use the correct void
  // operation without making an admin hunt through a second panel.
  assert.match(invoiceService, /installments: \{ select: \{ id: true, status: true \} \}/);
  assert.match(workspace, /invoice\.installments\?\.find\(\(item\) => item\.status === "Invoiced"\)/);
  assert.match(workspace, /voidInstallmentInvoice\(invoice\.caseId, invoicedInstallment\.id, voidReason\.trim\(\)\)/);
  assert.match(workspace, /voidCaseInvoice\(invoice\.caseId, invoice\.id, voidReason\.trim\(\)\)/);
});
