import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CASE_DATE_FIELDS,
  CASE_HEADER_MAP,
  CONTACT_DATE_FIELDS,
  CONTACT_HEADER_MAP,
  caseEasyAssigneeNameMatches,
  classifyWorkbookHeaders,
  isUsableCaseEasyCaseType,
  linkImportedContactsToExistingClients,
  mapRow,
  resolveCaseEasyAssigneeUserIds,
} from "../src/services/caseEasyImportService.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("Case Easy contacts and cases exports are classified from their real headers", () => {
  const contactHeaders = Object.keys(CONTACT_HEADER_MAP).filter(
    (header) => header !== "Client Identifier",
  );
  const caseHeaders = Object.keys(CASE_HEADER_MAP).filter(
    (header) => header !== "Client Identifier",
  );
  assert.equal(classifyWorkbookHeaders(contactHeaders).type, "contacts");
  assert.equal(classifyWorkbookHeaders(caseHeaders).type, "cases");
});

test("Case Easy placeholder case types are treated as missing", () => {
  assert.equal(isUsableCaseEasyCaseType("Unassigned Case Type"), false);
  assert.equal(isUsableCaseEasyCaseType("  unassigned   case type "), false);
  assert.equal(isUsableCaseEasyCaseType(""), false);
  assert.equal(isUsableCaseEasyCaseType("Study Permit: Application"), true);
});

test("late Case Easy imports link to one exact existing client without guessing", async () => {
  const contactUpdates = [];
  const reportUpdates = [];
  const db = {
    caseEasyImportContact: {
      findMany: async () => [
        { id: "anwari-import", email: "anwarimalik15@gmail.com", phone: "+1 647 676 0329" },
        { id: "ambiguous-import", email: "shared@example.com", phone: null },
      ],
      update: async (operation) => contactUpdates.push(operation),
    },
    caseEasyImportReportRow: {
      updateMany: async (operation) => reportUpdates.push(operation),
    },
    client: {
      findMany: async () => [
        { id: "anwari-client", emailNormalized: "anwarimalik15@gmail.com", phoneNormalized: "+16476760329" },
        { id: "shared-1", emailNormalized: "shared@example.com", phoneNormalized: null },
        { id: "shared-2", emailNormalized: "shared@example.com", phoneNormalized: null },
      ],
    },
  };

  assert.equal(await linkImportedContactsToExistingClients("agency-1", db), 1);
  assert.deepEqual(contactUpdates, [{
    where: { id: "anwari-import" },
    data: { convertedClientId: "anwari-client", importStatus: "converted" },
  }]);
  assert.deepEqual(reportUpdates, [{
    where: { agencyId: "agency-1", linkedContactId: "anwari-import" },
    data: { linkedClientId: "anwari-client" },
  }]);
});

test("Case Easy raw fields preserve UCI and marital status for conversion", () => {
  const errors = [];
  const contact = mapRow(
    {
      rowNumber: 2,
      raw: {
        UCI: "1234-5678",
        "First Name": "Katy",
        "Last Name": "Perry",
        "Marital Status": "Married",
        "Date of Birth": "1984-10-25",
      },
    },
    CONTACT_HEADER_MAP,
    CONTACT_DATE_FIELDS,
    "contacts",
    errors,
  );
  assert.equal(contact.uci, "1234-5678");
  assert.equal(contact.maritalStatus, "Married");
  assert.ok(contact.dateOfBirth instanceof Date);
  assert.deepEqual(errors, []);
});

