import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canCreateLead, leadAccessWhere, leadSegmentWhere } from "../src/modules/leads/lead.permissions.js";

const req = (role, userId = "user-a") => ({ auth: { role, userId, agencyId: "agency-a" } });

test("admin sees agency leads while consultants see owned leads and leads with assigned work", () => {
  assert.deepEqual(leadAccessWhere(req("admin")), {});
  assert.deepEqual(leadAccessWhere(req("consultant")), {
    AND: [
      {
        OR: [
          { ownerUserId: "user-a" },
          { followUps: { some: { assignedUserId: "user-a", status: "PENDING" } } },
        ],
      },
    ],
  });
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

test("stage, priority, and owner each have a real endpoint with the right role gate and a UI entry point on the lead sheet", async () => {
  const [routes, leadDetail] = await Promise.all([
    readFile(new URL("../src/modules/leads/lead.routes.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx", import.meta.url), "utf8"),
  ]);
  // Owner reassignment is admin-only; stage and priority are admin or the
  // consultant currently assigned to the lead.
  assert.match(routes, /router\.post\("\/:id\/assign", requireRole\("admin"\), asyncHandler\(assignLead\)\)/);
  assert.match(routes, /router\.patch\("\/:id\/stage", requireRole\("admin", "consultant"\), asyncHandler\(changeLeadStage\)\)/);
  assert.match(routes, /router\.patch\("\/:id\/priority", requireRole\("admin", "consultant"\), asyncHandler\(changeLeadPriority\)\)/);

  // Owner still opens a proper sheet (needs a reason on record); stage and
  // priority are inline <select>s directly in the summary grid — no popup.
  assert.match(leadDetail, /canReassign = isWorkable && role === "admin"/);
  assert.match(leadDetail, /canEditWorkflow = isWorkable && \(role === "admin" \|\| \(role === "consultant" && ownsLead\)\)/);
  assert.match(leadDetail, /onEdit=\{canReassign \? \(\) => setActiveAction\("reassign"\) : null\}/);
  assert.match(leadDetail, /select=\{canEditWorkflow \? \{ value: lead\.stage, disabled: stageSaving, onChange: updateStage,/);
  assert.match(leadDetail, /select=\{canEditWorkflow \? \{ value: lead\.priority, disabled: prioritySaving, onChange: updatePriority,/);
  assert.match(leadDetail, /api\.patch\(`\/leads\/\$\{lead\.id\}\/stage`, \{ stage: nextStage \}\)/);
  assert.match(leadDetail, /api\.patch\(`\/leads\/\$\{lead\.id\}\/priority`, \{ priority: nextPriority \}\)/);
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
  assert.match(routes, /router\.post\("\/promote-bulk", asyncHandler\(bulkPromoteLeadsToPipeline\)\)/);
  assert.match(routes, /router\.get\("\/ledger\/import-review", requireRole\("admin"\), asyncHandler\(listImportReviewLedgerEntries\)\)/);
  assert.match(sidebar, /to: "\/leads\/review"/);
  assert.match(appRoutes, /path="\/leads\/review"/);
  assert.match(appRoutes, /<LeadsPage segment="IMPORT_REVIEW" \/>/);
  assert.match(leadsPage, /segment !== "STANDARD"/);
  assert.match(leadsPage, /canBulkPromote = segment === "IMPORT_REVIEW"/);
  assert.match(leadsPage, /api\.post\("\/leads\/promote-bulk", \{ leadIds: \[\.\.\.selectedIds\] \}\)/);
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

test("lead conversion uses the agency case-type dropdown", async () => {
  const sheet = await readFile(
    new URL(
      "../../frontend/src/modules/leads/components/ConvertLeadSheet.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sheet, /CaseTypeCombobox/);
  assert.match(sheet, /api\.get\("\/cases\/case-types"\)/);
  assert.match(sheet, /options=\{caseTypeOptions\}/);
  assert.doesNotMatch(sheet, /Case type<input/);
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

test("confirming a lead's appointment starts the retainer flow, and signing reuses the existing e-signature logic through a no-login link", async () => {
  const [publicBookingController, publicBookingRoutes, leadService, quickbooksWebhookService, mailService, retainerService, retainerTemplate, clientPortalController, publicRetainerController, schema, appRoutes, bookingApi, signPage] = await Promise.all([
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/publicBookingRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/leads/lead.service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/quickbooksWebhookService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/accountAccessMailService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/leads/lead.retainer.service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/leads/retainerDocumentTemplate.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/clientPortalController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/publicRetainerController.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/api/bookingApi.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/PublicRetainerSignPage.jsx", import.meta.url), "utf8"),
  ]);

  // Trigger: the retainer flow fires the moment a lead's first consultation
  // is booked — staff booking it directly, a visitor self-booking free or
  // paid — not only when a guest later confirms attendance. Confirming is
  // kept as an idempotent, redundant safety net, not the only door in.
  assert.match(retainerService, /export function triggerRetainerFlow/);
  assert.match(leadService, /triggerRetainerFlow\(result\.appointment\)/);
  assert.match(publicBookingController, /leadId: linkResult\.leadId/);
  assert.match(publicBookingController, /triggerRetainerFlow\(\{ \.\.\.appointment, leadId \}\)/);
  assert.match(publicBookingController, /confirmationStatus: "Confirmed"/);
  assert.match(publicBookingController, /triggerRetainerFlow\(updated\)/);
  assert.match(quickbooksWebhookService, /leadId: linkedLeadId/);
  assert.match(quickbooksWebhookService, /triggerRetainerFlow\(\{ \.\.\.appointment, leadId \}\)/);

  // Same trigger also covers an appointment linked straight to an existing
  // Client with no Lead at all (a returning client re-booking) — creates
  // just the missing Case, since the client already exists.
  assert.match(retainerService, /export async function ensureRetainerCaseForClient/);
  assert.match(retainerService, /appointment\?\.clientId\) \{\s*\n\s*ensureRetainerCaseForClient/);

  // Copy says "booked", not "confirmed" — accurate now that this usually
  // fires well before any attendance confirmation happens.
  assert.match(retainerService, /your consultation is booked/);
  assert.match(mailService, /Your consultation is booked\. Please review and sign/);

  // Early client/case creation is a separate, additive concept from a real
  // lead conversion — never reuses convertedClientId/convertedCaseId.
  assert.match(schema, /earlyClientId\s+String\?\s+@unique @map\("early_client_id"\)/);
  assert.match(schema, /earlyCaseId\s+String\?\s+@unique @map\("early_case_id"\)/);
  assert.match(retainerService, /correspondenceStatus: "Issued"/);
  assert.match(retainerService, /retainerStatus: "SENT"/);

  // The retainer has its own letterhead document — agency branding, an
  // attending-consultant/client block, and the real consultation fee —
  // rather than the generic {{placeholder}} correspondence template.
  assert.match(retainerService, /renderRetainerDocumentHtml\(\{/);
  assert.match(retainerService, /agencyLogoDataUri: logoDataUri/);
  assert.doesNotMatch(retainerService, /correspondenceTemplate\.findFirst/);
  assert.match(retainerTemplate, /export function renderRetainerDocumentHtml/);
  assert.match(retainerTemplate, /Attending Consultant/);
  assert.match(retainerTemplate, /class="parties"/);
  assert.match(retainerTemplate, /export function wrapRetainerDocument/);

  // Signing is the same logic either way — no-login public route and the
  // logged-in client portal both call the one shared signing function —
  // but a retainer specifically forces a drawn signature, never typed.
  assert.match(clientPortalController, /export async function applyAgreementSignature/);
  assert.match(clientPortalController, /renderDocument = agreementDocumentHtml/);
  assert.match(clientPortalController, /applyAgreementSignature\(\{[\s\S]*?userId: req\.auth\.userId,/);
  assert.match(publicRetainerController, /import \{ applyAgreementSignature, publicAgreement \} from "\.\/clientPortalController\.js"/);
  assert.match(publicRetainerController, /import \{ wrapRetainerDocument \} from "\.\.\/modules\/leads\/retainerDocumentTemplate\.js"/);
  assert.match(publicRetainerController, /signatureMethod: "drawn",/);
  assert.match(publicRetainerController, /renderDocument: wrapRetainerDocument,/);
  assert.match(publicRetainerController, /applyAgreementSignature\(\{[\s\S]*?userId: null,/);

  // Public, no-login routes keyed by the same manageToken already used for
  // guest appointment self-service.
  assert.match(publicBookingRoutes, /router\.get\("\/manage\/:manageToken\/retainer", readLimit, asyncHandler\(getManagedRetainer\)\)/);
  assert.match(publicBookingRoutes, /router\.post\("\/manage\/:manageToken\/retainer\/sign", writeLimit, asyncHandler\(signManagedRetainer\)\)/);

  // Frontend: a real page reachable without login, wired to those routes,
  // with no typed-signature option — drawn only.
  assert.match(appRoutes, /path="\/retainer\/:manageToken"/);
  assert.match(appRoutes, /<PublicRetainerSignPage \/>/);
  assert.match(bookingApi, /getManagedRetainer|signManagedRetainer/);
  assert.match(signPage, /SignaturePad/);
  assert.doesNotMatch(signPage, /Type signature/);
  assert.doesNotMatch(signPage, /useState\("typed"\)/);
});
