import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("crediting is wired into all 4 balance-mutating call sites, not just the two obvious write endpoints", async () => {
  const [caseInvoiceService, quickbooksWebhookService, paymentScheduleService] = await Promise.all([
    source("../src/services/caseInvoiceService.js"),
    source("../src/services/quickbooksWebhookService.js"),
    source("../src/services/paymentScheduleService.js"),
  ]);

  // 1. Manual cash/e-transfer payment.
  assert.match(caseInvoiceService, /creditCaseInvoiceCollection\(agencyId, \{ caseId, caseInvoiceId: updated\.id, newBalance: updated\.balance, trigger: "MANUAL_PAYMENT" \}\)/);
  // 2. The read-path resync inside listCaseInvoices — easy to miss, but a
  // QuickBooks-side payment can be observed here before any webhook fires.
  assert.match(caseInvoiceService, /creditCaseInvoiceCollection\(agencyId, \{ caseId: updated\.caseId, caseInvoiceId: updated\.id, newBalance: updated\.balance, trigger: "LAZY_RESYNC" \}\)/);
  // 3. QuickBooks webhook sync.
  assert.match(quickbooksWebhookService, /creditCaseInvoiceCollection\(event\.agencyId, \{ caseId: updated\.caseId, caseInvoiceId: updated\.id, newBalance: updated\.balance, trigger: "QBO_WEBHOOK" \}\)/);
  // 4. Voiding an untouched installment invoice — must NOT go through the
  // normal crediting path (that would credit the full amount as if it had
  // just been collected); it must reset the cursor instead.
  assert.match(paymentScheduleService, /resetCreditCursor\(agencyId, invoice\.id, 0\)/);
  assert.doesNotMatch(paymentScheduleService, /creditCaseInvoiceCollection/);
});

