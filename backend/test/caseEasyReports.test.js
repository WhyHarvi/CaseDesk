import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CASE_EASY_REPORT_DEFINITIONS,
  detectCaseEasyReportType,
  inferCaseEasyReportTypeFromFileName,
  mapCaseEasyReportRows,
  selectCaseEasyClientListingIdentity,
} from "../src/services/caseEasyReportImportService.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("all supported Case Easy reports are catalogued", () => {
  assert.deepEqual(Object.keys(CASE_EASY_REPORT_DEFINITIONS), [
    "case_types",
    "payment_requests",
    "invoices",
    "payments",
    "receipts",
    "account_receivables",
    "retainer_balances",
    "client_listing",
    "trust_balances",
    "reminders",
    "time_entries",
    "trust_account_entries",
    "activity_tracker",
    "case_information",
    "employers_applications",
    "e_signatures",
  ]);
  for (const excluded of [
    "cicc_annual_report",
    "caseeasy_pay",
    "audit_history",
  ]) {
    assert.equal(CASE_EASY_REPORT_DEFINITIONS[excluded], undefined);
  }
  for (const [type, definition] of Object.entries(
    CASE_EASY_REPORT_DEFINITIONS,
  )) {
    assert.equal(
      detectCaseEasyReportType(definition.signatures).type,
      type,
      `${definition.label} should be independently detectable`,
    );
  }
});

test("Case Types aggregate exports are recognized and preserved", () => {
  const headers = [
    "Case Type",
    "Location(s)",
    "Retainers On File",
    "No Retainers",
    "Total",
    "Month(Year)",
  ];
  assert.equal(detectCaseEasyReportType(headers).type, "case_types");
  assert.equal(
    inferCaseEasyReportTypeFromFileName("CaseTypes-export-2026-08-13.xlsx"),
    "case_types",
  );
  const mapped = mapCaseEasyReportRows({
    headers,
    rows: [
      {
        rowNumber: 2,
        raw: {
          "Case Type": "Visitor Visa",
          "Location(s)": "London",
          "Retainers On File": "1",
          "No Retainers": "2",
          Total: "3",
          "Month(Year)": "Apr (2022)",
        },
      },
    ],
  });
  assert.equal(mapped.reportType, "case_types");
  assert.equal(mapped.rows[0].caseType, "Visitor Visa");
  assert.equal(mapped.rows[0].rawData.Total, "3");
});

test("Client Listing is detected and preserves its source columns", () => {
  const headers = [
    "Case Number",
    "Unique Client Identifier (UCI)",
    "Client Identifier",
    "Full Name",
    "Email",
    "Case Type",
    "Case Status",
    "Trust Balance",
    "Currency",
    "Trust Account",
    "Created Date",
  ];
  assert.equal(detectCaseEasyReportType(headers).type, "client_listing");
  const mapped = mapCaseEasyReportRows(
    {
      headers,
      rows: [
        {
          rowNumber: 2,
          raw: {
            "Case Number": "00002-Perry",
            "Client Identifier": "KP-2",
            "Full Name": "Katy Perry",
            Email: "katy@example.com",
            "Trust Balance": "2500.00",
            Currency: "CAD",
            "Trust Account": "General Trust",
            "Created Date": "2026-01-01",
          },
        },
      ],
    },
  );
  assert.equal(mapped.reportType, "client_listing");
  assert.equal(mapped.rows[0].clientIdentifier, "KP-2");
  assert.equal(mapped.rows[0].caseNumber, "00002-Perry");
  assert.equal(mapped.rows[0].rawData["Trust Balance"], "2500.00");
  assert.equal(mapped.rows[0].rawData["Trust Account"], "General Trust");
  assert.equal(mapped.rows[0].sourceRowKey.length, 64);
});

test("report detection distinguishes milestone and financial exports", () => {
  assert.equal(
    detectCaseEasyReportType([
      "Case Number",
      "Foreign national arrival date",
      "Resubmission date",
      "Extension submission date",
      "Deferral received date",
    ]).type,
    "case_information",
  );
  assert.equal(
    detectCaseEasyReportType([
      "Case Number",
      "Transaction Number",
      "Payment Date",
      "Method",
      "Amount",
    ]).type,
    "payments",
  );
});

test("official identity-only Case Information exports are accepted by filename", () => {
  const headers = [
    "Case Number",
    "Full Name",
    "Email",
    "Case Type",
    "Case Status",
    "First Name",
    "Last Name",
    "Company Name",
  ];
  assert.equal(
    inferCaseEasyReportTypeFromFileName(
      "CaseInformationReport-export-2026-08-13.xlsx",
    ),
    "case_information",
  );
  const mapped = mapCaseEasyReportRows(
    {
      headers,
      rows: [
        {
          rowNumber: 2,
          raw: {
            "Case Number": "00101-Sharma",
            "Full Name": "Jagdeep Kaur Sharma",
            Email: "jagdeep@example.com",
            "Case Type": "Express Entry",
            "Case Status": "Prospect",
            "First Name": "Jagdeep Kaur",
            "Last Name": "Sharma",
            "Company Name": "",
          },
        },
      ],
    },
    "case_information",
  );
  assert.equal(mapped.reportType, "case_information");
  assert.equal(mapped.identityOnlyCaseInformation, true);
  assert.equal(mapped.rows.length, 1);
});

