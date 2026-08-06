import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canCreateLead, leadAccessWhere, leadSegmentWhere } from "../src/modules/leads/lead.permissions.js";

const req = (role, userId = "user-a") => ({ auth: { role, userId, agencyId: "agency-a" } });

test("admin sees agency leads while consultants see their assigned leads", () => {
  assert.deepEqual(leadAccessWhere(req("admin")), {});
  assert.deepEqual(leadAccessWhere(req("consultant")), { ownerUserId: "user-a" });
});

test("segment filtering is a separate, explicit opt-in — not baked into role access", () => {
  assert.deepEqual(leadSegmentWhere(), { pipelineSegment: "STANDARD" });
  assert.deepEqual(leadSegmentWhere("IMPORT_REVIEW"), { pipelineSegment: "IMPORT_REVIEW" });
});

test("consultants can perform reception intake without adding another role", () => {
  assert.equal(canCreateLead(req("consultant")), true);
  assert.equal(canCreateLead(req("client")), false);
});

test("lead dashboard and report endpoints are admin-only", async () => {
  const routes = await readFile(new URL("../src/modules/leads/lead.routes.js", import.meta.url), "utf8");
  assert.match(routes, /"\/dashboard", requireRole\("admin"\)/);
  for (const report of ["funnel", "sources", "employees", "lost", "response-time", "ageing", "trends", "workload"]) {
    assert.match(routes, new RegExp(`"/reports/${report}", requireRole\\("admin"\\)`));
  }
});

test("Import Review has its own promote action, ledger view, sidebar entry, and route — separate from the standard Leads page", async () => {
  const [routes, sidebar, appRoutes, leadsPage, leadDetail] = await Promise.all([
    readFile(new URL("../src/modules/leads/lead.routes.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/layout/Sidebar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/modules/leads/pages/LeadsPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /router\.post\("\/:id\/promote", asyncHandler\(promoteLeadToPipeline\)\)/);
  assert.match(routes, /router\.get\("\/ledger\/import-review", requireRole\("admin"\), asyncHandler\(listImportReviewLedgerEntries\)\)/);
  assert.match(sidebar, /to: "\/leads\/review"/);
  assert.match(appRoutes, /path="\/leads\/review"/);
  assert.match(appRoutes, /<LeadsPage segment="IMPORT_REVIEW" \/>/);
  assert.match(leadsPage, /segment !== "STANDARD"/);
  assert.match(leadDetail, /lead\.pipelineSegment === "IMPORT_REVIEW"/);
  assert.match(leadDetail, /Promote to pipeline/);
});

test("lead dashboard names open the existing lead detail sheet", async () => {
  const page = await readFile(
    new URL(
      "../../frontend/src/modules/leads/pages/LeadDashboardPage.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(page, /function LeadNameButton\(\{ lead, onOpen \}\)/);
  assert.equal(page.match(/<LeadNameButton lead=\{lead\} onOpen=\{setSelectedLead\} \/>/g)?.length, 2);
  assert.match(page, /<LeadDetailSheet lead=\{selectedLead\}/);
  assert.match(page, /\["Open leads", summary\.openLeads, TrendingUp, "\/leads\?status=OPEN"\]/);
  assert.doesNotMatch(page, /money\.format\(summary\.openPipelineValue\)/);
});

test("lead RLS is agency scoped and no client policy is granted", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714150000_add_lead_foundation/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /leads_read[\s\S]*"agency_id" = current_agency_id\(\)/);
  assert.match(sql, /current_user_role\(\) = 'consultant'/);
  assert.doesNotMatch(sql, /current_user_role\(\) = 'client'[\s\S]*leads/);
});

test("lead history tables reject in-place updates", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714150000_add_lead_foundation/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /lead_activities_no_update/);
  assert.match(sql, /lead_stage_history_no_update/);
  assert.match(sql, /lead_assignment_history_no_update/);
});

test("qualification RLS follows lead ownership and agency membership", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714160000_add_lead_qualifications/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE "lead_qualifications" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /l\."owner_user_id" = current_app_user_id\(\)/);
  assert.match(sql, /"agency_id" = current_agency_id\(\)/);
});

test("consultation RLS follows agency, lead owner, and assigned consultant", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260714170000_add_lead_consultations/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE "lead_consultations" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /l\."owner_user_id" = current_app_user_id\(\)/);
  assert.match(sql, /"consultant_user_id" = current_app_user_id\(\)/);
  assert.match(sql, /lead_consultations_completion_check/);
});
