import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("incentive plan routes are fully admin-only", async () => {
  const routes = await source("../src/routes/incentivePlanRoutes.js");
  assert.match(routes, /router\.use\(requireRole\("admin"\)\);/);
});

test("a plan's formula shape is validated per formulaType, and numbers stay admin-editable (no code deploy to adjust a rate)", async () => {
  const service = await source("../src/services/incentivePlanService.js");

  assert.match(service, /export const FORMULA_TYPES = \["FLAT_PER_PAYMENT", "PERCENT_OF_PAYMENT", "TIERED_PERCENT_OF_REVENUE"\];/);
  assert.match(service, /if \(amount === null \|\| amount <= 0\) throw createHttpError\(400, "Enter a flat amount greater than zero\."/);
  assert.match(service, /if \(rate === null \|\| rate <= 0 \|\| rate > 100\) throw createHttpError\(400, "Enter a percent rate between 0 and 100\."/);
  assert.match(service, /if \(!suppliedTiers\.length\) throw createHttpError\(400, "Add at least one tier\."/);
  // Tiers must start at distinct cumulative-revenue thresholds, or the
  // "which tier applies" lookup in the crediting engine would be ambiguous.
  assert.match(service, /if \(seen\.has\(tier\.minCumulativeAmount\)\) throw createHttpError\(400, "Tiers must start at different revenue amounts\."/);

  // PATCH can never flip isActive to true directly — only the dedicated
  // activate action may, because it has to atomically steal the scope from
  // whatever plan currently holds it.
  assert.match(service, /if \(values\?\.isActive === true\) \{\s*\n\s*throw createHttpError\(400, "Use the activate action/);
});

test("role shares must sum to exactly 100%, reference valid case roles, and never repeat the same attribution point", async () => {
  const service = await source("../src/services/incentivePlanService.js");

  assert.match(service, /export const ATTRIBUTION_KINDS = \["CASE_ROLE", "LEAD_OWNER", "LEAD_CONVERTER"\];/);
  assert.match(service, /if \(attributionKind === "CASE_ROLE" && !caseRoleId\) throw createHttpError\(400, "Choose a case role for each case-role share\."/);
  assert.match(service, /if \(dedupeKeys\.has\(key\)\) throw createHttpError\(400, "Each role can only appear once in a plan's shares\."/);
  assert.match(service, /if \(Math\.abs\(total - 100\) > 0\.01\) throw createHttpError\(400, `Role shares must sum to exactly 100% /);
  // Case-role references are checked against this agency's active roles —
  // a share can't silently point at another agency's role or a hidden one.
  assert.match(service, /prisma\.agencyCaseRole\.findMany\(\{ where: \{ agencyId, id: \{ in: caseRoleIds \}, isActive: true \}/);
});

test("activating a plan atomically deactivates whatever else holds its scope, in one transaction", async () => {
  const service = await source("../src/services/incentivePlanService.js");

  assert.match(service, /export async function activateIncentivePlan\(agencyId, id\) \{\s*\n\s*return prisma\.\$transaction/);
  // A plan needs at least one role share before it can go live — an active
  // plan with nothing to split money across would silently credit nobody.
  assert.match(service, /if \(!plan\.roleShares\.length\) throw createHttpError\(409, "Add role shares before activating this plan\."/);
  // Same scope = same agencyId + caseType (including the null/agency-wide
  // fallback, which Prisma compares correctly as IS NULL) — matches the
  // partial unique index's semantics in the migration.
  assert.match(service, /where: \{ agencyId, caseType: plan\.caseType, isActive: true, id: \{ not: id \} \},\s*\n\s*data: \{ isActive: false, deactivatedAt: now \},/);
  assert.match(service, /data: \{ isActive: true, activatedAt: now, deactivatedAt: null \}/);
});

test("the one-active-plan-per-scope invariant is a real database constraint, not just app logic", async () => {
  const migration = await source(
    "../prisma/migrations/20260818200000_add_incentive_plans/migration.sql",
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "incentive_plans_one_active_per_scope"\s*\n\s*ON "incentive_plans" \("agency_id", COALESCE\("case_type", ''\)\)\s*\n\s*WHERE "is_active" = true;/,
  );
});

test("incentive plans are mounted behind the incentives portal page, admin-gated underneath", async () => {
  const server = await source("../src/server.js");
  assert.match(
    server,
    /app\.use\(\s*"\/api\/incentive-plans",\s*requireAuth,\s*staffUser,[\s\S]*?requirePortalPage\("incentives"\),\s*incentivePlanRoutes,\s*\);/,
  );
});

test("admins can preview and explicitly apply an active plan to safe outstanding legacy invoices", async () => {
  const [routes, service, panel] = await Promise.all([
    source("../src/routes/incentivePlanRoutes.js"),
    source("../src/services/incentivePlanService.js"),
    source("../../frontend/src/components/settings/IncentivePlansSettingsPanel.jsx"),
  ]);
  assert.match(routes, /router\.get\("\/:id\/legacy-invoices", asyncHandler\(previewLegacyInvoices\)\)/);
  assert.match(routes, /router\.post\("\/:id\/legacy-invoices\/apply"/);
  assert.match(service, /balance: \{ gt: 0 \}/);
  assert.match(service, /incentiveLedgerEntries: \{ none: \{\} \}/);
  assert.match(service, /incentiveSnapshot: \{ is: \{ incentivePlanId: null \} \}/);
  assert.match(service, /only future collections qualify/);
  assert.match(service, /skippedNoRecipients/);
  assert.match(panel, /Apply to old invoices/);
  assert.match(panel, /Only payments collected after applying this plan will create incentive credit/);
});