test("Case Information inherits the right Client Listing identity when a case number was reused", () => {
  const clientListingRows = [
    {
      caseNumber: "00834-",
      clientIdentifier: "H-12507",
      fullName: "Hunpreet Singh",
      email: "honey@example.com",
    },
    {
      caseNumber: "00834-",
      clientIdentifier: "A-17589",
      fullName: "Ashfaq Pathan",
      email: "ashfaq@example.com",
    },
  ];
  const match = selectCaseEasyClientListingIdentity(
    {
      caseNumber: "00834-",
      fullName: "Hunpreet  Singh",
      email: "HONEY@example.com",
    },
    clientListingRows,
  );
  assert.equal(match.ambiguous, false);
  assert.equal(match.record.clientIdentifier, "H-12507");

  const caseNumberOnly = selectCaseEasyClientListingIdentity(
    { caseNumber: "00834-" },
    clientListingRows,
  );
  assert.equal(caseNumberOnly.record, null);
  assert.equal(caseNumberOnly.ambiguous, true);
});

test("financial rows recover a Case Easy company identifier with a missing prefix", () => {
  const match = selectCaseEasyClientListingIdentity(
    {
      caseNumber: "00879-ActionForceTransportLtd",
      clientIdentifier: "-18612",
    },
    [
      {
        caseNumber: "00879-ActionForceTransportLtd",
        clientIdentifier: "A-18612",
        companyName: "Action Force Transport Ltd",
        linkStatus: "unlinked",
        importStatus: "reviewed",
      },
    ],
  );
  assert.equal(match.record.clientIdentifier, "A-18612");
  assert.equal(match.ambiguous, false);
});

test("Case Information can inherit a reviewed standalone company", () => {
  const match = selectCaseEasyClientListingIdentity(
    {
      caseNumber: "01555-Ltd",
      companyName: "Example Holdings Ltd.",
    },
    [
      {
        caseNumber: "01555-Ltd",
        clientIdentifier: "E-1555",
        companyName: "Example Holdings Ltd",
        linkStatus: "unlinked",
        importStatus: "reviewed",
      },
    ],
  );
  assert.equal(match.record.clientIdentifier, "E-1555");
  assert.equal(match.ambiguous, false);
});

test("large reports preserve every row, including identical duplicates", () => {
  const headers = [
    "Case Number",
    "Client Identifier",
    "Full Name",
    "Trust Balance",
    "Trust Account",
    "Created Date",
  ];
  const raw = {
    "Case Number": "00002-Perry",
    "Client Identifier": "KP-2",
    "Full Name": "Katy Perry",
    "Trust Balance": "2500.00",
    "Trust Account": "General Trust",
    "Created Date": "2026-01-01",
  };
  const rows = Array.from({ length: 10_025 }, (_, index) => ({
    rowNumber: index + 2,
    raw: { ...raw },
  }));
  const first = mapCaseEasyReportRows({ headers, rows }, "client_listing");
  const second = mapCaseEasyReportRows({ headers, rows }, "client_listing");

  assert.equal(first.rows.length, 10_025);
  assert.equal(new Set(first.rows.map((row) => row.sourceRowKey)).size, 10_025);
  assert.deepEqual(
    first.rows.map((row) => row.sourceRowKey),
    second.rows.map((row) => row.sourceRowKey),
  );
});

test("report staging prefers stable identifiers and follows conversion links", async () => {
  const [service, schema, migration, controller] = await Promise.all([
    source("../src/services/caseEasyReportImportService.js"),
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260723120000_case_easy_reports/migration.sql"),
    source("../src/controllers/caseEasyImportController.js"),
  ]);
  assert.match(schema, /model CaseEasyImportReportRow/);
  assert.match(schema, /clientIdentifier\s+String\?/);
  assert.match(migration, /foreign_national_arrival_date/);
  assert.match(migration, /case_easy_import_report_rows/);
  assert.match(service, /contactsByIdentifier/);
  assert.match(service, /casesByNumber/);
  assert.match(service, /backfillClientIdentifiers/);
  assert.match(service, /applyCaseInformationMilestones/);
  assert.match(controller, /linkedClientId: client\.id/);
  assert.match(controller, /linkedCaseId: newCase\.id/);
});

test("report upload, browser, and client history are connected", async () => {
  const [routes, settings, browser, clientCard, profile, controller, service, importService] = await Promise.all([
    source("../src/routes/caseEasyImportRoutes.js"),
    source("../../frontend/src/components/settings/CaseEasyReportImportPanel.jsx"),
    source("../../frontend/src/components/case-easy/CaseEasyReportsBrowser.jsx"),
    source("../../frontend/src/components/clients/CaseEasyReportsCard.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
    source("../src/controllers/caseEasyImportController.js"),
    source("../src/services/caseEasyReportImportService.js"),
    source("../src/services/caseEasyImportService.js"),
  ]);
  assert.match(routes, /"\/reports\/preview"/);
  assert.match(routes, /"\/reports\/upload"/);
  assert.match(routes, /"\/clients\/:clientId\/reports"/);
  assert.match(settings, /Client Listing — import this first/);
  assert.match(settings, /timeout: 300_000/);
  assert.match(browser, /row\.rawData/);
  assert.match(browser, /Standalone companies/);
  assert.match(browser, /row\.companyName/);
  assert.match(clientCard, /Case Easy report history/);
  assert.match(controller, /linkedContact: \{ convertedClientId: client\.id \}/);
  assert.match(importService, /caseEasyImportReportRow\.updateMany/);
  assert.doesNotMatch(profile, /role === "admin" \? <CaseEasyReportsCard/);
  assert.match(controller, /sheet\.rows\.length > 100_000/);
  assert.match(controller, /linkStatus === "standalone"/);
  assert.match(service, /caseEasyImportReportRow\.createMany/);
  assert.match(service, /narrowedCaseNumberCandidates/);
  assert.match(service, /selectCaseEasyClientListingIdentity/);
  assert.match(service, /hasUsableClientIdentifier/);
});
