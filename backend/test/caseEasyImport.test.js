import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CASE_DATE_FIELDS,
  CASE_HEADER_MAP,
  CONTACT_DATE_FIELDS,
  CONTACT_HEADER_MAP,
  classifyWorkbookHeaders,
  mapRow,
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

test("Case Easy raw fields map without moving UCI or marital status onto Client", () => {
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

test("Case Easy conversion writes assessment paths and validates agency staff", async () => {
  const controller = await source("../src/controllers/caseEasyImportController.js");
  assert.match(
    controller,
    /profileQuestionnaires = \{ canadianStatus: \{ uci \} \}/,
  );
  assert.match(controller, /formData\.profile = \{ maritalStatus \}/);
  assert.match(
    controller,
    /agencyId,[\s\S]*status: "active"[\s\S]*role: \{ in: \["admin", "consultant"\] \}/,
  );
  assert.match(controller, /CASE_STAGES\.includes\(stage\)/);
  assert.match(controller, /Next action is required/);
  assert.match(controller, /FOR UPDATE/);
  assert.match(controller, /lockedStagingCase/);
  assert.doesNotMatch(
    controller,
    /identificationNumber:\s*(contact\.uci|uci)/,
  );
});

test("Case Easy staging UI exposes unresolved cases and all raw source fields", async () => {
  const page = await source("../../frontend/src/pages/CaseEasyImport.jsx");
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
});

test("Case Easy staging data remains tenant scoped for every internal staff role", async () => {
  const [routes, migration] = await Promise.all([
    source("../src/routes/caseEasyImportRoutes.js"),
    source("../prisma/migrations/20260723170000_case_easy_staff_access/migration.sql"),
  ]);
  assert.match(routes, /router\.use\(requireRole\("admin", "consultant", "frontdesk"\)\)/);
  assert.match(migration, /current_agency_id\(\)/);
  assert.match(migration, /current_user_role\(\) IN \('admin', 'consultant', 'frontdesk'\)/);
});

test("Case Easy is a main staff tab directly above Settings", async () => {
  const [sidebar, routes, settings, page] = await Promise.all([
    source("../../frontend/src/components/layout/Sidebar.jsx"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
    source("../../frontend/src/pages/Settings.jsx"),
    source("../../frontend/src/pages/CaseEasyImport.jsx"),
  ]);
  assert.match(sidebar, /Case Easy Import[\s\S]*\/app\/case-easy-import[\s\S]*Settings/);
  assert.match(routes, /case-easy-import" element=\{<Internal allowFrontdesk>/);
  assert.doesNotMatch(settings, /id: "case-easy-import"/);
  assert.match(page, /<CaseEasyImportSettingsPanel \/>/);
});
