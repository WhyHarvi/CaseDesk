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
  assert.match(caseInvoiceService, /creditCaseInvoiceCollection\(agencyId, \{ caseId, caseInvoiceId: updated\.id, newBalance: updated\.balance, trigger: "MANUAL_PAYMENT", paymentProcessorUserId \}\)/);
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
  assert.match(service, /if \(delta === 0\) return \{ credited: false, reason: "no_balance_change" \};/);
  assert.match(service, /if \(delta < 0\) \{/);
  assert.match(service, /reverseInvoiceCredits/);
  // The claim (CAS) and the ledger inserts happen inside one transaction —
  // if they were two separate awaited calls, a crash between them would
  // permanently lose that credit (cursor says caught-up, no ledger rows
  // exist, and nothing would ever retry it).
  assert.match(service, /const result = await prisma\.\$transaction\(async \(tx\) => \{\s*\n\s*const claim = await tx\.caseInvoiceCreditCursor\.updateMany\(\{\s*\n\s*where: \{ caseInvoiceId, agencyId, lastCreditedBalance: cursor\.lastCreditedBalance \},\s*\n\s*data: \{ lastCreditedBalance: newBalanceNumber \},\s*\n\s*\}\);\s*\n\s*if \(claim\.count !== 1\) return \{ credited: false, reason: "lost_race" \};/);
});

test("new invoices freeze attribution and establish the original balance before any payment", async () => {
  const [service, invoices, schema] = await Promise.all([
    source("../src/services/incentiveCreditingService.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../prisma/schema.prisma"),
  ]);
  assert.match(schema, /model CaseInvoiceIncentiveSnapshot \{/);
  assert.match(service, /export async function buildInvoiceIncentiveSnapshot/);
  assert.match(invoices, /creditCursor: \{ create: \{ agencyId, lastCreditedBalance: invoice\.balance \} \}/);
  assert.match(invoices, /incentiveSnapshot: \{ create: incentiveSnapshot \}/);
});

test("voids rebaseline without credit and refunds create auditable negative reversals", async () => {
  const [service, invoiceService, webhook] = await Promise.all([
    source("../src/services/incentiveCreditingService.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../src/services/quickbooksWebhookService.js"),
  ]);
  assert.match(webhook, /resetCreditCursor\(event\.agencyId, updated\.id, 0\)/);
  assert.match(invoiceService, /fresh\.isVoided\s*\n\s*\? resetCreditCursor/);
  assert.match(service, /entryType: "REVERSAL"/);
  assert.match(service, /reversesEntryId: credit\.id/);
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
  assert.match(service, /share\.attributionKind === "PAYMENT_PROCESSOR"/);
  assert.match(service, /paymentProcessorUserId: verifiedPaymentProcessorId/);
});

test("payment-processor attribution follows the staff member who recorded the collection", async () => {
  const [crediting, invoices, approvals] = await Promise.all([
    source("../src/services/incentiveCreditingService.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../src/services/paymentApprovalService.js"),
  ]);
  assert.match(crediting, /roleName = "Payment processor"/);
  assert.match(crediting, /id: paymentProcessorUserId, agencyId, status: "active"/);
  assert.match(invoices, /paymentProcessorUserId = actorUserId/);
  assert.match(approvals, /paymentProcessorUserId: row\.submittedById/);
  const manualCreditCalls = invoices.match(/trigger: "MANUAL_PAYMENT", paymentProcessorUserId/g) || [];
  assert.equal(manualCreditCalls.length, 2, "cash and non-cash manual payments must both credit their real processor");
});

test("the retry worker never recreates snapshots for an inactive workspace", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");
  assert.match(service, /prisma\.incentivePlan\.findMany\(\{\s*where: \{ isActive: true \}/);
  assert.match(service, /if \(!activePlans\.length\) return 0;/);
  assert.match(service, /where: \{ incentiveSnapshot: null, OR: eligibleScopes \}/);
  assert.match(service, /if \(!data\?\.incentivePlanId\) continue;/);
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

// An admin can just as easily be the RCIC or a Reviewer on cases as a
// consultant can, but account lifecycle (invite/disable/reset-password) is
// deliberately restricted to managedRoles (consultant/frontdesk) —
// listIncentiveRoleMembers/updateMemberProfile must NOT reuse
// teamMemberRecord (which enforces that same managedRoles restriction), or
// admins would 404 out of their own incentive-role/avatar assignment.
test("admins can be assigned an incentive role and pick their own avatar too — the read/write pair for it looks up any active staff member, not just managed roles", async () => {
  const [controller, routes, teamMembers] = await Promise.all([
    source("../src/controllers/adminTeamMemberController.js"),
    source("../src/routes/adminRoutes.js"),
    source("../../frontend/src/pages/TeamMembers.jsx"),
  ]);

  // User.role also covers client-portal accounts (and unused roles like
  // developer/staff/manager/accountant) — both the list and the update
  // below must scope to real staff only, or a client account could leak
  // into (or worse, be written to via) this endpoint.
  assert.match(controller, /const incentiveEligibleRoles = \["admin", \.\.\.managedRoles\];/);

  const listStart = controller.indexOf("export async function listIncentiveRoleMembers(");
  const listBody = controller.slice(listStart, controller.indexOf("\n}\n", listStart));
  assert.match(listBody, /where: \{ agencyId: req\.auth\.agencyId, status: "active", role: \{ in: incentiveEligibleRoles \} \}/);
  assert.match(listBody, /avatarPreset: resolvedAvatarPreset\(user\)/);
  // The unified card grid needs a status badge for every role, admins
  // included — the query's own filter is already the guarantee.
  assert.match(listBody, /status: "active",/);

  const updateStart = controller.indexOf("export async function updateMemberProfile(");
  const updateBody = controller.slice(updateStart, controller.indexOf("\n}\n", updateStart));
  assert.match(updateBody, /where: \{ id: req\.params\.id, agencyId: req\.auth\.agencyId, status: "active", role: \{ in: incentiveEligibleRoles \} \}/);
  assert.doesNotMatch(updateBody, /teamMemberRecord/);
  assert.match(updateBody, /validateIncentiveRoleIds\(/);
  assert.match(updateBody, /tx\.teamIncentiveRoleAssignment\.deleteMany/);
  // A picked preset always wins over a previously-uploaded custom photo,
  // same rule updateTeamMember already applies for consultants.
  assert.match(updateBody, /data: \{ avatarPreset, avatarStorageKey: null, avatarMimeType: null \}/);
  assert.match(updateBody, /normalizeAvatarPreset\(req\.body\.avatarPreset, \{ required: true \}\)/);

  assert.match(routes, /router\.get\("\/incentive-role-members", asyncHandler\(listIncentiveRoleMembers\)\)/);
  assert.match(routes, /router\.patch\("\/incentive-role-members\/:id", asyncHandler\(updateMemberProfile\)\)/);
  // This whole router is requireRole("admin")-gated at the top — confirm
  // the new routes aren't accidentally mounted somewhere else unguarded.
  assert.match(routes, /router\.use\(requireRole\("admin"\)\);[\s\S]*router\.get\("\/incentive-role-members"/);

  // Admins render in the exact same card grid as consultants/frontdesk —
  // same "Admins" filter pill, same role badge lookup, same
  // click-a-card-to-open-an-overlay dispatcher — not a visually separate section.
  assert.match(teamMembers, /\{ value: "admin", label: "Admins" \}/);
  assert.match(teamMembers, /admin: "bg-amber-50 text-amber-700"/);
  assert.match(teamMembers, /function openMember\(member\) \{/);
  assert.match(teamMembers, /\/admin\/incentive-role-members/);
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

test("the incentive ledger exposes and filters derived approval statuses without adding a mutable payout status column", async () => {
  const [controller, api, page, schema] = await Promise.all([
    source("../src/controllers/incentiveLedgerController.js"),
    source("../../frontend/src/api/incentivesApi.js"),
    source("../../frontend/src/pages/Incentives.jsx"),
    source("../prisma/schema.prisma"),
  ]);
  assert.match(controller, /const APPROVAL_STATUSES = new Set\(\["APPROVED", "RECALCULATED", "AUTOMATIC", "REVERSED"\]\)/);
  assert.match(controller, /if \(entry\.entryType === "REVERSAL"\) return "REVERSED"/);
  assert.match(controller, /if \(entry\.entryType === "ADJUSTMENT" \|\| entry\.triggerSource === "PLAN_RECALCULATION"\) return "RECALCULATED"/);
  assert.match(controller, /if \(entry\.triggerSource === "RETROACTIVE_APPROVAL"\) return "APPROVED"/);
  assert.match(controller, /triggerSource: "RETROACTIVE_APPROVAL", entryType: "CREDIT"/);
  assert.match(controller, /entryType: \{ notIn: \["REVERSAL", "ADJUSTMENT"\] \}, NOT: \{ triggerSource: "RETROACTIVE_APPROVAL" \}/);
  assert.match(controller, /data: rows\.map\(\(row\) => \(\{ \.\.\.row, approvalStatus: approvalStatusFor\(row\) \}\)\)/);
  assert.match(api, /approvalStatus/);
  assert.match(page, /<option value="APPROVED">Approved<\/option>/);
  assert.match(page, /<option value="RECALCULATED">Recalculated<\/option>/);
  assert.match(page, /<option value="AUTOMATIC">Automatic<\/option>/);
  assert.match(page, /<option value="REVERSED">Reversed<\/option>/);
  assert.match(page, /getIncentiveLedger\(\{ userId, pageSize: 20, approvalStatus \}\)/);
  assert.doesNotMatch(schema.slice(schema.indexOf("model IncentiveLedgerEntry"), schema.indexOf("model IncentiveTimelineLegEvaluation")), /approvalStatus/);
});

test("computeSnapshotPool reports which rate it matched alongside the pool, and the real crediting path only takes the pool it needs", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");
  const fnStart = service.indexOf("async function computeSnapshotPool(");
  const fnBody = service.slice(fnStart, service.indexOf("\n}\n", fnStart));
  assert.match(fnBody, /return \{ pool: Number\(snapshot\.flatAmount\), matchedRate: null \};/);
  assert.match(fnBody, /return \{ pool: \(delta \* Number\(snapshot\.percentRate\)\) \/ 100, matchedRate: Number\(snapshot\.percentRate\) \};/);
  assert.match(fnBody, /return \{ pool: rate === null \? 0 : \(delta \* rate\) \/ 100, matchedRate: rate \};/);
  assert.match(service, /const \{ pool \} = await computeSnapshotPool\(snapshot, \{ agencyId, caseId, delta \}\);/);
});

test("the pipeline estimate exposes the formula detail and matched rate behind its final amount, not just the amount", async () => {
  const service = await source("../src/services/incentiveCreditingService.js");
  const fnStart = service.indexOf("export async function estimateInvoicePotentialCredit(");
  const fnBody = service.slice(fnStart, service.indexOf("\n}\n", fnStart));
  assert.match(fnBody, /const \{ pool, matchedRate \} = await computeSnapshotPool\(snapshot, \{ agencyId, caseId: invoice\.caseId, delta: balance \}\);/);
  assert.match(fnBody, /formulaType: snapshot\.formulaType,/);
  assert.match(fnBody, /tiers: Array\.isArray\(snapshot\.tiers\) \? snapshot\.tiers : \[\],/);
  assert.match(fnBody, /matchedRate,/);
});

test("getPipeline keeps its existing per-case aggregate fields and additionally attaches a per-invoice breakdown carrying the formula, matched rate, and every one of the viewer's own role shares on that invoice", async () => {
  const controller = await source("../src/controllers/incentiveLedgerController.js");
  const fnStart = controller.indexOf("export async function getPipeline(");
  const fnBody = controller.slice(fnStart, controller.indexOf("\n}\n", fnStart));

  // Existing aggregate fields untouched — nothing else in the frontend
  // depends on their absence of an `invoices` array, so this must stay additive.
  assert.match(fnBody, /existing\.outstandingBalance \+= outstandingBalance;/);
  assert.match(fnBody, /existing\.estimatedAmount \+= myTotal;/);
  assert.match(fnBody, /client: invoice\.case\.client, outstandingBalance, planName: estimate\.planName, estimatedAmount: myTotal, estimated: true,/);

  // New per-invoice breakdown, additive on the same row.
  assert.match(fnBody, /existing\.invoices\.push\(invoiceDetail\);/);
  assert.match(fnBody, /invoices: \[invoiceDetail\] \}\);/);
  assert.match(fnBody, /formulaType: estimate\.formulaType,/);
  assert.match(fnBody, /matchedRate: estimate\.matchedRate,/);
  assert.match(fnBody, /myShares: mine\.map\(\(entry\) => \(\{ roleNameSnapshot: entry\.roleNameSnapshot, attributionKind: entry\.attributionKind, sharePercentApplied: entry\.sharePercentApplied, amount: entry\.amount \}\)\),/);
});

test("a case-team change re-freezes open never-credited invoice snapshots with the current holders — the RCIC gap fix", async () => {
  const [service, teamController, requiredTeamService] = await Promise.all([
    source("../src/services/incentiveCreditingService.js"),
    source("../src/controllers/caseTeamController.js"),
    source("../src/services/caseRequiredTeamService.js"),
  ]);

  // The re-snapshot helper: only invoices that still owe money, aren't
  // void, and have never had a credit are touched — already-collected
  // money is never re-attributed ("only future collections qualify").
  const fnStart = service.indexOf("export async function refreshOpenInvoiceSnapshots(");
  const fnBody = service.slice(fnStart, service.indexOf("\n}\n", fnStart));
  assert.match(fnBody, /balance: \{ gt: 0 \}/);
  assert.match(fnBody, /status: \{ notIn: \["Void", "Voided"\] \}/);
  assert.match(fnBody, /incentiveLedgerEntries: \{ none: \{\} \}/);
  // Rebuilds the snapshot from current holders and freezes it back.
  assert.match(fnBody, /buildInvoiceIncentiveSnapshot\(agencyId, caseId, invoice\.case\.caseType\)/);
  assert.match(fnBody, /caseInvoiceIncentiveSnapshot\.upsert/);

  // Wired into both team-assignment paths, best-effort — a snapshot
  // refresh failure must never break the team assignment it reacts to.
  const updateStart = teamController.indexOf("export async function updateCaseCollaboration(");
  const updateBody = teamController.slice(updateStart, teamController.indexOf("\n}\n", updateStart));
  assert.match(updateBody, /refreshOpenInvoiceSnapshots\(agencyId, caseId\)/);
  assert.match(updateBody, /logger\.warn\("incentive\.snapshot_refresh_failed"/);

  const backfillStart = requiredTeamService.indexOf("export async function backfillRequiredCaseTeams(");
  const backfillBody = requiredTeamService.slice(backfillStart, requiredTeamService.indexOf("\n}\n", backfillStart));
  assert.match(backfillBody, /refreshOpenInvoiceSnapshots\(agencyId, item\.caseId, db\)/);
  assert.match(backfillBody, /logger\.warn\("incentive\.snapshot_refresh_failed"/);
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

test("a completed refund reverses incentive ledger credits and contest revenue, not just the invoice/refund records", async () => {
  const [creditingService, caseInvoiceService, quickbooksWebhookService] = await Promise.all([
    source("../src/services/incentiveCreditingService.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../src/services/quickbooksWebhookService.js"),
  ]);

  // The reversal engine has its own entry point for refunds that never move
  // CaseInvoice.balance (cash refunds and QuickBooks refund receipts both
  // settle through InvoiceRefund/CashTransaction, not by re-inflating the
  // owed balance) — creditCaseInvoiceCollection's balance-diff cursor can
  // never observe these, so it can't be the thing that reverses them.
  assert.match(creditingService, /export async function reverseCaseInvoiceRefund\(tx, \{ agencyId, caseId, caseInvoiceId, refundAmount, trigger, triggerRef \}\)/);

  // Cash refund: the ledger reversal runs inside the same transaction that
  // first flips the InvoiceRefund row to Completed, so a crash mid-way
  // leaves nothing partially applied — the existing approvalId idempotency
  // guard reprocesses the whole step, reversal included, on retry.
  const cashRefundStart = caseInvoiceService.indexOf("export async function completeCashInvoiceRefund(");
  const cashRefundBody = caseInvoiceService.slice(cashRefundStart, caseInvoiceService.indexOf("\nexport async function markInvoiceRefundFailed(", cashRefundStart));
  assert.match(cashRefundBody, /const refund = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?tx\.invoiceRefund\.upsert\([\s\S]*?tx\.caseInvoice\.update\([\s\S]*?reverseCaseInvoiceRefund\(tx, \{\s*\n\s*agencyId, caseId: invoice\.caseId, caseInvoiceId: invoice\.id, refundAmount: numericAmount,\s*\n\s*trigger: "CASH_REFUND", triggerRef: `refund:\$\{row\.id\}`,\s*\n\s*\}\);\s*\n\s*return row;\s*\n\s*\}\);/);
  assert.match(cashRefundBody, /recordRevenueMovement\(agencyId, \{\s*\n\s*caseId: invoice\.caseId, caseInvoiceId: invoice\.id, delta: -numericAmount,\s*\n\s*triggerSource: "CASH_REFUND"/);
  assert.match(cashRefundBody, /\.catch\(\(error\) => \{\s*\n\s*logger\.warn\("incentive\.revenue_reversal_failed"/);

  // QuickBooks refund receipt: same shape — the reversal is inside the
  // transaction that marks the InvoiceRefund Completed (qbRefundReceiptId
  // set), so the existing "alreadyApplied" lookup on that field makes a
  // retried webhook delivery safe to reprocess in full.
  const qboRefundStart = quickbooksWebhookService.indexOf("async function applyCaseInvoiceRefundReceipt(");
  const qboRefundBody = quickbooksWebhookService.slice(qboRefundStart, quickbooksWebhookService.indexOf("\nasync function processCaseInvoiceEvent(", qboRefundStart));
  assert.match(qboRefundBody, /const completed = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?tx\.invoiceRefund\.update\([\s\S]*?tx\.caseInvoice\.update\([\s\S]*?reverseCaseInvoiceRefund\(tx, \{\s*\n\s*agencyId, caseId: row\.invoice\.caseId, caseInvoiceId: row\.invoice\.id, refundAmount: Number\(row\.amount\),\s*\n\s*trigger: "QBO_REFUND", triggerRef: `refund:\$\{row\.id\}`,\s*\n\s*\}\);\s*\n\s*return row;\s*\n\s*\}\);/);
  assert.match(qboRefundBody, /recordRevenueMovement\(agencyId, \{\s*\n\s*caseId: completed\.invoice\.caseId, caseInvoiceId: completed\.invoice\.id, delta: -Number\(completed\.amount\),\s*\n\s*triggerSource: "QBO_REFUND"/);
  assert.match(qboRefundBody, /\.catch\(\(error\) => \{\s*\n\s*logger\.warn\("incentive\.revenue_reversal_failed"/);
});
