import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(paymentScheduleService, /"agreement\.professionalFees": formatMoney\(schedule\.taxSummary\.taxableSubtotal\)/);
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
});

test("the sync-schedule route is registered and the Billing tab exposes both entry points", async () => {
  const [routes, statusCard] = await Promise.all([
    source("../src/routes/caseBillingRetainerRoutes.js"),
    source("../../frontend/src/components/case-profile/RetainerStatusCard.jsx"),
  ]);

  assert.match(routes, /router\.post\("\/:caseId\/sync-schedule", asyncHandler\(syncCaseBillingRetainerWithSchedule\)\)/);

  // Starting a retainer on a case with no schedule yet shows the same
  // template-pick-then-edit builder as the Payment Schedule tab, inline,
  // before the retainer is created — not a silent blank draft.
  assert.match(statusCard, /function ScheduleReviewStep/);
  assert.match(statusCard, /TemplatePicker caseType=\{caseItem\.caseType\}/);
  assert.match(statusCard, /Approve schedule &amp; create retainer/);
  assert.match(statusCard, /Skip for now — start without a schedule/);
  assert.match(statusCard, /const offerScheduleReview = schedule === null/);

  // Sync is only offered while the document is still editable and a
  // schedule actually exists to sync from.
  assert.match(statusCard, /const canSync = canApprove && isEditable && Boolean\(schedule\)/);
  assert.match(statusCard, /syncCaseBillingRetainerWithSchedule/);
});

test("a voided installment invoice never fires again, and voided invoices drop out of the case's Billing tab", async () => {
  const service = await source("../src/services/paymentScheduleService.js");
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
});
