import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canCreateLead, leadAccessWhere } from "../src/modules/leads/lead.permissions.js";

const req = (role, userId = "user-a") => ({ auth: { role, userId, agencyId: "agency-a" } });

test("admin sees agency leads while consultants see their assigned leads", () => {
  const hideImported = { importedRows: { none: {} }, activities: { none: { title: "Admissions detail (imported)" } } };
  assert.deepEqual(leadAccessWhere(req("admin")), hideImported);
  assert.deepEqual(leadAccessWhere(req("consultant")), { ownerUserId: "user-a", ...hideImported });
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