test("Case Easy abbreviated assignees resolve only to one active staff identity", () => {
  const staff = [
    { id: "afi", fullName: "Afi Mariam" },
    { id: "gagan", fullName: "Gagandeep Singh Dhillon" },
    { id: "harpreet", fullName: "Harpreet Kaur" },
  ];
  assert.equal(caseEasyAssigneeNameMatches("Afi M.", "Afi Mariam"), true);
  assert.equal(
    caseEasyAssigneeNameMatches(
      "Gagandeep Singh D.",
      "Gagandeep Singh Dhillon",
    ),
    true,
  );
  assert.deepEqual(
    resolveCaseEasyAssigneeUserIds("Harpreet  K.", staff),
    ["harpreet"],
  );
  // A case naming two real, active people must resolve BOTH — this used to
  // return nothing at all just because there was more than one name, which
  // left every genuinely multi-assignee case stuck in manual review forever
  // even though every name on it matched cleanly.
  assert.deepEqual(
    resolveCaseEasyAssigneeUserIds("Afi M.;Gagandeep Singh D.", staff),
    ["afi", "gagan"],
  );
  // A name that matches nobody is simply dropped, not treated as a reason to
  // discard every other name that did resolve.
  assert.deepEqual(
    resolveCaseEasyAssigneeUserIds("Afi M.;Former Staff X.", staff),
    ["afi"],
  );
  // Nothing resolves only when literally none of the names match anyone.
  assert.deepEqual(
    resolveCaseEasyAssigneeUserIds("Former Staff X.;Former Staff Y.", staff),
    [],
  );
});

// A case can only ever be assigned to an admin or consultant
// (validateCaseAssignee in caseController.js is the one app-wide rule) — a
// front desk staffer showing up here as auto-matchable or pickable used to
// mean a case would always fail its real assignee check at conversion time
// with a confusing "not active" error, even though the account was active.
test("Case Easy assignee resolution and the conversion screen's picker exclude front desk, matching the app-wide case-assignee rule", async () => {
  const [service, page] = await Promise.all([
    source("../src/services/caseEasyImportService.js"),
    source("../../frontend/src/pages/CaseEasyImport.jsx"),
  ]);
  assert.match(
    service,
    /agencyId,\s*status: "active",\s*role: \{ in: \["admin", "consultant"\] \},/,
  );
  assert.doesNotMatch(
    service.slice(service.indexOf("resolveCaseEasyLinks")),
    /role: \{ in: \["admin", "consultant", "frontdesk"\] \}/,
  );
  assert.match(
    page,
    /filter\(\(person\) => \["admin", "consultant"\]\.includes\(person\.role\)\)/,
  );
  assert.equal(caseEasyAssigneeNameMatches("Simar K.", "Harpreet Kaur"), false);
});

test("Case Easy link resolution uses secondary export fields without fuzzy contact guessing", async () => {
  const service = await source("../src/services/caseEasyImportService.js");
  assert.match(service, /extractEmailKeys\(kase\.email, kase\.otherEmails\)/);
  assert.match(service, /extractPhoneKeys\(kase\.phone, kase\.otherContacts\)/);
  assert.match(service, /contactsByNameTokens/);
  assert.match(service, /exactNameMatch\.id === tokenNameMatch\.id/);
  assert.match(service, /values\.length === 1 \? values\[0\] : null/);
});