test("every crediting call site treats a credit failure as best-effort and never lets it fail the underlying payment", async () => {
  const [caseInvoiceService, quickbooksWebhookService, paymentScheduleService] = await Promise.all([
    source("../src/services/caseInvoiceService.js"),
    source("../src/services/quickbooksWebhookService.js"),
    source("../src/services/paymentScheduleService.js"),
  ]);
  for (const [name, src] of [["caseInvoiceService", caseInvoiceService], ["quickbooksWebhookService", quickbooksWebhookService]]) {
    assert.match(src, /\.catch\(\(error\) => \{\s*\n\s*logger\.warn\("incentive\.credit_failed"/, `${name} must catch crediting errors, not let them propagate`);
  }
  assert.match(paymentScheduleService, /\.catch\(\(resetError\) => \{\s*\n\s*logger\.warn\("incentive\.cursor_reset_failed"/);
});

test("crediting is idempotent via a compare-and-swap on the cursor, claimed in the same transaction as the ledger writes", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");

  // A first-ever observation only establishes a baseline — it must not credit,
  // whether that's a brand-new $0 invoice or the pre-launch backfill.
  assert.match(service, /return \{ credited: false, reason: "baseline" \};/);
  // Balance went up (or is unchanged) relative to the cursor -> nothing new
  // was collected. This alone is what makes voids/amount-edits/lost races
  // automatically safe without any special-casing.
  assert.match(service, /if \(!\(delta > 0\)\) return \{ credited: false, reason: "no_new_collection" \};/);
  // The claim (CAS) and the ledger inserts happen inside one transaction —
  // if they were two separate awaited calls, a crash between them would
  // permanently lose that credit (cursor says caught-up, no ledger rows
  // exist, and nothing would ever retry it).
  assert.match(service, /const result = await prisma\.\$transaction\(async \(tx\) => \{\s*\n\s*const claim = await tx\.caseInvoiceCreditCursor\.updateMany\(\{\s*\n\s*where: \{ caseInvoiceId, lastCreditedBalance: cursor\.lastCreditedBalance \},\s*\n\s*data: \{ lastCreditedBalance: newBalanceNumber \},\s*\n\s*\}\);\s*\n\s*if \(claim\.count !== 1\) return \{ credited: false, reason: "lost_race" \};/);
});

test("the payout pool is computed per formulaType, and a share with no current holder is dropped rather than reallocated", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");

  assert.match(service, /if \(plan\.formulaType === "FLAT_PER_PAYMENT"\) return Number\(plan\.flatAmount\);/);
  assert.match(service, /if \(plan\.formulaType === "PERCENT_OF_PAYMENT"\) return \(delta \* Number\(plan\.percentRate\)\) \/ 100;/);
  // Tiered rate is looked up against cumulative collected-to-date, not the
  // size of this one payment.
  assert.match(service, /const cumulativeAfterPayment = Number\(summary\.paidAmount\);/);
  assert.match(service, /const rate = tierRateFor\(plan\.tiers, cumulativeAfterPayment\);/);

  // LEAD_OWNER / LEAD_CONVERTER resolve off the case's originating Lead;
  // CASE_ROLE resolves from active global Team Member assignments.
  assert.match(service, /prisma\.lead\.findFirst\(\{\s*\n\s*where: \{ convertedCaseId: caseId, agencyId \},\s*\n\s*select: \{ ownerUserId: true, conversion: \{ select: \{ convertedById: true \} \} \},/);
  assert.match(service, /prisma\.teamIncentiveRoleAssignment\.findMany\(\{/);
  assert.match(service, /user: \{ status: "active", memberships: \{ some: \{ agencyId, isActive: true \} \} \}/);
  assert.match(service, /const caseTeamUserIds = new Set/);
  assert.match(service, /if \(!caseTeamUserIds\.has\(row\.userId\)\) continue;/);
  assert.match(service, /if \(!userIds\.length\) continue;/);
});

test("global incentive roles are stored on team members and existing case assignments are carried forward", async () => {
  const [schema, migration, controller, teamMembers] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260818220000_add_team_incentive_roles/migration.sql"),
    source("../src/controllers/adminTeamMemberController.js"),
    source("../../frontend/src/pages/TeamMembers.jsx"),
  ]);
  assert.match(schema, /model TeamIncentiveRoleAssignment \{/);
  assert.match(migration, /INSERT INTO "team_incentive_role_assignments"/);
  assert.match(migration, /FROM "case_role_assignments"/);
  assert.match(controller, /incentiveRoleIds/);
  assert.match(controller, /tx\.teamIncentiveRoleAssignment\.deleteMany/);
  assert.match(teamMembers, /Incentive roles/);
  assert.match(teamMembers, /No incentive role/);
});

test("largest-remainder rounding keeps a share's holders summing exactly to its rounded cent amount", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");
  assert.match(service, /function splitEvenly\(shareAmountCents, userIds\) \{/);
  assert.match(service, /const base = Math\.floor\(shareAmountCents \/ userIds\.length\);/);
});

test("the pre-launch backfill seeds a cursor for every existing invoice at its current balance, guarded against re-running", async () => {
  const migration = await source("../prisma/migrations/20260818210000_add_incentive_ledger/migration.sql");
  assert.match(migration, /INSERT INTO "case_invoice_credit_cursors"/);
  assert.match(migration, /SELECT gen_random_uuid\(\)::text, "agency_id", "id", "balance", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP\s*\n\s*FROM "case_invoices"/);
  assert.match(migration, /ON CONFLICT \("case_invoice_id"\) DO NOTHING;/);
});

test("the pipeline estimate never writes ledger rows or advances the cursor — it's read-only", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");
  const estimateFn = service.slice(service.indexOf("export async function estimatePotentialCredit"), service.indexOf("// Re-baselines"));
  assert.doesNotMatch(estimateFn, /caseInvoiceCreditCursor/);
  assert.doesNotMatch(estimateFn, /incentiveLedgerEntry\.create/);
});

test("incentive read APIs scope self-vs-admin correctly and are mounted behind the incentives portal page", async () => {
  const [controller, server] = await Promise.all([
    source("../src/controllers/incentiveLedgerController.js"),
    source("../src/server.js"),
  ]);
  // Non-admins can never see anyone else's numbers — targetUserId ignores
  // ?userId= entirely unless the caller is an admin.
  assert.match(controller, /if \(req\.auth\.role === "admin"\) \{/);
  assert.match(controller, /return req\.auth\.userId;\s*\n\}/);
  assert.match(server, /app\.use\(\s*"\/api\/incentives",\s*requireAuth,\s*staffUser,[\s\S]*?requirePortalPage\("incentives"\),\s*incentiveRoutes,\s*\);/);
});