test("Case Easy conversion writes assessment paths and validates agency staff", async () => {
  const controller = await source(
    "../src/controllers/caseEasyImportController.js",
  );
  assert.match(
    controller,
    /profileQuestionnaires = \{ canadianStatus: \{ uci \} \}/,
  );
  assert.match(controller, /formData\.profile = \{ maritalStatus \}/);
  assert.match(controller, /maritalStatus: importedMaritalStatus/);
  assert.match(
    controller,
    /agencyId,[\s\S]*status: "active"[\s\S]*role: \{ in: \["admin", "consultant"\] \}/,
  );
  assert.match(controller, /CASE_STAGES\.includes\(stage\)/);
  assert.match(controller, /Next action is required/);
  assert.match(controller, /FOR UPDATE/);
  assert.match(controller, /lockedStagingCase/);
  assert.match(controller, /resolveImportedCaseType/);
  assert.match(controller, /canonicalCaseType/);
  assert.equal((controller.match(/assignDefaultWorkflowToCase\(tx/g) || []).length, 2);
  assert.doesNotMatch(controller, /identificationNumber:\s*(contact\.uci|uci)/);
});

test("a staging case's resolvedAssigneeUserId is re-checked against admin/consultant at conversion time, not trusted as a stale fallback straight onto the real Case", async () => {
  const controller = await source("../src/controllers/caseEasyImportController.js");
  // Single-contact conversion: cases without an explicit assignedUserId
  // fall back to resolvedAssigneeUserId, but only if it's still eligible —
  // resolveCaseEasyLinks only recomputes non-converted rows, so a value
  // computed before candidates were restricted to admin/consultant can
  // still be sitting there stale.
  const singleFn = controller.slice(controller.indexOf("export async function convertCaseEasyImportContact"), controller.indexOf("export async function bulkConvertCaseEasyImportContacts"));
  assert.match(singleFn, /const fallbackAssigneeIds = \[/);
  assert.match(singleFn, /role: \{ in: \["admin", "consultant"\] \}/);
  assert.match(singleFn, /const primaryAssigneeId = caseInput\.assignedUserId \|\| \(eligibleFallbackAssigneeIds\.has\(stagingCase\.resolvedAssigneeUserId\) \? stagingCase\.resolvedAssigneeUserId : null\);/);
  assert.match(singleFn, /assignedUserId: primaryAssigneeId,/);
  assert.doesNotMatch(singleFn, /assignedUserId: caseInput\.assignedUserId \|\| stagingCase\.resolvedAssigneeUserId \|\| null/);

  // Bulk conversion: same staleness risk, checked once up front for the
  // whole batch instead of per-contact (avoids an N+1 query).
  const bulkFn = controller.slice(controller.indexOf("export async function bulkConvertCaseEasyImportContacts"));
  assert.match(bulkFn, /const candidateFallbackAssigneeIds = \[/);
  assert.match(bulkFn, /const bulkPrimaryAssigneeId = eligibleFallbackAssigneeIds\.has\(planned\.stagingCase\.resolvedAssigneeUserId\) \? planned\.stagingCase\.resolvedAssigneeUserId : null;/);
  assert.match(bulkFn, /assignedUserId: bulkPrimaryAssigneeId,/);
  assert.doesNotMatch(bulkFn, /assignedUserId: planned\.stagingCase\.resolvedAssigneeUserId \|\| null/);
});

test("a case naming multiple Case Easy assignees converts with all of them instead of getting stuck in review — additional assignees get the same active-staff eligibility recheck as the primary", async () => {
  const [service, controller] = await Promise.all([
    source("../src/services/caseEasyImportService.js"),
    source("../src/controllers/caseEasyImportController.js"),
  ]);
  // resolveCaseEasyLinks no longer treats "more than one name" as an
  // automatic assignee_mismatch — only zero resolved names does.
  assert.match(service, /if \(assigneeNames\.length > 0 && !resolvedAssigneeUserIds\.length\) reasons\.push\("assignee_mismatch"\);/);
  assert.match(service, /kase\.resolvedAdditionalAssigneeUserIds = resolvedAdditionalAssigneeUserIds;/);

  const singleFn = controller.slice(controller.indexOf("export async function convertCaseEasyImportContact"), controller.indexOf("export async function bulkConvertCaseEasyImportContacts"));
  assert.match(singleFn, /const additionalAssigneeIds = \[/);
  assert.match(singleFn, /additionalAssignedUserIds: additionalAssignedUserIds,|additionalAssignedUserIds,/);
  assert.match(singleFn, /\.filter\(\(id\) => id !== primaryAssigneeId && eligibleFallbackAssigneeIds\.has\(id\)\);/);

  const bulkFn = controller.slice(controller.indexOf("export async function bulkConvertCaseEasyImportContacts"));
  assert.match(bulkFn, /const bulkAdditionalAssignedUserIds = \[\.\.\.new Set\(planned\.stagingCase\.resolvedAdditionalAssigneeUserIds \|\| \[\]\)\]/);
  assert.match(bulkFn, /\.filter\(\(id\) => id !== bulkPrimaryAssigneeId && eligibleFallbackAssigneeIds\.has\(id\)\);/);
});

test("Case Easy conversion carries over the original opened date and the one recoverable note, honestly marked and dated, instead of dropping them", async () => {
  const controller = await source("../src/controllers/caseEasyImportController.js");
  const singleFn = controller.slice(controller.indexOf("export async function convertCaseEasyImportContact"), controller.indexOf("export async function bulkConvertCaseEasyImportContacts"));
  assert.match(singleFn, /openedAt: stagingCase\.opened \|\| null,/);
  assert.match(singleFn, /if \(String\(stagingCase\.lastNote \|\| ""\)\.trim\(\)\) \{/);
  assert.match(singleFn, /Imported from Case Easy — last recorded note, dated/);
  assert.match(singleFn, /userId: null,/);

  const bulkFn = controller.slice(controller.indexOf("export async function bulkConvertCaseEasyImportContacts"));
  assert.match(bulkFn, /openedAt: planned\.stagingCase\.opened \|\| null,/);
  assert.match(bulkFn, /if \(String\(planned\.stagingCase\.lastNote \|\| ""\)\.trim\(\)\) \{/);
});

test("Case Easy conversion requires a real type instead of accepting its unassigned sentinel", async () => {
  const [controller, page] = await Promise.all([
    source("../src/controllers/caseEasyImportController.js"),
    source("../../frontend/src/pages/CaseEasyImport.jsx"),
  ]);
  assert.match(controller, /isUsableCaseEasyCaseType/);
  assert.match(controller, /Case type is required for every selected imported case/);
  assert.match(controller, /No imported cases have a valid case type/);
  assert.match(page, /Case Easy did not provide a real case type/);
  assert.match(page, /Case type needs review/);
  assert.match(page, /caseType: isUsableImportedCaseType\(kase\.caseType\) \? kase\.caseType : ""/);
});

test("Case Easy conversion notifies each assigned consultant", async () => {
  const controller = await source("../src/controllers/caseEasyImportController.js");
  assert.match(controller, /notifyCaseAssignment/);
  assert.match(controller, /source: "Imported from Case Easy"/);
  assert.equal((controller.match(/result\.cases\.map\(\(caseItem\) => notifyCaseAssignment/g) || []).length, 2);
});

test("Case Easy staging UI exposes unresolved cases and all raw source fields", async () => {
  const [page, controller, searchService] = await Promise.all([
    source("../../frontend/src/pages/CaseEasyImport.jsx"),
    source("../src/controllers/caseEasyImportController.js"),
    source("../src/services/caseEasySearchService.js"),
  ]);
  assert.match(page, /Cases without a matched contact/);
  assert.match(page, /View all raw Case Easy fields/);
  for (const field of [
    "companyName",
    "category",
    "tags",
    "officeLocation",
    "lastNote",
    "prospectOrClient",
  ]) {
    assert.match(page, new RegExp(`"${field}"`));
  }
  assert.match(page, /Convert to CaseDesk Client/);
  assert.match(page, /CaseEasyReportsBrowser/);
  assert.match(page, /Search name, client\/case number, email, or phone/);
  assert.match(page, /searchParams\.get\("contact"\)/);
  assert.match(controller, /buildCaseEasyContactSearchWhere\(search\)/);
  assert.match(searchService, /linkedCases:[\s\S]*caseNumber/);
  assert.match(searchService, /convertedClient:[\s\S]*clientNumber/);
});

test("Case Easy staging data remains tenant scoped for every internal staff role", async () => {
  const [routes, migration] = await Promise.all([
    source("../src/routes/caseEasyImportRoutes.js"),
    source(
      "../prisma/migrations/20260723170000_case_easy_staff_access/migration.sql",
    ),
  ]);
  assert.match(
    routes,
    /router\.use\(requireRole\("admin", "consultant", "frontdesk"\)\)/,
  );
  assert.match(migration, /current_agency_id\(\)/);
  assert.match(
    migration,
    /current_user_role\(\) IN \('admin', 'consultant', 'frontdesk'\)/,
  );
});

test("Case Easy is a main staff tab directly above Settings", async () => {
  const [sidebar, routes, settings, page] = await Promise.all([
    source("../../frontend/src/components/layout/Sidebar.jsx"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
    source("../../frontend/src/pages/Settings.jsx"),
    source("../../frontend/src/pages/CaseEasyImport.jsx"),
  ]);
  assert.match(
    sidebar,
    /Case Easy Import[\s\S]*\/app\/case-easy-import[\s\S]*Settings/,
  );
  assert.match(
    routes,
    /case-easy-import"[\s\S]*<Access page="caseEasyImport">/,
  );
  assert.doesNotMatch(settings, /id: "case-easy-import"/);
  assert.match(page, /<CaseEasyImportSettingsPanel \/>/);
});

test("materializeCaseEasyLastNotes attaches the note to the client as soon as its contact is converted — never waits on the specific case also being converted, since that stays a separate staff decision", async () => {
  const service = await source("../src/services/caseEasyImportService.js");
  const fn = service.slice(service.indexOf("export async function materializeCaseEasyLastNotes"), service.indexOf("export async function materializeCaseEasyLastNotes") + service.slice(service.indexOf("export async function materializeCaseEasyLastNotes")).indexOf("\nexport async function", 1));
  // Gated on the linked CONTACT being converted (a real client exists), not
  // on the case's own importStatus/convertedCaseId — this is the fix for a
  // client like Anwari whose contact converted but whose case is still
  // sitting unconverted by deliberate choice.
  assert.doesNotMatch(fn, /importStatus: "converted",/);
  assert.match(fn, /linkedContact: \{ convertedClientId: \{ not: null \} \},/);
  assert.match(fn, /materializedNoteId: null,/);
  assert.match(fn, /lastNote: \{ not: null \},/);
  assert.match(fn, /caseId: kase\.convertedCaseId \|\| null,/);
  assert.match(fn, /userId: null,/);
  assert.match(fn, /await prisma\.caseEasyImportCase\.update\(\{ where: \{ id: kase\.id \}, data: \{ materializedNoteId: note\.id \} \}\);/);
});

test("materializeCaseEasyActivityNotes turns linked Activity Tracker rows into real notes, resolving the author the same conservative way as case assignees, idempotently", async () => {
  const service = await source("../src/services/caseEasyReportImportService.js");
  assert.match(service, /caseEasyAssigneeNameMatches,\s*\n\s*normalizeKey,/);
  const fn = service.slice(service.indexOf("export async function materializeCaseEasyActivityNotes"));
  assert.match(fn, /reportType: "activity_tracker",/);
  assert.match(fn, /linkStatus: "linked",/);
  assert.match(fn, /materializedNoteId: null,/);
  // Rows with no real description are skipped, not turned into empty notes.
  assert.match(fn, /if \(!description\) \{\s*\n\s*stats\.skipped \+= 1;\s*\n\s*continue;\s*\n\s*\}/);
  // Same fail-safe matcher as case assignees — an author is only ever
  // credited when the "Created By" name unambiguously matches one real
  // active user, never guessed.
  assert.match(fn, /users\.find\(\(user\) => caseEasyAssigneeNameMatches\(createdBy, user\.fullName\)\)/);
  assert.match(fn, /userId: matchedAuthor\?\.id \|\| null,/);
  assert.match(fn, /await prisma\.caseEasyImportReportRow\.update\(\{ where: \{ id: row\.id \}, data: \{ materializedNoteId: note\.id \} \}\);/);
});

test("uploading a Case Easy report always tries to materialize newly-linked Activity Tracker notes, not just when the upload itself is an Activity Tracker file", async () => {
  const controller = await source("../src/controllers/caseEasyImportController.js");
  const fn = controller.slice(controller.indexOf("export async function confirmCaseEasyReportUpload"), controller.indexOf("export async function syncCaseEasyNotes"));
  assert.match(fn, /const noteStats = await materializeCaseEasyActivityNotes\(req\.user\.agencyId\);/);
  assert.doesNotMatch(fn, /if \(result\.reportType === "activity_tracker"\)/);
});

test("Case Easy notes can be manually re-synced on demand — a deliberate action, never run automatically against already-converted cases in bulk", async () => {
  const [controller, routes, api, panel] = await Promise.all([
    source("../src/controllers/caseEasyImportController.js"),
    source("../src/routes/caseEasyImportRoutes.js"),
    source("../../frontend/src/api/caseEasyImportApi.js"),
    source("../../frontend/src/components/settings/CaseEasyReportImportPanel.jsx"),
  ]);
  const fn = controller.slice(controller.indexOf("export async function syncCaseEasyNotes"));
  assert.match(fn, /materializeCaseEasyLastNotes\(agencyId\),/);
  assert.match(fn, /materializeCaseEasyActivityNotes\(agencyId\),/);
  assert.match(routes, /router\.post\("\/notes\/sync", rateLimit\(\{ windowMs: 60_000, max: 5 \}\), asyncHandler\(syncCaseEasyNotes\)\);/);
  assert.match(api, /export async function syncCaseEasyNotes\(\) \{/);
  assert.match(panel, /Sync notes now/);
  assert.match(panel, /onClick=\{runNoteSync\}/);
});

test("the case profile surfaces its Case Easy origin, its extra imported assignees, and a dedicated historical payment/invoice history — all previously missing from CaseProfile.jsx entirely", async () => {
  const [caseController, tabs, ledgerCard, routes, api] = await Promise.all([
    source("../src/controllers/caseController.js"),
    source("../../frontend/src/components/case-profile/CaseWorkspaceTabs.jsx"),
    source("../../frontend/src/components/case-profile/CaseEasyHistoricalLedgerCard.jsx"),
    source("../src/routes/caseEasyImportRoutes.js"),
    source("../../frontend/src/api/caseEasyImportApi.js"),
  ]);
  // Same take:1-boolean pattern already used for the client-level badge.
  assert.match(caseController, /caseEasyImportCases: \{ select: \{ id: true \}, take: 1 \},/);
  assert.match(caseController, /res\.json\(\{ data: await withAdditionalAssignedUsers\(data\) \}\);/);
  assert.match(tabs, /import CaseEasyOriginBadge from "\.\.\/clients\/CaseEasyOriginBadge";/);
  assert.match(tabs, /caseItem\.caseEasyImportCases\?\.length \? \(/);
  assert.match(tabs, /caseItem\.additionalAssignedUsers\?\.length \? \(/);
  assert.match(tabs, /<CaseEasyHistoricalLedgerCard caseId=\{caseItem\.id\} hasCaseEasyOrigin=\{Boolean\(caseItem\.caseEasyImportCases\?\.length\)\} \/>/);
  // Strictly informational — never included in the tab's real payment
  // totals, never anywhere near the real invoice-creation code.
  assert.match(ledgerCard, /not included in the totals above and not connected to QuickBooks/);
  assert.doesNotMatch(ledgerCard, /NewInvoiceSheet|CashPaymentRow|onRecordPayment/);
  assert.match(routes, /router\.get\("\/cases\/:caseId\/reports", asyncHandler\(getCaseEasyReportsForCase\)\);/);
  assert.match(api, /export async function getCaseEasyReportsForCase\(caseId\) \{/);
});

test("the client profile shows the same historical payment/invoice ledger as the case profile — visible even before any of the client's cases has been converted, since Case Easy report rows link to a client independently of case conversion", async () => {
  const [clientProfile, clientCard, sharedModule] = await Promise.all([
    source("../../frontend/src/pages/ClientProfile.jsx"),
    source("../../frontend/src/components/clients/ClientCaseEasyLedgerCard.jsx"),
    source("../../frontend/src/components/case-easy/caseEasyLedgerShared.jsx"),
  ]);
  assert.match(clientProfile, /import ClientCaseEasyLedgerCard from "\.\.\/components\/clients\/ClientCaseEasyLedgerCard";/);
  assert.match(clientProfile, /<ClientCaseEasyLedgerCard clientId=\{client\.id\} hasCaseEasyOrigin=\{Boolean\(client\.caseEasyImportContacts\?\.length\)\} \/>/);
  assert.match(clientCard, /getCaseEasyReportsForClient\(clientId\)/);
  assert.match(clientCard, /not connected to QuickBooks or any invoice\/payment record/);
  // Both the case-level and client-level cards share the same row-rendering
  // and report-type filtering logic, not two independently-drifting copies.
  assert.match(sharedModule, /export const PAYMENT_REPORT_TYPES = new Set\(\[/);
  assert.match(sharedModule, /export function LedgerRow\(/);
});

test("imported Case Easy notes carry a visible label wherever notes are shown, so they're never mistaken for something a real staff member wrote today", async () => {
  const [clientProfile, caseNoteCard] = await Promise.all([
    source("../../frontend/src/pages/ClientProfile.jsx"),
    source("../../frontend/src/components/case-profile/notes/NoteCard.jsx"),
  ]);
  for (const source_ of [clientProfile, caseNoteCard]) {
    assert.match(source_, /const CASE_EASY_NOTE_PREFIX = "Imported from Case Easy";/);
    assert.match(source_, /note\.content\?\.startsWith\(CASE_EASY_NOTE_PREFIX\)/);
    assert.match(source_, /title="Imported from Case Easy"/);
  }
});
